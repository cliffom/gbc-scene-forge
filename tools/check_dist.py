"""Check the wheel's resources, metadata and contracts in a clean environment."""

import os
import subprocess
import tarfile
import tempfile
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
wheels = list((ROOT / "dist").glob("*.whl"))
if len(wheels) != 1:
    raise SystemExit("Expected one wheel in dist; run make clean before rebuilding a new version")
archives = list((ROOT / "dist").glob("*.tar.gz"))
if len(archives) != 1:
    raise SystemExit("Expected one source archive in dist")
with tarfile.open(archives[0]) as archive:
    members = {Path(*Path(name).parts[1:]) for name in archive.getnames()}
    for name in (
        "frontend/app.ts",
        "frontend/types.ts",
        "frontend/model.mts",
        "tests/browser.ts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "tsconfig.build.json",
        "eslint.config.mjs",
        ".prettierrc.json",
    ):
        assert Path(name) in members, name
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
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.request import urlopen
import json
import shutil
import gbc_scene_forge
from gbc_scene_forge.demo import DemoConnector
from gbc_scene_forge.server import make_handler
package = distribution('gbc-scene-forge')
assert package.version == gbc_scene_forge.__version__
assert not package.requires, package.requires
assert package.metadata['License-Expression'] == 'MIT'
assert package.metadata.get_all('License-File') == ['LICENSE']
license_file = next(path for path in package.files if str(path).endswith('.dist-info/licenses/LICENSE'))
assert 'Copyright (c) 2026 Michael Clifford' in package.locate_file(license_file).read_text()
static = files('gbc_scene_forge').joinpath('static')
assets = ('index.html', 'app.js', 'model.mjs', 'progress.mjs', 'api.mjs', 'decode.mjs', 'dom.mjs', 'style.css')
for name in assets:
    assert static.joinpath(name).read_bytes(), name
assert shutil.which('node') is None
with TemporaryDirectory() as workspace:
    handler = make_handler('wheel-test', DemoConnector(Path(workspace)))
    with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            for name in assets:
                route = '/' if name == 'index.html' else '/' + name
                with urlopen(base + route) as response:
                    assert response.read() == static.joinpath(name).read_bytes(), name
                    if name.endswith(('.js', '.mjs')):
                        assert response.headers.get_content_type() == 'text/javascript'
            with urlopen(base + '/api/catalog') as response:
                assert json.load(response)['connector'] == 'scene-forge-demo'
        finally:
            server.shutdown()
            worker.join()
            handler.apply_manager.close()
print('Installed wheel: metadata, browser modules and demo HTTP service verified without Node')
"""
    subprocess.run(
        [str(python), "-I", "-c", code],
        cwd=temporary,
        env=os.environ | {"PATH": str(temporary / "no-node")},
        check=True,
    )
    subprocess.run(
        [str(python), "-I", "-m", "unittest", "discover", "-s", str(ROOT / "tests")],
        cwd=temporary,
        check=True,
    )
