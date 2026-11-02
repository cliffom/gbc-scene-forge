"""Native candidate review, exact raster comparisons and final dependency guards."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge.artwork import editable, png, review
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project


class ArtworkReviewTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Project.create(Path(temp.name) / "project", "Review")
        self.art = self.project.artwork.documents
        self.reviews = self.project.artwork.reviews

    def revision(self):
        return self.project.catalog()["revision"]

    def blank(self, *, kind="tile", width=8, height=8, origin=None):
        return self.art.create(
            "native", "Native", kind, width, height, self.revision(), origin=origin
        )

    def opened(self):
        document = self.art.list(self.revision())["documents"][0]
        return self.art.open(document["target"], self.revision(), document["artwork_revision"])

    def scene(self, *, width=2, height=2, grid=8):
        return self.project.scenes.create("Context", width, height, grid, self.revision())

    def context(self, loaded, model=None):
        return {
            "scene_id": loaded["id"],
            "scene_revision": loaded["revision"],
            "scene": model,
            "viewport": {"x": 0, "y": 0, "width": 32, "height": 32},
        }

    def snapshot(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file() and not str(p.relative_to(self.project.root)).startswith(".forge/")
        }

    def test_isolated_new_pixels_alpha_and_nearest_neighbor_are_exact_and_read_only(self):
        candidate = self.art.edit(
            self.blank(),
            [
                {"x": 0, "y": 0, "rgba": [17, 18, 19, 0]},
                {"x": 1, "y": 0, "rgba": [31, 32, 33, 127]},
            ],
        )
        before, original = self.snapshot(), copy.deepcopy(candidate)
        result = self.reviews.review(candidate, scale=3)
        self.assertIsNone(result["before"])
        self.assertEqual(
            png.decode(result["after"]["native_png"], generic=True)[2][:8],
            bytes([17, 18, 19, 0, 31, 32, 33, 127]),
        )
        w, h, pixels = png.decode(result["after"]["enlarged_png"], generic=True)
        self.assertEqual((w, h), (24, 24))
        for y in range(3):
            self.assertEqual(
                pixels[y * w * 4 : y * w * 4 + 24],
                bytes([17, 18, 19, 0]) * 3 + bytes([31, 32, 33, 127]) * 3,
            )
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(candidate, original)
        saved = self.art.save(candidate, receipt=result["receipt"])
        self.assertEqual(saved["candidate_revision"], candidate["revision"])

    def test_saved_before_after_and_all_shared_scene_placements(self):
        self.art.save(self.blank())
        scenes = []
        for _ in range(2):
            loaded = self.scene()
            loaded["scene"]["cells"][0][0] = "native/artwork/0/0#1"
            scenes.append(
                self.project.scenes.save(
                    loaded["id"], loaded["scene"], loaded["revision"], self.revision()
                )
            )
        candidate = self.art.edit(self.opened(), [{"x": 0, "y": 0, "rgba": [255, 0, 0, 255]}])
        before = self.snapshot()
        result = self.reviews.review(candidate, scene=self.context(scenes[0]))
        self.assertEqual(result["references"]["total"], 2)
        self.assertEqual(len(result["references"]["scenes"]), 2)
        self.assertEqual(result["references"]["locations"][0]["flags"], 1)
        _, _, pixels = png.decode(result["scene"]["after_png"], generic=True)
        self.assertEqual(pixels[7 * 4 : 8 * 4], bytes([255, 0, 0, 255]))
        self.assertEqual(png.decode(result["scene"]["before_png"], generic=True)[2], bytes(4096))
        self.assertEqual(self.snapshot(), before)
        self.art.save(candidate, receipt=result["receipt"])
        for loaded in scenes:
            self.assertEqual(self.project.scenes.load(loaded["id"])["revision"], loaded["revision"])

    def test_new_tile_in_temporary_scene_and_snapshot_binding(self):
        loaded = self.scene()
        model = copy.deepcopy(loaded["scene"])
        model["cells"][1][1] = "native/artwork/0/0#4"
        candidate = self.art.edit(self.blank(), [{"x": 1, "y": 2, "rgba": [2, 4, 6, 255]}])
        before = self.snapshot()
        result = self.reviews.review(candidate, scene=self.context(loaded, model))
        _, _, pixels = png.decode(result["scene"]["after_png"], generic=True)
        self.assertEqual(
            pixels[((8 + 1) * 32 + 8 + 2) * 4 : ((8 + 1) * 32 + 8 + 2) * 4 + 4],
            bytes([2, 4, 6, 255]),
        )
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(result["receipt"]["context"]["snapshot_revision"])
        self.art.save(candidate, receipt=result["receipt"])
        self.assertEqual(self.project.scenes.load(loaded["id"])["scene"], loaded["scene"])

    def test_sprite_origin_override_and_layer_occlusion_use_canonical_renderer(self):
        self.art.save(self.blank(kind="sprite", width=8, height=16, origin=[3, 5]))
        loaded = self.scene()
        model = copy.deepcopy(loaded["scene"])
        model["objects"] = [
            {"id": 1, "asset": "native/artwork", "x": 6, "y": 8},
            {"id": 2, "asset": "native/artwork", "x": 12, "y": 12, "origin": [0, 0]},
        ]
        model["next_object_id"] = 3
        candidate = self.art.edit(self.opened(), [{"x": 0, "y": 0, "rgba": [40, 50, 60, 127]}])
        result = self.reviews.review(candidate, scene=self.context(loaded, model))
        _, _, pixels = png.decode(result["scene"]["after_png"], generic=True)
        for x, y in ((3, 3), (12, 12)):
            self.assertEqual(
                pixels[(y * 32 + x) * 4 : (y * 32 + x) * 4 + 4], bytes([40, 50, 60, 127])
            )
        layered = {
            "width": 2,
            "height": 2,
            "grid": 8,
            "layers": [
                {
                    "id": 1,
                    "name": "Hidden",
                    "type": "objectgroup",
                    "visible": False,
                    "objects": model["objects"],
                }
            ],
            "next_layer_id": 2,
            "next_object_id": 3,
        }
        hidden = self.reviews.review(candidate, scene=self.context(loaded, layered))
        self.assertEqual(png.decode(hidden["scene"]["after_png"], generic=True)[2], bytes(4096))
        self.assertNotEqual(result["receipt"]["revision"], hidden["receipt"]["revision"])

    def test_changed_pixels_cannot_commit_with_older_review(self):
        candidate = self.blank()
        receipt = self.reviews.review(candidate)["receipt"]
        changed = self.art.edit(candidate, [{"x": 0, "y": 0, "rgba": [1, 2, 3, 255]}])
        before = self.snapshot()
        with self.assertRaisesRegex(Conflict, "Review again"):
            self.art.save(changed, receipt=receipt)
        self.assertEqual(self.snapshot(), before)

    def test_unchanged_reviewed_scene_is_guarded_before_and_at_final_commit(self):
        self.art.save(self.blank())
        loaded = self.scene()
        candidate = self.opened()
        receipt = self.reviews.review(candidate)["receipt"]
        path = self.project.root / f"scenes/{loaded['id']}.tmj"
        original = path.read_bytes()
        # Raw map changes do not change the manifest revision.
        path.write_bytes(original + b"\n")
        with self.assertRaises(Conflict):
            self.art.save(candidate, receipt=receipt)
        path.write_bytes(original)
        commit = self.project.store.commit

        def race(*args, **kwargs):
            path.write_bytes(original + b"\n")
            return commit(*args, **kwargs)

        with patch.object(self.project.store, "commit", race), self.assertRaises(Conflict):
            self.art.save(candidate, receipt=receipt)
        self.assertEqual(self.opened()["rgba"], candidate["rgba"])

    def test_drift_during_render_is_rejected(self):
        loaded = self.scene()
        candidate = self.blank()
        path = self.project.root / f"scenes/{loaded['id']}.tmj"
        original = path.read_bytes()
        render = review.rendering.render

        def race(*args, **kwargs):
            path.write_bytes(original + b"\n")
            return render(*args, **kwargs)

        with patch.object(review.rendering, "render", race), self.assertRaises(Conflict):
            self.reviews.review(candidate, scene=self.context(loaded))
        self.assertFalse((self.project.root / "assets/native").exists())

    def test_pagination_covers_saved_hidden_cells_without_claiming_full_details(self):
        self.art.save(self.blank())
        loaded = self.scene(width=32, height=32)
        loaded["scene"]["cells"] = [["native/artwork/0/0"] * 32 for _ in range(32)]
        self.project.scenes.save(loaded["id"], loaded["scene"], loaded["revision"], self.revision())
        candidate = self.opened()
        result = self.reviews.review(candidate)
        self.assertTrue(result["references"]["scan_complete"])
        self.assertFalse(result["references"]["locations_complete"])
        self.assertEqual(result["references"]["total"], 1024)
        self.assertEqual(len(result["references"]["locations"]), 256)
        second = self.reviews.review(candidate, offset=256)
        self.assertEqual(second["references"]["locations"][0]["y"], 8)
        self.assertEqual(result["receipt"], second["receipt"])

    def test_bounds_and_stale_scene_base_fail_without_writes(self):
        loaded = self.scene()
        candidate = self.blank()
        before = self.snapshot()
        for kwargs in (
            {"scale": True},
            {"scale": 17},
            {"offset": -1},
            {"scene": {**self.context(loaded), "extra": True}},
            {
                "scene": {
                    **self.context(loaded),
                    "viewport": {"x": 0, "y": 0, "width": 1025, "height": 1},
                }
            },
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.reviews.review(candidate, **kwargs)
        with self.assertRaises(Conflict):
            self.reviews.review(
                candidate, scene={**self.context(loaded), "scene_revision": "0" * 64}
            )
        with patch.object(review, "MAX_SCENES", 0), self.assertRaisesRegex(ValueError, "64 saved"):
            self.reviews.review(candidate)
        with patch.object(review, "MAX_MAP_BYTES", 1), self.assertRaisesRegex(ValueError, "16 MiB"):
            self.reviews.review(candidate)
        self.assertEqual(self.snapshot(), before)

    def test_map_budget_counts_captured_bytes_and_accepts_exact_limit(self):
        self.scene()
        self.scene()
        candidate = self.blank()
        before = self.snapshot()
        total = sum(len(data) for path, data in before.items() if path.startswith("scenes/"))
        with patch.object(review, "MAX_MAP_BYTES", total):
            self.assertTrue(self.reviews.review(candidate)["receipt"])
        with (
            patch.object(review, "MAX_MAP_BYTES", total - 1),
            patch.object(tiled, "decode", wraps=tiled.decode) as decode,
            self.assertRaisesRegex(ValueError, "16 MiB"),
        ):
            self.reviews.review(candidate)
        self.assertEqual(decode.call_count, 1)
        self.assertEqual(self.snapshot(), before)

    def test_maps_growing_during_scan_reject_before_decoding_over_budget_map(self):
        for _ in range(5):
            self.scene()
        candidate = self.blank()
        original = copy.deepcopy(candidate)
        expected = self.snapshot()
        load = self.project.store._load_scene

        def grow_before_load(scene_id, document=None, **kwargs):
            entry = next(s for s in document["scenes"] if s["id"] == scene_id)
            path = self.project.root / entry["path"]
            data = path.read_bytes().ljust(3_600_000, b"\n")
            path.write_bytes(data)
            expected[entry["path"]] = data
            return load(scene_id, document, **kwargs)

        with (
            patch.object(self.project.store, "_load_scene", side_effect=grow_before_load),
            patch.object(tiled, "decode", wraps=tiled.decode) as decode,
            self.assertRaisesRegex(ValueError, "16 MiB"),
        ):
            self.reviews.review(candidate)
        self.assertEqual(decode.call_count, 4)
        self.assertEqual(self.snapshot(), expected)
        self.assertEqual(candidate, original)

    def test_receipt_missing_scene_guards_and_invalid_candidate_policies_rejected(self):
        self.scene()
        candidate = self.blank()
        receipt = self.reviews.review(candidate)["receipt"]
        body = {k: v for k, v in receipt.items() if k != "revision"}
        body["scene_revisions"] = {}
        with self.assertRaisesRegex(ValueError, "every scanned"):
            self.art.save(candidate, receipt=review.sealed(body))
        changed = {k: copy.deepcopy(v) for k, v in candidate.items() if k != "revision"}
        changed["metadata"] = {
            "8": {
                "native/artwork/0/0": {
                    "terrain": "",
                    "solid": True,
                    "shapes": [],
                    "next_shape_id": 1,
                }
            }
        }
        with self.assertRaisesRegex(ValueError, "Blank creation"):
            self.reviews.review(editable.seal(changed))

    def test_stamps_and_sprite_definitions_are_project_owned_references(self):
        self.art.save(self.blank(kind="sprite"))
        loaded = self.scene()
        model = copy.deepcopy(loaded["scene"])
        model["objects"] = [{"id": 1, "asset": "native/artwork", "x": 1, "y": 1}]
        model["next_object_id"] = 2
        self.project.objects.save_stamp("Sprite stamp", model, [0, 0], self.revision())
        self.project.objects.save_definition(
            {
                "name": "Sprite definition",
                "kind": "sprite",
                "asset": "native/artwork",
                "fields": [],
            },
            self.revision(),
        )
        candidate = self.opened()
        result = self.reviews.review(candidate)
        self.assertEqual(result["references"]["total"], 2)
        self.assertEqual(
            {p["kind"] for p in result["references"]["locations"]}, {"stamp", "definition"}
        )
        self.assertEqual(result["references"]["scenes"], [])
        self.project.objects.save_definition(
            {
                "name": "Another definition",
                "kind": "sprite",
                "asset": "native/artwork",
                "fields": [],
            },
            self.revision(),
        )
        with self.assertRaises(Conflict):
            self.art.save(candidate, receipt=result["receipt"])

    def test_all_tile_transform_flags_and_layer_order(self):
        self.art.save(self.blank())
        loaded = self.scene(width=8, height=2)
        model = copy.deepcopy(loaded["scene"])
        model["cells"][0] = ["native/artwork/0/0" + (f"#{f}" if f else "") for f in range(8)]
        candidate = self.art.edit(self.opened(), [{"x": 1, "y": 2, "rgba": [1, 2, 3, 255]}])
        context = self.context(loaded, model)
        context["viewport"]["width"] = 64
        result = self.reviews.review(candidate, scene=context)
        _, _, pixels = png.decode(result["scene"]["after_png"], generic=True)
        # Forward diagonal swap followed by horizontal and vertical mirroring.
        for flags in range(8):
            x, y = (2, 1) if flags & 4 else (1, 2)
            if flags & 1:
                x = 7 - x
            if flags & 2:
                y = 7 - y
            start = (y * 64 + flags * 8 + x) * 4
            self.assertEqual(pixels[start : start + 4], bytes([1, 2, 3, 255]))
        layered = {
            "width": 8,
            "height": 2,
            "grid": 8,
            "layers": [
                {
                    "id": 1,
                    "name": "Lower",
                    "type": "tilelayer",
                    "visible": True,
                    "cells": model["cells"],
                },
                {
                    "id": 2,
                    "name": "Upper",
                    "type": "tilelayer",
                    "visible": True,
                    "cells": model["cells"],
                },
            ],
            "next_layer_id": 3,
            "next_object_id": 1,
        }
        semi = self.art.edit(candidate, [{"x": 1, "y": 2, "rgba": [1, 2, 3, 127]}])
        context["scene"] = layered
        output = self.reviews.review(semi, scene=context)
        _, _, pixels = png.decode(output["scene"]["after_png"], generic=True)
        self.assertEqual(pixels[(2 * 64 + 1) * 4 + 3], 191)

    def test_existing_asset_drift_and_render_work_limits_reject_without_writes(self):
        self.art.save(self.blank())
        loaded = self.scene()
        candidate = self.opened()
        model = copy.deepcopy(loaded["scene"])
        model["cells"][0][0] = "native/artwork/0/0"
        before = self.snapshot()
        with (
            patch.object(review.rendering, "MAX_WORK", 1),
            self.assertRaisesRegex(ValueError, "composited pixels"),
        ):
            self.reviews.review(candidate, scene=self.context(loaded, model))
        with (
            patch.object(review.rendering, "MAX_SOURCE_PIXELS", 1),
            self.assertRaisesRegex(ValueError, "source pixels"),
        ):
            self.reviews.review(candidate, scene=self.context(loaded, model))
        self.assertEqual(self.snapshot(), before)
        path = self.project.root / "assets/native/atlas.png"
        path.write_bytes(b"drift")
        with self.assertRaises(Conflict):
            self.reviews.review(candidate)

    def test_large_isolated_output_is_bounded_before_allocating(self):
        candidate = self.blank(kind="sprite", width=256, height=256)
        with self.assertRaisesRegex(ValueError, "1024 pixels"):
            self.reviews.review(candidate, scale=5)

    def test_duplicate_candidate_and_busy_reads_preserve_unsaved_work(self):
        self.art.save(self.blank())
        source = self.opened()
        candidate = self.art.duplicate(
            {
                "atlas_id": "native",
                "region": "artwork",
                "grid": 8,
                "cell": [0, 0],
                "artwork_revision": source["artwork_revision"],
            },
            "variation",
            "Variation",
            self.revision(),
        )
        result = self.reviews.review(candidate)
        self.assertIsNone(result["before"])
        self.assertEqual(result["references"]["total"], 0)
        from gbc_scene_forge.core.errors import TransactionBusy

        with patch.object(self.project.store, "read_session", side_effect=TransactionBusy("busy")):
            with self.assertRaises(TransactionBusy):
                self.reviews.review(candidate)
        self.art.save(candidate, receipt=result["receipt"])

    def test_new_artwork_reencoding_cannot_replace_original_review_guards(self):
        from gbc_scene_forge.artwork import documents

        loaded = self.scene()
        candidate = self.blank()
        receipt = self.reviews.review(candidate)["receipt"]
        path = self.project.root / f"scenes/{loaded['id']}.tmj"
        original = path.read_bytes()
        check = documents.check_receipt

        def race(*args, **kwargs):
            expected = check(*args, **kwargs)
            path.write_bytes(original + b"\n")
            return expected

        with patch.object(documents, "check_receipt", race), self.assertRaises(Conflict):
            self.art.save(candidate, receipt=receipt)
        self.assertFalse((self.project.root / "assets/native").exists())
        self.assertEqual(path.read_bytes(), original + b"\n")
