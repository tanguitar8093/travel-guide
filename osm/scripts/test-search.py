import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from search import PlaceSearch

data=json.loads((Path(__file__).resolve().parents[1]/'data/okinawa-places.json').read_text())
search=PlaceSearch(data)
for term in ('中本天婦羅','中本天妇罗','中本てんぷら','nakamoto tempura'):
    result=search.search(term)
    assert result['results'][0]['id']=='osm-node-1995215770',term
for term in ('波上宮','波上城'):
    result=search.search(term)
    assert result['results'][0]['name']=='波上宮'
    assert result['results'][0]['category']=='place_of_worship'
assert search.search('波上城')['suggestion']
assert not search.search('波上宮')['suggestion']
assert not search.search('this-should-not-exist-zzzz')['results']
assert not search.search('   ')['results']
assert len(search.search('ホテル')['results'])<=30
assert search.search('ホテル')['total']>30
print(f'PASS: {len(search.entries)} real OSM places; Chinese/Japanese/English aliases; accurate shrine suggestion; limits and empty search.')

for term in ('萬座毛','齋場御嶽','姬百合之塔','殘波岬','真榮田岬','名護鳳梨園','陶藝之里','今歸仁城跡','邊戶岬','牧志公設市場','DMM水族館','暖暮拉麵','通堂拉麵','傑克牛排館'):
    result=search.search(term)
    assert result['total']>0,term
    assert result['results'][0]['source'].startswith('https://www.openstreetmap.org/'),term
assert any(p['id'].startswith('osm-relation-') for p in data['places'])
assert search.search('殘波岬')['results'][0]['category']!='hotel'
print('PASS: expanded Chinese travel aliases, relation catalog and attraction ranking')
