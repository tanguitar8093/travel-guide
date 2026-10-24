"""Disk search must match existing Taiwan names, ranking and response fields."""
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from disk_search import DiskPlaceSearch, ensure_search_index
from search import PlaceSearch

places = [
    {'id':f'node/{i}','name':f'台中海洋館第{i}站','english':f'Aquarium {i}',
     'names':{'alt_name':f'臺中海洋館支線{i}'},'coordinates':[120.52,24.296],'tags':{}}
    for i in range(40)
]
places.extend([
 {'id':'way/2','name':'臺中海洋館','names':{'alt_name':'Taichung Oceanarium'},'coordinates':[120.52,24.296]},
 {'id':'node/0','name':'台中海洋館','english':'Taichung Aquarium','names':{'alt_name':'Aquarium'},'coordinates':[120.52,24.296]},
 {'id':'way/long','name':'跨區塊測試'+('界'*70000)+'海洋','coordinates':[120.52,24.296]},
])
data = {'dataTimestamp':'fixture','places':places}
with tempfile.TemporaryDirectory() as folder:
    path = Path(folder)/'places.json'
    path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    expected = PlaceSearch(data,'taiwan')
    actual = DiskPlaceSearch(path)
    assert actual.entry_count == len(places)
    for query in ['台中','臺中海洋館','海洋','Aquarium','Oceanarium','第1','跨區塊','不存在','--','']:
        assert actual.search(query) == expected.search(query), query
    first = ensure_search_index(path)
    assert ensure_search_index(path) == first
    actual.connection.close()
    data['places'] = data['places'][:1]
    path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    assert ensure_search_index(path) != first
    updated = DiskPlaceSearch(path)
    assert updated.entry_count == 1
    updated.connection.close()
    invalid = Path(folder)/'bad.json'
    invalid.write_text('{"places":[{"id":"x"')
    try: ensure_search_index(invalid)
    except ValueError: pass
    else: raise AssertionError('Truncated catalog accepted')
    assert not list((Path(folder)/'.search-cache').glob('*.download'))
print('PASS: streaming Unicode/chunk boundaries, exact Taiwan ranking/fields, index reuse and source invalidation')
