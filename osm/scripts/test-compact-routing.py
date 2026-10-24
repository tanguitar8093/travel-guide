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
