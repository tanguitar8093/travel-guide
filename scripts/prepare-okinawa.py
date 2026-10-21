"""Convert downloaded OSM into small locally served 2D GeoJSON layers."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


def prepare():
    raw = json.loads((ROOT/'data/okinawa-osm.json').read_text())
    if raw.get('remark'):
        raise ValueError(raw['remark'])
    nodes = {e['id']:[e['lon'],e['lat']] for e in raw['elements'] if e['type']=='node'}
    roads, water, coastline = [], [], []
    for e in raw['elements']:
        if e['type']!='way':
            continue
        coords = [nodes[n] for n in e['nodes'] if n in nodes]
        tags = e.get('tags', {})
        if len(coords)<2:
            continue
        if 'highway' in tags:
            roads.append({'type':'Feature','properties':{'class':tags['highway'],'name':tags.get('name:en', tags.get('ref',''))},'geometry':{'type':'LineString','coordinates':coords}})
        if tags.get('natural')=='coastline':
            coastline.append(e['nodes'])
        if tags.get('natural')=='water' and coords[0]==coords[-1] and len(coords)>3:
            water.append({'type':'Feature','properties':{},'geometry':{'type':'Polygon','coordinates':[coords]}})
    # OSM coastline ways are oriented with land on their left. Join chains into island rings.
    chains = list(coastline)
    by_start = {chain[0]:chain for chain in chains}
    used = set()
    land = []
    for chain in chains:
        if id(chain) in used:
            continue
        ring = list(chain)
        used.add(id(chain))
        while ring[-1]!=ring[0] and ring[-1] in by_start:
            next_chain = by_start[ring[-1]]
            if id(next_chain) in used:
                break
            used.add(id(next_chain))
            ring.extend(next_chain[1:])
        if ring[0]==ring[-1] and len(ring)>3:
            land.append({'type':'Feature','properties':{},'geometry':{'type':'Polygon','coordinates':[[nodes[n] for n in ring]]}})
    if not land:
        raise ValueError('No complete island coastline found; map cannot render land.')
    for name, features in [('roads',roads),('water',water),('land',land)]:
        (ROOT/f'data/okinawa-{name}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')))
    print(f'Okinawa: {len(roads)} roads, {len(land)} island polygons, {len(nodes)} routing nodes')

if __name__=='__main__':
    prepare()
