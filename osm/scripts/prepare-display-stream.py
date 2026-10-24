"""Experimental display-only extraction with disk locations and streamed GeoJSONL.

Use a reference-complete, prefiltered PBF containing highway, coastline and water
ways. Outputs are staged in a new directory; this does not register a dataset,
extract places, build routing or publish to the running map service.
"""
import argparse
from collections import Counter
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import struct
import tempfile
import time

import osmium
from shapely import from_wkb, to_wkb
from shapely.geometry import LineString, mapping
from shapely.ops import polygonize, unary_union


def write_feature(output, geometry, properties=None):
    output.write(json.dumps({'type': 'Feature', 'properties': properties or {}, 'geometry': geometry},
                            ensure_ascii=False, separators=(',', ':')))
    output.write('\n')


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def read_coasts(path):
    with path.open('rb') as source:
        while header := source.read(4):
            if len(header) != 4:
                raise ValueError('Incomplete coastline record header')
            size = struct.unpack('<I', header)[0]
            body = source.read(size)
            if len(body) != size:
                raise ValueError('Incomplete coastline record')
            yield from_wkb(body)


def extract(pbf, output_dir, prefix, index_type='sparse_file_array', timestamp=None):
    """Extract all display candidates in the input; coverage is not inferred here."""
    if output_dir.exists():
        raise ValueError(f'Refusing to replace an existing output directory: {output_dir}')
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    counts = Counter()
    with tempfile.TemporaryDirectory(prefix=f'.{output_dir.name}-build-', dir=output_dir.parent) as temporary:
        stage = Path(temporary)
        coast_path = stage / 'coastlines.wkb'
        index_path = stage / 'locations.idx'
        roads_path = stage / f'{prefix}-roads.geojsonl'
        water_path = stage / f'{prefix}-water.geojsonl'
        factory = osmium.geom.GeoJSONFactory()
        last_progress = time.monotonic()
        with roads_path.open('w', encoding='utf-8') as roads, water_path.open('w', encoding='utf-8') as water, coast_path.open('wb') as coasts:
            processor = (osmium.FileProcessor(str(pbf))
                         .with_locations(f'{index_type},{index_path}')
                         .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)))
            stamp = timestamp or processor.header.get('osmosis_replication_timestamp') or 'unknown'
            for way in processor:
                counts['scannedWays'] += 1
                highway = way.tags.get('highway')
                natural = way.tags.get('natural')
                waterway = way.tags.get('waterway')
                if highway is None and natural not in ('coastline', 'water') and waterway != 'riverbank':
                    continue
                if len(way.nodes) < 2:
                    counts['degenerateWays'] += 1
                    continue
                try:
                    geometry = factory.create_linestring(way, use_nodes=osmium.geom.use_nodes.ALL)
                except (osmium.InvalidLocationError, RuntimeError):
                    counts['invalidWays'] += 1
                    continue
                # Keep C++ serialization for the many road geometries. Decode
                # only water/coast ways that need topology processing.
                points = json.loads(geometry)['coordinates'] if natural in ('coastline', 'water') or waterway == 'riverbank' else None
                if natural == 'coastline':
                    blob = to_wkb(LineString(points))
                    coasts.write(struct.pack('<I', len(blob)))
                    coasts.write(blob)
                    counts['coastWays'] += 1
                if ((natural == 'water' or waterway == 'riverbank')
                        and points[0] == points[-1] and len(points) >= 4):
                    write_feature(water, {'type': 'Polygon', 'coordinates': [points]})
                    counts['waterFeatures'] += 1
                if highway is not None:
                    roads.write('{"type":"Feature","properties":{"class":'+json.dumps(highway)+'},"geometry":'+geometry+'}\n')
                    counts['roadFeatures'] += 1
                    counts['roadPointReferences'] += len(way.nodes)
                now = time.monotonic()
                if now-last_progress >= 10:
                    print(json.dumps({'stage': 'stream-ways', 'elapsedSeconds': round(now-started, 2),
                                      **counts, 'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024}), flush=True)
                    last_progress = now
            # Drop processor ownership before loading coastlines for GEOS.
            del processor
        gc.collect()
        location_bytes = index_path.stat().st_size if index_path.exists() else 0
        index_path.unlink(missing_ok=True)
        collection_seconds = time.monotonic()-started
        print(json.dumps({'stage': 'ways-complete', **counts, 'locationIndexBytes': location_bytes,
                          'elapsedSeconds': round(collection_seconds, 2),
                          'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024}), flush=True)

        coasts = list(read_coasts(coast_path))
        if not coasts:
            raise ValueError('No coastlines; refusing to produce an empty land layer')
        merged = unary_union(coasts)
        del coasts
        gc.collect()
        land_path = stage / f'{prefix}-land.geojsonl'
        shoreline_path = stage / f'{prefix}-coastline.geojsonl'
        with land_path.open('w', encoding='utf-8') as land, shoreline_path.open('w', encoding='utf-8') as shoreline:
            for polygon in polygonize(merged):
                write_feature(land, mapping(polygon))
                counts['landFeatures'] += 1
                for ring in (polygon.exterior, *polygon.interiors):
                    write_feature(shoreline, {'type': 'LineString', 'coordinates': list(ring.coords)})
                    counts['shorelineFeatures'] += 1
        del merged
        coast_path.unlink()
        if not counts['landFeatures'] or not counts['roadFeatures']:
            raise ValueError('Missing land or roads; refusing to publish incomplete layers')
        # Invalid source geometry needs investigation before a complete artifact
        # directory is produced. Temporary files are removed on failure.
        if counts['invalidWays']:
            raise ValueError(f'{counts["invalidWays"]} ways have invalid or missing geometry')
        result = {'status': 'display-layers-complete', 'input': str(pbf), 'inputBytes': pbf.stat().st_size,
                  'inputSha256': digest(pbf), 'dataTimestamp': stamp, 'prefix': prefix,
                  'locationIndexType': index_type, 'locationIndexBytes': location_bytes,
                  'counts': dict(counts), 'collectionSeconds': round(collection_seconds, 2),
                  'elapsedSeconds': round(time.monotonic()-started, 2),
                  'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
                  'coverage': 'All valid input candidates; no production Japan coverage defined',
                  'artifacts': {path.name: {'bytes': path.stat().st_size, 'sha256': digest(path)}
                                for path in (roads_path, water_path, land_path, shoreline_path)}}
        (stage / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        os.replace(stage, output_dir)
        print(json.dumps(result), flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path)
    parser.add_argument('output_dir', type=Path)
    parser.add_argument('--prefix', default='japan')
    parser.add_argument('--index-type', choices=('sparse_file_array',), default='sparse_file_array')
    parser.add_argument('--timestamp', help='Override a missing PBF timestamp with known source metadata')
    args = parser.parse_args()
    if re.fullmatch('[a-z][a-z0-9-]*', args.prefix) is None:
        parser.error('prefix must contain only lowercase letters, numbers and hyphens')
    extract(args.pbf.resolve(), args.output_dir.resolve(), args.prefix, args.index_type, args.timestamp)


if __name__ == '__main__':
    main()
