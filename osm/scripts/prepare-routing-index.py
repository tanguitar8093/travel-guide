"""Prepare a disposable routing index before serving a regional SQLite road extract."""
import argparse
from pathlib import Path
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routing_index import ensure_routing_index
parser = argparse.ArgumentParser()
parser.add_argument('path', type=Path)
args = parser.parse_args()
start = time.perf_counter()
print(ensure_routing_index(args.path), flush=True)
print(f'Routing index ready in {time.perf_counter()-start:.2f}s', flush=True)
