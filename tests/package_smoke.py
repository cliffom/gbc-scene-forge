"""Run explicitly with an isolated interpreter after installing the built wheel."""

import tempfile
import unittest
from importlib.metadata import distribution
from importlib.resources import files
from pathlib import Path

from gbc_scene_forge import __version__, server
from gbc_scene_forge.demo import SCENES, DemoConnector


class InstalledPackageSmokeTests(unittest.TestCase):
    def test_imports_and_metadata(self):
        package = distribution("gbc-scene-forge")
        self.assertEqual(package.version, __version__)
        self.assertFalse(package.requires, "The package must not require runtime dependencies")
        self.assertTrue(callable(server.serve))

    def test_browser_assets_are_bundled(self):
        static = files("gbc_scene_forge").joinpath("static")
        for name in (
            "index.html",
            "style.css",
            "app.js",
            "app.js.map",
            "branding/logo-64.png",
            "branding/favicon-32.png",
            "branding/favicon-16.png",
        ):
            with self.subTest(asset=name):
                self.assertTrue(static.joinpath(name).read_bytes())

    def test_demo_scenes_load(self):
        with tempfile.TemporaryDirectory() as folder:
            connector = DemoConnector(Path(folder))
            self.assertTrue(SCENES)
            for target in SCENES:
                with self.subTest(scene=target):
                    self.assertTrue(connector.load(target)["scene"]["cells"])


if __name__ == "__main__":
    unittest.main()
