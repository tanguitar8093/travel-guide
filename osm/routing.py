"""Local OSM graph routing for the demo; static speeds, no live traffic."""
import heapq
import math
from functools import lru_cache
from threading import RLock
from datasets import definition, inside

MODES = ('car', 'walk', 'bike')
BOUNDS = [127.58, 25.98, 128.36, 26.9]


def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def allowed(tags, mode):
    road = tags.get('highway')
    if road not in {'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','living_street','service','track','path','footway','pedestrian','steps','cycleway'}:
        return False
    # More specific OSM access tags override general ones.
    access = tags.get('access', 'yes')
    if mode == 'car':
        access = tags.get('motorcar', tags.get('motor_vehicle', tags.get('vehicle', access)))
        if road in {'path','footway','pedestrian','steps','cycleway'} and tags.get('motorcar',tags.get('motor_vehicle')) not in {'yes','designated','permissive'}:
            return False
    elif mode == 'walk':
        access = tags.get('foot', access)
        if (road.startswith('motorway') or tags.get('motorroad') == 'yes') and tags.get('foot') != 'yes':
            return False
    else:
        access = tags.get('bicycle', tags.get('vehicle', access))
        if (road.startswith('motorway') or tags.get('motorroad') == 'yes' or road == 'steps') and tags.get('bicycle') not in {'yes','designated'}:
            return False
    return access not in {'no','private','customers','delivery','agricultural','forestry'} and tags.get('area') != 'yes'


def speed(tags, mode):
    road = tags['highway']
    if mode == 'walk':
        return 3 if road == 'steps' else 4.5
    if mode == 'bike':
        return 10 if road in {'path','footway','pedestrian','track'} else 15
    speeds = {'motorway':75,'motorway_link':40,'trunk':50,'trunk_link':35,'primary':40,'primary_link':30,'secondary':35,'tertiary':30,'residential':25,'unclassified':25,'service':15,'living_street':10,'track':10}
    value = speeds.get(road, 25)
    try:
        limit = float(tags.get('maxspeed', '').split(';')[0])
        if limit > 0:
            value = min(value, limit)
    except ValueError:
        pass
    return value


