"""Run assert-based fixtures and unittest scripts (hyphenated modules are not discoverable)."""
from pathlib import Path
import subprocess
import sys

for script in sorted(Path(__file__).parent.glob('test-*.py')):
    print(f'Running {script.name}',flush=True)
    subprocess.run([sys.executable,'-B',str(script)],check=True)
