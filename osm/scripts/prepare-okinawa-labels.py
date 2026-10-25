"""Build display-only label inputs from the bundled Okinawa source/catalog."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME_KEYS = ('name', 'name:ja', 'name:zh-Hant', 'name:zh', 'ref')
PLACE_ZOOMS = {'city': 7, 'town': 10, 'village': 10, 'suburb': 12, 'quarter': 12,
               'neighbourhood': 15}


def road_properties(tags):
    return {'class': tags.get('highway', tags.get('class')), **{
        key: tags[key] for key in NAME_KEYS if tags.get(key)
    }}


def prepare():
    data = ROOT / 'data'
    raw = json.loads((data / 'okinawa-osm.json').read_text())
    roads = []
    if 'elements' in raw:
        nodes = {row['id']: [row['lon'], row['lat']] for row in raw['elements'] if row['type'] == 'node'}
        for row in raw['elements']:
            tags = row.get('tags', {})
            if row['type'] != 'way' or not tags.get('highway') or not any(tags.get(key) for key in NAME_KEYS):
                continue
            coordinates = [nodes[node] for node in row['nodes'] if node in nodes]
            if len(coordinates) >= 2:
                roads.append({'type': 'Feature', 'properties': road_properties(tags),
                              'geometry': {'type': 'LineString', 'coordinates': coordinates}})
    else:
        for row in json.loads((data / 'okinawa-roads.geojson').read_text())['features']:
            if any(row['properties'].get(key) for key in NAME_KEYS):
                roads.append(row)
    del raw
    places, seen = [], set()
    for row in json.loads((data / 'okinawa-places.json').read_text())['places']:
        kind = row['category']
        # Use actual place nodes, rather than duplicate administrative polygons or POIs.
        if kind not in PLACE_ZOOMS or row['locationKind'] != 'osm-node':
            continue
        names = row.get('names', {})
        name = names.get('name:zh-Hant') or names.get('name:zh') or names.get('name') or row['name']
        identity = (name, tuple(row['coordinates']))
        if identity in seen:
            continue
        seen.add(identity)
        places.append({'type': 'Feature', 'properties': {'name': name, 'class': kind,
                       'label_minzoom': PLACE_ZOOMS[kind]},
                       'geometry': {'type': 'Point', 'coordinates': row['coordinates']}})
    for name, features in [('road-labels', roads), ('place-labels', places)]:
        path = data / f'okinawa-{name}.geojsonl'
        temporary = path.with_suffix('.download')
        with temporary.open('w') as output:
            for feature in features:
                output.write(json.dumps(feature, ensure_ascii=False, separators=(',', ':')) + '\n')
        temporary.replace(path)
    print(f'Okinawa labels: {len(roads):,} road ways; {len(places):,} place nodes', flush=True)


if __name__ == '__main__':
    prepare()
