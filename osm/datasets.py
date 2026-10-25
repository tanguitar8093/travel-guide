"""Shared, version-controlled coverage used by the UI, API and data builder."""
import json
import math
from pathlib import Path

DEFINITIONS = json.loads((Path(__file__).resolve().parents[1] / 'shared/geo/osm-datasets.json').read_text())


def definition(dataset):
    if dataset not in DEFINITIONS:
        raise ValueError('Unknown OSM dataset.')
    return DEFINITIONS[dataset]


def inside(point, dataset='okinawa'):
    if not isinstance(point, (tuple, list)) or len(point) != 2 or any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point
    ):
        return False
    x, y = point
    for bounds, ring in coverage_rings(dataset):
        if not (bounds[0] <= x <= bounds[2] and bounds[1] <= y <= bounds[3]):
            continue
        hit = False
        for (a, b), (c, d) in zip(ring, ring[1:] + ring[:1]):
            cross = (x-a)*(d-b)-(y-b)*(c-a)
            if abs(cross) < 1e-10 and min(a,c) <= x <= max(a,c) and min(b,d) <= y <= max(b,d):
                return True
            if (b > y) != (d > y) and x < (c-a)*(y-b)/(d-b)+a:
                hit = not hit
        if hit:
            return True
    return False


from functools import lru_cache
@lru_cache(maxsize=None)
def coverage_rings(dataset):
    return [(
        (min(p[0] for p in ring), min(p[1] for p in ring), max(p[0] for p in ring), max(p[1] for p in ring)), ring
    ) for ring in definition(dataset)['coverage']]
