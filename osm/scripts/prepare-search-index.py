"""Prepare the Taiwan search cache with bounded memory, before serving requests."""
import argparse
from pathlib import Path
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from disk_search import ensure_search_index
parser = argparse.ArgumentParser()
parser.add_argument('path',type=Path)
args = parser.parse_args()
start = time.perf_counter()
print(ensure_search_index(args.path),flush=True)
print(f'Search index ready in {time.perf_counter()-start:.2f}s',flush=True)
