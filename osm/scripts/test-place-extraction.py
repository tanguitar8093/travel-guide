"""Regression coverage for missing languages, names and relation geometry."""
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('extract',Path(__file__).with_name('extract-places.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=m.Places()
p.add('node',1,{'name:ko':'한국 이름'},[127.7,26.2],'osm-node')
p.add('way',2,{'alt_name:zh':'中文別名','highway':'residential'},[127.8,26.3],'approximate-center')
p.add('node',3,{'name':'Outside'},[139,35],'osm-node')
p.locations[('n',1)]=[127.7,26.2]
p.locations[('w',2)]=[127.8,26.3]
p.relations[4]={'tags':{'name':'具名關聯','type':'multipolygon'},'members':[('w',2,'outer'),('n',1,'label')]}
p.relations[5]={'tags':{'name':'循環'},'members':[('r',5,'')]}
p.relations[6]={'tags':{'name':'無位置'},'members':[('w',999,'')]}
p.finish()
rows={r['id']:r for r in p.places}
assert rows['osm-node-1']['name']=='한국 이름'
assert rows['osm-way-2']['name']=='中文別名'
assert rows['osm-relation-4']['coordinates']==[127.7,26.2]
assert 'osm-node-3' not in rows and 'osm-relation-5' not in rows and 'osm-relation-6' not in rows
print('PASS: all language-only names, alternative names, named roads, relation label preference, missing geometry, cyclic relations and bounds')
