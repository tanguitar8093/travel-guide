"""Disk builders must preserve multilingual/relation and road splitting semantics."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import osmium

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
from sys import path
path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import allowed
for transport in ('ferry','train','railway'):
    assert all(not allowed({'highway':'path','route':transport},mode) for mode in ('car','walk','bike'))
places=load('places_disk','extract-places-disk.py');routing=load('routing_disk','build-routing-disk.py')
with tempfile.TemporaryDirectory() as temp:
    root=Path(temp);pbf=root/'fixture.osm.pbf'
    with osmium.SimpleWriter(str(pbf)) as writer:
        for identifier,xy,tags in [(1,(127.7,26.2),{'name:ko':'한국'}),(2,(127.701,26.2),{}),(14313680697,(127.702,26.2),{}),(4,(127.701,26.201),{}),(8,(127.7005,26.2),{})]:
            writer.add_node(osmium.osm.mutable.Node(id=identifier,location=xy,tags=tags))
        writer.add_way(osmium.osm.mutable.Way(id=5,nodes=[1,8,2,14313680697],tags={'name:ja':'道','highway':'residential'}))
        writer.add_way(osmium.osm.mutable.Way(id=6,nodes=[2,4],tags={'highway':'residential','oneway':'yes'}))
        writer.add_way(osmium.osm.mutable.Way(id=9,nodes=[8,4],tags={'highway':'path','route':'ferry'}))
        writer.add_relation(osmium.osm.mutable.Relation(id=7,tags={'name':'Relation'},members=[('w',5,'outer'),('n',1,'label')]))
    original=places.legacy.Places('okinawa');original.apply_file(str(pbf),locations=True,idx='flex_mem');expected=original.finish()
    places.extract(pbf,'okinawa',root/'places.json');actual=json.loads((root/'places.json').read_text())
    assert sorted(actual['places'],key=lambda p:p['id'])==sorted(expected,key=lambda p:p['id'])
    assert actual['counts']=={'node':1,'way':1,'relation':1}
    routing.build(pbf,root/'routing.sqlite')
    count=routing.legacy.Count();count.apply_file(str(pbf))
    with sqlite3.connect(root/'baseline.sqlite') as db:
        db.executescript('create table nodes(id integer primary key,lon real,lat real);create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer,geometry blob);')
        handler=routing.legacy.Build(count,db);handler.apply_file(str(pbf),locations=True,idx='flex_mem');db.commit()
        built=sqlite3.connect(root/'routing.sqlite')
        assert built.execute('select * from nodes order by id').fetchall()==db.execute('select * from nodes order by id').fetchall()
        assert built.execute('select * from edges order by a,b').fetchall()==db.execute('select * from edges order by a,b').fetchall()
        built.close()
    # A complete junction superset may split a valid road more finely, but must
    # preserve its cost and must not introduce the excluded ferry connection.
    with sqlite3.connect(root/'junctions.sqlite') as db:
        db.execute('create table counts(id integer primary key,refs integer,endpoint integer)')
        db.executemany('insert into counts values(?,2,1)',[(n,) for n in [1,2,4,8,14313680697]])
    routing.build(pbf,root/'resumed.sqlite',root/'junctions.sqlite')
    with sqlite3.connect(root/'routing.sqlite') as before,sqlite3.connect(root/'resumed.sqlite') as after:
        assert after.execute('select count(*) from edges').fetchone()[0]>before.execute('select count(*) from edges').fetchone()[0]
        for column in ['meters','car_seconds','walk_seconds','bike_seconds']:
            a=before.execute(f'select sum({column}) from edges').fetchone()[0]
            b=after.execute(f'select sum({column}) from edges').fetchone()[0]
            assert abs(a-b)<1e-8,(column,a,b)
        assert after.execute('select count(*) from edges where (a=8 and b=4) or (a=4 and b=8)').fetchone()[0]==0

print('PASS: disk builders preserve multilingual names, relation label preference, 64-bit IDs, junctions, geometry and modes')
