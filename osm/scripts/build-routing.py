"""Split OSM roads at junctions and retain full road geometry in a disk-backed regional graph."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sqlite3
import sys
import zlib
import osmium
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from routing import allowed, speed, distance

class Count(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.counts=Counter()
        self.ends=set()
    def way(self,way):
        if 'highway' not in way.tags or len(way.nodes)<2: return
        tags=dict(way.tags)
        if not any(allowed(tags,mode) for mode in ('car','walk','bike')): return
        self.counts.update(node.ref for node in way.nodes)
        self.ends.update((way.nodes[0].ref,way.nodes[-1].ref))

class Build(osmium.SimpleHandler):
    def __init__(self,count,connection):
        super().__init__()
        self.count=count
        self.db=connection
        self.total=0
    def way(self,way):
        if 'highway' not in way.tags or len(way.nodes)<2: return
        tags=dict(way.tags)
        modes=[allowed(tags,mode) for mode in ('car','walk','bike')]
        if not any(modes) or any(not n.location.valid() for n in way.nodes): return
        nodes=list(way.nodes)
        start=0
        walked=0
        for index in range(1,len(nodes)):
            n=nodes[index]
            previous=nodes[index-1]
            walked+=distance([previous.lon,previous.lat],[n.lon,n.lat])
            if self.count.counts[n.ref]<2 and n.ref not in self.count.ends and walked<250: continue
            segment=nodes[start:index+1]
            points=[[n.lon,n.lat] for n in segment]
            meters=sum(distance(a,b) for a,b in zip(points,points[1:]))
            first,last=segment[0],segment[-1]
            self.db.executemany('insert or ignore into nodes values(?,?,?)',[(first.ref,first.lon,first.lat),(last.ref,last.lon,last.lat)])
            profiles=[]
            one=tags.get('oneway','yes' if tags.get('junction')=='roundabout' else 'no')
            for mode,enabled in zip(('car','walk','bike'),modes):
                direction=tags.get('oneway:foot','no') if mode=='walk' else tags.get('oneway:bicycle',one) if mode=='bike' else one
                if mode=='bike' and any(tags.get(k,'').startswith('opposite') for k in ('cycleway','cycleway:left','cycleway:right')): direction='no'
                profiles.extend((meters/(speed(tags,mode)/3.6) if enabled else None,-1 if direction=='-1' else 1 if direction in ('yes','1','true') else 0))
            self.db.execute('insert into edges(a,b,meters,car_seconds,car_direction,walk_seconds,walk_direction,bike_seconds,bike_direction,geometry) values(?,?,?,?,?,?,?,?,?,?)',
                [first.ref,last.ref,meters,*profiles,zlib.compress(json.dumps(points,separators=(',',':')).encode(),1)])
            self.total+=1
            start=index
            walked=0


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('pbf')
    parser.add_argument('--dataset',choices=('okinawa','taiwan'),required=True)
    args=parser.parse_args()
    destination=ROOT/'data'/f'{args.dataset}-routing.sqlite'
    temporary=destination.with_suffix('.download')
    temporary.unlink(missing_ok=True)
    count=Count(); count.apply_file(args.pbf)
    print(f'Routing junction scan: {len(count.counts):,} road nodes',flush=True)
    with sqlite3.connect(temporary) as db:
        db.executescript('''pragma journal_mode=off; pragma synchronous=off;
            create table nodes(id integer primary key,lon real not null,lat real not null);
            create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer,geometry blob);
            create table metadata(key text primary key,value text);''')
        reader=osmium.io.Reader(args.pbf); stamp=reader.header().get('osmosis_replication_timestamp') or 'unknown'; reader.close()
        db.execute('insert into metadata values(?,?)',('timestamp',stamp))
        handler=Build(count,db);handler.apply_file(args.pbf,locations=True,idx='flex_mem')
        db.executescript('create index edges_forward on edges(a,b); create index edges_reverse on edges(b,a);')
        db.commit()
        print(f'Routing: {handler.total:,} segments; {db.execute("select count(*) from nodes").fetchone()[0]:,} junction nodes',flush=True)
    temporary.replace(destination)

if __name__=='__main__':main()
