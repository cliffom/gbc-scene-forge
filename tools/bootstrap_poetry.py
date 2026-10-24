"""Install the pinned development tool into an isolated local environment."""

import subprocess
import sys
import venv
from pathlib import Path

if sys.version_info < (3, 10):
    raise SystemExit("Python 3.10+ required; run make setup PYTHON=/path/to/python3.12")
root = Path(__file__).resolve().parents[1]
directory = root / ".tools/poetry"
python = directory / "bin/python"
if not python.is_file():
    venv.create(directory, with_pip=True)
subprocess.run([str(python), "-m", "pip", "install", "poetry==2.4.2"], check=True)
