"""External junction counting and disk coordinate index; unchanged SQLite route graph."""
import argparse
import gc
from functools import lru_cache
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import osmium
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from routing import allowed
from routing_index import ensure_routing_index
spec=importlib.util.spec_from_file_location('routing_builder',Path(__file__).with_name('build-routing.py'))
legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)
class Counts:
    def __init__(self,db):self.db=db;self.counts=self;self.ends=self
    @lru_cache(maxsize=65536)
    def row(self,key):return self.db.execute('select refs,endpoint from counts where id=?',(key,)).fetchone() or (0,0)
    def __getitem__(self,key):return self.row(key)[0]
    def __contains__(self,key):return bool(self.row(key)[1])

def build(pbf,output,junction_index=None):
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.routing-build-',dir=output.parent) as folder:
        folder=Path(folder);refs=folder/'refs.txt';sorted_refs=folder/'sorted.txt'
        if junction_index:
            countdb=sqlite3.connect(Path(junction_index).resolve().as_uri()+'?mode=ro&immutable=1',uri=True)
            countdb.execute('select id,refs,endpoint from counts limit 1').fetchone()
            print('Reusing complete read-only junction index',flush=True)
        else:
            with refs.open('w',buffering=1024*1024) as stream:
                class Count(osmium.SimpleHandler):
                    total=0
                    def way(self,w):
                        if len(w.nodes)<2 or 'highway' not in w.tags or not any(allowed(dict(w.tags),m) for m in ('car','walk','bike')):return
                        last=len(w.nodes)-1
                        stream.writelines(f'{n.ref}\t{int(i==0 or i==last)}\n' for i,n in enumerate(w.nodes));self.total+=1
                        if self.total%1000000==0:print(f'Counted {self.total:,} roads',flush=True)
                handler=Count();handler.apply_file(str(pbf));print(f'Count scan complete: {handler.total:,}',flush=True)
            subprocess.run(['sort','-n','-k1,1','-S','256M','--parallel=1','-T',str(folder),'-o',str(sorted_refs),str(refs)],check=True);refs.unlink()
            countdb=sqlite3.connect(folder/'counts.sqlite');countdb.executescript('pragma journal_mode=off;pragma synchronous=off;pragma cache_size=-32768;create table counts(id integer primary key,refs integer,endpoint integer);')
            def rows():
                previous=None;count=end=0
                with sorted_refs.open() as stream:
                    for line in stream:
                        node,flag=map(int,line.split())
                        if node!=previous:
                            if previous is not None:yield previous,min(count,2),end
                            previous=node;count=end=0
                        count+=1;end|=flag
                    if previous is not None:yield previous,min(count,2),end
            countdb.executemany('insert into counts values(?,?,?)',rows());countdb.commit();sorted_refs.unlink();print('Disk junction index ready',flush=True)
        temporary=folder/'routing.sqlite'
        with sqlite3.connect(temporary) as db:
            db.executescript('''pragma journal_mode=off;pragma synchronous=off;pragma cache_size=-32768;
            create table nodes(id integer primary key,lon real not null,lat real not null);
            create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer,geometry blob);
            create table metadata(key text primary key,value text);''')
            reader=osmium.io.Reader(str(pbf));stamp=reader.header().get('osmosis_replication_timestamp') or 'unknown';reader.close()
            db.execute('insert into metadata values(?,?)',('timestamp',stamp))
            handler=legacy.Build(Counts(countdb),db)
            processor=osmium.FileProcessor(str(pbf)).with_locations(f'sparse_file_array,{folder}/locations.idx').with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
            roads=0
            for way in processor:
                handler.way(way);roads+=1
                if roads%1000000==0:print(f'Built {roads:,} ways / {handler.total:,} segments',flush=True)
            db.executescript('create index edges_forward on edges(a,b);create index edges_reverse on edges(b,a);');db.commit()
            print(f'Routing graph complete: {handler.total:,} segments',flush=True)
        countdb.close();temporary.replace(output)
    del processor,handler
    Counts.row.cache_clear()
    gc.collect()
    print(ensure_routing_index(output),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('pbf');p.add_argument('--dataset',required=True);p.add_argument('--output',type=Path);p.add_argument('--junction-index',type=Path,help='Resume road construction from a complete same-source junction SQLite');a=p.parse_args();build(a.pbf,a.output or ROOT/'data'/f'{a.dataset}-routing.sqlite',a.junction_index)
