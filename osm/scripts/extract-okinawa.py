"""Optional fallback: extract Okinawa from Geofabrik Kyushu PBF. Requires osmium."""
import json
import sys
from pathlib import Path
import osmium

ROOT = Path(__file__).resolve().parents[1]

class Extract(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes = {}
        self.ways = []

    def way(self, way):
        tags = dict(way.tags)
        if 'highway' not in tags and tags.get('natural') not in {'coastline','water'}:
            return
        if not all(n.location.valid() for n in way.nodes):
            return
        if not any(127.58<=n.lon<=128.36 and 25.98<=n.lat<=26.9 for n in way.nodes):
            return
        self.ways.append({'type':'way','id':way.id,'nodes':[n.ref for n in way.nodes],'tags':tags})
        for node in way.nodes:
            self.nodes[node.ref] = {'type':'node','id':node.ref,'lon':node.lon,'lat':node.lat}

handler=Extract()
handler.apply_file(sys.argv[1],locations=True,idx='flex_mem',filters=[osmium.filter.KeyFilter('highway','natural')])
timestamp=sys.argv[2] if len(sys.argv)>2 else 'unknown'
data={'osm3s':{'timestamp_osm_base':timestamp},'source':'Geofabrik Kyushu extract / OpenStreetMap','elements':[*handler.nodes.values(),*handler.ways]}
(ROOT/'data/okinawa-osm.json').write_text(json.dumps(data,separators=(',',':')))
print(f'Extracted {len(handler.ways)} ways and {len(handler.nodes)} nodes',flush=True)
