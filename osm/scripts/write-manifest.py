"""Record dataset provenance and artifact checksums after all build steps complete."""
import argparse
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--dataset',choices=('okinawa','taiwan'),required=True)
    args=parser.parse_args()
    catalog=ROOT/'data'/f'{args.dataset}-places.json'
    with catalog.open() as stream:
        prefix=stream.read(8192).split('"places":',1)[0].rstrip().rstrip(',')
    metadata=json.loads(prefix+'}')
    artifacts={}
    for suffix in ('.mbtiles','-places.json','-routing.sqlite','-osm.json'):
        path=ROOT/'data'/f'{args.dataset}{suffix}'
        if not path.is_file():continue
        with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        artifacts[path.name]={'bytes':path.stat().st_size,'sha256':digest}
    manifest={'dataset':args.dataset,'dataTimestamp':metadata['dataTimestamp'],'placeCount':sum(metadata['counts'].values()),
              'counts':metadata['counts'],'source':metadata['source'],'artifacts':artifacts}
    path=ROOT/'data'/f'{args.dataset}-manifest.json'
    temporary=path.with_suffix('.download')
    temporary.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');temporary.replace(path)
    print(f'Manifest: {args.dataset}, {manifest["placeCount"]:,} places, {manifest["dataTimestamp"]}',flush=True)
if __name__=='__main__':main()
