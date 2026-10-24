"""Runtime router for regional datasets. Geometry stays on disk, graphs keep junctions only."""
import json
import sqlite3
import zlib
from pathlib import Path
from threading import RLock
from routing import Router


class CompactRouter(Router):
    def __init__(self, path, dataset):
        self.dataset = dataset
        self.connection = sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro&immutable=1',uri=True,check_same_thread=False)
        self.nodes = {row[0]:(row[1],row[2]) for row in self.connection.execute('select id,lon,lat from nodes')}
        self.timestamp = self.connection.execute("select value from metadata where key='timestamp'").fetchone()[0]
        self.ways = ()
        self.lock = RLock()
        self.snap_cache = {}
        self.components = {}
        self.active_mode = None
        self.active_graph = None

    def graph(self, mode):
        if self.active_mode == mode:
            return self.active_graph
        if mode not in ('car','walk','bike'):
            raise ValueError('Unknown mode')
        import math
        graph = {}
        # Columns are selected from this fixed allowlist, never from request text.
        for a,b,meters,seconds,direction in self.connection.execute(f'select a,b,meters,{mode}_seconds,{mode}_direction from edges where {mode}_seconds is not null'):
            graph.setdefault(a,[])
            graph.setdefault(b,[])
            if direction != -1: graph[a].append((b,seconds,meters))
            if direction != 1: graph[b].append((a,seconds,meters))
        cells = {}
        for node, edges in graph.items():
            if edges:
                lon,lat = self.nodes[node]
                cells.setdefault((math.floor(lon*100),math.floor(lat*100)),[]).append(node)
        self.components = {id(graph):cells}
        self.snap_cache.clear()
        self.active_mode,self.active_graph = mode,graph
        return graph

    def path_geometry(self, path, mode):
        result=[]
        for a,b in zip(path,path[1:]):
            row=self.connection.execute(f'''select geometry,a from edges where
              ((a=? and b=? and {mode}_direction<>-1) or (a=? and b=? and {mode}_direction<>1))
              and {mode}_seconds is not null order by {mode}_seconds limit 1''',(a,b,b,a)).fetchone()
            if row is None: raise ValueError('Missing road geometry')
            points=json.loads(zlib.decompress(row[0]))
            if row[1]!=a: points.reverse()
            result.extend(points if not result else points[1:])
        return result if result else [self.nodes[path[0]]]
