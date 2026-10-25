"""Public multi-city regressions; optional reported trip stays in a local private file."""
import argparse
import json
from pathlib import Path
import resource
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from compact_routing import CompactRouter
from routing import distance
CASES={
 'taiwan':[
 ('miaoli-taichung',[120.825,24.565],[120.6847,24.1377]),
 ('taipei-hsinchu',[121.517,25.0478],[120.971,24.801]),
 ('taipei-taichung',[121.517,25.0478],[120.6847,24.1377]),
 ('taichung-tainan',[120.6847,24.1377],[120.212,22.997]),
 ('taichung-kaohsiung',[120.6847,24.1377],[120.3014,22.6394]),
 ('hualien-ruisui',[121.601,23.992],[121.379,23.497])],
 'japan':[
 ('tokyo-yokohama',[139.7671,35.6812],[139.638,35.4437]),
 ('tokyo-shizuoka',[139.7671,35.6812],[138.389,34.972]),
 ('osaka-himeji',[135.4959,34.7025],[134.690,34.827]),
 ('fukuoka-kumamoto',[130.4017,33.5902],[130.705,32.790])],
}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--dataset',choices=('all','taiwan','japan'),default='all')
 parser.add_argument('--trip',type=Path,help='Private synced fixture, only first two stops are used; coordinates are not written into the report')
 args=parser.parse_args();cases={key:list(value) for key,value in CASES.items()}
 if args.trip:
  trip=next(row for row in json.loads(args.trip.read_text()) if row['region']['map_provider']=='osm')
  def point(row):
   coordinate=row['place']['location']['coordinate'];return [coordinate['longitude'],coordinate['latitude']]
  items=sorted(trip['items'],key=lambda row:(row['date'],row['sort_order']))
  cases[trip['region']['osm_dataset']].insert(0,('reported-leg',point(items[0]),point(items[1])))
 records=[]
 for dataset,entries in cases.items():
  if args.dataset!='all' and dataset!=args.dataset:continue
  router=CompactRouter(ROOT/f'data/{dataset}-routing.sqlite',dataset)
  for label,a,b in entries:
   modes=('car','walk','bike') if label in ('miaoli-taichung','tokyo-yokohama') else ('car',)
   for mode in modes:
    for direction,start,end in [('forward',a,b),('reverse',b,a)]:
     started=time.monotonic()
     try:
      result=router.route([start,end],mode);leg=result['legs'][0]
      assert result['distance']>=distance(start,end)-1 and result['duration']>0
      assert tuple(leg['geometry']['coordinates'][0])==tuple(start) and tuple(leg['geometry']['coordinates'][-1])==tuple(end)
      row={'ok':True,'meters':result['distance'],'duration':result['duration'],'optimal':result['optimal'],'weight':result['heuristicWeight'],'geometryPoints':len(leg['geometry']['coordinates'])}
     except ValueError as error:row={'ok':False,'error':str(error)}
     row.update(dataset=dataset,case=label,mode=mode,direction=direction,straightKm=round(distance(start,end)/1000,1),seconds=round(time.monotonic()-started,4),peakRssMiB=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,2))
     records.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
 output={'records':records,'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024}
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
 if any(not row['ok'] for row in records):raise SystemExit('Some public regional routes failed; inspect results')
if __name__=='__main__':main()
