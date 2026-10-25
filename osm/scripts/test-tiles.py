"""Exercise XYZ/TMS conversion, versioned caching and HTTP encodings."""
import gzip
import hashlib
import shutil
from unittest.mock import patch
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import tiles as tile_module
from tiles import VectorTiles


class TileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        path = cls.root / 'test.mbtiles'
        cls.raw = b'vector tile fixture'
        cls.compressed = gzip.compress(cls.raw, mtime=0)
        with sqlite3.connect(path) as database:
            database.executescript('''
                CREATE TABLE metadata (name TEXT, value TEXT);
                CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER,
                                    tile_row INTEGER, tile_data BLOB);
            ''')
            database.executemany('INSERT INTO metadata VALUES (?, ?)', [
                ('format', 'pbf'), ('minzoom', '5'), ('maxzoom', '14'),
                ('bounds', '127.58,25.98,128.36,26.9'),
                ('json', json.dumps({'vector_layers': [
                    {'id': name} for name in ('land', 'water', 'coastline', 'roads')
                ]}))
            ])
            database.execute('INSERT INTO tiles VALUES (5, 27, 18, ?)', (cls.compressed,))
        cls.original_datasets = server.DATASETS
        cls.original_tiles = server.TILES
        cls.original_root = server.ROOT
        server.ROOT = cls.root
        server.TILES = VectorTiles(path)
        server.DATASETS = {"okinawa": {"tiles":server.TILES,"search":None,"router":None,"roads":cls.root/"missing","compact":cls.root/"missing"}}
        (cls.root / 'public').mkdir()
        (cls.root / 'public/index.html').write_text('<html>cached</html>')
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.tile = f'/tiles/{server.TILES.version}/5/27/13.pbf'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.thread.join()
        cls.http.server_close()
        server.TILES.close()
        server.DATASETS = cls.original_datasets
        server.TILES = cls.original_tiles
        server.ROOT = cls.original_root
        cls.temporary.cleanup()

    def request(self, path, headers=None, method='GET'):
        return urlopen(Request(self.base + path, headers=headers or {}, method=method), timeout=5)

    def test_xyz_conversion_and_gzip(self):
        with self.request(self.tile, {'Accept-Encoding': 'gzip'}) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), self.compressed)
            self.assertEqual(response.headers['Content-Encoding'], 'gzip')
            self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
            self.assertIn('immutable', response.headers['Cache-Control'])
        for encoding in ('identity', 'gzip;q=0', '*;q=1, gzip;q=0'):
            with self.request(self.tile, {'Accept-Encoding': encoding}) as response:
                self.assertEqual(response.read(), self.raw)
                self.assertIsNone(response.headers.get('Content-Encoding'))
        with self.request(self.tile, {'Accept-Encoding': 'gzip;q=0.5'}) as response:
            self.assertEqual(response.read(), self.compressed)

    def test_etags_and_head(self):
        with self.request(self.tile, {'Accept-Encoding': 'gzip'}, method='HEAD') as response:
            self.assertEqual(response.read(), b'')
            self.assertEqual(int(response.headers['Content-Length']), len(self.compressed))
            etag = response.headers['ETag']
        for tag in (etag, 'W/' + etag, '"other", ' + etag, '*'):
            with self.assertRaises(HTTPError) as caught:
                self.request(self.tile, {'Accept-Encoding': 'gzip', 'If-None-Match': tag})
            self.assertEqual(caught.exception.code, 304)
            self.assertEqual(caught.exception.read(), b'')
            self.assertIn('immutable', caught.exception.headers['Cache-Control'])
        with self.request(self.tile, {'Accept-Encoding': 'identity', 'If-None-Match': etag}) as response:
            self.assertEqual(response.status, 200)
            self.assertNotEqual(response.headers['ETag'], etag)

    def test_empty_and_invalid_tiles(self):
        with self.request(self.tile.replace('/13.pbf', '/12.pbf')) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.read(), b'')
            self.assertIsNone(response.headers.get('Content-Length'))
        for path, status in (
            (self.tile.replace('/5/27/13', '/5/32/13'), 400),
            (self.tile.replace('/5/27/13', '/4/10/10'), 400),
            (self.tile.replace(server.TILES.version, '0' * 64), 404),
            ('/tiles/not-a-tile', 404),
        ):
            with self.assertRaises(HTTPError) as caught:
                self.request(path)
            self.assertEqual(caught.exception.code, status)
            self.assertEqual(caught.exception.headers['Cache-Control'], 'no-store')

    def test_manifest_and_app_revalidation(self):
        with self.request('/tiles.json') as response:
            manifest = json.load(response)
            self.assertEqual(manifest['scheme'], 'xyz')
            self.assertIn(server.TILES.version, manifest['tiles'][0])
            self.assertEqual(response.headers['Cache-Control'], 'no-cache')
        with self.request('/') as response:
            etag = response.headers['ETag']
            self.assertEqual(response.headers['Cache-Control'], 'no-cache')
        with self.assertRaises(HTTPError) as caught:
            self.request('/', {'If-None-Match': etag})
        self.assertEqual(caught.exception.code, 304)
        (self.root / 'public/index.html').write_text('<html>updated</html>')
        with self.request('/', {'If-None-Match': etag}) as response:
            self.assertEqual(response.status, 200)
            self.assertNotEqual(response.headers['ETag'], etag)

    def test_missing_database_is_explicit(self):
        tiles = server.TILES
        try:
            server.TILES = None
            server.DATASETS["okinawa"]["tiles"] = None
            with self.assertRaises(HTTPError) as caught:
                self.request('/tiles.json')
            self.assertEqual(caught.exception.code, 503)
            self.assertIn('build:tiles', json.load(caught.exception)['error'])
        finally:
            server.TILES = tiles
            server.DATASETS["okinawa"]["tiles"] = tiles

    def test_open_snapshot_survives_atomic_rebuild(self):
        path = self.root / 'test.mbtiles'
        replacement = self.root / 'replacement.mbtiles'
        replacement.write_bytes(path.read_bytes())
        with sqlite3.connect(replacement) as database:
            database.execute('UPDATE tiles SET tile_data=?', (gzip.compress(b'new tiles'),))
        replacement.replace(path)
        self.assertEqual(server.TILES.read(5, 27, 13), self.compressed)
        newer = VectorTiles(path)
        try:
            self.assertNotEqual(newer.version, server.TILES.version)
            self.assertEqual(gzip.decompress(newer.read(5, 27, 13)), b'new tiles')
        finally:
            newer.close()



