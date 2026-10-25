"""Bounded-memory named-place extraction, preserving the legacy relation rules."""
import argparse
from collections.abc import MutableMapping
import importlib.util
import json
from itertools import islice
from pathlib import Path
import sqlite3
import tempfile
import sys
import osmium
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from datasets import definition
spec=importlib.util.spec_from_file_location('place_extractor',Path(__file__).with_name('extract-places.py'))
legacy=importlib.util.module_from_spec(spec); spec.loader.exec_module(legacy)

class DiskMap(MutableMapping):
    def __init__(self,db,table):
        self.db,self.table=db,table
        db.execute(f'create table {table}(key text primary key,value text) without rowid')
    def __getitem__(self,key):
        row=self.db.execute(f'select value from {self.table} where key=?',(json.dumps(key),)).fetchone()
        if row is None: raise KeyError(key)
        return json.loads(row[0])
    def __setitem__(self,key,value):
        self.db.execute(f'insert or replace into {self.table} values(?,?)',(json.dumps(key),json.dumps(value,separators=(',',':'))))
    def __delitem__(self,key):
        self.db.execute(f'delete from {self.table} where key=?',(json.dumps(key),))
    def __iter__(self):
        for row in self.db.execute(f'select key from {self.table}'):
            key=json.loads(row[0]); yield tuple(key) if isinstance(key,list) else key
    def __len__(self):return self.db.execute(f'select count(*) from {self.table}').fetchone()[0]
    def items(self):
        for key,value in self.db.execute(f'select key,value from {self.table}'):
            yield json.loads(key),json.loads(value)

class Sink:
    def __init__(self,output):self.output=output;self.counts={'node':0,'way':0,'relation':0};self.total=0
    def append(self,row):
        if self.total:self.output.write(',')
        self.output.write(json.dumps(row,ensure_ascii=False,separators=(',',':')))
        self.total+=1;self.counts[row['id'].split('-')[1]]+=1
        if self.total%100000==0:print(f'Places: {self.total:,}',flush=True)

def extract(pbf,dataset,output):
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.places-build-',dir=output.parent) as folder:
        db=sqlite3.connect(Path(folder)/'work.sqlite');db.executescript('pragma journal_mode=off;pragma synchronous=off;pragma cache_size=-32768;')
        handler=legacy.Places(dataset);handler.locations=DiskMap(db,'locations');handler.relations=DiskMap(db,'relations')
        required_ways=DiskMap(db,'required_ways');required_nodes=DiskMap(db,'required_nodes');handler.required_ways=required_ways
        class Members(osmium.SimpleHandler):
            def relation(self,r):
                for m in r.members:
                    if m.type=='w':required_ways[m.ref]=True
                    elif m.type=='n':required_nodes[m.ref]=True
        Members().apply_file(str(pbf));db.commit();print('Relation members indexed',flush=True)
        members=iter(required_nodes)
        while batch:=list(islice(members,65536)):
            reader=osmium.FileProcessor(str(pbf),entities=osmium.osm.NODE).with_filter(osmium.filter.IdFilter(batch))
            for node in reader:
                point=[node.lon,node.lat]
                if legacy.dataset_inside(point,dataset):handler.locations[('n',node.id)]=point
            db.commit()
        print('Required relation node locations indexed',flush=True)
        temporary=Path(folder)/'places.json'
        with temporary.open('w') as out:
            processor=osmium.FileProcessor(str(pbf)).with_locations(f'sparse_file_array,{folder}/locations.idx')
            stamp=processor.header.get('osmosis_replication_timestamp') or 'unknown'
            header={'schemaVersion':2,'source':'OpenStreetMap via Geofabrik '+dataset,'dataTimestamp':stamp,'bounds':list(definition(dataset)['bounds'].values()),'coverage':definition(dataset)['source']}
            out.write(json.dumps(header,ensure_ascii=False,separators=(',',':'))[:-1]+',"places":[')
            sink=Sink(out);handler.places=sink
            # EmptyTagFilter still indexes every node before native filtering.
            class Untagged(osmium.SimpleHandler):
                def way(self,w):handler.way(w)
            processor=processor.with_filter(osmium.filter.EmptyTagFilter()).handler_for_filtered(Untagged())
            for obj in processor:
                if isinstance(obj,osmium.osm.Node):
                    handler.node(obj)
                elif isinstance(obj,osmium.osm.Way):handler.way(obj)
                elif isinstance(obj,osmium.osm.Relation):handler.relation(obj)
            db.commit();handler.finish();out.write('],"counts":'+json.dumps(sink.counts)+'}')
        db.close();temporary.replace(output)
        print(json.dumps({'places':sink.total,'counts':sink.counts,'bytes':output.stat().st_size}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('pbf');parser.add_argument('--dataset',required=True);parser.add_argument('--output',type=Path)
    args=parser.parse_args();extract(args.pbf,args.dataset,args.output or ROOT/'data'/f'{args.dataset}-places.json')
