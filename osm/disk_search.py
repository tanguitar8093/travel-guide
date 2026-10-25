"""Disk-backed large-dataset name search; keep catalogs out of the HTTP process."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from threading import RLock
import uuid
from search import normalize

INDEX_VERSION = 2


def iter_places(path, metadata):
    """Decode one place at a time from the extractor's top-level places array."""
    decoder = json.JSONDecoder()
    with Path(path).open(encoding='utf-8') as stream:
        buffer = ''
        while True:
            chunk = stream.read(65536)
            if not chunk:
                raise ValueError('地點資料缺少 places 陣列。')
            buffer += chunk
            match = re.search(r'"places"\s*:\s*\[', buffer)
            if match:
                header = buffer[:match.start()]
                stamp = re.search(r'"dataTimestamp"\s*:\s*("(?:[^"\\]|\\.)*")', header)
                metadata['dataTimestamp'] = json.loads(stamp[1]) if stamp else 'unknown'
                position = match.end()
                break
        while True:
            while position < len(buffer) and (buffer[position].isspace() or buffer[position] == ','):
                position += 1
            if position < len(buffer) and buffer[position] == ']':
                return
            try:
                value, end = decoder.raw_decode(buffer, position)
            except json.JSONDecodeError:
                chunk = stream.read(65536)
                if not chunk:
                    raise ValueError('地點資料格式不完整。')
                buffer, position = buffer[position:]+chunk, 0
                continue
            if not isinstance(value, dict):
                raise ValueError('地點資料格式錯誤。')
            yield value
            position = end
            if position > 65536:
                buffer, position = buffer[position:], 0


def ensure_search_index(path):
    path = Path(path).resolve()
    stat = path.stat()
    stamp = json.dumps([INDEX_VERSION,str(path),stat.st_size,stat.st_mtime_ns])
    digest = hashlib.sha256(stamp.encode()).hexdigest()[:20]
    folder = path.parent / '.search-cache'
    target = folder / f'{path.stem}-{digest}.sqlite'
    if target.is_file():
        return target
    folder.mkdir(exist_ok=True)
    temporary = target.with_suffix(f'.{os.getpid()}.{uuid.uuid4().hex}.download')
    database = sqlite3.connect(temporary)
    try:
        database.executescript('''pragma journal_mode=off; pragma synchronous=off;
          create table places(id integer primary key,source_id text,name text,data text);
          create table names(place_id integer,value text);
          create table metadata(key text primary key,value text);''')
        previous_stamp=json.dumps([1,str(path),stat.st_size,stat.st_mtime_ns])
        previous=folder/f'{path.stem}-{hashlib.sha256(previous_stamp.encode()).hexdigest()[:20]}.sqlite'
        reused=False
        if previous.is_file():
            with sqlite3.connect(previous.as_uri()+'?mode=ro&immutable=1',uri=True) as source:
                if dict(source.execute('select key,value from metadata')).get('source')==previous_stamp:
                    source.backup(database)
                    reused=True
        if reused:
            database.execute('update metadata set value=? where key=?',(stamp,'source'))
        metadata, count = {}, 0
        for place in (() if reused else iter_places(path, metadata)):

            # Large datasets have no curated Okinawa aliases; preserve the existing response contract.
            values = [place['name'],place.get('english',''),*place.get('names',{}).values()]
            names = list(dict.fromkeys(normalize(value) for value in values if value))
            place['aliases'], place['aliasSource'] = [], None
            cursor = database.execute('insert into places(source_id,name,data) values(?,?,?)',
                (place['id'],place['name'],json.dumps(place,ensure_ascii=False,separators=(',',':'))))
            database.executemany('insert into names values(?,?)', [(cursor.lastrowid,value) for value in names])
            count += 1
        if not reused:
            database.executemany('insert into metadata values(?,?)',
                [('source',stamp),('timestamp',metadata.get('dataTimestamp','unknown')),('count',str(count))])
        database.execute('create index places_display on places(id,name,source_id)')
        database.commit()
        database.close()
        if path.stat().st_mtime_ns != stat.st_mtime_ns:
            raise ValueError('地點資料更新中，請完成更新後重啟地圖服務。')
        os.replace(temporary,target)
        return target
    finally:
        database.close()
        temporary.unlink(missing_ok=True)


class DiskPlaceSearch:
    def __init__(self, path):
        index = ensure_search_index(path)
        self.connection = sqlite3.connect(index.as_uri()+'?mode=ro&immutable=1', uri=True, check_same_thread=False)
        metadata = dict(self.connection.execute('select key,value from metadata'))
        self.timestamp, self.entry_count = metadata['timestamp'], int(metadata['count'])
        self.lock = RLock()

    def search(self, query):
        if not isinstance(query,str) or len(query)>100:
            raise ValueError('搜尋文字最多 100 個字。')
        term = normalize(query)
        if not term:
            return {'results':[],'total':0,'suggestion':None}
        # SQLite scans compact normalized strings in C. Only the best 30 full
        # records are decoded, and SQLite's temporary working storage stays bounded.
        with self.lock:
            rows = self.connection.execute('''with matched as (
              select place_id,length(value) namelen,
                case when value=:term then 0 when instr(value,:term)=1 then 1 else 2 end score
              from names where instr(value,:term)>0
            ), ranked_names as (
              select *,row_number() over(partition by place_id order by score,namelen) position from matched
            ), best as (select * from ranked_names where position=1), selected as (
              select b.place_id,b.score,b.namelen,p.name,p.source_id,count(*) over() total
              from best b join places p indexed by places_display on p.id=b.place_id
              order by b.score,b.namelen,p.name,p.source_id limit 30
            )
            select p.data,s.total from selected s join places p on p.id=s.place_id
            order by s.score,s.namelen,s.name,s.source_id''',{'term':term}).fetchall()
        return {'results':[{key:value for key,value in json.loads(row[0]).items() if not key.startswith('_')} for row in rows],
                'total':rows[0][1] if rows else 0,'suggestion':None,'dataTimestamp':self.timestamp}
