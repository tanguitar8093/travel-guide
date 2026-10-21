import json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
root=Path(__file__).resolve().parents[1]
r=Router(json.loads((root/'data/okinawa-osm.json').read_text()))
points=[[127.6513,26.2065],[127.6843,26.2144],[127.7192,26.2170],[127.7562,26.3167],[127.8501,26.5048],[127.8780,26.6944],[128.0200,26.6960]]
for mode in ('car','walk','bike'):
    start=time.monotonic()
    for a,b in zip(points,points[1:]):
        leg=r.leg(a,b,mode)
        assert leg['distance']>0 and leg['duration']>0
        print(mode,round(leg['distance']/1000,1),round(leg['duration']/60),leg['snapDistances'],flush=True)
    print('Verified',mode,'in',round(time.monotonic()-start,1),'seconds',flush=True)
