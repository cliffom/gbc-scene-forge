"""Native sheet persistence, explicit animation identities and exact pixel contracts."""

import copy
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from gbc_scene_forge.artwork import editable, sheets
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project


def frame(key, x=0, kind="sprite"):
    return {
        "id": key,
        "name": key.title(),
        "kind": kind,
        "x": x,
        "y": 0,
        "width": 8,
        "height": 8,
        "origin": [3, 5] if kind == "sprite" else [0, 0],
    }


def sequence():
    return {
        "id": "walk",
        "name": "Walk",
        "loop": True,
        "frames": [
            {"frame_id": "idle", "duration_ms": 120},
            {"frame_id": "step", "duration_ms": 240},
        ],
    }


class SheetTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Sheets")
        self.documents = self.project.artwork.documents

    def revision(self):
        return self.project.catalog()["revision"]

    def candidate(self):
        return self.documents.create_sheet(
            "player",
            "Player",
            "sprite",
            24,
            8,
            self.revision(),
            frames=[frame("idle"), frame("step", 8)],
            sequences=[sequence()],
        )

    def save(self, candidate):
        review = self.project.artwork.reviews.review(candidate)
        return self.documents.save(candidate, receipt=review["receipt"])

    def open(self, candidate, acknowledgment):
        return self.documents.open(
            self.documents._target(candidate["descriptor"]),
            acknowledgment["project_revision"],
            acknowledgment["artwork_revision"],
        )

    def test_exact_pixels_sequences_and_export_reopen(self):
        candidate = self.documents.edit(
            self.candidate(),
            [
                {"x": 1, "y": 2, "rgba": [77, 88, 99, 0]},
                {"x": 9, "y": 2, "rgba": [10, 20, 30, 128]},
            ],
        )
        ack = self.save(candidate)
        reopened = self.open(candidate, ack)
        self.assertEqual(reopened["rgba"], candidate["rgba"])
        self.assertEqual(reopened["descriptor"], candidate["descriptor"])
        entry = self.project.catalog()["project"]["atlases"]["player"]
        self.assertEqual(entry["tiles"]["sprites"], {"player/idle": 0, "player/step": 1})
        self.assertEqual(entry["manifest"]["animations"][0]["frames"][1]["duration_ms"], 240)
        exported, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(exported)) as archive:
            archive.extractall(self.root / "export")
        copied = Project(self.root / "export")
        listing = copied.artwork.documents.list(copied.catalog()["revision"])
        self.assertEqual(listing["documents"][0]["descriptor"], candidate["descriptor"])

    def test_reorder_keeps_local_ids_and_append_is_guarded(self):
        candidate = self.candidate()
        ack = self.save(candidate)
        opened = self.open(candidate, ack)
        frames = list(reversed(opened["descriptor"]["frames"])) + [frame("jump", 16)]
        changed = self.documents.layout(opened, frames, [sequence()])
        self.assertNotEqual(changed["revision"], opened["revision"])
        self.save(changed)
        mapping = self.project.catalog()["project"]["atlases"]["player"]["tiles"]["sprites"]
        self.assertEqual(mapping, {"player/idle": 0, "player/step": 1, "player/jump": 2})
        with self.assertRaises(Conflict):
            self.save(opened)

    def test_saved_geometry_and_frame_removal_are_rejected(self):
        candidate = self.candidate()
        opened = self.open(candidate, self.save(candidate))
        frames = copy.deepcopy(opened["descriptor"]["frames"])
        frames[0]["x"] = 16
        changed = self.documents.layout(opened, frames, [sequence()])
        with self.assertRaisesRegex(ValueError, "geometry"):
            self.save(changed)
        with self.assertRaisesRegex(ValueError, "primary region"):
            self.documents.layout(opened, [frames[1]], [])
        removed = self.documents.layout(opened, [opened["descriptor"]["frames"][0]], [])
        with self.assertRaisesRegex(ValueError, "removed"):
            self.save(removed)

    def test_invalid_frame_and_sequence_contracts(self):
        candidate = self.candidate()
        descriptor = candidate["descriptor"]
        invalid = []
        duplicate = copy.deepcopy(descriptor)
        duplicate["frames"].append(frame("idle"))
        invalid.append(duplicate)
        for duration in (0, True, 65536):
            bad = copy.deepcopy(descriptor)
            bad["sequences"][0]["frames"][0]["duration_ms"] = duration
            invalid.append(bad)
        for field, value in (("x", 1), ("width", 32), ("origin", [8, 0])):
            bad = copy.deepcopy(descriptor)
            bad["frames"][0][field] = value
            invalid.append(bad)
        for bad in invalid:
            with self.subTest(descriptor=bad), self.assertRaises(ValueError):
                editable.check_descriptor(bad)
        self.assertEqual(sheets.regions(descriptor)[0]["name"], "idle")
