"""Reproducible disk-backed Japan build; no nationwide in-memory graph/catalog."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('pbf',type=Path);parser.add_argument('--osmium',default='osmium');args=parser.parse_args()
    if not shutil.which(args.osmium):raise SystemExit('Install osmium-tool (native osmium executable) before building Japan.')
    if not shutil.which('tippecanoe'):raise SystemExit('Install tippecanoe before building Japan.')
    work=ROOT/'data/japan-build';work.mkdir(parents=True,exist_ok=True)
    stamp={'path':str(args.pbf.resolve()),'bytes':args.pbf.stat().st_size,'mtimeNs':args.pbf.stat().st_mtime_ns}
    stamp_path=work/'source.json'
    if stamp_path.is_file() and json.loads(stamp_path.read_text())!=stamp:
        raise SystemExit('Japan build workspace belongs to another PBF. Move osm/data/japan-build aside before rebuilding.')
    stamp_path.write_text(json.dumps(stamp)+'\n')
    if shutil.disk_usage(work).free < 20*1024**3:raise SystemExit('Japan build requires at least 20 GiB free workspace.')
    python=sys.executable
    def run(*command):subprocess.run([str(x) for x in command],check=True)
    def filtered(name,expressions):
        target=work/name
        if not target.is_file():
            stage=target.with_suffix('.download')
            try:
                run(args.osmium,'tags-filter',args.pbf,*expressions,'-o',stage,'-f','pbf','--overwrite');stage.replace(target)
            finally:stage.unlink(missing_ok=True)
        return target
    display=filtered('display.osm.pbf',['w/highway','w/natural=coastline,water','w/waterway=riverbank'])
    names=('name','alt_name','official_name','short_name','loc_name','old_name','brand')
    named=filtered('named.osm.pbf',[expr for key in names for expr in (f'nwr/{key}',f'nwr/{key}:*')])
    layers=work/'layers'
    if not layers.is_dir():run(python,ROOT/'scripts/prepare-display-stream.py',display,layers,'--prefix','japan')
    run(python,ROOT/'scripts/extract-places-disk.py',named,'--dataset','japan')
    run(python,ROOT/'scripts/prepare-search-index.py',ROOT/'data/japan-places.json')
    run(python,ROOT/'scripts/build-routing-disk.py',display,'--dataset','japan')
    run(python,ROOT/'scripts/build-tiles.py','--dataset','japan','--layers',layers)
    run(python,ROOT/'scripts/write-manifest.py','--dataset','japan')
    print('Japan artifacts ready. Restart the OSM service to publish.',flush=True)
if __name__=='__main__':main()
