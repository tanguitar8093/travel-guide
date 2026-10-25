"""Measure this machine's actual Japan catalog and SQLite graph (no synthetic claims)."""
import argparse
import json
from pathlib import Path
import resource
import sys
import time
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
parser=argparse.ArgumentParser();parser.add_argument('--kind',choices=('search','routing'),required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
records=[];started=time.monotonic()
if args.kind=='search':
    from disk_search import DiskPlaceSearch
    search=DiskPlaceSearch(ROOT/'data/japan-places.json')
    queries=['東京駅','Tokyo','大阪城','札幌','首里城','石垣','宮古','石垣島','宮古島','父島','セブン','駅','a','東']
    for iteration in range(2):
        for query in queries:
            start=time.monotonic();result=search.search(query)
            row={'iteration':iteration,'query':query,'seconds':round(time.monotonic()-start,4),'total':result['total'],'returned':len(result['results']),'sample':[{'id':p['id'],'name':p['name'],'coordinates':p['coordinates']} for p in result['results'][:3]]}
            records.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
    count=search.entry_count
else:
    from compact_routing import CompactRouter
    router=CompactRouter(ROOT/'data/japan-routing.sqlite','japan')
    cases=[('Tokyo',[139.7671,35.6812],[139.7528,35.6852]),('Osaka',[135.4959,34.7025],[135.5262,34.6873]),
      ('Sapporo',[141.3508,43.0687],[141.3545,43.0618]),('Fukuoka',[130.4017,33.5902],[130.4207,33.5898]),
      ('Matsuyama',[132.7657,33.8392],[132.7867,33.852]),('Naha',[127.6809,26.2124],[127.7195,26.217]),
      ('Ishigaki',[124.1572,24.3448],[124.1554,24.3406]),('Miyako',[125.2811,24.8055],[125.2785,24.8002]),
      ('Chichijima',[142.194,27.094],[142.191,27.090]),('Tokyo-Yokohama',[139.7671,35.6812],[139.638,35.4437]),
      ('Tokyo-Osaka',[139.7671,35.6812],[135.4959,34.7025]),('Tokyo-Sapporo',[139.7671,35.6812],[141.3508,43.0687]),
      ('Naha-Ishigaki',[127.6809,26.2124],[124.1572,24.3448])]
    for label,origin,destination in cases:
        for mode in ('car','walk','bike'):
            start=time.monotonic()
            try:
                result=router.route([origin,destination],mode)
                row={'case':label,'mode':mode,'ok':True,'result':result}
            except ValueError as error:row={'case':label,'mode':mode,'ok':False,'error':str(error)}
            row['seconds']=round(time.monotonic()-start,4);records.append(row);print(json.dumps({k:v for k,v in row.items() if k!='result'},ensure_ascii=False),flush=True)
    count=None
summary={'kind':args.kind,'seconds':time.monotonic()-started,'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,'placeCount':count,'records':records,'note':'Single-machine measurements; concurrent builders may affect timing. RSS is per benchmark process, not the complete HTTP service.'}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
