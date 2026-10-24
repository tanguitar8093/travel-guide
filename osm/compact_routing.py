"""Bounded, disk-backed regional routing. Never materialize a nationwide mode graph."""
import heapq
import json
import math
import sqlite3
import time
import zlib
from functools import lru_cache
from pathlib import Path
from threading import RLock
from routing import Router, distance
from routing_index import ensure_routing_index, MODES


class DiskNodes:
    def __init__(self, index):
        self.index = index
        self.record = lru_cache(maxsize=32768)(self._record)

    def _record(self, node):
        row = self.index.execute('select lon,lat,car_component,walk_component,bike_component from nodes where id=?', (node,)).fetchone()
        if row is None:
            raise KeyError(node)
        return row

    def __getitem__(self, node):
        return self.record(node)[:2]


class DiskGraph:
    def __init__(self, connection, nodes, mode):
        self.connection, self.nodes, self.mode = connection, nodes, mode
        self.mode_index = MODES.index(mode)
        self.neighbors = lru_cache(maxsize=4096)(self._neighbors)
        self.reverse_neighbors = lru_cache(maxsize=4096)(self._reverse_neighbors)

    def _neighbors(self, node):
        # Both queries use the existing (a,b)/(b,a) indexes. Mode is allowlisted.
        return tuple(self.connection.execute(f'''select b,{self.mode}_seconds,meters from edges
          where a=? and {self.mode}_seconds is not null and {self.mode}_direction<>-1
          union all select a,{self.mode}_seconds,meters from edges
          where b=? and {self.mode}_seconds is not null and {self.mode}_direction<>1''', (node, node)))

    def _reverse_neighbors(self, node):
        return tuple(self.connection.execute(f'''select a,{self.mode}_seconds,meters from edges
          where b=? and {self.mode}_seconds is not null and {self.mode}_direction<>-1
          union all select b,{self.mode}_seconds,meters from edges
          where a=? and {self.mode}_seconds is not null and {self.mode}_direction<>1''', (node, node)))

    def __getitem__(self, node):
        return self.neighbors(node)

    def connected_candidates(self, starts, ends):
        # Weak components only reject impossible routes; direction remains in the search.
        def component(candidate):
            return self.nodes.record(candidate[1])[2+self.mode_index]
        common = {component(row) for row in starts} & {component(row) for row in ends}
        return ([row for row in starts if component(row) in common],
                [row for row in ends if component(row) in common])


