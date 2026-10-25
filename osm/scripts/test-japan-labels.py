"""Japan labels preserve Japanese names and original road geometry."""
import importlib.util
import json
from pathlib import Path
import tempfile
import osmium

spec = importlib.util.spec_from_file_location('region_labels', Path(__file__).with_name('prepare-region-labels.py'))
labels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(labels)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'data').mkdir()
    labels.ROOT = root
    source = root / 'japan.osm.pbf'
    with osmium.SimpleWriter(str(source)) as writer:
        writer.add_node(osmium.osm.mutable.Node(id=1, location=(139.77, 35.68), tags={'place': 'city', 'name': 'Tokyo', 'name:ja': '東京都', 'name:zh-Hant': '東京'}))
        writer.add_node(osmium.osm.mutable.Node(id=2, location=(139.771, 35.681), tags={'place': 'quarter', 'name:ja': '丸の内'}))
        writer.add_node(osmium.osm.mutable.Node(id=3, location=(139.772, 35.682)))
        writer.add_way(osmium.osm.mutable.Way(id=1, nodes=[1, 2, 3], tags={'highway': 'residential', 'name:ja': '外堀通り', 'ref': '405'}))
    labels.prepare(source, 'japan')
    roads = [json.loads(line) for line in (root / 'data/japan-road-labels.geojsonl').read_text().splitlines()]
    places = [json.loads(line) for line in (root / 'data/japan-place-labels.geojsonl').read_text().splitlines()]
    assert roads[0]['properties']['name:ja'] == '外堀通り'
    assert roads[0]['properties']['ref'] == '405'
    assert len(roads[0]['geometry']['coordinates']) == 3, 'Untagged referenced nodes must survive native filtering'
    assert places[0]['properties']['name'] == '東京'
    assert places[1]['properties'] == {'name': '丸の内', 'class': 'quarter', 'label_minzoom': 12}
    assert not list((root / 'data').glob('taiwan*'))
print('PASS: Japanese names/ref, city/quarter labels, untagged road references and dataset isolation')
