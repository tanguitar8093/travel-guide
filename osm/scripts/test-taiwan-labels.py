"""Taiwan label extraction preserves names, geometry, coverage and atomic failure."""
import importlib.util
import json
from pathlib import Path
import tempfile

import osmium

spec = importlib.util.spec_from_file_location('taiwan_labels', Path(__file__).with_name('prepare-region-labels.py'))
labels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(labels)

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'data').mkdir()
    labels.ROOT = root
    pbf = root / 'fixture.osm.pbf'
    with osmium.SimpleWriter(str(pbf)) as writer:
        for identifier, location, tags in [
            (1, (121.517, 25.047), {'place': 'city', 'name': 'Taipei', 'name:zh-Hant': '臺北市'}),
            (2, (121.518, 25.047), {'place': 'suburb', 'name': '中正區'}),
            (3, (121.519, 25.048), {}),
            (4, (139.76, 35.68), {'place': 'city', 'name': 'outside'}),
            (5, (139.77, 35.69), {}),
        ]:
            writer.add_node(osmium.osm.mutable.Node(id=identifier, location=location, tags=tags))
        for identifier, nodes, tags in [
            (1, [1, 2], {'highway': 'primary', 'name': 'Road', 'name:zh-Hant': '忠孝西路', 'ref': '1'}),
            (2, [2, 3], {'highway': 'residential', 'name': '公園路'}),
            (3, [1, 3], {'highway': 'service'}),
            (4, [4, 5], {'highway': 'primary', 'name': 'outside'}),
        ]:
            writer.add_way(osmium.osm.mutable.Way(id=identifier, nodes=nodes, tags=tags))
    labels.prepare(pbf)
    roads_path = root / 'data/taiwan-road-labels.geojsonl'
    places_path = root / 'data/taiwan-place-labels.geojsonl'
    roads = [json.loads(line) for line in roads_path.read_text().splitlines()]
    places = [json.loads(line) for line in places_path.read_text().splitlines()]
    assert len(roads) == 2 and len(places) == 2
    assert roads[0]['properties']['name:zh-Hant'] == '忠孝西路'
    assert roads[0]['properties']['ref'] == '1'
    assert roads[0]['geometry']['coordinates'] == [[121.517, 25.047], [121.518, 25.047]]
    assert places[0]['properties']['name'] == '臺北市'
    assert places[1]['properties']['label_minzoom'] == 12
    before = roads_path.read_bytes(), places_path.read_bytes()
    try:
        labels.prepare(root / 'missing.osm.pbf')
        raise AssertionError('Missing PBF accepted')
    except SystemExit:
        pass
    assert before == (roads_path.read_bytes(), places_path.read_bytes())
    assert not list((root / 'data').glob('atlas-labels-*'))
print('PASS: Taiwan source names, zoom class, geometry, coverage, unnamed roads and failure preservation')