class TileVersionCacheTests(unittest.TestCase):
    def copy_fixture(self, name):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / name
        with sqlite3.connect(path) as db:
            db.executescript('create table metadata(name text,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob);')
            db.executemany('insert into metadata values(?,?)',[
                ('format','pbf'),('minzoom','5'),('maxzoom','14'),('bounds','122,20,154,46'),
                ('json',json.dumps({'vector_layers':[{'id':v} for v in ('land','water','coastline','roads')]}))])
            db.execute('insert into tiles values(5,1,1,?)',(gzip.compress(b'fixture'),))
        return path

    def test_cached_version_does_not_reread_mbtiles(self):
        path=self.copy_fixture('cached.mbtiles')
        first=VectorTiles(path);version=first.version;first.close()
        original=Path.open
        def guarded(file,*args,**kwargs):
            if file==path:raise AssertionError('Cached load reread the complete MBTiles')
            return original(file,*args,**kwargs)
        with patch.object(Path,'open',guarded):
            second=VectorTiles(path)
            self.assertEqual(second.version,version)
            second.close()

    def test_optional_labels_are_allowed_but_required_basemap_layers_remain_required(self):
        path = self.copy_fixture('labels.mbtiles')
        with sqlite3.connect(path) as db:
            layers = [{'id': name} for name in ('land', 'water', 'coastline', 'roads', 'road_labels', 'place_labels')]
            db.execute('update metadata set value=? where name="json"', (json.dumps({'vector_layers': layers}),))
        labeled = VectorTiles(path)
        self.assertEqual(len(labeled.layers), 6)
        labeled.close()
        with sqlite3.connect(path) as db:
            db.execute('update metadata set value=? where name="json"', (json.dumps({'vector_layers': layers[1:]}),))
        with self.assertRaisesRegex(ValueError, 'required display layers'):
            VectorTiles(path)

    def test_same_size_content_changes_invalidate_version(self):
        path=self.copy_fixture('changed.mbtiles')
        before=VectorTiles(path);version=before.version;before.close();size=path.stat().st_size
        with sqlite3.connect(path) as db:db.execute('update tiles set tile_data=?',(gzip.compress(b'updated'),))
        self.assertEqual(path.stat().st_size,size)
        after=VectorTiles(path)
        self.assertNotEqual(after.version,version)
        self.assertEqual(after.version,hashlib.sha256(path.read_bytes()).hexdigest())
        after.close()

    def test_read_only_cache_falls_back_without_breaking_maps(self):
        path=self.copy_fixture('readonly.mbtiles')
        original=Path.mkdir
        def denied(folder,*args,**kwargs):
            if folder.name=='.tiles-cache':raise PermissionError('Read-only data')
            return original(folder,*args,**kwargs)
        with patch.object(Path,'mkdir',denied):
            tiles=VectorTiles(path)
            self.assertEqual(tiles.version,hashlib.sha256(path.read_bytes()).hexdigest())
            tiles.close()

if __name__ == '__main__':
    unittest.main()
