"""Download and prepare a complete OSM dataset. Existing Okinawa assets stay compatible."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def download(url, destination):
    if destination.is_file() and destination.stat().st_size:
        print(f'Already installed: {destination.name}',flush=True)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.download')
    try:
        with urlopen(Request(url,headers={'User-Agent':'TripMap-OSM-data/1.0'}),timeout=180) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response,output)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset',choices=('okinawa','taiwan','japan'),default='okinawa')
    parser.add_argument('--pbf',help='Use an already downloaded regional PBF')
    args = parser.parse_args()
    python = ROOT/'.venv/bin/python'
    if not python.is_file():
        subprocess.run([sys.executable,'-m','venv',str(ROOT/'.venv')],check=True)
    subprocess.run([str(python),'-m','pip','install','-r',str(ROOT/'requirements-build.txt')],check=True)
    pbf = Path(args.pbf).resolve() if args.pbf else ROOT/'data'/f'{args.dataset}.osm.pbf'
    if not args.pbf:
        source = {'taiwan':'asia/taiwan','okinawa':'asia/japan/kyushu','japan':'asia/japan'}[args.dataset]
        url = f'https://download.geofabrik.de/{source}-latest.osm.pbf'
        download(url,pbf)
        # Check a complete download before spending time on extraction.
        with urlopen(url+'.md5',timeout=60) as response:
            expected = response.read().decode().split()[0]
        checksum = hashlib.md5()
        with pbf.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024*1024), b''):
                checksum.update(chunk)
        actual = checksum.hexdigest()
        if expected != actual:
            raise SystemExit('PBF checksum mismatch. Remove the local PBF and retry (the upstream latest file may have rotated).')
    if args.dataset == 'japan':
        subprocess.run([str(python),str(ROOT/'scripts/prepare-japan.py'),str(pbf)],check=True)
        return
    for script in ('prepare-dataset.py','extract-places.py','build-routing.py'):
        subprocess.run([str(python),str(ROOT/'scripts'/script),str(pbf),'--dataset',args.dataset],check=True)
    if args.dataset == 'taiwan':
        subprocess.run([str(python),str(ROOT/'scripts/prepare-search-index.py'),str(ROOT/'data/taiwan-places.json')],check=True)
    subprocess.run([str(python),str(ROOT/'scripts/build-tiles.py'),'--dataset',args.dataset,'--pbf',str(pbf)],check=True)
    subprocess.run([str(python),str(ROOT/'scripts/write-manifest.py'),'--dataset',args.dataset],check=True)
    print(f'{args.dataset} ready. Restart npm run dev / npm run osm:start to publish the new dataset.',flush=True)

if __name__=='__main__':
    main()