class CompactRouter(Router):
    def __init__(self, path, dataset):
        self.dataset = dataset
        path = Path(path).resolve()
        index_path = ensure_routing_index(path)
        self.connection = sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1', uri=True, check_same_thread=False)
        self.index = sqlite3.connect(index_path.as_uri()+'?mode=ro&immutable=1', uri=True, check_same_thread=False)
        self.nodes = DiskNodes(self.index)
        self.timestamp = self.connection.execute("select value from metadata where key='timestamp'").fetchone()[0]
        self.ways = ()
        self.lock = RLock()
        self.snap_cache = {}
        self.components = {}
        self.graphs = {}
        self.failed_legs = {}

    def graph(self, mode):
        if mode not in MODES:
            raise ValueError('Unknown mode')
        if mode not in self.graphs:
            self.graphs[mode] = DiskGraph(self.connection, self.nodes, mode)
        return self.graphs[mode]

    def snap(self, coordinate, graph, expanded=False):
        key = (tuple(coordinate), graph.mode, expanded)
        if key in self.snap_cache:
            return self.snap_cache[key]
        x, y = math.floor(coordinate[0]*100), math.floor(coordinate[1]*100)
        # No valid snap can exceed 800m; avoid measuring every vertex in a 5km box.
        radius = 801 / 6371000
        lat_radius = math.degrees(radius)
        lon_radius = math.degrees(math.asin(min(1, math.sin(radius)/max(1e-12,math.cos(math.radians(coordinate[1]))))))
        rows = self.index.execute('''select id,lon,lat from nodes indexed by node_position
          where grid_x in (?,?,?,?,?) and grid_y in (?,?,?,?,?) and outgoing & ? <> 0
          and lon between ? and ? and lat between ? and ?''',
          (*range(x-2,x+3), *range(y-2,y+3), 1 << graph.mode_index,
           coordinate[0]-lon_radius,coordinate[0]+lon_radius,coordinate[1]-lat_radius,coordinate[1]+lat_radius))
        candidates = heapq.nsmallest(256 if expanded else 16,
            ((distance(coordinate, (lon,lat)), node) for node,lon,lat in rows))
        if not candidates or candidates[0][0] > 800:
            raise ValueError('地點距離可通行道路超過 800 公尺，請改選附近道路。')
        if candidates[0][0] < 1 and not expanded:
            result = [candidates[0]]
        else:
            result = [(meters,node) for meters,node in candidates if meters <= min(800,candidates[0][0]+400)]
        if len(self.snap_cache) >= 256:
            self.snap_cache.clear()
        self.snap_cache[key] = result
        return result

    def leg(self, start, end, mode):
        key = (tuple(start), tuple(end), mode)
        failed = self.failed_legs.get(key)
        if failed and time.monotonic() - failed[0] < 30:
            raise ValueError(failed[1])
        try:
            return super().leg(start, end, mode)
        except ValueError as error:
            if len(self.failed_legs) >= 128:
                self.failed_legs.clear()
            self.failed_legs[key] = (time.monotonic(), str(error))
            raise

    def bidirectional_leg(self, start, end, mode, graph, starts, ends, expanded, deadline):
        # Balanced A* potentials make the sum of frontier minima a valid lower
        # bound, including directed roads and multiple access-point candidates.
        max_speed = {'car':75,'walk':4.5,'bike':15}[mode]/3.6
        @lru_cache(maxsize=100000)
        def potential(node):
            coordinate = self.nodes[node]
            return (distance(coordinate,end)-distance(coordinate,start))/(2*max_speed)
        heaps, costs, parents, origins = [[],[]], [{},{}], [{},{}], [{},{}]
        for side, candidates in enumerate((starts, ends)):
            sign = 1 if side == 0 else -1
            for meters, node in candidates:
                cost = meters/(4.5/3.6)
                costs[side][node] = cost
                origins[side][node] = node
                heapq.heappush(heaps[side], (cost+sign*potential(node), cost, node))
        best_cost, meeting = math.inf, None
        for node in costs[0].keys() & costs[1].keys():
            total = costs[0][node] + costs[1][node]
            if total < best_cost:
                best_cost, meeting = total, node
        visited = 0
        while heaps[0] and heaps[1]:
            for side in (0,1):
                while heaps[side] and heaps[side][0][1] != costs[side].get(heaps[side][0][2]):
                    heapq.heappop(heaps[side])
            if not heaps[0] or not heaps[1] or heaps[0][0][0]+heaps[1][0][0] >= best_cost:
                break
            visited += 1
            if visited % 128 == 0 and (visited > 50000 or time.monotonic() > deadline or len(costs[0])+len(costs[1]) > 100000):
                raise ValueError('此路段搜尋範圍過大或計算超過時限，請分段計算後重試。')
            side = 0 if heaps[0][0][0] <= heaps[1][0][0] else 1
            other, sign = 1-side, 1 if side == 0 else -1
            _, cost, node = heapq.heappop(heaps[side])
            edges = graph[node] if side == 0 else graph.reverse_neighbors(node)
            for neighbor, seconds, meters in edges:
                total = cost + seconds
                if total >= costs[side].get(neighbor, math.inf):
                    continue
                costs[side][neighbor] = total
                parents[side][neighbor] = (node, meters)
                origins[side][neighbor] = origins[side][node]
                heapq.heappush(heaps[side], (total+sign*potential(neighbor), total, neighbor))
                joined = total + costs[other].get(neighbor, math.inf)
                if joined < best_cost:
                    best_cost, meeting = joined, neighbor
        self.last_search_visited = visited
        if meeting is None:
            if mode == 'walk' and not expanded:
                return self.search_leg(start,end,mode,True,deadline)
            raise ValueError('這兩個地點找不到交通方式的連通道路。')
        source, target = origins[0][meeting], origins[1][meeting]
        path, meters = [meeting], 0
        while path[-1] != source:
            parent, edge_meters = parents[0][path[-1]]
            path.append(parent)
            meters += edge_meters
        path.reverse()
        node = meeting
        while node != target:
            node, edge_meters = parents[1][node]
            path.append(node)
            meters += edge_meters
        access_seconds = (distance(start,self.nodes[source])+distance(end,self.nodes[target]))/(4.5/3.6)
        return self.finish_leg(start,end,mode,path,source,target,max(0,best_cost-access_seconds),meters)

    def path_geometry(self, path, mode):
        result=[]
        for a,b in zip(path,path[1:]):
            row=self.connection.execute(f'''select geometry,a from edges where
              ((a=? and b=? and {mode}_direction<>-1) or (a=? and b=? and {mode}_direction<>1))
              and {mode}_seconds is not null order by {mode}_seconds limit 1''',(a,b,b,a)).fetchone()
            if row is None:
                raise ValueError('Missing road geometry')
            points=json.loads(zlib.decompress(row[0]))
            if row[1]!=a:
                points.reverse()
            result.extend(points if not result else points[1:])
        return result if result else [self.nodes[path[0]]]
