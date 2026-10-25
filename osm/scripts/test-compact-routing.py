"""The regional router must retain bends, obey direction and support tiny island networks."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import zlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from compact_routing import CompactRouter

with tempfile.TemporaryDirectory() as temporary:
    path=Path(temporary)/'roads.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript('''create table nodes(id integer primary key,lon real,lat real);
          create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer,geometry blob);
          create table metadata(key text,value text);''')
        db.execute('insert into metadata values(?,?)',('timestamp','fixture'))
        db.executemany('insert into nodes values(?,?,?)',[(2**53+1,119.566,23.566),(2,119.567,23.567),(3,119.568,23.566),(4,119.600,23.566),(5,119.601,23.566)])
        for a,b,geometry,direction in [(2**53+1,2,[[119.566,23.566],[119.5661,23.5669],[119.567,23.567]],1),(2,3,[[119.567,23.567],[119.568,23.566]],0),(3,2**53+1,[[119.568,23.566],[119.566,23.566]],0),(4,5,[[119.600,23.566],[119.601,23.566]],0)]:
            db.execute('insert into edges values(?,?,?,?,?,?,?,?,?,?)',[a,b,200,20,direction,160,0,60,direction,zlib.compress(json.dumps(geometry).encode())])
    router=CompactRouter(path,'taiwan')
    result=router.route([[119.566,23.566],[119.567,23.567]],'car')
    assert result['legs'][0]['geometry']['coordinates'][1]==[119.5661,23.5669], 'full road bend must survive graph compression'
    assert len(router.route([[119.567,23.567],[119.566,23.566]],'car')['legs'][0]['geometry']['coordinates'])==3
    assert router.route([[119.567,23.567],[119.566,23.566]],'walk')['duration']>result['duration']
    try:router.route([[127.9,26.4],[119.566,23.566]],'car')
    except ValueError:pass
    else:raise AssertionError('Cross-region request accepted')
    queries = []
    router.connection.set_trace_callback(queries.append)
    car_graph = router.graph('car')
    for mode in ('car', 'walk', 'bike', 'walk', 'car'):
        assert router.route([[119.566,23.566],[119.567,23.567]],mode)['duration'] > 0
    assert router.graph('car') is car_graph
    assert all('where' in query.lower() for query in queries if 'from edges' in query.lower())
    assert router.nodes[2**53+1] == (119.566,23.566)
    graph = router.graph('walk')
    before = graph.neighbors.cache_info().misses
    try: router.leg((119.566,23.566),(119.600,23.566),'walk')
    except ValueError as error: assert '連通道路' in str(error)
    else: raise AssertionError('Disconnected road components accepted')
    assert graph.neighbors.cache_info().misses == before, 'disconnected endpoints must fail before graph search'
    assert len(router.failed_legs) == 1
    router.connection.close()
    router.index.close()
print('PASS: compact geometry, direction, transport and small-island coverage')

print('PASS: mode switches without graph rebuild, 64-bit IDs, and disconnected routes rejected before search')

# A temporary resource failure must use the same bounded fallback in every dataset,
# and never poison the negative cache for 30 seconds.
from unittest.mock import patch
from routing import RouteSearchLimit
with tempfile.TemporaryDirectory() as temporary:
    path=Path(temporary)/'budget.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript("create table nodes(id integer primary key,lon real,lat real); create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer,geometry blob); create table metadata(key text,value text); insert into metadata values('timestamp','budget');")
    for dataset in ('taiwan','okinawa','japan'):
        router=CompactRouter(path,dataset)
        with patch.object(router,'search_leg',side_effect=RouteSearchLimit()), patch.object(router,'weighted_leg',side_effect=RouteSearchLimit()) as fallback:
            try:router.leg((127.68,26.21),(127.70,26.21),'car')
            except RouteSearchLimit:pass
            else:raise AssertionError('An unfinished search must not produce a route')
            assert [call.args[3] for call in fallback.call_args_list]==[1.5,2.0]
        assert not router.failed_legs,'Temporary resource failures must remain retryable'
        with patch.object(router,'search_leg',return_value={'distance':1,'duration':1}) as retry:
            assert router.leg((127.68,26.21),(127.70,26.21),'car')['optimal']
            retry.assert_called_once()
        router.connection.close();router.index.close()
print('PASS: common bounded fallback and immediate resource-failure retry across SQLite datasets')


# Multiple legs share one deadline; each retry cannot obtain a fresh 22 seconds.
with tempfile.TemporaryDirectory() as temporary:
    path=Path(temporary)/'route-budget.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript("create table nodes(id integer primary key,lon real,lat real); create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer,geometry blob); create table metadata(key text,value text); insert into metadata values('timestamp','budget');")
    router=CompactRouter(path,'taiwan');clock=[0];calls=[]
    def exact(start,end,mode,expanded,deadline):
        calls.append(deadline)
        if len(calls)==1:
            clock[0]=1;return {'distance':1,'duration':1}
        clock[0]=min(deadline,clock[0]+2)
        raise RouteSearchLimit()
    def estimate(start,end,mode,weight,deadline,expanded):
        calls.append(deadline);clock[0]=deadline
        if weight==1.5:raise RouteSearchLimit()
        return {'distance':1,'duration':1,'optimal':False,'heuristicWeight':weight}
    with patch('compact_routing.time.monotonic',side_effect=lambda:clock[0]),patch.object(router,'search_leg',side_effect=exact),patch.object(router,'weighted_leg',side_effect=estimate):
        try:router.route([[119.566,23.566],[119.567,23.567],[119.568,23.566],[119.566,23.566]],'car')
        except RouteSearchLimit:pass
        else:raise AssertionError('A multi-leg route exceeded the shared deadline')
    assert max(calls)<=22 and router.route_deadline is None
    router.connection.close();router.index.close()
print('PASS: multiple legs share one request budget and clear it after an error')
