"""Reproducible real-data routing benchmark. Prepare routing indexes before measurement."""
import argparse
import json
from pathlib import Path
import resource
import sys
import time
root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--module-dir', type=Path, help='Optional prior routing implementation for comparison')
args = parser.parse_args()
sys.path.insert(0, str(root))
if args.module_dir:
    sys.path.insert(0, str(args.module_dir.resolve()))
from compact_routing import CompactRouter

def memory():
    if Path('/proc/self/status').exists():
        fields = dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
        return {name:round(int(fields[key].split()[0])/1024,1) for name,key in [('rssMB','VmRSS'),('peakMB','VmHWM')]}
    return {'peakMB':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,1)}
start = time.perf_counter()
router = CompactRouter(root/'data/taiwan-routing.sqlite','taiwan')
print(json.dumps({'stage':'init','seconds':round(time.perf_counter()-start,4),**memory()}),flush=True)
stages = {}
for name in ('graph','snap','path_geometry'):
    original = getattr(router,name)
    def timed(*args,_name=name,_original=original,**kwargs):
        start = time.perf_counter()
        try: return _original(*args,**kwargs)
        finally: stages[_name] = stages.get(_name,0)+time.perf_counter()-start
    setattr(router,name,timed)
cases = [
    ('city-car',[121.5654,25.033],[121.5645,25.0375],'car'),
    ('city-walk',[121.5654,25.033],[121.5645,25.0375],'walk'),
    ('Taipei-station-to-101',[121.517,25.0478],[121.5654,25.033],'walk'),
    ('disconnected-islands',[121.517,25.0478],[119.566,23.566],'walk'),
    ('repeat-failure',[121.517,25.0478],[119.566,23.566],'walk'),
    ('switch-back-car',[121.5655,25.0331],[121.5646,25.0376],'car'),
]
for name,start,end,mode in cases:
    stages.clear()
    began = time.perf_counter()
    try:
        result = router.route([start,end],mode)
        outcome = {key:result[key] for key in ('distance','duration')}
    except ValueError as error:
        outcome = {'error':str(error)}
    print(json.dumps({'case':name,'seconds':round(time.perf_counter()-began,4),
      'stages':{key:round(value,4) for key,value in stages.items()},**memory(),**outcome},ensure_ascii=False),flush=True)
