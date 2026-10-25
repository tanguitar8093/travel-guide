"""Compatibility entry point; regional extraction defaults to Taiwan."""
import runpy
from pathlib import Path

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('prepare-region-labels.py')), run_name='__main__')
