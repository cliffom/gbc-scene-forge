"""Replay shipped skill recipes through the bounded plugin profile.

Synthetic grants/data check preservation and publication guards, not model skill
adherence, image visibility, animation playback or artistic quality.
"""

import base64
import copy
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from gbc_scene_forge.adapters.plugin.selection import Selection
from gbc_scene_forge.adapters.plugin.session import PluginSession
from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project


class PluginArtworkWorkflows(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        project = Project.create(self.root / "project", "Skill recipes")
        bundle = self.root / "bundle"
        bundle.mkdir()
        selection = Selection(bundle, settings=self.root / "settings", cache=self.root / "cache")
        self.session = PluginSession(selection, chooser=lambda _: project.root)
        self.assertIsNone(self.session.call("plugin_status", {})["selection"])
        self.session.call("plugin_choose_location", {"mode": "project"})
        self.available = set(self.session.call("capabilities", {})["tools"])

    def call(self, tool, **arguments):
        self.assertIn(tool, self.available)
        return self.session.call(tool, {"project": "project", **arguments})

    def revision(self):
        return self.call("get_project")["revision"]

    def export(self, candidate):
        return self.call("export_artwork_candidate", candidate=candidate)

    def commit_reopen(self, candidate):
        review = self.call("review_artwork_candidate", candidate=candidate)
        self.call("commit_artwork", candidate=candidate, receipt=review["receipt"])
        inventory = self.call("list_artwork", project_revision=self.revision())
        target = next(
            item
            for item in inventory["documents"]
            if item["target"]["document_id"] == self.export(candidate)["document_id"]
        )
        return self.call(
            "open_artwork",
            target=target["target"],
            project_revision=inventory["project_revision"],
            artwork_revision=target["artwork_revision"],
            compact=True,
        )

    def assert_png(self, resource):
        artifact = self.session.read_artifact(resource["uri"])
        self.assertEqual(artifact["mimeType"], "image/png")
        data = base64.b64decode(artifact["blob"])
        width, height, rgba = png.decode(data, generic=True)
        self.assertEqual(len(rgba), width * height * 4)

    def test_scoped_layer_patch_preserves_hidden_source_and_other_pixels(self):
        candidate = self.call(
            "create_artwork",
            project_revision=self.revision(),
            atlas_id="lantern",
            name="Lantern",
            kind="sprite",
            width=32,
            height=32,
            compact=True,
        )
        sources = [
            dict(id=str(uuid4()), name=name, visible=visible, opacity=255, locked=False)
            for name, visible in (("Metal", True), ("Light", True), ("Sketch", False))
        ]
        candidate = self.call("edit_artwork_layers", candidate=candidate, layers=sources)
        candidate = self.call(
            "edit_artwork_pixels",
            candidate=candidate,
            layer_id=sources[0]["id"],
            writes=[dict(x=10, y=12, rgba=[20, 32, 60, 255])],
        )
        candidate = self.call(
            "edit_artwork_pixels",
            candidate=candidate,
            layer_id=sources[2]["id"],
            writes=[dict(x=0, y=0, rgba=[91, 82, 73, 0])],
        )
        sources[2]["locked"] = True
        candidate = self.call("edit_artwork_layers", candidate=candidate, layers=sources)
        saved = self.commit_reopen(candidate)
        before = self.export(saved)
        receipt = self.call("review_artwork_candidate", candidate=saved)["receipt"]
        changed = self.call(
            "edit_artwork_pixels",
            candidate=saved,
            layer_id=sources[1]["id"],
            patch=dict(
                rectangle=dict(x=14, y=14, width=2, height=2),
                rgba=base64.b64encode(bytes([255, 180, 60, 255]) * 4).decode(),
            ),
        )
        after = self.export(changed)
        self.assertEqual(before["descriptor"], after["descriptor"])
        for source in (sources[0], sources[2]):
            self.assertEqual(before["layer_rgba"][source["id"]], after["layer_rgba"][source["id"]])
        pixels = self.call("read_artwork_pixels", candidate=changed, layer_id=sources[1]["id"])
        raw = base64.b64decode(pixels["rgba"])
        expected = bytearray(32 * 32 * 4)
        for x, y in ((14, 14), (15, 14), (14, 15), (15, 15)):
            expected[(y * 32 + x) * 4 : (y * 32 + x) * 4 + 4] = bytes([255, 180, 60, 255])
        self.assertEqual(raw, expected)
        contact = self.call(
            "inspect_artwork_candidate",
            candidate=changed,
            before_candidate=saved,
            rectangles=[dict(x=8, y=8, width=16, height=16)],
            format="png",
            scale=4,
            changed_overlay=True,
        )
        self.assertFalse(contact["complete"])
        self.assert_png(contact["resource"])
        with self.assertRaises(Conflict):
            self.call("commit_artwork", candidate=changed, receipt=receipt)
        reopened = self.export(self.commit_reopen(changed))
        self.assertEqual(reopened["layer_rgba"], after["layer_rgba"])
        self.assertEqual(reopened["descriptor"], after["descriptor"])
        self.assertEqual(self.export(saved), before)  # Original handle remains a recovery copy.

    def test_animation_timing_review_and_contact_fallback_preserve_other_sequence(self):
        frames = [
            dict(
                id=key,
                name=key.title(),
                kind="sprite",
                x=x,
                y=0,
                width=8,
                height=8,
                origin=[3, 5],
            )
            for key, x in (("glow", 0), ("dim", 8))
        ]
        sequences = [
            dict(
                id="pulse",
                name="Pulse",
                loop=True,
                frames=[
                    dict(frame_id="glow", duration_ms=120),
                    dict(frame_id="dim", duration_ms=240),
                ],
            ),
            dict(
                id="still",
                name="Still",
                loop=False,
                frames=[dict(frame_id="glow", duration_ms=500)],
            ),
        ]
        candidate = self.call(
            "create_artwork_sheet",
            project_revision=self.revision(),
            atlas_id="beacon",
            name="Beacon",
            kind="sprite",
            width=16,
            height=8,
            frames=frames,
            sequences=sequences,
            compact=True,
        )
        candidate = self.call(
            "edit_artwork_pixels",
            candidate=candidate,
            writes=[
                dict(x=3, y=3, rgba=[255, 220, 90, 255]),
                dict(x=11, y=3, rgba=[128, 88, 30, 255]),
            ],
        )
        saved = self.commit_reopen(candidate)
        before = self.export(saved)
        stale = self.call("review_artwork_animation", candidate=saved, sequence_id="pulse")
        sequences = copy.deepcopy(before["descriptor"]["sequences"])
        sequences[0]["frames"][1]["duration_ms"] = 333
        changed = self.call(
            "edit_artwork_layout",
            candidate=saved,
            frames=before["descriptor"]["frames"],
            sequences=sequences,
        )
        after = self.export(changed)
        self.assertEqual(after["rgba"], before["rgba"])
        self.assertEqual(after["descriptor"]["frames"], before["descriptor"]["frames"])
        self.assertEqual(after["descriptor"]["sequences"][1], before["descriptor"]["sequences"][1])
        contact = self.call(
            "inspect_artwork_candidate",
            candidate=changed,
            format="png",
            scale=4,
            rectangles=[dict(x=f["x"], y=f["y"], width=8, height=8) for f in frames],
        )
        self.assertTrue(contact["complete"])
        self.assert_png(contact["resource"])
        animation = self.call(
            "review_artwork_animation", candidate=changed, sequence_id="pulse", scale=4
        )
        artifact = self.session.read_artifact(animation["animation_resource"]["uri"])
        self.assertEqual(artifact["mimeType"], "image/apng")
        data = base64.b64decode(artifact["blob"])
        self.assertIn(b"acTL", data)
        with self.assertRaises(Conflict):
            self.call("commit_artwork", candidate=changed, receipt=stale["receipt"])
        reopened = self.export(self.commit_reopen(changed))
        self.assertEqual(reopened["descriptor"], after["descriptor"])
        self.assertEqual(reopened["rgba"], before["rgba"])

    def test_tile_variants_remain_unpublished_and_missing_tools_reject(self):
        revision = self.revision()
        candidate = self.call(
            "create_artwork_sheet",
            project_revision=revision,
            atlas_id="grass",
            name="Grass",
            kind="tile",
            width=16,
            height=16,
            frames=[
                dict(
                    id=f"grass_{i}",
                    name=f"Grass {i}",
                    kind="tile",
                    x=x,
                    y=y,
                    width=8,
                    height=8,
                    origin=[0, 0],
                )
                for i, (x, y) in enumerate(((0, 0), (8, 0), (0, 8), (8, 8)))
            ],
            sequences=[],
            compact=True,
        )
        for tool in ("edit_artwork_raster", "analyze_artwork_cleanup", "duplicate_artwork"):
            self.assertNotIn(tool, self.available)
            with self.assertRaisesRegex(ValueError, "unavailable"):
                self.session.call(tool, {"project": "project", "candidate": candidate})
        self.assertEqual(self.revision(), revision)
        self.assertEqual(self.call("list_artwork", project_revision=revision)["documents"], [])
        self.assertEqual(self.call("list_artwork_candidates")["used_count"], 1)
