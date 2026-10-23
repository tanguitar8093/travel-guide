"""Read prebuilt MBTiles; keep one snapshot open until the server restarts."""
import hashlib
import json
import sqlite3
import threading


class VectorTiles:
    def __init__(self, path):
        with path.open('rb') as source:
            digest = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        self.version = digest.hexdigest()
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
        if {layer['id'] for layer in self.layers} != {'land', 'water', 'coastline', 'roads'}:
            raise ValueError('Map tiles are missing required display layers.')

    def tilejson(self):
        return {
            'tilejson': '3.0.0', 'name': 'Okinawa',
            'scheme': 'xyz', 'minzoom': self.minzoom, 'maxzoom': self.maxzoom,
            'bounds': self.bounds, 'vector_layers': self.layers,
            'attribution': '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a>',
            'tiles': [f'/tiles/{self.version}/{{z}}/{{x}}/{{y}}.pbf'],
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
