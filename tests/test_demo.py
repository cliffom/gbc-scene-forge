"""Demo workspace persistence and reviewed Apply, independent of any host game."""

import base64
import copy
import io
import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from gbc_scene_forge.apply import ApplyManager
from gbc_scene_forge.contract import check_connector
from gbc_scene_forge.demo import SCENES, TILES, DemoConnector
from gbc_scene_forge.documents import DraftStore


class DemoTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.connector = DemoConnector(self.root)

    def test_catalog_previews_templates_and_export_for_each_scene(self):
        check_connector(self.connector)
        self.assertEqual(set(self.connector.catalog()["profiles"]), set(SCENES))
        self.assertEqual(struct.unpack(">II", self.connector.asset("terrain")[16:24]), (72, 8))
        for target in SCENES:
            with self.subTest(target=target):
                scene = self.connector.load(target)["scene"]
                self.assertTrue(self.connector.validate(scene)["valid"])
                self.assertFalse(self.connector.compare(scene)["differs"])
                day = self.connector.preview(scene, "day")
                night = self.connector.preview(scene, "night")
                self.assertNotEqual(day["png"], night["png"])
                image = base64.b64decode(day["png"].split(",", 1)[1])
                self.assertEqual(struct.unpack(">II", image[16:24]), (128, 96))
                self.assertEqual(len(day["collision"]), 12)
                self.assertTrue(any(any(row) for row in day["collision"]))
                template = self.connector.load(target, template=True)["scene"]
                self.assertTrue(all(tile == "grass" for row in template["cells"] for tile in row))
                with zipfile.ZipFile(io.BytesIO(self.connector.export(scene))) as archive:
                    document = json.loads(archive.read("scene.json"))
                    self.assertEqual(document["target"], target)
                    self.assertEqual(document["content"]["cells"], scene["cells"])

    def test_drafts_and_originals_survive_restart_without_changing_sources(self):
        before = {target: self.connector.source_path(target).read_bytes() for target in SCENES}
        store = DraftStore(self.connector)
        for target in SCENES:
            scene = self.connector.load(target)["scene"]
            scene["cells"][0][0] = "path"
            store.save(scene, None, None)
        restarted = DemoConnector(self.root)
        store = DraftStore(restarted)
        self.assertEqual(len(store.list()), 2)
        for target in SCENES:
            self.assertEqual(restarted.source_path(target).read_bytes(), before[target])
            self.assertNotEqual(store.load_original(target)["scene"]["cells"][0][0], "path")

    def test_reviewed_apply_persists_and_undo_restores_only_demo_files(self):
        before = {target: self.connector.source_path(target).read_bytes() for target in SCENES}
        scene = self.connector.load("village")["scene"]
        scene["cells"][0][0] = "path"
        manager = ApplyManager(self.connector)
        self.addCleanup(manager.close)
        review = manager.prepare(scene)
        self.assertEqual(review["changed_cells"], 1)
        job = manager.start(review["id"], True)
        manager._workers[job["id"]].join(timeout=10)
        status = manager.status(job["id"])
        self.assertEqual(status["status"], "complete", status.get("error"))
        self.assertEqual(self.connector.source_path("river").read_bytes(), before["river"])
        compiled = (self.root / "compiled/village.bin").read_bytes()
        self.assertEqual(len(compiled), 16 * 12)
        self.assertEqual(compiled[0], list(TILES).index("path"))
        restarted = DemoConnector(self.root)
        self.assertEqual(restarted.load("village")["scene"]["cells"][0][0], "path")
        self.assertFalse(restarted.validate(scene)["valid"])
        recovered = ApplyManager(restarted)
        self.addCleanup(recovered.close)
        recovered.undo(status["transaction"])
        for target in SCENES:
            self.assertEqual(restarted.source_path(target).read_bytes(), before[target])
            self.assertFalse((self.root / f"compiled/{target}.bin").exists())

    def test_invalid_targets_tiles_and_references_are_rejected(self):
        for target in ("../escape", "missing"):
            with self.assertRaises(ValueError):
                self.connector.load(target)
        scene = self.connector.load("village")["scene"]
        for change in (
            {"connector": "other"},
            {"profile": "missing"},
            {"references": [{"asset": "tree", "x": 0, "y": 0}]},
        ):
            with self.assertRaises(ValueError):
                self.connector.normalize(dict(scene, **change))
        invalid = copy.deepcopy(scene)
        invalid["cells"][0][0] = "missing"
        with self.assertRaises(ValueError):
            self.connector.validate(invalid)
