"""A busy route calculation must not block map tiles/health or start another heavy job."""
import json
from pathlib import Path
import sys
import threading
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

entered, release = threading.Event(), threading.Event()
class BusyRouter:
    lock = threading.Lock()
    def route(self, *_args):
        entered.set()
        assert release.wait(5)
        return {'duration': 60}

state = {'tiles': None, 'search': None, 'places': Path('/missing'),
         'compact': Path('/missing'), 'roads': Path('/missing')}
with patch.object(server, 'load_dataset', return_value=state), patch.object(server, 'dataset_router', return_value=BusyRouter()):
    http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{http.server_port}'
    def route():
        return urlopen(Request(base+'/api/route', data=b'{"mode":"walk","points":[]}', headers={'Content-Type':'application/json'}), timeout=5)
    results = []
    def first():
        with route() as response:
            results.append(json.load(response))
    worker = threading.Thread(target=first)
    worker.start()
    try:
        assert entered.wait(5)
        try: route()
        except HTTPError as error:
            assert error.code == 503
            assert '正在計算' in json.load(error)['error']
        else: raise AssertionError('A second heavy route should be rejected while busy')
        with urlopen(base+'/api/health', timeout=2) as response:
            assert json.load(response)['ok'] is True
        release.set()
        worker.join(5)
        assert results == [{'duration':60}]
        with route() as response:
            assert response.status == 200
    finally:
        release.set()
        worker.join(5)
        http.shutdown()
        http.server_close()
print('PASS: route admission, health while routing, and capacity recovery')

# A catalog initialization must not hold the lock needed by the routing initializer.
from types import SimpleNamespace
search_lock, router_lock = threading.Lock(), threading.Lock()
existing_router = SimpleNamespace(timestamp='fixture')
state = {'search_lock':search_lock,'router_lock':router_lock,'router':existing_router}
search_lock.acquire()
result = []
worker = threading.Thread(target=lambda: result.append(server.dataset_router('taiwan',state)),daemon=True)
try:
    worker.start()
    worker.join(1)
    assert result == [existing_router], 'Search initialization blocked routing'
finally:
    search_lock.release()
    worker.join(2)
print('PASS: catalog initialization and routing use independent locks')
