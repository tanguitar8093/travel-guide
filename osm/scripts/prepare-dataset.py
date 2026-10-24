"""Extract routing/display data from a regional PBF without an Overpass bulk query."""
import argparse
import gc
import json
from pathlib import Path
import sys
import osmium
from shapely.geometry import LineString, mapping
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from datasets import definition
from shapely.geometry import Polygon, MultiPolygon
from shapely import intersects_xy, prepare
_COVERAGE = {}
def inside(point, dataset):
    if dataset not in _COVERAGE:
        _COVERAGE[dataset] = MultiPolygon([Polygon(ring) for ring in definition(dataset)["coverage"]])
        prepare(_COVERAGE[dataset])
    return bool(intersects_xy(_COVERAGE[dataset],point[0],point[1]))

ROUTE_TAGS = {'highway','access','motorcar','motor_vehicle','vehicle','foot','bicycle','area','oneway',
              'oneway:foot','oneway:bicycle','junction','motorroad','maxspeed','cycleway','cycleway:left','cycleway:right'}

class Extract(osmium.SimpleHandler):
    def __init__(self, dataset):
        super().__init__()
        self.dataset = dataset
        self.nodes, self.ways, self.roads, self.water, self.coasts = {}, [], [], [], []

    def way(self, way):
        tags = dict(way.tags)
        if not ('highway' in tags or tags.get('natural') in ('coastline','water') or tags.get('waterway') == 'riverbank'):
            return
        points = [[node.lon,node.lat] for node in way.nodes if node.location.valid()]
        if len(points) != len(way.nodes) or len(points) < 2:
            return
        # Keep complete coastline chains; clip display/places using the coverage manifest.
        if tags.get('natural') == 'coastline':
            self.coasts.append(LineString(points))
        if (tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank') and points[0] == points[-1] and len(points) >= 4:
            self.water.append({'type':'Feature','properties':{},'geometry':{'type':'Polygon','coordinates':[points]}})
        if 'highway' in tags and any(inside(point,self.dataset) for point in points):
            self.ways.append({'type':'way','id':way.id,'nodes':[node.ref for node in way.nodes],
                              'tags':{key:value for key,value in tags.items() if key in ROUTE_TAGS}})
            self.nodes.update((node.ref,[node.lon,node.lat]) for node in way.nodes)
            self.roads.append({'type':'Feature','properties':{'class':tags['highway']},'geometry':{'type':'LineString','coordinates':points}})


def publish(path, value):
    temporary = path.with_suffix('.download')
    with temporary.open('w') as output:
        json.dump(value,output,ensure_ascii=False,separators=(',',':'))
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pbf')
    parser.add_argument('--dataset', choices=('okinawa','taiwan'), required=True)
    args = parser.parse_args()
    handler = Extract(args.dataset)
    handler.apply_file(args.pbf,locations=True,idx='flex_mem')
    # Open coastline fragments at the extract border are deliberately not filled.
    land = [polygon for polygon in polygonize(unary_union(handler.coasts)) if inside([polygon.representative_point().x,polygon.representative_point().y],args.dataset)]
    if not land:
        raise ValueError('No complete land polygons in this dataset; refusing to publish an empty basemap.')
    directory = ROOT/'data'
    directory.mkdir(exist_ok=True)
    for layer, features in [('land',[{'type':'Feature','properties':{},'geometry':mapping(polygon)} for polygon in land]),('roads',handler.roads),('water',handler.water)]:
        publish(directory/f'{args.dataset}-{layer}.geojson',{'type':'FeatureCollection','features':features})
    reader = osmium.io.Reader(args.pbf)
    timestamp = reader.header().get('osmosis_replication_timestamp') or 'unknown'
    reader.close()
    # Compact node arrays avoid millions of repeated JSON object field names.
    publish(directory/f'{args.dataset}-osm.json', {'nodes':[[key,*point] for key,point in handler.nodes.items()],
        'ways':handler.ways,'osm3s':{'timestamp_osm_base':timestamp}})
    print(f'{args.dataset}: {len(handler.ways)} roads, {len(handler.nodes)} road nodes, {len(land)} land polygons; {timestamp}',flush=True)

if __name__ == '__main__':
    main()
