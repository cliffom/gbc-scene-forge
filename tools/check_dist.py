"""Check the wheel's resources, metadata and contracts in a clean environment."""

import os
import subprocess
import tempfile
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
wheels = list((ROOT / "dist").glob("*.whl"))
if len(wheels) != 1:
    raise SystemExit("Expected one wheel in dist; run make clean before rebuilding a new version")
with tempfile.TemporaryDirectory() as folder:
    temporary = Path(folder)
    environment = temporary / "venv"
    venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    subprocess.run(
        [str(python), "-m", "pip", "install", "--no-index", "--no-deps", str(wheels[0])],
        check=True,
    )
    code = """
from importlib.metadata import distribution
from importlib.resources import files
import gbc_scene_forge
package = distribution('gbc-scene-forge')
assert package.version == gbc_scene_forge.__version__
assert not package.requires, package.requires
assert package.metadata['License-Expression'] == 'MIT'
assert package.metadata.get_all('License-File') == ['LICENSE']
license_file = next(path for path in package.files if str(path).endswith('.dist-info/licenses/LICENSE'))
assert 'Copyright (c) 2026 Michael Clifford' in package.locate_file(license_file).read_text()
static = files('gbc_scene_forge').joinpath('static')
for name in ('index.html', 'app.js', 'model.mjs', 'progress.mjs', 'style.css'):
    assert static.joinpath(name).read_bytes(), name
print('Installed wheel: metadata and all browser resources verified')
"""
    subprocess.run([str(python), "-I", "-c", code], cwd=temporary, check=True)
    subprocess.run(
        [str(python), "-I", "-m", "unittest", "discover", "-s", str(ROOT / "tests")],
        cwd=temporary,
        check=True,
    )
