"""Disposable spatial/connectivity index; routing edges and geometry remain in the source SQLite."""
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import uuid

INDEX_VERSION = 2
MODES = ('car', 'walk', 'bike')


def _find(parent, node):
    while parent[node] != node:
        parent[node] = parent[parent[node]]
        node = parent[node]
    return node


def ensure_routing_index(source_path):
    source_path = Path(source_path).resolve()
    stat = source_path.stat()
    stamp = json.dumps([INDEX_VERSION, str(source_path), stat.st_size, stat.st_mtime_ns])
    digest = hashlib.sha256(stamp.encode()).hexdigest()[:20]
    folder = source_path.parent / '.routing-cache'
    target = folder / f'{source_path.stem}-{digest}.sqlite'
    if target.is_file():
        return target
    folder.mkdir(exist_ok=True)
    temporary = target.with_suffix(f'.{os.getpid()}.{uuid.uuid4().hex}.download')
    source = sqlite3.connect(source_path.as_uri() + '?mode=ro&immutable=1', uri=True)
    output = sqlite3.connect(temporary)
    try:
        output.executescript('''pragma journal_mode=off; pragma synchronous=off;
          create table nodes(id integer primary key,lon real,lat real,
            car_component integer,walk_component integer,bike_component integer,outgoing integer,grid_x integer,grid_y integer);
          create table metadata(key text primary key,value text);''')
        # Compact union/find arrays are used only at preparation time, never per route.
        indices = {row[0]: index for index, row in enumerate(source.execute('select id from nodes order by id'))}
        count = len(indices)
        parents = [array('I', range(count)) for _ in MODES]
        ranks = [bytearray(count) for _ in MODES]
        outgoing = bytearray(count)
        query = '''select a,b,car_seconds is not null,car_direction,
          walk_seconds is not null,walk_direction,bike_seconds is not null,bike_direction from edges'''
        for row in source.execute(query):
            a, b = indices[row[0]], indices[row[1]]
            for mode in range(3):
                enabled, direction = row[2+mode*2:4+mode*2]
                if not enabled:
                    continue
                parent, rank = parents[mode], ranks[mode]
                root_a, root_b = _find(parent, a), _find(parent, b)
                if root_a != root_b:
                    if rank[root_a] < rank[root_b]:
                        root_a, root_b = root_b, root_a
                    parent[root_b] = root_a
                    if rank[root_a] == rank[root_b]:
                        rank[root_a] += 1
                if direction != -1:
                    outgoing[a] |= 1 << mode
                if direction != 1:
                    outgoing[b] |= 1 << mode
        def rows():
            for index, row in enumerate(source.execute('select id,lon,lat from nodes order by id')):
                yield (*row, *(_find(parent, index) for parent in parents), outgoing[index], math.floor(row[1]*100), math.floor(row[2]*100))
        output.executemany('insert into nodes values(?,?,?,?,?,?,?,?,?)', rows())
        output.execute('create index node_position on nodes(grid_x,grid_y)')
        output.execute('insert into metadata values(?,?)', ('source', stamp))
        output.commit()
        output.close()
        source.close()
        if source_path.stat().st_mtime_ns != stat.st_mtime_ns:
            raise ValueError('路網更新中，請完成更新後重啟地圖服務。')
        os.replace(temporary, target)
        return target
    finally:
        output.close()
        source.close()
        temporary.unlink(missing_ok=True)
