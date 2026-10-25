"""Real Okinawa regression routes; optional private synced-trip fixture stays local."""
import argparse
import json
from pathlib import Path
import resource
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from routing import Router, distance

CASES=[
 ('airport-to-rental',[127.6466452,26.2001297],[127.654403,26.1588346]),
 ('rental-to-ou-island',[127.654403,26.1588346],[127.7724548,26.1293214]),
 ('okinawa-world-to-naha',[127.7489447,26.1404807],[127.6775494,26.2138849]),
 ('minatogawa-to-katsuren',[127.714602,26.2625264],[127.8790368,26.3304832]),
 ('oodomari-to-parco',[127.9910566,26.3935945],[127.6981799,26.2617542]),
 ('naha-control',[127.6809,26.2124],[127.6819,26.2134]),
]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--trip',type=Path,help='Local private synced-trip fixture, never uploaded')
    args=parser.parse_args()
    started=time.monotonic()
    router=Router(json.loads((ROOT/'data/okinawa-osm.json').read_text()))
    cases=[(label,a,b,'car') for label,a,b in CASES]
    cases += [(label+'-reverse',b,a,'car') for label,a,b in CASES]
    cases += [('naha-control-'+mode,CASES[-1][1],CASES[-1][2],mode) for mode in ('walk','bike')]
    if args.trip:
        trip=next(row for row in json.loads(args.trip.read_text()) if row['region']['map_provider']=='osm')
        for day,date in enumerate(sorted({row['date'] for row in trip['items']}),1):
            items=sorted((row for row in trip['items'] if row['date']==date),key=lambda row:row['sort_order'])
            for index,(a,b) in enumerate(zip(items,items[1:]),1):
                mode={'DRIVING':'car','WALKING':'walk','BICYCLING':'bike'}.get(b['transport'])
                if mode is None:continue
                def point(row):
                    coordinate=row['place']['location']['coordinate']
                    return [coordinate['longitude'],coordinate['latitude']]
                cases.append((f'actual-day-{day}-leg-{index}',point(a),point(b),mode))
    rows=[]
    for label,a,b,mode in cases:
        start=time.monotonic()
        try:
            result=router.route([a,b],mode)
            leg=result['legs'][0]
            assert result['distance']>=distance(a,b)-1 and result['duration']>0
            assert tuple(leg['geometry']['coordinates'][0])==tuple(a) and tuple(leg['geometry']['coordinates'][-1])==tuple(b)
            assert max(leg['snapDistances'])<=800
            row={'case':label,'mode':mode,'ok':True,'distance':result['distance'],'duration':result['duration'],
                 'geometryPoints':len(leg['geometry']['coordinates']),'snapDistances':leg['snapDistances']}
        except ValueError as error:
            row={'case':label,'mode':mode,'ok':False,'error':str(error)}
        row.update(seconds=round(time.monotonic()-start,4),peakRssMiB=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,2))
        rows.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
    report={'dataset':'okinawa','seconds':time.monotonic()-started,'records':rows,
            'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if any(not row['ok'] for row in rows):raise SystemExit('Some real routes failed; inspect the report')

if __name__=='__main__':main()
