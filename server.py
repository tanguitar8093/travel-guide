"""Self-hosted Okinawa 2D map and static road routing demo."""
import json
import os
import errno
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit, parse_qs
from routing import Router, BOUNDS
from search import PlaceSearch
from maps_urls import parse_map_link

ROOT = Path(__file__).resolve().parent
ROUTER = None
SEARCH = None

class Handler(BaseHTTPRequestHandler):
    def send(self, body, mime, status=200):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if self.command!='HEAD':
            self.wfile.write(body)

    def json(self, value, status=200):
        self.send(json.dumps(value,ensure_ascii=False).encode(), 'application/json; charset=utf-8', status)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path=='/api/search':
            if SEARCH is None:
                return self.json({'error':'尚未安裝地點資料，請執行 npm run setup。'},503)
            try:
                return self.json(SEARCH.search(parse_qs(urlsplit(self.path).query).get('q',[''])[0]))
            except ValueError as error:
                return self.json({'error':str(error)},400)
        if path=='/api/health':
            return self.json({'ok':True,'dataset':'Okinawa OSM','dataTimestamp':ROUTER.timestamp,'bounds':BOUNDS,'roadCount':len(ROUTER.ways),'placeCount':len(SEARCH.entries) if SEARCH else 0,'placeDataTimestamp':SEARCH.timestamp if SEARCH else None})
        files = {'/':('public/index.html','text/html; charset=utf-8'),'/favicon.svg':('public/favicon.svg','image/svg+xml'),'/fonts/ui-zh-hant.ttf':('data/fonts/ui-zh-hant.ttf','font/ttf')}
        for name in ('app.js','style.js','styles.css'):
            files['/'+name] = ('public/'+name, 'text/css' if name.endswith('.css') else 'text/javascript')
        for name in ('maplibre-gl.mjs','maplibre-gl-worker.mjs','maplibre-gl-shared.mjs','maplibre-gl.css'):
            files['/vendor/'+name] = ('node_modules/maplibre-gl/dist/'+name, 'text/css' if name.endswith('.css') else 'text/javascript')
        for name in ('roads','water','land'):
            files['/data/'+name+'.geojson'] = ('data/okinawa-'+name+'.geojson','application/geo+json')
        if path not in files:
            return self.json({'error':'Not found'},404)
        filename,mime=files[path]
        try:
            self.send((ROOT/filename).read_bytes(),mime)
        except OSError:
            self.json({'error':'缺少檔案，請執行 npm run setup。'},503)

    def do_POST(self):
        path=urlsplit(self.path).path
        if path not in {'/api/route','/api/parse-map-url'}:
            return self.json({'error':'Not found'},404)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=16384:
                return self.json({'error':'Invalid request size'},400)
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):
                raise ValueError('Invalid request')
            if path=='/api/parse-map-url':
                return self.json(parse_map_link(payload.get('url')))
            with ROUTER.lock:
                result = ROUTER.route(payload.get('points'),payload.get('mode'))
            self.json(result)
        except (ValueError,TypeError) as error:
            self.json({'error':str(error)},400)

if __name__=='__main__':
    port=int(os.environ.get('PORT',3000))
    try:
        server=ThreadingHTTPServer((os.environ.get('HOST','0.0.0.0'),port),Handler)
    except OSError as error:
        if error.errno==errno.EADDRINUSE:
            raise SystemExit(f'埠 {port} 已被使用。若沖繩 demo 已在運行，直接開啟 http://localhost:{port}。\n要另開服務可執行：PORT=3001 npm start') from None
        raise
    source=ROOT/'data/okinawa-osm.json'
    if not source.is_file():
        raise SystemExit('Run npm run setup to download Okinawa OSM data.')
    ROUTER=Router(json.loads(source.read_text()))
    places=ROOT/'data/okinawa-places.json'
    if places.is_file():
        SEARCH=PlaceSearch(json.loads(places.read_text()))
    for mode in ('car','walk','bike'):
        ROUTER.graph(mode)
    print(f'Okinawa map: http://localhost:{port} | {len(ROUTER.ways)} roads',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n沖繩地圖服務已停止。',flush=True)
    finally:
        server.server_close()
