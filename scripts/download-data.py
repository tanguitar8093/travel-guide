"""Download Okinawa OSM data and a local Chinese UI font."""
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import urlencode
import shutil

ROOT = Path(__file__).resolve().parents[1]


def download(url, destination):
    if destination.is_file() and destination.stat().st_size:
        print(f'Already installed: {destination.relative_to(ROOT)}')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.download')
    try:
        with urlopen(Request(url, headers={'User-Agent': 'osm-local-map-demo/1.0'}), timeout=120) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Downloaded: {destination.relative_to(ROOT)}')


query = '[out:json][timeout:120];(way[highway](25.98,127.58,26.9,128.36);way[natural=coastline](25.98,127.58,26.9,128.36););out body;>;out skel qt;'
download('https://overpass-api.de/api/interpreter?' + urlencode({'data':query}), ROOT / 'data/okinawa-osm.json')
import runpy
runpy.run_path(str(ROOT/'scripts/prepare-okinawa.py'), run_name='__main__')
runpy.run_path(str(ROOT/'scripts/build-tiles.py'), run_name='__main__')
places_file = ROOT / 'data/okinawa-places.json'
import json
needs_places = not places_file.is_file() or json.loads(places_file.read_text()).get('schemaVersion',0)<2
if needs_places:
    import tempfile, subprocess, sys
    reader_dir = Path(tempfile.gettempdir()) / 'atlas-osmium'
    subprocess.run([sys.executable,'-m','pip','install','--target',str(reader_dir),'osmium'],check=True)
    region = ROOT / 'data/kyushu.osm.pbf'
    download('https://download.geofabrik.de/asia/japan/kyushu-latest.osm.pbf',region)
    import os
    environment=dict(os.environ,PYTHONPATH=str(reader_dir))
    subprocess.run([sys.executable,str(ROOT/'scripts/extract-places.py'),str(region)],env=environment,check=True)
ui_font = ROOT / 'data/fonts/ui-zh-hant.ttf'
# Full font supports names from the OSM catalog and user-entered place names.
download('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf', ui_font)
print('Ready. Run npm start, then open http://localhost:3000')
