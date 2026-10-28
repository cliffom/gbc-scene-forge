"""The demo is an editable portable project, safely seeded once."""

import io
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge.projects import Project
from gbc_scene_forge.sample import prepare


class SampleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "demo"

    def test_sample_is_portable_and_has_editable_scenes_and_preview_metadata(self):
        project = prepare(self.root)
        catalog = project.catalog()
        self.assertEqual(
            [s["name"] for s in catalog["project"]["scenes"]], ["Riverside", "Courtyard"]
        )
        for entry in catalog["project"]["scenes"]:
            scene = project.load_scene(entry["id"])["scene"]
            self.assertEqual(len(scene["layers"]), 3)
            self.assertEqual(scene["layers"][2]["objects"][0]["asset"], "sample/hero_idle")
        metadata = catalog["project"]["atlases"]["sample"]["metadata"]["8"]
        self.assertTrue(metadata["sample/water/0/0"]["solid"])
        self.assertFalse(metadata["sample/path/0/0"]["solid"])
        self.assertEqual(
            catalog["project"]["preview"]["sprite"]["mappings"]["sample/hero_idle"]["walk:down"],
            "walk",
        )
        payload, _ = project.export_bundle("project", catalog["revision"])
        exported = self.root.parent / "exported"
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            archive.extractall(exported)
        shutil.rmtree(self.root)
        reopened = Project(exported)
        for key in ("id", "name", "scenes", "preview"):
            self.assertEqual(reopened.catalog()["project"][key], catalog["project"][key])
        for scene in catalog["project"]["scenes"]:
            restored = reopened.load_scene(scene["id"])["scene"]
            self.assertEqual(restored["width"], 28)
            self.assertEqual(restored["layers"][2]["objects"][0]["asset"], "sample/hero_idle")

    def test_reopening_preserves_edits_without_writing_files(self):
        project = prepare(self.root)
        scene_id = project.catalog()["project"]["scenes"][0]["id"]
        loaded = project.load_scene(scene_id)
        loaded["scene"]["layers"][0]["cells"][2][2] = "sample/path/0/0"
        project.save_scene(
            scene_id, loaded["scene"], loaded["revision"], project.catalog()["revision"]
        )
        before = {
            p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()
        }
        reopened = prepare(self.root)
        after = {
            p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()
        }
        self.assertEqual(before, after)
        self.assertEqual(reopened.load_scene(scene_id)["scene"], loaded["scene"])

    def test_failed_seed_leaves_no_partial_project_and_can_retry(self):
        with patch("gbc_scene_forge.sample._scene", side_effect=ValueError("Interrupted")):
            with self.assertRaisesRegex(ValueError, "Interrupted"):
                prepare(self.root)
        self.assertFalse(self.root.exists())
        self.assertEqual(list(self.root.parent.iterdir()), [])
        self.assertEqual(len(prepare(self.root).catalog()["project"]["scenes"]), 2)

    def test_unrelated_files_are_preserved_and_empty_directory_is_accepted(self):
        self.root.mkdir()
        source = self.root / "notes.txt"
        source.write_text("Keep me")
        with self.assertRaisesRegex(ValueError, "new or empty"):
            prepare(self.root)
        self.assertEqual(source.read_text(), "Keep me")
        self.assertEqual(list(self.root.iterdir()), [source])
        source.unlink()
        self.assertEqual(len(prepare(self.root).catalog()["project"]["scenes"]), 2)


if __name__ == "__main__":
    unittest.main()
