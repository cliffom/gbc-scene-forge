"""Check the wheel's resources, metadata and contracts in a clean environment."""

import os
import subprocess
import sys
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
        "build_backend.py",
        "tools/frontend_build.py",
        "src/gbc_scene_forge/static/frontend-manifest.json",
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
# Reproduce both supported precompiled-source builds and a fresh checkout with no assets.
with tempfile.TemporaryDirectory() as folder:
    temporary = Path(folder)
    source = temporary / "source"
    source.mkdir()
    with tarfile.open(archives[0]) as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            relative = Path(*Path(member.name).parts[1:])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Source archive contains an escaping path")
            target = source / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError("Missing source archive contents")
            target.write_bytes(stream.read())
    command = [
        sys.executable,
        "-m",
        "build",
        "--wheel",
        "--outdir",
        str(temporary / "dist"),
        str(source),
    ]
    environment = os.environ | {"PATH": str(temporary / "no-node")}
    result = subprocess.run(command, env=environment, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(
            "Precompiled source build failed without Node:\n" + result.stdout + result.stderr
        )
    static = source / "src/gbc_scene_forge/static"
    for path in (*static.glob("*.js"), *static.glob("*.mjs"), static / "frontend-manifest.json"):
        path.unlink()
    result = subprocess.run(command, env=environment, capture_output=True, text=True)
    assert result.returncode != 0, "A source checkout with missing assets must not produce a wheel"
    assert "Browser assets are missing or stale" in result.stdout + result.stderr
    print("PEP 517: precompiled source builds without Node; missing assets fail explicitly")

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
modules = json.loads(static.joinpath('frontend-manifest.json').read_text())['outputs']
assets = ('index.html', 'style.css', *sorted(modules))
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
