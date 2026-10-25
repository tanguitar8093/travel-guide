"""Record dataset provenance and artifact checksums after all build steps complete."""
import argparse
import hashlib
import json
import re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0,str(ROOT))
from tiles import cache_tile_version

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--dataset',choices=('okinawa','taiwan','japan'),required=True)
    args=parser.parse_args()
    catalog=ROOT/'data'/f'{args.dataset}-places.json'
    with catalog.open() as stream:
        prefix=stream.read(8192).split('"places":',1)[0].rstrip().rstrip(',')
    metadata=json.loads(prefix+'}')
    if 'counts' not in metadata:
        with catalog.open('rb') as stream:
            stream.seek(max(0,catalog.stat().st_size-4096))
            tail=stream.read().decode('utf-8',errors='replace')
        counts=re.search(r',\"counts\":(\{[^}]+\})\}\s*$',tail)
        if counts:metadata['counts']=json.loads(counts[1])
    if 'counts' not in metadata:
        from collections import Counter
        import sys
        sys.path.insert(0,str(ROOT))
        from disk_search import iter_places
        counts=Counter(row['id'].split('-')[1] for row in iter_places(catalog,{}))
        metadata['counts']=dict(counts)
    artifacts={}
    for suffix in ('.mbtiles','-places.json','-routing.sqlite','-osm.json'):
        path=ROOT/'data'/f'{args.dataset}{suffix}'
        if not path.is_file():continue
        checksum=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):checksum.update(chunk)
        digest=checksum.hexdigest()
        artifacts[path.name]={'bytes':path.stat().st_size,'sha256':digest}
        if suffix=='.mbtiles':cache_tile_version(path,digest)
    manifest={'dataset':args.dataset,'dataTimestamp':metadata['dataTimestamp'],'placeCount':sum(metadata['counts'].values()),
              'counts':metadata['counts'],'source':metadata['source'],'artifacts':artifacts}
    path=ROOT/'data'/f'{args.dataset}-manifest.json'
    temporary=path.with_suffix('.download')
    temporary.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');temporary.replace(path)
    print(f'Manifest: {args.dataset}, {manifest["placeCount"]:,} places, {manifest["dataTimestamp"]}',flush=True)
if __name__=='__main__':main()
