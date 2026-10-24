"""Streaming display layers preserve the existing geometry and publish atomically."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile

import osmium
from shapely.geometry import shape
from shapely.ops import polygonize, unary_union


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stream = load('display_stream', 'prepare-display-stream.py')
original = load('display_original', 'prepare-dataset.py')
original.inside = lambda point, dataset: True


def fixture(path, missing=False, coast=True):
    nodes = {1:(127,26), 2:(128,26), 3:(128,27), 4:(127,27),
             5:(127.2,26.2), 14313680697:(127.3,26.4), 7:(127.5,26.2),
             8:(127.6,26.6), 9:(127.7,26.6), 10:(127.7,26.7), 11:(127.6,26.7), 12:(127.6,26.6)}
    with osmium.SimpleWriter(str(path)) as writer:
        for identifier, point in sorted(nodes.items()):
            writer.add_node(osmium.osm.mutable.Node(id=identifier, location=point))
        ways = []
        if coast:
            ways.extend((identifier, refs, {'natural':'coastline'})
                        for identifier, refs in enumerate(([1,2],[2,3],[3,4],[4,1]),1))
        ways.extend([(5,[5,5,14313680697,7],{'highway':'residential'}),
                     (6,[8,9,10,11,12],{'natural':'water'}),
                     (7,[5,7],{'building':'yes'}),
                     (8,[5],{'highway':'service'})])
        if missing:
            ways.append((9,[5,999],{'highway':'service'}))
        for identifier, refs, tags in ways:
            writer.add_way(osmium.osm.mutable.Way(id=identifier, nodes=refs, tags=tags))


def read_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    source = root/'fixture.osm.pbf'
    fixture(source)
    baseline = original.Extract('fixture')
    baseline.apply_file(str(source), locations=True, idx='flex_mem')
    output = root/'layers'
    with redirect_stdout(io.StringIO()):
        result = stream.extract(source, output, 'fixture', timestamp='fixture-stamp')
    assert read_lines(output/'fixture-roads.geojsonl') == baseline.roads
    assert read_lines(output/'fixture-water.geojsonl') == baseline.water
    actual_land = unary_union([shape(feature['geometry']) for feature in read_lines(output/'fixture-land.geojsonl')])
    expected_land = unary_union(list(polygonize(unary_union(baseline.coasts))))
    assert actual_land.equals(expected_land)
    assert actual_land.area == 1
    assert result['counts']['roadFeatures'] == 1
    assert result['counts']['roadPointReferences'] == 4, 'Duplicate points must survive native serialization'
    assert result['counts']['degenerateWays'] == 1
    assert result['dataTimestamp'] == 'fixture-stamp'
    # libosmium reserves an initial block (16 MiB here); a dense index for this
    # 64-bit ID would instead require hundreds of GB.
    assert result['locationIndexBytes'] < 64*1024*1024, 'Sparse index must not allocate by the maximum OSM ID'
    assert set(path.name for path in output.iterdir()) == {
        'fixture-roads.geojsonl','fixture-water.geojsonl','fixture-land.geojsonl',
        'fixture-coastline.geojsonl','manifest.json'}
    for name, metadata in result['artifacts'].items():
        assert metadata['sha256'] == stream.digest(output/name)
    try:
        stream.extract(source, output, 'fixture')
    except ValueError as error:
        assert 'existing output directory' in str(error)
    else:
        raise AssertionError('Existing output was overwritten')

    for name, kwargs in [('missing',{'missing':True}),('open-coast',{'coast':False})]:
        bad_source = root/f'{name}.osm.pbf'
        fixture(bad_source, **kwargs)
        destination = root/name
        try:
            with redirect_stdout(io.StringIO()):
                stream.extract(bad_source, destination, 'fixture')
        except ValueError:
            pass
        else:
            raise AssertionError('Incomplete source was accepted')
        assert not destination.exists(), 'Failed extraction must not publish layers'
    assert not list(root.glob('.*-build-*')), 'Temporary locations and WKB must be removed'
print('PASS: streamed roads/water/land match baseline; sparse 64-bit IDs; atomic output; missing geometry and empty land rejected')
