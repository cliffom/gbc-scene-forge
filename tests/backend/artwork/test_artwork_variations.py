"""Atomic selected-placement variations, immutable review and recoverable conflicts."""

import copy
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from gbc_scene_forge.artwork import editable, png
from gbc_scene_forge.artwork.drafts import ArtworkDrafts
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project


class ArtworkVariationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Variations")
        self.art = self.project.artwork.documents
        for atlas_id, kind in (("ground", "tile"), ("actor", "sprite")):
            candidate = self.art.create(
                atlas_id,
                atlas_id.title(),
                kind,
                8,
                8,
                self.revision(),
                origin=[3, 5] if kind == "sprite" else None,
            )
            self.art.save(self.art.edit(candidate, [{"x": 1, "y": 2, "rgba": [10, 20, 30, 255]}]))
        self.project.artwork.set_metadata(
            "ground",
            "8",
            "ground/artwork/0/0",
            {
                "terrain": "grass",
                "solid": True,
                "shapes": [],
                "next_shape_id": 1,
            },
            self.revision(),
        )
        self.scenes = []
        for _ in range(2):
            loaded = self.project.scenes.create("Shared", 8, 4, 8, self.revision())
            model = loaded["scene"]
            model["cells"][0] = ["ground/artwork/0/0" + (f"#{f}" if f else "") for f in range(8)]
            model["objects"] = [
                {
                    "id": i,
                    "asset": "actor/artwork",
                    "x": i * 10,
                    "y": 14,
                    "origin": [2, 4],
                    "name": f"Actor {i}",
                    "class": "prop",
                    "properties": [{"name": "rank", "type": "int", "value": i}],
                }
                for i in (1, 2)
            ]
            model["next_object_id"] = 3
            self.scenes.append(
                self.project.scenes.save(loaded["id"], model, loaded["revision"], self.revision())
            )

    def revision(self):
        return self.project.catalog()["revision"]

    def snapshot(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file() and not str(p.relative_to(self.project.root)).startswith(".forge/")
        }

    def location(self, scene=0, **kwargs):
        return {
            "scene_id": self.scenes[scene]["id"],
            "scene_revision": self.scenes[scene]["revision"],
            "layer_id": 2 if "object_id" in kwargs else 1,
            **kwargs,
        }

    def variation(self, *, sprite=False, placements=None):
        entry = self.project.catalog()["project"]["atlases"]["actor" if sprite else "ground"]
        document, _ = self.project.store.read()
        source = {
            "atlas_id": "actor" if sprite else "ground",
            "region": "artwork",
            "grid": None if sprite else 8,
            "cell": None if sprite else [0, 0],
            "artwork_revision": editable.artwork_revision(entry, document["files"]),
        }
        return self.art.duplicate(
            source,
            "variation",
            "Variation",
            self.revision(),
            placements=placements
            or [self.location(object_id=1) if sprite else self.location(x=0, y=0)],
        )

    def context(self, scene=0):
        return {
            "scene_id": self.scenes[scene]["id"],
            "scene_revision": self.scenes[scene]["revision"],
            "scene": None,
            "viewport": {"x": 0, "y": 0, "width": 64, "height": 32},
        }

    def test_selected_tiles_all_transforms_metadata_export_and_original_unchanged(self):
        original = self.snapshot()
        selections = [self.location(x=x, y=0) for x in range(8)]
        candidate = self.variation(placements=selections)
        candidate = self.art.edit(candidate, [{"x": 1, "y": 2, "rgba": [200, 80, 50, 255]}])
        report = self.project.artwork.reviews.review(candidate, scene=self.context())
        self.assertEqual(self.snapshot(), original)
        self.assertEqual(report["replacements"], selections)
        self.assertEqual(report["references"]["total"], 16)
        self.assertNotEqual(report["scene"]["before_png"], report["scene"]["after_png"])
        ack = self.art.save(candidate, receipt=report["receipt"])
        self.assertEqual(ack["replaced_scenes"], [self.scenes[0]["id"]])
        model = self.project.scenes.load(self.scenes[0]["id"])["scene"]
        for flags, cell in enumerate(tiled.scene_layers(model)[0]["cells"][0]):
            self.assertEqual(cell, "variation/artwork/0/0" + (f"#{flags}" if flags else ""))
        self.assertEqual(
            self.project.scenes.load(self.scenes[1]["id"])["scene"], self.scenes[1]["scene"]
        )
        entry = self.project.store.read()[0]["atlases"]["variation"]
        self.assertEqual(entry["metadata"]["8"]["variation/artwork/0/0"]["terrain"], "grass")
        for path, data in original.items():
            if path.startswith("assets/ground/") or path.startswith("assets/actor/"):
                self.assertEqual((self.project.root / path).read_bytes(), data)
        archive, _ = self.project.export_bundle("project", self.revision())
        destination = self.root / "exported"
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            bundle.extractall(destination)
        reopened = Project(destination)
        self.assertEqual(reopened.scenes.load(self.scenes[0]["id"])["scene"], model)
        self.assertEqual(
            png.decode((destination / "assets/variation/atlas.png").read_bytes())[2],
            editable.check_candidate(candidate),
        )

    def test_sprite_selected_across_scenes_preserves_properties_origins_and_original(self):
        selections = [self.location(i, object_id=1) for i in range(2)]
        candidate = self.variation(sprite=True, placements=selections)
        self.assertEqual(candidate["descriptor"]["origin"], [3, 5])
        report = self.project.artwork.reviews.review(candidate, scene=self.context())
        self.assertEqual(report["references"]["total"], 4)
        self.art.save(candidate, receipt=report["receipt"])
        for before in self.scenes:
            expected = copy.deepcopy(before["scene"])
            tiled.scene_layers(expected)[1]["objects"][0]["asset"] = "variation/artwork"
            self.assertEqual(self.project.scenes.load(before["id"])["scene"], expected)

    def test_sprite_stamps_and_definitions_are_reported_but_remain_original(self):
        self.project.objects.save_stamp(
            "Lantern stamp", self.scenes[0]["scene"], [0, 0], self.revision()
        )
        self.project.objects.save_definition(
            {"name": "Lantern", "kind": "sprite", "asset": "actor/artwork", "fields": []},
            self.revision(),
        )
        before = self.project.store.read()[0]
        candidate = self.variation(sprite=True)
        report = self.project.artwork.reviews.review(candidate)
        self.assertEqual(report["references"]["total"], 7)
        self.assertEqual(
            {p["kind"] for p in report["references"]["locations"]}, {"scene", "stamp", "definition"}
        )
        self.art.save(candidate, receipt=report["receipt"])
        after = self.project.store.read()[0]
        self.assertEqual(after["stamps"], before["stamps"])
        self.assertEqual(after["object_definitions"], before["object_definitions"])

    def test_stale_selection_and_changed_review_reject_without_partial_writes(self):
        candidate = self.variation()
        report = self.project.artwork.reviews.review(candidate)
        changed = {k: v for k, v in candidate.items() if k != "revision"}
        changed["placements"] = [self.location(x=1, y=0)]
        with self.assertRaises(Conflict):
            self.art.save(editable.seal(changed), receipt=report["receipt"])
        path = self.project.root / f"scenes/{self.scenes[0]['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        before = self.snapshot()
        for call in (
            lambda: self.project.artwork.reviews.review(candidate),
            lambda: self.art.save(candidate, receipt=report["receipt"]),
        ):
            with self.assertRaises(Conflict):
                call()
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.project.root / "assets/variation").exists())

    def test_invalid_mixed_duplicate_and_oversized_selections_rejected(self):
        before = self.snapshot()
        for locations in (
            [self.location(x=0, y=0)] * 2,
            [self.location(x=0, y=1)],
            [self.location(x=8, y=0)],
            [self.location(object_id=1)],
            [self.location(x=True, y=0)],
            [self.location(x=0, y=0)] * 257,
        ):
            with self.subTest(locations=locations[:2]), self.assertRaises(ValueError):
                self.variation(placements=locations)
        self.assertEqual(self.snapshot(), before)

    def test_final_transaction_scene_race_never_replaces_external_edit(self):
        candidate = self.variation()
        receipt = self.project.artwork.reviews.review(candidate)["receipt"]
        path = self.project.root / f"scenes/{self.scenes[0]['id']}.tmj"
        original = path.read_bytes()
        commit = self.project.store.commit

        def race(*args, **kwargs):
            path.write_bytes(original + b"\n")
            return commit(*args, **kwargs)

        with patch.object(self.project.store, "commit", race), self.assertRaises(Conflict):
            self.art.save(candidate, receipt=receipt)
        self.assertEqual(path.read_bytes(), original + b"\n")
        self.assertFalse((self.project.root / "assets/variation").exists())

    def test_variation_requires_review_and_recovers_with_exact_selection(self):
        candidate = self.variation()
        with self.assertRaisesRegex(ValueError, "Review selected"):
            self.art.save(candidate)
        drafts = ArtworkDrafts(self.art)
        draft_id, owner = str(uuid4()), str(uuid4())
        ack = drafts.write(
            {
                "id": draft_id,
                "owner": owner,
                "revision": None,
                "project_id": candidate["project_id"],
                "name": "Variation",
                "original": candidate,
                "candidate": candidate,
            }
        )
        self.assertEqual(drafts.restore(draft_id, ack["revision"])["candidate"], candidate)
        plain = editable.seal(
            {k: v for k, v in candidate.items() if k not in {"placements", "revision"}}
        )
        for original, changed in ((plain, candidate), (candidate, plain)):
            with self.subTest(optional_selection="placements" in original):
                with self.assertRaisesRegex(ValueError, "retain its original"):
                    drafts.write(
                        {
                            "id": str(uuid4()),
                            "owner": owner,
                            "revision": None,
                            "project_id": candidate["project_id"],
                            "name": "Changed selection",
                            "original": original,
                            "candidate": changed,
                        }
                    )
        path = self.project.root / f"scenes/{self.scenes[0]['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaises(Conflict):
            drafts.restore(draft_id, ack["revision"])
        self.assertEqual(drafts.download(draft_id, ack["revision"])["candidate"], candidate)

    def test_write_failure_rolls_back_artwork_and_selected_maps_together(self):
        from gbc_scene_forge.storage import transactions

        candidate = self.variation()
        receipt = self.project.artwork.reviews.review(candidate)["receipt"]
        before = self.snapshot()
        write = transactions.atomic_write
        failed = False

        def fail_once(path, data):
            nonlocal failed
            if path == self.project.root / f"scenes/{self.scenes[0]['id']}.tmj" and not failed:
                failed = True
                raise OSError("injected map write failure")
            return write(path, data)

        with patch.object(transactions, "atomic_write", fail_once), self.assertRaises(OSError):
            self.art.save(candidate, receipt=receipt)
        self.assertTrue(failed)
        Project(self.project.root)
        self.assertEqual(self.snapshot(), before)
        self.art.save(candidate, receipt=receipt)
