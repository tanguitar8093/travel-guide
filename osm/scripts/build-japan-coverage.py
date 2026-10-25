"""Coverage changes must be reviewed together with a matching cloud migration."""
from pathlib import Path
import json,time
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
from collections import defaultdict
import argparse
parser=argparse.ArgumentParser(description='Generate Japan coverage from validated land GeoJSONL with bounded island groups')
parser.add_argument('land',type=Path);parser.add_argument('output',type=Path)
parser.add_argument('--timestamp',required=True,help='Validated source PBF snapshot date/time')
args=parser.parse_args();started=time.monotonic();rings=[]
with args.land.open() as source:
    for line in source:
        geometry=shape(json.loads(line)['geometry']).simplify(.001,preserve_topology=True).buffer(.005,quad_segs=2).simplify(.001,preserve_topology=True)
        polygons=list(geometry.geoms) if hasattr(geometry,'geoms') else [geometry]
        rings.extend([[[round(x,6),round(y,6)] for x,y in p.exterior.coords] for p in polygons if not p.is_empty])
groups=defaultdict(list)
for ring in rings:
    polygon=Polygon(ring); c=polygon.centroid; groups[(int(c.x),int(c.y))].append(polygon)
rings=[]
for values in groups.values():
    combined=unary_union(values).simplify(.001,preserve_topology=True)
    polygons=list(combined.geoms) if hasattr(combined,'geoms') else [combined]
    rings.extend([[[round(x,6),round(y,6)] for x,y in p.exterior.coords] for p in polygons if not p.is_empty])
xs=[p[0] for r in rings for p in r]; ys=[p[1] for r in rings for p in r]
entry={'name':'日本','bounds':dict(zip(('west','south','east','north'),[min(xs),min(ys),max(xs),max(ys)])),'center':{'latitude':35.6812,'longitude':139.7671},'zoom':5,'coverage':rings,'source':f'OpenStreetMap via Geofabrik Japan {args.timestamp}; individual islands simplified 0.001 degree, coastal margin 0.005 degree. Okinawa identity preserved.'}
args.output.write_text(json.dumps(entry,ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'rings':len(rings),'vertices':sum(len(r) for r in rings),'elapsedSeconds':time.monotonic()-started}),flush=True)
