"""Compare bidirectional routing with an independent Dijkstra reference on directed fixtures."""
import heapq
import json
import math
from pathlib import Path
import random
import sqlite3
import sys
import tempfile
import zlib
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compact_routing import CompactRouter
from routing import distance

checked = 0
for seed in range(5):
    rng = random.Random(seed)
    nodes = {y*8+x: (127.68+x*.0025,26.21+y*.0025) for y in range(8) for x in range(8)}
    graphs = {mode:{node:[] for node in nodes} for mode in ('car','walk','bike')}
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder)/'roads.sqlite'
        with sqlite3.connect(path) as db:
            db.executescript('''create table nodes(id integer primary key,lon real,lat real);
              create table edges(a integer,b integer,meters real,car_seconds real,car_direction integer,walk_seconds real,walk_direction integer,bike_seconds real,bike_direction integer,geometry blob);
              create table metadata(key text,value text);''')
            db.execute("insert into metadata values('timestamp','fixture')")
            db.executemany('insert into nodes values(?,?,?)', [(node,*coordinate) for node,coordinate in nodes.items()])
            for a in nodes:
                for b in (a+1 if a%8<7 else -1, a+8):
                    if b not in nodes:
                        continue
                    meters = distance(nodes[a],nodes[b])
                    profiles = []
                    for mode,max_speed in [('car',75),('walk',4.5),('bike',15)]:
                        seconds = meters/(rng.uniform(max_speed*.5,max_speed)/3.6) if rng.random()>.15 else None
                        direction = rng.choice([-1,0,0,1])
                        profiles.extend([seconds,direction])
                        if seconds is not None:
                            if direction != -1: graphs[mode][a].append((b,seconds))
                            if direction != 1: graphs[mode][b].append((a,seconds))
                    db.execute('insert into edges values(?,?,?,?,?,?,?,?,?,?)',
                      [a,b,meters,*profiles,zlib.compress(json.dumps([nodes[a],nodes[b]]).encode())])
        router = CompactRouter(path,'okinawa')
        for mode in graphs:
            for start,end in [((127.6801,26.2101),(127.6974,26.2274)),
                              ((127.6974,26.2274),(127.6801,26.2101)),
                              (nodes[0],nodes[63]),(nodes[63],nodes[0])]:
                graph = router.graph(mode)
                starts,ends = router.snap(start,graph), router.snap(end,graph)
                # Independent shortest path over the original fixture edges, including access legs.
                goals = {node:meters/1.25 for meters,node in ends}
                costs = {node:meters/1.25 for meters,node in starts}
                queue = [(cost,node) for node,cost in costs.items()]
                heapq.heapify(queue)
                best = math.inf
                while queue:
                    cost,node = heapq.heappop(queue)
                    if cost != costs[node] or cost >= best: continue
                    best = min(best,cost+goals.get(node,math.inf))
                    for neighbor,seconds in graphs[mode][node]:
                        total = cost+seconds
                        if total < costs.get(neighbor,math.inf):
                            costs[neighbor] = total
                            heapq.heappush(queue,(total,neighbor))
                try: result = router.leg(start,end,mode)
                except ValueError:
                    # Walking can expand its snap candidates after a disconnected exact snap.
                    if math.isfinite(best): raise
                else:
                    if math.isfinite(best):
                        assert abs(result['duration']-math.ceil(best)) <= 1, (seed,mode,start,end,result['duration'],best)
                    elif mode != 'walk':
                        raise AssertionError('Accepted a disconnected directed route')
                    assert result['distance'] > 0
                checked += 1
        router.connection.close()
        router.index.close()
print(f'PASS: {checked} directed/multi-candidate cases agree with independent Dijkstra')
