"""Read prebuilt MBTiles; keep one snapshot open until the server restarts."""
import hashlib
import json
import os
from pathlib import Path
import re
import uuid
import sqlite3
import threading


def _fingerprint(path):
    stat = path.stat()
    return [str(path.resolve()), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]


def _version_cache(path, fingerprint):
    key = hashlib.sha256(json.dumps(fingerprint).encode()).hexdigest()[:20]
    return path.parent / '.tiles-cache' / f'{path.stem}-{key}.json'


def cache_tile_version(path, digest, fingerprint=None):
    """Record a build-time digest; failed cache writes never block read-only maps."""
    path = Path(path).resolve()
    fingerprint = fingerprint or _fingerprint(path)
    target = _version_cache(path, fingerprint)
    temporary = target.with_suffix(f'.{os.getpid()}.{uuid.uuid4().hex}.download')
    try:
        target.parent.mkdir(exist_ok=True)
        temporary.write_text(json.dumps({'source':fingerprint,'sha256':digest})+'\n')
        temporary.replace(target)
    except OSError:
        pass
    finally:
        try:temporary.unlink(missing_ok=True)
        except OSError:pass


def tile_version(path):
    path = Path(path).resolve()
    fingerprint = _fingerprint(path)
    try:
        cached = json.loads(_version_cache(path, fingerprint).read_text())
        if cached.get('source') == fingerprint and re.fullmatch('[0-9a-f]{64}', cached.get('sha256','')):
            return cached['sha256']
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    with path.open('rb') as source:
        hasher = hashlib.sha256()
        for chunk in iter(lambda:source.read(1024*1024),b''):
            hasher.update(chunk)
        digest = hasher.hexdigest()
    if _fingerprint(path) != fingerprint:
        raise ValueError('圖磚更新中，請完成更新後重啟地圖服務。')
    cache_tile_version(path,digest,fingerprint)
    return digest


class VectorTiles:
    def __init__(self, path):
        self.version = tile_version(path)
        self.lock = threading.Lock()
        self.database = sqlite3.connect(
            path.as_uri() + '?mode=ro&immutable=1', uri=True,
            check_same_thread=False
        )
        metadata = dict(self.database.execute('SELECT name, value FROM metadata'))
        if metadata['format'] != 'pbf':
            raise ValueError('Map tiles must use the pbf vector format.')
        self.minzoom = int(metadata['minzoom'])
        self.maxzoom = int(metadata['maxzoom'])
        self.bounds = [float(value) for value in metadata['bounds'].split(',')]
        self.layers = json.loads(metadata['json'])['vector_layers']
        if not {'land', 'water', 'coastline', 'roads'}.issubset({layer['id'] for layer in self.layers}):
            raise ValueError('Map tiles are missing required display layers.')

    def tilejson(self, dataset='okinawa'):
        return {
            'tilejson': '3.0.0', 'name': dataset,
            'scheme': 'xyz', 'minzoom': self.minzoom, 'maxzoom': self.maxzoom,
            'bounds': self.bounds, 'vector_layers': self.layers,
            'attribution': '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a>',
            'tiles': [f'{"" if dataset == "okinawa" else "/datasets/" + dataset}/tiles/{self.version}/{{z}}/{{x}}/{{y}}.pbf'],
        }

    def read(self, zoom, x, y):
        if not self.minzoom <= zoom <= self.maxzoom or not (
            0 <= x < 2 ** zoom and 0 <= y < 2 ** zoom
        ):
            raise ValueError('Invalid tile coordinates.')
        with self.lock:
            row = self.database.execute(
                'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
                (zoom, x, 2 ** zoom - 1 - y)
            ).fetchone()
        return row[0] if row else None

    def close(self):
        self.database.close()
