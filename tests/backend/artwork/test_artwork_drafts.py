"""Owned artwork checkpoints retain original bases through recovery and conflicts."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from gbc_scene_forge.artwork import layers
from gbc_scene_forge.artwork.drafts import ArtworkDrafts
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project


class ArtworkDraftTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Project.create(Path(temporary.name) / "project", "Pixels")
        self.art = self.project.artwork.documents
        self.drafts = ArtworkDrafts(self.art)
        self.original = self.art.create("grass", "Grass", "tile", 8, 8, self.revision())
        self.candidate = self.art.edit(self.original, [{"x": 1, "y": 2, "rgba": [4, 9, 8, 0]}])
        self.data = {
            "id": str(uuid4()),
            "project_id": self.original["project_id"],
            "owner": str(uuid4()),
            "original": self.original,
            "candidate": self.candidate,
            "name": "Grass",
            "revision": None,
        }

    def revision(self):
        return self.project.catalog()["revision"]

    def test_write_restore_download_and_owned_delete_leave_project_unchanged(self):
        before = self.revision()
        ack = self.drafts.write(self.data)
        restored = self.drafts.restore(self.data["id"], ack["revision"])
        self.assertEqual(restored["candidate"], self.candidate)
        self.assertEqual(restored, self.drafts.download(self.data["id"], ack["revision"]))
        self.assertEqual(self.drafts.list()["drafts"][0]["owner"], self.data["owner"])
        self.assertEqual(before, self.revision())
        self.assertEqual(len(self.drafts.paths()), 1)
        self.drafts.delete(self.data["id"], ack["revision"], self.data["owner"])
        self.assertEqual(self.drafts.list(), {"drafts": []})

    def test_stale_and_other_owner_writes_do_not_replace_checkpoint(self):
        ack = self.drafts.write(self.data)
        for data in (self.data, {**self.data, "revision": ack["revision"], "owner": str(uuid4())}):
            with self.assertRaises(Conflict):
                self.drafts.write(data)
        with self.assertRaises(Conflict):
            self.drafts.delete(self.data["id"], ack["revision"], str(uuid4()))
        self.assertEqual(self.drafts.read(self.data["id"])[1], ack["revision"])

    def test_stale_base_recovers_independently_and_download_retains_original(self):
        self.project.scenes.create("External", 4, 4, 8, self.revision())
        ack = self.drafts.write(self.data)
        recovered = self.drafts.restore(self.data["id"], ack["revision"])
        candidate = recovered["candidate"]
        self.assertEqual(candidate["rgba"], self.candidate["rgba"])
        self.assertEqual(candidate["project_revision"], self.revision())
        self.assertNotEqual(candidate["document_id"], self.candidate["document_id"])
        self.assertNotEqual(candidate["atlas_id"], self.candidate["atlas_id"])
        self.assertEqual(candidate["operation"], "create")
        self.art.save(candidate)
        self.assertEqual(
            self.drafts.download(self.data["id"], ack["revision"])["candidate"], self.candidate
        )

    def test_competing_save_and_later_save_keep_their_conflict_guards(self):
        self.art.save(self.original)
        listing = self.art.list(self.revision())["documents"][0]
        original = self.art.open(listing["target"], self.revision(), listing["artwork_revision"])
        candidate = self.art.edit(original, [{"x": 6, "y": 6, "rgba": [155, 80, 131, 255]}])
        ack = self.drafts.write({**self.data, "original": original, "candidate": candidate})
        winner = self.art.edit(original, [{"x": 7, "y": 0, "rgba": [0, 255, 255, 255]}])
        self.art.save(winner)
        before = self.project.store.read()
        recovered = self.drafts.restore(self.data["id"], ack["revision"])
        self.assertEqual(self.project.store.read(), before)
        self.assertEqual(recovered["candidate"]["rgba"], candidate["rgba"])
        self.art.save(recovered["candidate"])
        reopened = self.art.list(self.revision())["documents"]
        source = next(d for d in reopened if d["target"] == listing["target"])
        self.assertEqual(
            self.art.open(source["target"], self.revision(), source["artwork_revision"])["rgba"],
            winner["rgba"],
        )
        stale = self.drafts.restore(self.data["id"], ack["revision"])["candidate"]
        self.project.scenes.create("Later", 4, 4, 8, self.revision())
        with self.assertRaises(Conflict):
            self.art.save(stale)

    def test_stale_layered_sheet_preserves_layout_and_exact_layer_sources(self):
        frame = dict(
            id="pose", name="Pose", kind="sprite", x=0, y=0, width=8, height=8, origin=[0, 0]
        )
        original = self.art.create_sheet(
            "sheet", "Sheet", "sprite", 8, 8, self.revision(), frames=[frame], sequences=[]
        )
        candidate = layers.edit(original, [layers.item("Base"), layers.item("Detail")])
        candidate = layers.apply(
            candidate,
            candidate["descriptor"]["layers"]["items"][1]["id"],
            lambda flat: self.art.edit(flat, [{"x": 1, "y": 2, "rgba": [100, 50, 25, 128]}]),
        )
        ack = self.drafts.write({**self.data, "original": original, "candidate": candidate})
        self.project.scenes.create("External", 4, 4, 8, self.revision())
        recovered = self.drafts.restore(self.data["id"], ack["revision"])["candidate"]
        self.assertEqual(recovered["rgba"], candidate["rgba"])
        self.assertEqual(recovered["layer_rgba"], candidate["layer_rgba"])
        for key in ("frames", "sequences", "layers"):
            self.assertEqual(recovered["descriptor"][key], candidate["descriptor"][key])
        self.art.save(recovered)

    def test_original_base_identity_and_metadata_are_immutable(self):
        self.drafts.write(self.data)
        other = self.art.create("stone", "Stone", "tile", 8, 8, self.revision())
        with self.assertRaises(ValueError):
            self.drafts.write({**self.data, "candidate": other})
        with self.assertRaises(ValueError):
            self.drafts.write({**self.data, "id": "../outside"})
        damaged = copy.deepcopy(self.data)
        damaged["candidate"]["rgba"] = "bad"
        with self.assertRaises(ValueError):
            self.drafts.write(damaged)

    def test_recovery_copy_never_takes_over_original(self):
        ack = self.drafts.write(self.data)
        recovered = self.drafts.restore(self.data["id"], ack["revision"])
        self.drafts.write(
            {**recovered, "id": str(uuid4()), "owner": str(uuid4()), "revision": None}
        )
        self.assertEqual(len(self.drafts.paths()), 2)
        self.assertEqual(self.drafts.read(self.data["id"])[1], ack["revision"])

    def test_failed_write_and_quotas_preserve_existing_record(self):
        ack = self.drafts.write(self.data)
        with patch("gbc_scene_forge.artwork.drafts.atomic_write", side_effect=OSError("injected")):
            with self.assertRaises(OSError):
                self.drafts.write({**self.data, "revision": ack["revision"]})
        self.assertEqual(self.drafts.read(self.data["id"])[1], ack["revision"])
        with patch("gbc_scene_forge.artwork.drafts.MAX_DRAFTS", 1):
            with self.assertRaisesRegex(ValueError, "limit"):
                self.drafts.write({**self.data, "id": str(uuid4())})
        with patch("gbc_scene_forge.artwork.drafts.MAX_TOTAL", 1):
            with self.assertRaisesRegex(ValueError, "128 MiB"):
                self.drafts.write({**self.data, "revision": ack["revision"]})

    def test_corrupt_record_does_not_hide_other_drafts(self):
        self.drafts.write(self.data)
        self.drafts.path(str(uuid4())).write_bytes(b"not json")
        values = self.drafts.list()["drafts"]
        self.assertEqual(len(values), 2)
        self.assertTrue(any("error" in d for d in values))
