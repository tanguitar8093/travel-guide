import sys
import math
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

# Disconnected searches have a strict work/time budget, rather than scanning the island.
from unittest.mock import patch
bounded = Router({'nodes': [[i,127.68+i*.000001,26.21] for i in range(1102)], 'ways': []})
graph = {i:[(i+1,1,1)] for i in range(1100)}
graph[1100], graph[1101] = [], []
bounded.graph = lambda _mode: graph
bounded.snap = lambda coordinate, _graph, _expanded: [(0, 0 if coordinate[0] == 127.68 else 1101)]
with patch('routing.time.monotonic', side_effect=[0,100]):
    try: bounded.leg((127.68,26.21),(127.7,26.21),'walk')
    except ValueError as error: assert '資源上限' in str(error)
    else: raise AssertionError('An exhausted walking search must stop')
print('PASS: expensive disconnected walking searches stop within their budget')

# Different building/user coordinates may share the same nearest road vertex.
# The access legs are part of the route, not a reason to return 0 seconds/metres.
from routing import distance
for mode in ('car','walk','bike'):
    access_router = Router(fixture())
    start, end = (127.6809,26.2101), (127.6811,26.2101)
    result = access_router.leg(start,end,mode)
    assert result['snapped'][0] == result['snapped'][1]
    assert result['duration'] > 0
    assert result['distance'] >= distance(start,end)
    assert result['distance'] == math.ceil(sum(distance(point,snap) for point,snap in zip((start,end),result['snapped'])))
    assert tuple(result['geometry']['coordinates'][0]) == start
    assert tuple(result['geometry']['coordinates'][-1]) == end
print('PASS: shared snapped vertices retain access distance, duration and complete geometry')

# A public road can sit beyond the closest isolated parking/service nodes.
# Car/bike retry is still limited to the existing 800m walking access policy.
for mode in ('car','bike'):
    parking=Router({'nodes':[[1,127.68,26.21],[2,127.70,26.21],
        [3,127.68,26.211],[4,127.70,26.211],[5,127.68001,26.21],[6,127.70001,26.21]],
        'ways':[{'nodes':pair,'tags':{'highway':'residential'}} for pair in [[1,5],[2,6],[3,4]]]})
    result=parking.route([[127.68,26.21],[127.70,26.21]],mode)
    assert 0<max(result['legs'][0]['snapDistances'])<800
    assert result['distance']>1000
print('PASS: car/bike can escape isolated nearest parking nodes within the access bound')

# A curved road with many raw shape vertices is not a nationwide search.
count=60002
shapes=Router({'nodes':[[i,127.68+i*.00000001,26.21] for i in range(count)],
    'ways':[{'nodes':list(range(count)),'tags':{'highway':'residential'}}]})
result=shapes.route([list(shapes.nodes[0]),list(shapes.nodes[count-1])],'car')
assert len(result['legs'][0]['geometry']['coordinates'])==count
assert result['distance']>0 and result['duration']>0
print('PASS: a connected Okinawa road with over 50,000 shape vertices completes')

# Cold graph creation must not use up the route-search deadline.
cold=Router({'nodes':[[i,127.68+i*.000001,26.21] for i in range(202)],'ways':[]})
graph={i:[(i+1,1,1)] for i in range(201)};graph[201]=[]
clock=[0]
def prepare(_mode):
    clock[0]=10
    return graph
cold.graph=prepare
cold.snap=lambda coordinate,graph,expanded:[(0,0 if coordinate[0]==127.68 else 201)]
with patch('routing.time.monotonic',side_effect=lambda:clock[0]):
    assert cold.leg((127.68,26.21),(127.7,26.21),'car')['distance']>0
print('PASS: one-time cold mode initialization leaves the search budget available')

# Even the calibrated raw graph stops on excessive states.
limited=Router({'nodes':[[i,127.68+i*.000001,26.21] for i in range(152)],'ways':[]})
graph={i:[] for i in range(152)};graph[0]=[(i,1,1) for i in range(1,150)]
limited.graph=lambda mode:graph
limited.snap=lambda coordinate,graph,expanded:[(0,0 if coordinate[0]==127.68 else 151)]
limited.search_states=64
try:limited.leg((127.68,26.21),(127.7,26.21),'car')
except ValueError as error:assert '資源上限' in str(error)
else:raise AssertionError('The raw graph state limit was not enforced')
print('PASS: legacy raw search retains a hard state bound')

# Opposite sides of a disconnected network should be rejected before A* scans
# the entire public-road component, so the snap retry can run in either direction.
separate=Router({'nodes':[[1,127.68,26.21],[2,127.681,26.21],[3,127.70,26.21],[4,127.701,26.21]],
    'ways':[{'nodes':pair,'tags':{'highway':'residential'}} for pair in [[1,2],[3,4]]]})
separate.graph('car')
for start,end in [((127.68,26.21),(127.70,26.21)),((127.70,26.21),(127.68,26.21))]:
    with patch('routing.heapq.heappop',side_effect=AssertionError('A* must not scan disconnected components')):
        try:separate.leg(start,end,'car')
        except ValueError as error:assert '連通道路' in str(error)
        else:raise AssertionError('A disconnected route was accepted')
print('PASS: weak components reject both directions before costly searching')