class Router:
    def __init__(self, data, dataset='okinawa'):
        self.dataset = dataset
        definition(dataset)
        self.nodes = {row[0]: (row[1],row[2]) for row in data['nodes']} if 'nodes' in data else {e['id']: (e['lon'],e['lat']) for e in data['elements'] if e['type']=='node'}
        self.ways = data['ways'] if 'ways' in data else [e for e in data['elements'] if e['type']=='way' and 'highway' in e.get('tags', {})]
        self.lock = RLock()
        self.snap_cache = {}
        self.components = {}
        self.timestamp = data.get('osm3s', {}).get('timestamp_osm_base', 'unknown')

    @lru_cache(maxsize=3)
    def graph(self, mode):
        graph = {}
        for way in self.ways:
            tags = way.get('tags', {})
            if not allowed(tags, mode):
                continue
            one = tags.get('oneway', 'yes' if tags.get('junction')=='roundabout' else 'no')
            if mode == 'walk':
                one = tags.get('oneway:foot', 'no')
            if mode == 'bike':
                one = tags.get('oneway:bicycle', one)
                if any(tags.get(k, '').startswith('opposite') for k in ('cycleway','cycleway:left','cycleway:right')):
                    one = 'no'
            for a, b in zip(way['nodes'], way['nodes'][1:]):
                if a not in self.nodes or b not in self.nodes:
                    continue
                meters = distance(self.nodes[a], self.nodes[b])
                seconds = meters / (speed(tags, mode) / 3.6)
                graph.setdefault(a, [])
                graph.setdefault(b, [])
                if one != '-1':
                    graph[a].append((b, seconds, meters))
                if one not in {'yes','1','true'}:
                    graph[b].append((a, seconds, meters))
        # Spatial cells bound snapping work and retain small island road networks.
        cells = {}
        for node, edges in graph.items():
            if edges:
                lon, lat = self.nodes[node]
                cells.setdefault((math.floor(lon*100), math.floor(lat*100)), []).append(node)
        self.components[id(graph)] = cells
        return graph

    def snap(self, coordinate, graph, expanded=False):
        key = (tuple(coordinate),id(graph),expanded)
        if key in self.snap_cache:
            return self.snap_cache[key]
        cells = self.components[id(graph)]
        x, y = math.floor(coordinate[0]*100), math.floor(coordinate[1]*100)
        nearby = (node for dx in range(-2,3) for dy in range(-2,3) for node in cells.get((x+dx,y+dy), []))
        candidates = heapq.nsmallest(256 if expanded else 16, ((distance(coordinate, self.nodes[node]), node) for node in nearby))
        if not candidates or candidates[0][0] > 800:
            raise ValueError('地點距離可通行道路超過 800 公尺，請改選附近道路。')
        if candidates[0][0]<1 and not expanded:
            return [candidates[0]]
        result = [(meters,node) for meters,node in candidates if meters <= min(800,candidates[0][0]+400)]
        if len(self.snap_cache)>300:
            self.snap_cache.clear()
        self.snap_cache[key] = result
        return result

    def leg(self, start, end, mode):
        return self.cached_leg(tuple(start),tuple(end),mode)

    @lru_cache(maxsize=128)
    def cached_leg(self, start, end, mode, expanded=False):
        graph = self.graph(mode)
        starts, ends = self.snap(start, graph, expanded), self.snap(end, graph, expanded)
        # Consider several nearby vertices to avoid disconnected parking paths.
        connector_speed = 4.5 / 3.6
        end_costs = {node:meters/connector_speed for meters,node in ends}
        max_speed = {'car':75,'walk':4.5,'bike':15}[mode]/3.6
        target_coordinate = end
        def heuristic(node):
            return distance(self.nodes[node],target_coordinate)/max_speed
        heap = []
        costs = {}
        parents = {}
        source_for = {}
        for meters,node in starts:
            costs[node] = meters/connector_speed
            source_for[node] = node
            heapq.heappush(heap,(costs[node]+heuristic(node),costs[node],node))
        best_cost, target = math.inf, None
        while heap:
            priority, cost, node = heapq.heappop(heap)
            if cost != costs.get(node):
                continue
            if priority >= best_cost:
                break
            if node in end_costs and cost+end_costs[node]<best_cost:
                best_cost, target = cost+end_costs[node],node
            for neighbor, seconds, meters in graph[node]:
                total = cost+seconds
                if total < costs.get(neighbor, math.inf):
                    costs[neighbor] = total
                    parents[neighbor] = (node, meters)
                    source_for[neighbor] = source_for[node]
                    heapq.heappush(heap, (total+heuristic(neighbor), total, neighbor))
        if target is None:
            if mode == 'walk' and not expanded:
                return self.cached_leg(start,end,mode,True)
            raise ValueError('這兩個地點之間找不到此交通方式的連通道路，請改選道路附近的地點。')
        source = source_for[target]
        start_snap = distance(start,self.nodes[source])
        end_snap = distance(end,self.nodes[target])
        road_seconds = max(0,costs[target]-start_snap/connector_speed)
        path = [target]
        meters = 0
        while path[-1] != source:
            parent, edge_meters = parents[path[-1]]
            meters += edge_meters
            path.append(parent)
        path.reverse()
        return {'duration':round(road_seconds),'distance':round(meters),'geometry':{'type':'LineString','coordinates':self.path_geometry(path,mode)},'snapped':[self.nodes[source],self.nodes[target]],'snapDistances':[round(start_snap),round(end_snap)]}

    def path_geometry(self, path, _mode):
        return [self.nodes[node] for node in path]

    def route(self, points, mode):
        if mode not in MODES:
            raise ValueError('交通方式須為 car、walk 或 bike。')
        if not isinstance(points, list) or not 2 <= len(points) <= 10:
            raise ValueError('請選擇 2 至 10 個地點。')
        for point in points:
            if not isinstance(point, list) or len(point)!=2 or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in point):
                raise ValueError('座標格式錯誤。')
            if not inside(point, self.dataset):
                raise ValueError(f'此位置超出{definition(self.dataset)["name"]}圖資範圍。')
        legs = [self.leg(a,b,mode) for a,b in zip(points,points[1:])]
        return {'mode':mode,'legs':legs,'distance':sum(leg['distance'] for leg in legs),'duration':sum(leg['duration'] for leg in legs),'estimated':True,'dataTimestamp':self.timestamp}
