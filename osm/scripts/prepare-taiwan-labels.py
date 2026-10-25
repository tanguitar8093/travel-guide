"""Stream Taiwan display labels from PBF, without loading the full place catalog."""
import argparse
import json
from pathlib import Path
import sys
import tempfile

import osmium

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from datasets import definition
from shapely.geometry import MultiPolygon, Polygon
from shapely import intersects_xy, prepare as prepare_geometry

NAME_KEYS = ('name', 'name:zh-Hant', 'name:zh', 'ref')
PLACE_ZOOMS = {'city': 7, 'town': 10, 'village': 10, 'suburb': 12,
               'quarter': 12, 'neighbourhood': 15}


def prepare(pbf):
    data = ROOT / 'data'
    if not pbf.is_file():
        raise SystemExit('Taiwan labels require data/taiwan.osm.pbf; run osm:setup -- --dataset taiwan first.')
    counts = {'roads': 0, 'places': 0, 'invalidWays': 0}
    coverage = MultiPolygon([Polygon(ring) for ring in definition('taiwan')['coverage']])
    prepare_geometry(coverage)
    def inside(point):
        return bool(intersects_xy(coverage, point[0], point[1]))
    factory = osmium.geom.GeoJSONFactory()
    with tempfile.TemporaryDirectory(prefix='atlas-labels-', dir=data) as directory:
        stage = Path(directory)
        roads_path, places_path = stage / 'roads.geojsonl', stage / 'places.geojsonl'
        with roads_path.open('w') as roads, places_path.open('w') as places:
            processor = (osmium.FileProcessor(str(pbf))
                         .with_locations(f'sparse_file_array,{stage / "locations.idx"}')
                         .with_filter(osmium.filter.EntityFilter(osmium.osm.NODE | osmium.osm.WAY)))
            for entity in processor:
                if isinstance(entity, osmium.osm.Node):
                    kind = entity.tags.get('place')
                    if kind not in PLACE_ZOOMS or not entity.location.valid():
                        continue
                    name = entity.tags.get('name:zh-Hant') or entity.tags.get('name:zh') or entity.tags.get('name')
                    point = [entity.lon, entity.lat]
                    if not name or not inside(point):
                        continue
                    feature = {'type': 'Feature', 'properties': {'name': name, 'class': kind,
                               'label_minzoom': PLACE_ZOOMS[kind]},
                               'geometry': {'type': 'Point', 'coordinates': point}}
                    places.write(json.dumps(feature, ensure_ascii=False, separators=(',', ':')) + '\n')
                    counts['places'] += 1
                elif entity.tags.get('highway') and any(entity.tags.get(key) for key in NAME_KEYS):
                    if len(entity.nodes) < 2:
                        continue
                    if not all(node.location.valid() for node in entity.nodes):
                        counts['invalidWays'] += 1
                        continue
                    if not any(inside([node.lon, node.lat]) for node in entity.nodes):
                        continue
                    properties = {'class': entity.tags['highway'], **{
                        key: entity.tags[key] for key in NAME_KEYS if entity.tags.get(key)}}
                    geometry = factory.create_linestring(entity, use_nodes=osmium.geom.use_nodes.ALL)
                    roads.write('{"type":"Feature","properties":' + json.dumps(properties, ensure_ascii=False)
                                + ',"geometry":' + geometry + '}\n')
                    counts['roads'] += 1
            del processor
        if not counts['roads'] or not counts['places']:
            raise ValueError('Missing Taiwan labels; refusing to publish empty label inputs.')
        roads_path.replace(data / 'taiwan-road-labels.geojsonl')
        places_path.replace(data / 'taiwan-place-labels.geojsonl')
    print(f'Taiwan labels: {counts}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--pbf', type=Path, default=ROOT / 'data/taiwan.osm.pbf')
    prepare(parser.parse_args().pbf)
