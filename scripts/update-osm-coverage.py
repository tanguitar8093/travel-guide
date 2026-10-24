"""Deliberate coverage update: rebuild Taiwan land first, review diff, then update SQL rings in a new migration.
Run using osm/.venv/bin/python scripts/update-osm-coverage.py from the repository root.
Normal data refreshes do not change user-data validation boundaries.
"""
import json
from pathlib import Path
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union
p=Path('shared/geo/osm-datasets.json');d=json.loads(p.read_text())
land=json.loads(Path('osm/data/taiwan-land.geojson').read_text())
geometry=unary_union([shape(f['geometry']) for f in land['features']]).buffer(0.005).simplify(0.0007,preserve_topology=True)
polygons=list(geometry.geoms) if hasattr(geometry,'geoms') else [geometry]
d['taiwan']['coverage']=[[[round(x,6),round(y,6)] for x,y in polygon.exterior.coords] for polygon in polygons]
d['taiwan']['source']='OpenStreetMap via Geofabrik Taiwan, 2026-10-23. Coverage: complete island coastlines in the extract, with 0.005 degree coastal margin. Excludes open sea and clipped mainland coast. Rebuild deliberately with scripts/update-osm-coverage.py.'
p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
print('Coverage',len(polygons),'rings',sum(len(r) for r in d['taiwan']['coverage']),'vertices')
