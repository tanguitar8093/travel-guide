"""Build the display-only vector map; routing/search inputs remain untouched."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MAIN_ROADS = {'motorway', 'trunk', 'primary', 'secondary'}


def build(dataset='okinawa'):
    executable = shutil.which('tippecanoe')
    if executable is None:
        raise SystemExit('Missing tippecanoe. Install it first: sudo apt-get install tippecanoe (Ubuntu 24.04) or brew install tippecanoe.')
    destination = ROOT / f'data/{dataset}.mbtiles'
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Build beside the destination so publishing is an atomic rename.
    with tempfile.TemporaryDirectory(prefix='atlas-tiles-', dir=destination.parent) as directory:
        temporary = Path(directory)
        coast = temporary / 'coastline.geojson'
        with coast.open('w') as output:
            for feature in json.loads((ROOT / f'data/{dataset}-land.geojson').read_text())['features']:
                for ring in feature['geometry']['coordinates']:
                    output.write(json.dumps({
                        'type': 'Feature', 'properties': {},
                        'geometry': {'type': 'LineString', 'coordinates': ring}
                    }, separators=(',', ':')) + '\n')
        output = temporary / f'{dataset}.mbtiles'
        environment = dict(os.environ, TIPPECANOE_MAX_THREADS='2')
        subprocess.run([
            executable, '--output', str(output),
            '--minimum-zoom=5', '--maximum-zoom=14',
            '--base-zoom=0', '--drop-rate=1',
            '--no-feature-limit', '--no-tile-size-limit',
            '--include=class', f'--name={dataset}',
            '--attribution=© OpenStreetMap contributors · ODbL',
            '--feature-filter=' + json.dumps({
                'roads': ['any', ['>=', '$zoom', 10], ['in', 'class', *sorted(MAIN_ROADS)]]
            }),
            '-L', f'land:{ROOT / f"data/{dataset}-land.geojson"}',
            '-L', f'water:{ROOT / f"data/{dataset}-water.geojson"}',
            '-L', f'coastline:{coast}',
            '-L', f'roads:{ROOT / f"data/{dataset}-roads.geojson"}',
        ], check=True, env=environment)
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        output.replace(destination)
    print(f'Built {destination.name}: {destination.stat().st_size:,} bytes; SHA256 {digest}')
    print('Restart the map server to publish the new tile version.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", choices=("okinawa","taiwan"), default="okinawa")
    build(parser.parse_args().dataset)
