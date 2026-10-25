"""Extract all named OSM nodes, ways and locatable relations within Okinawa bounds."""
import argparse
import json
from pathlib import Path
import osmium
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from datasets import definition
from shapely.geometry import Polygon, MultiPolygon
from shapely import intersects_xy, prepare

_COVERAGE = {}
def dataset_inside(point, dataset):
    from shapely import Point, STRtree
    if dataset not in _COVERAGE:
        polygons = [Polygon(ring) for ring in definition(dataset)["coverage"]]
        prepare(polygons)
        _COVERAGE[dataset] = STRtree(polygons)
    tree = _COVERAGE[dataset]
    return any(bool(intersects_xy(tree.geometries[index],point[0],point[1])) for index in tree.query(Point(*point)))

ROOT = Path(__file__).resolve().parents[1]
BOUNDS = (127.58,25.98,128.36,26.9)
NAME_KEYS = ('name','alt_name','official_name','short_name','loc_name','old_name','brand')


def names_from(tags):
    return {k:v for k,v in tags.items() if k.partition(':')[0] in NAME_KEYS}


def inside(point):
    return BOUNDS[0]<=point[0]<=BOUNDS[2] and BOUNDS[1]<=point[1]<=BOUNDS[3]


def center(points):
    if not points:
        return None
    if len(points)>1 and points[0]==points[-1]:
        points=points[:-1]
    return [sum(p[0] for p in points)/len(points),sum(p[1] for p in points)/len(points)]


class Places(osmium.SimpleHandler):
    def __init__(self, dataset='okinawa'):
        self.dataset = dataset
        super().__init__()
        self.required_ways=None
        self.places=[]
        self.locations={}
        self.relations={}
        self.skipped=[]

    def add(self,kind,identifier,tags,point,location_kind):
        names=names_from(tags)
        if not names or point is None or not dataset_inside(point,self.dataset):
            return
        name=next((tags[k] for k in ('name:zh-Hant','name:zh','name','name:ja','name:en','official_name','short_name','alt_name','brand') if tags.get(k)),next(iter(names.values())))
        address=' '.join(dict.fromkeys(tags[k] for k in ('addr:province','addr:city','addr:suburb','addr:quarter','addr:street','addr:place','addr:housenumber') if tags.get(k)))
        category=next((tags[k] for k in ('amenity','shop','tourism','historic','leisure','office','place','natural','public_transport','railway','aeroway','highway','building','landuse','boundary') if k in tags),'place')
        self.places.append({'id':f'osm-{kind}-{identifier}','name':name,'english':tags.get('name:en',''),'names':names,'coordinates':point,'locationKind':location_kind,'category':category,'address':address,'tags':{k:v for k,v in tags.items() if k.startswith('addr:') or k in ('website','contact:website','phone','contact:phone','opening_hours','cuisine','wheelchair','wikidata','wikipedia','type')},'source':f'https://www.openstreetmap.org/{kind}/{identifier}','color':'green'})

    def node(self,node):
        if not names_from(dict(node.tags)):
            return
        point=[node.lon,node.lat]
        if dataset_inside(point,self.dataset):
            if names_from(dict(node.tags)):
                self.locations[('n',node.id)]=point
            self.add('node',node.id,dict(node.tags),point,'osm-node')

    def way(self,way):
        tags=dict(way.tags)
        if self.required_ways is not None and way.id not in self.required_ways and not names_from(tags):
            return
        points=[[n.lon,n.lat] for n in way.nodes if n.location.valid()]
        if not any(dataset_inside(p,self.dataset) for p in points):
            return
        point=center(points)
        self.locations[('w',way.id)]=point
        self.add('way',way.id,dict(way.tags),point,'approximate-center')

    def relation(self,relation):
        self.relations[relation.id]={'tags':dict(relation.tags),'members':[(m.type,m.ref,m.role) for m in relation.members]}

    def resolve(self,identifier,active=None):
        key=('r',identifier)
        if key in self.locations:
            return self.locations[key]
        active=set() if active is None else active
        if identifier in active:
            return None
        relation=self.relations.get(identifier)
        if relation is None:
            return None
        active.add(identifier)
        points=[]
        preferred=[]
        for kind,ref,role in relation['members']:
            point=self.resolve(ref,active) if kind=='r' else self.locations.get((kind,ref))
            if point is not None and dataset_inside(point,self.dataset):
                points.append(point)
                if role in ('label','admin_centre'):
                    preferred.append(point)
        active.remove(identifier)
        point=preferred[0] if preferred else center(points)
        if point:
            self.locations[key]=point
        return point

    def finish(self):
        for identifier,relation in self.relations.items():
            if not names_from(relation['tags']):
                continue
            point=self.resolve(identifier)
            if point:
                self.add('relation',identifier,relation['tags'],point,'approximate-member-center')
            # No coordinates are fabricated for unlocatable relations.
        return self.places


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('pbf')
    parser.add_argument('--dataset', choices=('okinawa','taiwan'), default='okinawa')
    parser.add_argument('timestamp',nargs='?',default=None)
    args=parser.parse_args()
    handler=Places(args.dataset)
    class Members(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.ways=set()
            self.nodes=set()
        def relation(self,relation):
            for member in relation.members:
                if member.type=='w':self.ways.add(member.ref)
                elif member.type=='n':self.nodes.add(member.ref)
    members=Members()
    members.apply_file(args.pbf)
    handler.required_ways=members.ways
    if members.nodes:
        reader=osmium.FileProcessor(args.pbf,entities=osmium.osm.NODE).with_filter(osmium.filter.IdFilter(members.nodes))
        for node in reader:
            point=[node.lon,node.lat]
            if dataset_inside(point,args.dataset):handler.locations[('n',node.id)]=point

    # No name KeyFilter: preserve every language plus unnamed relation geometry members.
    # FileProcessor consumes the whole reader, including its header, before closing.
    class GeometryMembers(osmium.SimpleHandler):
        def way(self, way):
            handler.way(way)
    # Native filtering avoids Python callbacks for millions of untagged nodes.
    # Keep untagged ways for named relation geometry; location indexing runs first.
    processor=(osmium.FileProcessor(args.pbf).with_locations('flex_mem')
        .with_filter(osmium.filter.EmptyTagFilter()).handler_for_filtered(GeometryMembers()))
    timestamp=args.timestamp or processor.header.get('osmosis_replication_timestamp') or 'unknown'
    for obj in processor:
        if isinstance(obj,osmium.osm.Node):handler.node(obj)
        elif isinstance(obj,osmium.osm.Way):handler.way(obj)
        elif isinstance(obj,osmium.osm.Relation):handler.relation(obj)
    rows=handler.finish()
    counts={kind:sum(p['id'].startswith('osm-'+kind+'-') for p in rows) for kind in ('node','way','relation')}
    output={'schemaVersion':2,'source':'OpenStreetMap via Geofabrik ' + args.dataset,'dataTimestamp':timestamp,'bounds':list(definition(args.dataset)['bounds'].values()),'coverage':definition(args.dataset)['source'],'counts':counts,'places':rows}
    destination=ROOT/f'data/{args.dataset}-places.json'
    temporary=destination.with_suffix('.download')
    temporary.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')))
    temporary.replace(destination)
    print(f'Extracted {len(rows)} named OSM places: {counts}; {destination.stat().st_size/1024**2:.2f} MiB',flush=True)

if __name__=='__main__':main()
