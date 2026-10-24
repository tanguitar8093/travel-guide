"""Index construction preserves access/direction and invalidates on source changes."""
from pathlib import Path
import sqlite3
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routing_index import ensure_routing_index

with tempfile.TemporaryDirectory() as folder:
    path = Path(folder)/'roads.sqlite'
    with sqlite3.connect(path) as source:
        source.executescript('''create table nodes(id integer primary key,lon real,lat real);
          create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,
            walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer);''')
        source.executemany('insert into nodes values(?,?,?)',[(1,127.68,26.21),(2,127.681,26.21),(3,127.682,26.21)])
        source.executemany('insert into edges values(?,?,?,?,?,?,?,?,?)',[(1,2,100,10,1,None,0,None,0),(2,3,100,None,0,80,0,None,0)])
    first = ensure_routing_index(path)
    assert ensure_routing_index(path) == first
    with sqlite3.connect(first) as index:
        rows = {row[0]:row[1:] for row in index.execute('select id,car_component,walk_component,outgoing from nodes')}
        assert rows[1][0] == rows[2][0] != rows[3][0]
        assert rows[1][1] != rows[2][1] == rows[3][1]
        assert rows[1][2] == 1 and rows[2][2] == 2 and rows[3][2] == 2
    with sqlite3.connect(path) as source:
        source.execute('update edges set walk_seconds=80 where a=1')
    second = ensure_routing_index(path)
    assert second != first
    with sqlite3.connect(second) as index:
        assert index.execute('select count(distinct walk_component) from nodes').fetchone()[0] == 1
    invalid = Path(folder)/'invalid.sqlite'
    sqlite3.connect(invalid).close()
    try: ensure_routing_index(invalid)
    except sqlite3.Error: pass
    else: raise AssertionError('Incomplete routing source accepted')
    assert not list((Path(folder)/'.routing-cache').glob('*.download'))
print('PASS: profile components, direction flags, cache reuse/invalidation, atomic preparation')
