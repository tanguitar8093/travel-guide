"""Self-hosted Okinawa 2D map and static road routing demo."""
import json
import os
import errno
import gzip
import hashlib
import threading
import re
import sqlite3
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit, parse_qs
from routing import Router, BOUNDS
from search import PlaceSearch
from maps_urls import parse_map_link
from tiles import VectorTiles

ROOT = Path(__file__).resolve().parent
ROUTER = None
SEARCH = None
TILES = None
GZIP_CACHE = {}
GZIP_CACHE_LOCK = threading.Lock()

def accepts_gzip(header):
    encodings = {}
    for part in header.split(','):
        coding, *parameters = part.strip().lower().split(';')
        quality = 1.0
        for parameter in parameters:
            key, separator, value = parameter.strip().partition('=')
            if key == 'q' and separator:
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
        encodings[coding] = quality
    return encodings.get('gzip', encodings.get('*', 0)) > 0

class Handler(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            self.log_message('Client disconnected before request completed')

    def send(self, body, mime, status=200, cache_control='no-store',
             etag=None, vary=None, content_encoding=None):
        if_none_match = self.headers.get('If-None-Match', '')
        tags = [tag.strip() for tag in if_none_match.split(',')]
        not_modified = etag and any(
            tag == '*' or tag.removeprefix('W/') == etag for tag in tags
        )
        self.send_response(304 if not_modified else status)
        if not_modified or status == 204:
            if etag:
                self.send_header('ETag', etag)
            self.send_header('Cache-Control', cache_control)
            if vary:
                self.send_header('Vary', vary)
            self.end_headers()
            return
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', cache_control)
        if etag:
            self.send_header('ETag', etag)
        if vary:
            self.send_header('Vary', vary)
        if content_encoding:
            self.send_header('Content-Encoding', content_encoding)
        self.end_headers()
        if self.command!='HEAD':
            self.wfile.write(body)

    def json(self, value, status=200, cache_control='no-store'):
        self.send(json.dumps(value,ensure_ascii=False).encode(), 'application/json; charset=utf-8',
                  status, cache_control=cache_control)

    def send_static(self, filename, mime):
        path = ROOT / filename
        stat = path.stat()
        body = path.read_bytes()
        cache_control = ('no-cache' if filename.startswith('public/') else
                         'public, max-age=3600, stale-while-revalidate=86400')
        text_asset = mime.startswith('text/') or mime in {
            'application/javascript', 'application/geo+json'
        }
        if text_asset and accepts_gzip(self.headers.get('Accept-Encoding', '')) and len(body) >= 1024:
            stamp = (stat.st_mtime_ns, stat.st_size)
            with GZIP_CACHE_LOCK:
                cached = GZIP_CACHE.get(str(path))
                if cached is None or cached[0] != stamp:
                    compressed = gzip.compress(body, mtime=0)
                    cached = (
                        stamp,
                        compressed,
                        '"' + hashlib.sha256(compressed).hexdigest() + '"'
                    )
                    GZIP_CACHE[str(path)] = cached
            body = cached[1]
            etag = cached[2]
            self.send(body, mime, cache_control=cache_control, etag=etag,
                      vary='Accept-Encoding', content_encoding='gzip')
            return
        etag = '"' + hashlib.sha256(body).hexdigest() + '"'
        self.send(body, mime, cache_control=cache_control, etag=etag,
                  vary='Accept-Encoding' if text_asset else None)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/tiles.json' or path.startswith('/tiles/'):
            if TILES is None:
                return self.json({'error': 'Missing vector tiles. Run npm run osm:build:tiles and restart the server.'}, 503)
            if path == '/tiles.json':
                return self.json(TILES.tilejson(), cache_control='no-cache')
            match = re.fullmatch(r'/tiles/([a-f0-9]{64})/([0-9]{1,2})/([0-9]{1,5})/([0-9]{1,5})\.pbf', path)
            if match is None or match[1] != TILES.version:
                return self.json({'error': 'Unknown tile version or path.'}, 404)
            try:
                body = TILES.read(*map(int, match.groups()[1:]))
            except ValueError as error:
                return self.json({'error': str(error)}, 400)
            except sqlite3.Error:
                self.log_error('Failed reading vector tile: %s', path)
                return self.json({'error': 'Vector tile database could not be read.'}, 503)
            cache_control = 'public, max-age=31536000, immutable'
            if body is None:
                return self.send(b'', 'application/vnd.mapbox-vector-tile', 204,
                                 cache_control=cache_control, vary='Accept-Encoding')
            compressed = body.startswith(b'\x1f\x8b')
            use_gzip = compressed and accepts_gzip(self.headers.get('Accept-Encoding', ''))
            if compressed and not use_gzip:
                body = gzip.decompress(body)
            etag = '"' + hashlib.sha256(body).hexdigest() + '"'
            return self.send(body, 'application/vnd.mapbox-vector-tile',
                             cache_control=cache_control, etag=etag,
                             vary='Accept-Encoding',
                             content_encoding='gzip' if use_gzip else None)
        if path=='/api/search':
            if SEARCH is None:
                return self.json({'error':'尚未安裝地點資料，請執行 npm run osm:setup。'},503)
            try:
                return self.json(SEARCH.search(parse_qs(urlsplit(self.path).query).get('q',[''])[0]))
            except ValueError as error:
                return self.json({'error':str(error)},400)
        if path=='/api/health':
            return self.json({'ok':True,'dataset':'Okinawa OSM','dataTimestamp':ROUTER.timestamp,'bounds':BOUNDS,'roadCount':len(ROUTER.ways),'placeCount':len(SEARCH.entries) if SEARCH else 0,'placeDataTimestamp':SEARCH.timestamp if SEARCH else None})
        files = {'/': ('public/index.html', 'text/html; charset=utf-8')}
        for name in ('maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css'):
            for prefix in ('/vendor/', '/osm-vendor/'):
                files[prefix + name] = ('vendor/maplibre-gl/' + name, 'text/css' if name.endswith('.css') else 'text/javascript')
        for name in ('roads', 'water', 'land'):
            for prefix in ('/data/', '/osm-assets/'):
                files[prefix + name + '.geojson'] = ('data/okinawa-' + name + '.geojson', 'application/geo+json')
        if path not in files:
            return self.json({'error':'Not found'},404)
        filename,mime=files[path]
        try:
            self.send_static(filename, mime)
        except (BrokenPipeError, ConnectionResetError):
            raise
        except OSError:
            self.json({'error':'缺少檔案，請執行 npm run osm:setup。'},503)

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
    tiles_path = ROOT / 'data/okinawa.mbtiles'
    if tiles_path.is_file():
        TILES = VectorTiles(tiles_path)
    try:
        server=ThreadingHTTPServer((os.environ.get('HOST','0.0.0.0'),port),Handler)
    except OSError as error:
        if error.errno==errno.EADDRINUSE:
            raise SystemExit(f'埠 {port} 已被使用。若沖繩 demo 已在運行，直接開啟 http://localhost:{port}。\n要另開服務可執行：PORT=3001 npm run osm:start') from None
        raise
    source=ROOT/'data/okinawa-osm.json'
    if not source.is_file():
        raise SystemExit('Run npm run osm:setup to download Okinawa OSM data.')
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
        if TILES is not None:
            TILES.close()
