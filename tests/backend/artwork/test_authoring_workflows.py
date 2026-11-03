"""Milestone authoring: transparent scenery, representation changes and exact migration."""

import copy
import io
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.artwork.test_sheets import frame, sequence
from gbc_scene_forge.artwork import png
from gbc_scene_forge.artwork.conversion import ArtworkConversion
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.scenes import rendering


class AuthoringWorkflows(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Authoring")
        self.art = self.project.artwork.documents

    def revision(self):
        return self.project.catalog()["revision"]

    def save(self, candidate):
        return self.art.save(
            candidate, receipt=self.project.artwork.reviews.review(candidate)["receipt"]
        )

    def render(self, project, scene_id):
        loaded = project.scenes.load(scene_id)
        document = project.catalog()["project"]
        return rendering.render(
            loaded["scene"],
            document,
            lambda path: (project.root / path).read_bytes(),
            {"x": 0, "y": 0, "width": 32, "height": 16},
        )

    def exported(self):
        data, _ = self.project.export_bundle("project", self.revision())
        destination = self.root / "export"
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            archive.extractall(destination)
        return Project(destination)

    def test_tree_vine_rounded_edge_transparency_roundtrip(self):
        background = self.art.create("sky", "Sky", "tile", 8, 8, self.revision())
        self.save(
            self.art.edit(
                background,
                [{"x": x, "y": y, "rgba": [32, 96, 160, 255]} for y in range(8) for x in range(8)],
            )
        )
        frames = [
            frame("tree", 0, "tile"),
            frame("vine", 8, "tile"),
            frame("rounded_edge", 16, "tile"),
        ]
        candidate = self.art.create_sheet(
            "scenery", "Scenery", "tile", 24, 8, self.revision(), frames=frames, sequences=[]
        )
        writes = []
        for index, predicate in enumerate(
            (
                lambda x, y: y < 5 and 1 <= x <= 6 or x in (3, 4),
                lambda x, y: x == 3 or y % 3 == 0 and x in (2, 4),
                lambda x, y: x * x + y * y <= 49,
            )
        ):
            for y in range(8):
                for x in range(8):
                    writes.append(
                        {
                            "x": index * 8 + x,
                            "y": y,
                            "rgba": [40, 140, 50, 255] if predicate(x, y) else [91, 82, 73, 0],
                        }
                    )
        candidate = self.art.edit(candidate, writes)
        ack = self.save(candidate)
        opened = self.art.open(
            self.art._target(candidate["descriptor"]),
            ack["project_revision"],
            ack["artwork_revision"],
        )
        self.assertEqual(opened["rgba"], candidate["rgba"])
        loaded = self.project.scenes.create("Garden", 4, 2, 8, self.revision())
        scene = {
            "width": 4,
            "height": 2,
            "grid": 8,
            "next_layer_id": 3,
            "layers": [
                {
                    "id": 1,
                    "name": "Sky",
                    "type": "tilelayer",
                    "visible": True,
                    "cells": [["sky/artwork/0/0"] * 4 for _ in range(2)],
                },
                {
                    "id": 2,
                    "name": "Scenery",
                    "type": "tilelayer",
                    "visible": True,
                    "cells": [[f"scenery/{f['id']}/0/0" for f in frames] + [""], [""] * 4],
                },
            ],
        }
        self.project.scenes.save(loaded["id"], scene, loaded["revision"], self.revision())
        before = self.render(self.project, loaded["id"])
        _, _, pixels = png.decode(before)
        for index, f in enumerate(frames):
            transparent = next(
                (w for w in writes if index * 8 <= w["x"] < index * 8 + 8 and w["rgba"][3] == 0)
            )
            offset = (transparent["y"] * 32 + transparent["x"]) * 4
            self.assertEqual(pixels[offset : offset + 4], bytes([32, 96, 160, 255]), f["id"])
        self.assertEqual(before, self.render(Project(self.project.root), loaded["id"]))
        exported = self.exported()
        self.assertEqual(before, self.render(exported, loaded["id"]))
        self.assertEqual(
            self.project.artwork.asset("assets/scenery/atlas.png"),
            exported.artwork.asset("assets/scenery/atlas.png"),
        )

    def player(self):
        candidate = self.art.create_sheet(
            "player",
            "Player",
            "sprite",
            16,
            8,
            self.revision(),
            frames=[frame("idle"), frame("step", 8), frame("idle_tiles", kind="tile")],
            sequences=[{**sequence(), "loop": False}],
        )
        return self.art.edit(
            candidate,
            [
                {"x": 0, "y": 0, "rgba": [51, 62, 73, 0]},
                {"x": 1, "y": 1, "rgba": [150, 100, 50, 255]},
                {"x": 9, "y": 1, "rgba": [50, 150, 100, 128]},
            ],
        )

    def test_migration_and_apng_exact_timing_and_hidden_rgb(self):
        original = self.player()
        ack = self.save(original)
        source = {
            "atlas_id": "player",
            "region": "idle",
            "grid": None,
            "cell": None,
            "artwork_revision": ack["artwork_revision"],
        }
        copied = self.art.duplicate_sheet(source, "copy", "Copy", self.revision())
        self.assertEqual(copied["rgba"], original["rgba"])
        for key in ("frames", "sequences"):
            self.assertEqual(copied["descriptor"][key], original["descriptor"][key])
        review = self.project.artwork.reviews.animation(copied, "walk", scale=1)
        chunks = []
        offset = 8
        while offset < len(review["animation_png"]):
            n = struct.unpack(">I", review["animation_png"][offset : offset + 4])[0]
            chunks.append(
                (
                    review["animation_png"][offset + 4 : offset + 8],
                    review["animation_png"][offset + 8 : offset + 8 + n],
                )
            )
            offset += n + 12
        self.assertEqual(struct.unpack(">II", dict(chunks)[b"acTL"]), (2, 1))
        controls = [struct.unpack(">IIIIIHHBB", data) for kind, data in chunks if kind == b"fcTL"]
        self.assertEqual([(c[5], c[6], c[8]) for c in controls], [(120, 1000, 0), (240, 1000, 0)])
        self.assertEqual(png.decode(review["animation_png"])[2][:4], bytes([51, 62, 73, 0]))
        self.art.save(copied, receipt=review["receipt"])
        exported = self.exported()
        docs = exported.artwork.documents.list(exported.catalog()["revision"])["documents"]
        copy_doc = next(d for d in docs if d["target"]["atlas_id"] == "copy")
        self.assertEqual(copy_doc["descriptor"]["sequences"], original["descriptor"]["sequences"])
        self.assertEqual(
            self.project.artwork.asset("assets/player/atlas.png"),
            exported.artwork.asset("assets/copy/atlas.png"),
        )

    def conversion(self):
        self.save(self.player())
        loaded = self.project.scenes.create("Stage", 4, 2, 8, self.revision())
        scene = loaded["scene"]
        scene["objects"] = [
            {"id": i, "asset": "player/idle", "x": 3 + (i - 1) * 8, "y": 5} for i in (1, 2, 3)
        ]
        scene["next_object_id"] = 4
        loaded = self.project.scenes.save(loaded["id"], scene, loaded["revision"], self.revision())
        request = {
            "project_revision": self.revision(),
            "scene_id": loaded["id"],
            "scene_revision": loaded["revision"],
            "layer_id": 2,
            "object_ids": [2],
            "tile_asset": "player/idle_tiles",
            "acknowledge_static": True,
        }
        return loaded, request, ArtworkConversion(self.art)

    def test_conversion_preserves_order_unselected_source_and_export(self):
        loaded, request, service = self.conversion()
        before = self.render(self.project, loaded["id"])
        report = service.review(request, {"x": 0, "y": 0, "width": 32, "height": 16})
        self.assertEqual(report["before_png"], report["after_png"])
        self.assertEqual(self.project.scenes.load(loaded["id"])["revision"], loaded["revision"])
        service.commit(report["plan"])
        layers = tiled.scene_layers(self.project.scenes.load(loaded["id"])["scene"])
        self.assertEqual([o["id"] for layer in layers for o in layer.get("objects", [])], [1, 3])
        self.assertEqual(
            [layer["type"] for layer in layers],
            ["tilelayer", "objectgroup", "tilelayer", "objectgroup"],
        )
        self.assertEqual(before, self.render(self.project, loaded["id"]))
        self.assertEqual(before, self.render(self.exported(), loaded["id"]))
        with self.assertRaises(Conflict):
            service.commit(report["plan"])

    def test_conversion_rejects_bad_alignment_and_modified_plan_atomically(self):
        loaded, request, service = self.conversion()
        report = service.review(request, {"x": 0, "y": 0, "width": 32, "height": 16})
        changed = copy.deepcopy(report["plan"])
        changed["mapping"][0]["x"] += 1
        with self.assertRaisesRegex(ValueError, "differs"):
            service.commit(changed)
        model = loaded["scene"]
        model["objects"][1]["x"] += 1
        updated = self.project.scenes.save(loaded["id"], model, loaded["revision"], self.revision())
        request.update(project_revision=self.revision(), scene_revision=updated["revision"])
        with self.assertRaisesRegex(ValueError, "align"):
            service.review(request, {"x": 0, "y": 0, "width": 32, "height": 16})
        self.assertEqual(self.project.scenes.load(loaded["id"])["revision"], updated["revision"])

    def test_imported_tile_and_animated_sprite_sheet_migrate_losslessly(self):
        import base64
        import json

        from support.atlas_fixture import bundle, sprite_bundle

        from gbc_scene_forge.artwork import editable

        for key, factory, primary in (
            ("tiles", bundle, "earth"),
            ("sprites", sprite_bundle, "idle"),
        ):
            path, manifest = factory(self.root / key)
            if key == "sprites":
                manifest["animations"][0]["loop"] = False
                path.write_text(json.dumps(manifest))
            width, height, source = png.decode((path.parent / "atlas.png").read_bytes())
            source = bytes([71, 82, 93, 0]) + source[4:]
            (path.parent / "atlas.png").write_bytes(png.encode(width, height, source))
            if key == "tiles":
                self.project.artwork.import_tilesheet(
                    {
                        "id": manifest["id"],
                        "png": base64.b64encode((path.parent / "atlas.png").read_bytes()).decode(),
                        "grid": 8,
                        "margin": 0,
                        "spacing": 0,
                    },
                    self.revision(),
                )
                primary = "tile_0_0"
            else:
                self.project.artwork.import_atlas(path, self.revision())
            document = self.project.catalog()["project"]
            entry = document["atlases"][manifest["id"]]
            copied = self.art.duplicate_sheet(
                {
                    "atlas_id": manifest["id"],
                    "region": primary,
                    "grid": None,
                    "cell": None,
                    "artwork_revision": editable.artwork_revision(entry, document["files"]),
                },
                f"native_{key}",
                f"Native {key}",
                self.revision(),
            )
            self.assertEqual(base64.b64decode(copied["rgba"]), source)
            if key == "sprites":
                self.assertEqual(
                    copied["descriptor"]["sequences"][0]["frames"][0]["duration_ms"], 120
                )
                self.assertFalse(copied["descriptor"]["sequences"][0]["loop"])
                self.assertEqual(copied["descriptor"]["frames"][0]["origin"], [8, 23])
            else:
                self.assertEqual(copied["descriptor"]["sequences"], [])
            self.save(copied)
        exported = self.exported()
        for key in ("tiles", "sprites"):
            self.assertEqual(
                self.project.artwork.asset(f"assets/native_{key}/atlas.png"),
                exported.artwork.asset(f"assets/native_{key}/atlas.png"),
            )

    def test_native_sheet_transfer_remaps_embedded_identity_and_sequences(self):
        import base64

        loaded, _, _ = self.conversion()
        archive, _ = self.project.export_bundle("project", self.revision())
        destination = Project.create(self.root / "destination", "Destination")
        revision = destination.catalog()["revision"]
        payload = base64.b64encode(archive).decode()
        report = destination.imports.forge(payload, revision)
        self.assertTrue(report["compatible"], report)
        destination.imports.forge(
            payload, revision, dry_run=False, confirmation=report["confirmation"]
        )
        inventory = destination.artwork.documents.list(destination.catalog()["revision"])
        native = inventory["documents"][0]
        d = native["descriptor"]
        self.assertNotEqual(d["atlas_id"], "player")
        self.assertEqual(d["sequences"], [{**sequence(), "loop": False}])
        opened = destination.artwork.documents.open(
            native["target"], destination.catalog()["revision"], native["artwork_revision"]
        )
        self.assertEqual(base64.b64decode(opened["rgba"])[:4], bytes([51, 62, 73, 0]))
        document = destination.catalog()["project"]
        self.assertEqual(document["atlases"][d["atlas_id"]]["manifest"]["sheet"], d)
        self.assertNotEqual(document["scenes"][0]["id"], loaded["id"])

    def test_animation_review_limits_and_changed_timing_reject_stale_receipt(self):
        candidate = self.player()
        review = self.project.artwork.reviews.animation(candidate, "walk", scale=1)
        sequences = copy.deepcopy(candidate["descriptor"]["sequences"])
        sequences[0]["frames"][0]["duration_ms"] = 333
        changed = self.art.layout(candidate, candidate["descriptor"]["frames"], sequences)
        with self.assertRaises(Conflict):
            self.art.save(changed, receipt=review["receipt"])
        with self.assertRaisesRegex(ValueError, "sequence"):
            self.project.artwork.reviews.animation(candidate, "missing", scale=1)
        large = self.art.create_sheet(
            "large",
            "Large",
            "sprite",
            256,
            256,
            self.revision(),
            frames=[{**frame("large"), "width": 256, "height": 256}],
            sequences=[
                {
                    "id": "long",
                    "name": "Long",
                    "loop": True,
                    "frames": [{"frame_id": "large", "duration_ms": 1}] * 65,
                }
            ],
        )
        with self.assertRaisesRegex(ValueError, "total frame pixels"):
            self.project.artwork.reviews.animation(large, "long", scale=1)
