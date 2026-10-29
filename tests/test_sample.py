"""The checked-in demo is portable, reproducible, and safely resettable."""

import io
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge.artwork import png
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.sample import template_path
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.storage.files import atomic_write


class SampleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "demo"

    def test_sample_is_portable_and_has_editable_scenes_and_preview_metadata(self):
        project = Project.from_sample(self.root)
        catalog = project.catalog()
        self.assertEqual(
            [s["name"] for s in catalog["project"]["scenes"]], ["Riverside", "Courtyard"]
        )
        for entry in catalog["project"]["scenes"]:
            scene = project.scenes.load(entry["id"])["scene"]
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
            restored = reopened.scenes.load(scene["id"])["scene"]
            self.assertEqual(restored["width"], 28)
            self.assertEqual(restored["layers"][2]["objects"][0]["asset"], "sample/hero_idle")

    def test_reopening_preserves_edits_without_writing_files(self):
        project = Project.from_sample(self.root)
        scene_id = project.catalog()["project"]["scenes"][0]["id"]
        loaded = project.scenes.load(scene_id)
        loaded["scene"]["layers"][0]["cells"][2][2] = "sample/path/0/0"
        project.scenes.save(
            scene_id, loaded["scene"], loaded["revision"], project.catalog()["revision"]
        )
        before = {
            p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()
        }
        reopened = Project.from_sample(self.root)
        after = {
            p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()
        }
        self.assertEqual(before, after)
        self.assertEqual(reopened.scenes.load(scene_id)["scene"], loaded["scene"])

    def test_failed_seed_leaves_no_partial_project_and_can_retry(self):
        with patch(
            "gbc_scene_forge.project.sample.shutil.copytree", side_effect=ValueError("Interrupted")
        ):
            with self.assertRaisesRegex(ValueError, "Interrupted"):
                Project.from_sample(self.root)
        self.assertFalse(self.root.exists())
        self.assertEqual(list(self.root.parent.iterdir()), [])
        self.assertEqual(len(Project.from_sample(self.root).catalog()["project"]["scenes"]), 2)

    def test_reset_restores_template_and_removes_added_scenes_with_recovery_history(self):
        project = Project.from_sample(self.root)
        original = project.read()[0]
        paths = {MANIFEST, *original["files"], *(s["path"] for s in original["scenes"])}
        before = {name: (self.root / name).read_bytes() for name in paths}
        loaded = project.scenes.load(original["scenes"][0]["id"])
        loaded["scene"]["layers"][0]["cells"][2][2] = "sample/path/0/0"
        project.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], project.catalog()["revision"]
        )
        extra = project.scenes.create("Extra scene", 2, 2, 8, project.catalog()["revision"])
        notes = self.root / "notes.txt"
        notes.write_text("Keep unrelated files")
        restored = Project.from_sample(self.root, reset=True)
        self.assertEqual(before, {name: (self.root / name).read_bytes() for name in paths})
        self.assertFalse((self.root / f"scenes/{extra['id']}.tmj").exists())
        self.assertEqual(notes.read_text(), "Keep unrelated files")
        record = restored.transactions.latest()
        self.assertEqual(record["label"], "Reset demo project")
        restored.transactions.undo(record["id"])
        self.assertEqual(len(restored.catalog()["project"]["scenes"]), 3)
        self.assertEqual(restored.scenes.load(loaded["id"])["scene"], loaded["scene"])

    def test_failed_reset_restores_previous_project(self):
        project = Project.from_sample(self.root)
        loaded = project.scenes.load(project.read()[0]["scenes"][0]["id"])
        loaded["scene"]["layers"][0]["cells"][2][2] = "sample/path/0/0"
        project.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], project.catalog()["revision"]
        )
        manifest = (self.root / MANIFEST).read_bytes()
        interrupted = False

        def fail_once(path, data):
            nonlocal interrupted
            if path == self.root / MANIFEST and not interrupted:
                interrupted = True
                raise OSError("Interrupted reset")
            return atomic_write(path, data)

        with patch("gbc_scene_forge.storage.transactions.atomic_write", side_effect=fail_once):
            with self.assertRaisesRegex(OSError, "Interrupted reset"):
                Project.from_sample(self.root, reset=True)
        self.assertTrue(interrupted)
        reopened = Project(self.root)
        self.assertEqual((self.root / MANIFEST).read_bytes(), manifest)
        self.assertEqual(reopened.scenes.load(loaded["id"])["scene"], loaded["scene"])

    def test_reset_refuses_unrelated_project_and_symlink(self):
        project = Project.create(self.root, "My own world")
        before = (self.root / MANIFEST).read_bytes()
        with self.assertRaisesRegex(ValueError, "only supported for a Scene Forge demo"):
            Project.from_sample(self.root, reset=True)
        self.assertEqual((self.root / MANIFEST).read_bytes(), before)
        self.assertEqual(project.read()[0]["name"], "My own world")
        link = self.root.parent / "link"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            Project.from_sample(link, reset=True)

    def test_copy_and_reset_do_not_modify_canonical_template(self):
        source = template_path()
        before = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
        Project.from_sample(self.root)
        Project.from_sample(self.root, reset=True)
        after = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        self.assertFalse((source / ".forge").exists())
        with self.assertRaisesRegex(ValueError, "separate from the bundled template"):
            Project.from_sample(source, reset=True)

    def test_imported_atlas_matches_aseprite_export_and_manifest(self):
        project = Project.from_sample(self.root)
        artwork = Path(__file__).resolve().parents[1] / "assets/demo/artwork"
        imported = self.root / "assets/sample"
        self.assertEqual(
            png.decode((artwork / "atlas.png").read_bytes()),
            png.decode((imported / "atlas.png").read_bytes()),
        )
        self.assertEqual(
            json.loads((artwork / "sample.atlas.json").read_bytes()),
            project.read()[0]["atlases"]["sample"]["manifest"],
        )

    def test_unrelated_files_are_preserved_and_empty_directory_is_accepted(self):
        self.root.mkdir()
        source = self.root / "notes.txt"
        source.write_text("Keep me")
        with self.assertRaisesRegex(ValueError, "new or empty"):
            Project.from_sample(self.root)
        self.assertEqual(source.read_text(), "Keep me")
        self.assertEqual(list(self.root.iterdir()), [source])
        source.unlink()
        self.assertEqual(len(Project.from_sample(self.root).catalog()["project"]["scenes"]), 2)


if __name__ == "__main__":
    unittest.main()
