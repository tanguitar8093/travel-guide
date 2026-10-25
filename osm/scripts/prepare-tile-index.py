"""Prepare content-version metadata before serving large country maps."""
import argparse
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tiles import tile_version
parser=argparse.ArgumentParser();parser.add_argument('path',type=Path);args=parser.parse_args()
start=time.monotonic();print(tile_version(args.path),flush=True)
print(f'Tile version ready in {time.monotonic()-start:.2f}s',flush=True)
