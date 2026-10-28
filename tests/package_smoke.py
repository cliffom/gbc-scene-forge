"""Run explicitly with an isolated interpreter after installing the built wheel."""

import io
import tempfile
import unittest
import zipfile
from importlib.metadata import distribution
from importlib.resources import files
from pathlib import Path

from gbc_scene_forge import __version__, standalone
from gbc_scene_forge.projects import Project
from gbc_scene_forge.sample import prepare
from gbc_scene_forge.workspaces import ProjectRoot


class InstalledPackageSmokeTests(unittest.TestCase):
    def test_imports_and_metadata(self):
        package = distribution("gbc-scene-forge")
        self.assertEqual(package.version, __version__)
        self.assertFalse(package.requires, "The package must not require runtime dependencies")
        self.assertTrue(callable(standalone.serve))
        launcher = next(entry for entry in package.entry_points if entry.name == "gbc-scene-forge")
        self.assertTrue(callable(launcher.load()))

    def test_browser_assets_are_bundled(self):
        static = files("gbc_scene_forge").joinpath("static")
        for name in (
            "index.html",
            "style.css",
            "app.js",
            "app.js.map",
            "project.html",
            "project.css",
            "project.js",
            "project.js.map",
            "branding/logo-64.png",
            "branding/favicon-32.png",
            "branding/favicon-16.png",
        ):
            with self.subTest(asset=name):
                self.assertTrue(static.joinpath(name).read_bytes())

    def test_sample_project_loads(self):
        with tempfile.TemporaryDirectory() as folder:
            project = prepare(Path(folder) / "demo")
            scenes = project.catalog()["project"]["scenes"]
            self.assertEqual(len(scenes), 2)
            for scene in scenes:
                with self.subTest(scene=scene["name"]):
                    self.assertTrue(project.load_scene(scene["id"])["scene"]["layers"])

    def test_project_root_creates_and_discovers_named_projects(self):
        with tempfile.TemporaryDirectory() as folder:
            workspace = ProjectRoot(Path(folder) / "projects")
            self.assertEqual(workspace.create("Hello World"), "hello-world")
            catalog = ProjectRoot(workspace.root).catalog()
            self.assertEqual(catalog["projects"][0]["name"], "Hello World")
            self.assertEqual(Project(workspace.root / "hello-world").read()[0]["version"], 1)

    def test_standalone_project_reopens(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Project.create(Path(folder) / "world", "Portable world")
            scene = project.create_scene("Village", 7, 5, 8, project.catalog()["revision"])
            reopened = Project(project.root)
            self.assertEqual(reopened.load_scene(scene["id"])["scene"]["width"], 7)
            payload, _ = reopened.export_bundle("project", reopened.catalog()["revision"])
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                self.assertIn("forge.project.json", archive.namelist())
                self.assertIn(f"scenes/{scene['id']}.tmj", archive.namelist())


if __name__ == "__main__":
    unittest.main()
