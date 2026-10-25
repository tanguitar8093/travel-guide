"""Build the display-only vector map; routing/search inputs remain untouched."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tiles import cache_tile_version

ROOT = Path(__file__).resolve().parents[1]
MAIN_ROADS = {'motorway', 'trunk', 'primary', 'secondary'}


def build(dataset='okinawa', layers=None):
    executable = shutil.which('tippecanoe')
    if executable is None:
        raise SystemExit('Missing tippecanoe. Install it first: sudo apt-get install tippecanoe (Ubuntu 24.04) or brew install tippecanoe.')
    destination = ROOT / f'data/{dataset}.mbtiles'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if dataset == 'okinawa':
        subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-okinawa-labels.py')], check=True)
    # Build beside the destination so publishing is an atomic rename.
    with tempfile.TemporaryDirectory(prefix='atlas-tiles-', dir=destination.parent) as directory:
        temporary = Path(directory)
        coast = temporary / 'coastline.geojson'
        if layers:
            coast = Path(layers) / f'{dataset}-coastline.geojsonl'
        else:
            with coast.open('w') as output:
                for feature in json.loads((ROOT / f'data/{dataset}-land.geojson').read_text())['features']:
                    for ring in feature['geometry']['coordinates']:
                        output.write(json.dumps({
                            'type': 'Feature', 'properties': {},
                            'geometry': {'type': 'LineString', 'coordinates': ring}
                        }, separators=(',', ':')) + '\n')
        def layer(name):
            return Path(layers) / f'{dataset}-{name}.geojsonl' if layers else ROOT / f'data/{dataset}-{name}.geojson'
        output = temporary / f'{dataset}.mbtiles'
        environment = dict(os.environ, TIPPECANOE_MAX_THREADS='2')
        filters = {
            'roads': (['any', ['>=', '$zoom', 12], ['all', ['>=', '$zoom', 10], ['in', 'class', *sorted(MAIN_ROADS | {'tertiary','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'})]], ['in', 'class', *sorted(MAIN_ROADS)]] if dataset == 'japan' else ['any', ['>=', '$zoom', 10], ['in', 'class', *sorted(MAIN_ROADS)]])
        }
        label_arguments = []
        if dataset == 'okinawa':
            filters.update({
                'road_labels': ['any', ['>=', '$zoom', 14], ['all', ['>=', '$zoom', 12], ['in', 'class', *sorted(MAIN_ROADS | {'tertiary'})]]],
                # Keep neighbourhoods at source zoom 14 for display zoom 15+.
                'place_labels': ['any', ['>=', '$zoom', 14],
                                 ['all', ['>=', '$zoom', 12], ['in', 'class', 'suburb', 'quarter']],
                                 ['all', ['>=', '$zoom', 10], ['in', 'class', 'town', 'village']],
                                 ['all', ['>=', '$zoom', 7], ['==', 'class', 'city']]],
            })
            label_arguments = ['-L', f'road_labels:{ROOT / "data/okinawa-road-labels.geojsonl"}',
                               '-L', f'place_labels:{ROOT / "data/okinawa-place-labels.geojsonl"}']
        subprocess.run([
            executable, '--output', str(output),
            '--minimum-zoom=5', '--maximum-zoom=14',
            '--base-zoom=0', '--drop-rate=1',
            '--no-feature-limit', '--no-tile-size-limit',
            '--include=class',
            *(['--include=name', '--include=name:ja', '--include=name:zh-Hant', '--include=name:zh', '--include=ref', '--include=label_minzoom'] if dataset == 'okinawa' else []),
            f'--name={dataset}',
            '--attribution=© OpenStreetMap contributors · ODbL',
            '--feature-filter=' + json.dumps(filters),
            '-L', f'land:{layer("land")}',
            '-L', f'water:{layer("water")}',
            '-L', f'coastline:{coast}',
            '-L', f'roads:{layer("roads")}',
            *label_arguments,
        ], check=True, env=environment)
        with output.open('rb') as stream:
            digest = hashlib.file_digest(stream,'sha256').hexdigest()
        output.replace(destination)
        cache_tile_version(destination,digest)
    print(f'Built {destination.name}: {destination.stat().st_size:,} bytes; SHA256 {digest}')
    print('Restart the map server to publish the new tile version.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", choices=("okinawa","taiwan","japan"), default="okinawa")
    parser.add_argument('--layers',type=Path,help='Streamed GeoJSONL layer directory (required for Japan)')
    args=parser.parse_args()
    if args.dataset=='japan' and not args.layers:parser.error('Japan requires --layers from prepare-display-stream.py')
    build(args.dataset,args.layers)
