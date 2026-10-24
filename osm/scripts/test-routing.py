import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router, allowed

def fixture():
    return {'elements':[{'type':'node','id':i,'lon':127.68+i*.001,'lat':26.21} for i in range(1,5)]+[
    {'type':'way','nodes':[1,2,3], 'tags':{'highway':'residential','oneway':'yes'}},
    {'type':'way','nodes':[3,4,1], 'tags':{'highway':'secondary'}}]}
r=Router(fixture())
assert not allowed({'highway':'motorway'},'walk')
assert not allowed({'highway':'motorway'},'bike')
assert not allowed({'highway':'footway'},'car')
assert not allowed({'highway':'residential','access':'private'},'car')
assert allowed({'highway':'residential','access':'no','foot':'yes'},'walk')
a=r.leg(r.nodes[3],r.nodes[1],'car');b=r.leg(r.nodes[3],r.nodes[1],'walk')
assert r.nodes[4] in a['geometry']['coordinates'], 'car must obey oneway'
assert r.nodes[2] in b['geometry']['coordinates'], 'walk may reverse normal oneway'
assert a['duration']<b['duration']
route=r.route([list(r.nodes[1]),list(r.nodes[2]),list(r.nodes[3])],'bike')
assert route['duration']==sum(l['duration'] for l in route['legs'])
for points,mode in [([[0,0],[1,1]],'car'),([[127.68,26.21]],'car'),([[127.68,26.21],[127.69,26.22]],'plane')]:
    try:r.route(points,mode)
    except ValueError:pass
    else:raise AssertionError('invalid request accepted')
print('PASS: access restrictions, oneway differences, multi-stop totals, invalid requests')


# Indoor/parking walkways may have an exact nearby node but no connection to street roads.
# Only retry after the closest candidates fail; preserve normal car/direction behavior.
fallback=Router({'elements':[
 {'type':'node','id':1,'lon':127.68,'lat':26.21},
 {'type':'node','id':2,'lon':127.70,'lat':26.21},
 {'type':'node','id':3,'lon':127.68,'lat':26.211},
 {'type':'node','id':4,'lon':127.70,'lat':26.211},
 {'type':'node','id':5,'lon':127.68001,'lat':26.21},
 {'type':'node','id':6,'lon':127.70001,'lat':26.21},
 {'type':'way','nodes':[1,5],'tags':{'highway':'footway'}},
 {'type':'way','nodes':[2,6],'tags':{'highway':'footway'}},
 {'type':'way','nodes':[3,4],'tags':{'highway':'residential'}},
]})
walk=fallback.route([[127.68,26.21],[127.70,26.21]],'walk')
assert walk['distance']>1000 and len(walk['legs'][0]['geometry']['coordinates'])>=2
assert max(walk['legs'][0]['snapDistances'])<800
print('PASS: disconnected exact walking nodes retry nearby connected roads')
