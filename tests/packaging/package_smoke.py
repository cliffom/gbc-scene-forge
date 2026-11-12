"""Run explicitly with an isolated interpreter after installing the built wheel."""

import base64
import io
import json
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from importlib.metadata import distribution
from importlib.resources import files
from pathlib import Path
from urllib.request import Request, urlopen

from gbc_scene_forge import __version__
from gbc_scene_forge.adapters.console import ServerConsole
from gbc_scene_forge.adapters.http import server as standalone
from gbc_scene_forge.build_info import build_version
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.workspaces import ProjectRoot


class InstalledPackageSmokeTests(unittest.TestCase):
    def test_imports_and_metadata(self):
        package = distribution("gbc-scene-forge")
        self.assertEqual(package.version, __version__)
        for requirement in package.requires or []:
            dependency, separator, marker = requirement.partition(";")
            self.assertTrue(dependency.startswith("mcp"), "Only the optional MCP SDK is allowed")
            self.assertTrue(separator, "The plain editor must not require runtime dependencies")
            self.assertEqual(marker.strip().replace('"', "'"), "extra == 'mcp'")
        self.assertTrue(callable(standalone.serve))
        launcher = next(entry for entry in package.entry_points if entry.name == "gbc-scene-forge")
        self.assertTrue(callable(launcher.load()))
        mcp_launcher = next(
            entry for entry in package.entry_points if entry.name == "gbc-scene-forge-mcp"
        )
        self.assertTrue(callable(mcp_launcher.load()))
        # Both console scripts and the documented module launchers stay usable
        # while implementation modules are free to move between domains.
        for module in ("gbc_scene_forge", "gbc_scene_forge.mcp_server"):
            result = subprocess.run(
                [sys.executable, "-I", "-m", module, "--help"],
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            self.assertIn("--project", result.stdout)

    def test_browser_assets_are_bundled(self):
        static = files("gbc_scene_forge").joinpath("static")
        for name in (
            "style.css",
            "project.html",
            "project.css",
            "project.js",
            "project.js.map",
            "build-info.json",
            "branding/logo-64.png",
            "branding/favicon-32.png",
            "branding/favicon-16.png",
            "branding/apple-touch-icon.png",
        ):
            with self.subTest(asset=name):
                self.assertTrue(static.joinpath(name).read_bytes())
        for name in ("index.html", "app.js", "app.js.map", "app.meta.json"):
            self.assertFalse(static.joinpath(name).is_file(), name)
        notices = static.joinpath("third-party-notices.txt").read_text()
        self.assertIn("Valibot", notices)
        self.assertIn("Copyright (c) Fabian Hiller", notices)
        self.assertIn("Permission is hereby granted", notices)
        version = build_version()
        self.assertRegex(version, rf"^{__version__}(?:-[0-9a-f]{{7,40}})?$")
        self.assertIn(f'"{version}"', static.joinpath("project.js").read_text())
        stream = io.StringIO()
        ServerConsole(stream).start(8765)
        self.assertIn(f"  {'Version':<14}{version}", stream.getvalue())

    def test_editable_artwork_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            project = Project.create(root / "native", "Native")
            documents = project.artwork.documents
            candidate = documents.create(
                "grass", "Grass", "tile", 8, 8, project.catalog()["revision"]
            )
            candidate = documents.edit(candidate, [{"x": 0, "y": 0, "rgba": [12, 34, 56, 0]}])
            comparison = project.artwork.reviews.review(candidate)
            acknowledgment = documents.save(candidate, receipt=comparison["receipt"])
            self.assertEqual(acknowledgment["review_revision"], comparison["receipt"]["revision"])
            project.scenes.create("Room", 2, 2, 8, project.catalog()["revision"])
            raw, _ = project.export_bundle("project", project.catalog()["revision"])
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                for member in archive.namelist():
                    path = root / "export" / member
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(archive.read(member))
            reopened = Project(root / "export")
            revision = reopened.catalog()["revision"]
            documents = reopened.artwork.documents
            saved = documents.list(revision)["documents"][0]
            exact = documents.read(
                documents.open(saved["target"], revision, saved["artwork_revision"]),
                {"x": 0, "y": 0, "width": 1, "height": 1},
            )
            self.assertEqual(base64.b64decode(exact["rgba"]), bytes([12, 34, 56, 0]))
            self.assertEqual(saved["artwork_revision"], acknowledgment["artwork_revision"])
            scene = reopened.scenes.load(reopened.catalog()["project"]["scenes"][0]["id"])
            scene["scene"]["cells"][0][0] = "grass/artwork/0/0"
            reviewed = reopened.artwork.reviews.review(
                documents.open(saved["target"], revision, saved["artwork_revision"]),
                scene={
                    "scene_id": scene["id"],
                    "scene_revision": scene["revision"],
                    "scene": scene["scene"],
                    "viewport": {"x": 0, "y": 0, "width": 16, "height": 16},
                },
            )
            self.assertEqual(reviewed["after"], comparison["after"])
            self.assertTrue(reviewed["scene"]["after_png"].startswith(b"\x89PNG"))

    def test_sample_project_loads(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Project.from_sample(Path(folder) / "demo")
            scenes = project.catalog()["project"]["scenes"]
            self.assertEqual(len(scenes), 2)
            for scene in scenes:
                with self.subTest(scene=scene["name"]):
                    self.assertTrue(project.scenes.load(scene["id"])["scene"]["layers"])
            original = project.scenes.load(scenes[0]["id"])
            changed = project.scenes.load(scenes[0]["id"])
            changed["scene"]["layers"][0]["cells"][2][2] = "sample/path/0/0"
            project.scenes.save(
                changed["id"], changed["scene"], changed["revision"], project.catalog()["revision"]
            )
            restored = Project.from_sample(project.root, reset=True)
            self.assertEqual(restored.scenes.load(original["id"])["scene"], original["scene"])

    def test_project_root_creates_and_discovers_named_projects(self):
        with tempfile.TemporaryDirectory() as folder:
            workspace = ProjectRoot(Path(folder) / "projects")
            self.assertEqual(workspace.create("Hello World"), "hello-world")
            catalog = ProjectRoot(workspace.root).catalog()
            self.assertEqual(catalog["projects"][0]["name"], "Hello World")
            self.assertEqual(Project(workspace.root / "hello-world").read()[0]["version"], 1)

    def test_installed_launcher_creates_sample_and_serves_offline_editor(self):
        with tempfile.TemporaryDirectory() as folder:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-I",
                    "-c",
                    "import faulthandler, runpy; "
                    "faulthandler.dump_traceback_later(10); "
                    "runpy.run_module('gbc_scene_forge', run_name='__main__')",
                    "--no-browser",
                    "--port",
                    "0",
                ],
                cwd=folder,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            lines = queue.Queue()

            def collect():
                for line in process.stdout:
                    lines.put(line)
                lines.put(None)

            reader = threading.Thread(target=collect, daemon=True)
            reader.start()
            try:
                output = ""
                deadline = time.monotonic() + 15
                while True:
                    try:
                        line = lines.get(timeout=max(0.01, deadline - time.monotonic()))
                    except queue.Empty:
                        self.fail(f"Installed launcher startup timed out:\n{output}")
                    self.assertIsNotNone(line, output)
                    output += line
                    match = re.search(r"Editor\s+(http://127\.0\.0\.1:\d+/)", output)
                    if match:
                        url = match[1]
                        break
                with urlopen(url + "api/project", timeout=5) as response:
                    catalog = json.load(response)
                request = Request(
                    url + "api/create-project",
                    data=json.dumps({"name": "First world", "starter": "sample"}).encode(),
                    headers={"Content-Type": "application/json", "X-Scene-Token": catalog["token"]},
                )
                with urlopen(request, timeout=5) as response:
                    directory = json.load(response)["directory"]
                base = url + f"projects/{directory}/"
                with urlopen(base, timeout=5) as response:
                    self.assertIn(b"First scene guide", response.read())
                with urlopen(base + "project.js", timeout=5) as response:
                    self.assertEqual(
                        response.read(),
                        files("gbc_scene_forge").joinpath("static/project.js").read_bytes(),
                    )
                project = Project(Path(folder) / ".forge_project" / directory)
                self.assertEqual(project.read()[0]["name"], "First world")
                self.assertEqual(len(project.read()[0]["scenes"]), 2)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                reader.join(timeout=5)
                process.stdout.close()

    def test_standalone_project_reopens(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Project.create(Path(folder) / "world", "Portable world")
            scene = project.scenes.create("Village", 7, 5, 8, project.catalog()["revision"])
            reopened = Project(project.root)
            self.assertEqual(reopened.scenes.load(scene["id"])["scene"]["width"], 7)
            payload, _ = reopened.export_bundle("project", reopened.catalog()["revision"])
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                self.assertIn("forge.project.json", archive.namelist())
                self.assertIn(f"scenes/{scene['id']}.tmj", archive.namelist())


if __name__ == "__main__":
    unittest.main()
