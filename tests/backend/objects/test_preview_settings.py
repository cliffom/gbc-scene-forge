"""Durable preview preferences and read-only native animation export."""

import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from support.atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import exporting
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.scene_objects import preview as preview_settings
from gbc_scene_forge.storage import transactions
from gbc_scene_forge.storage.files import digest


class PreviewSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = Project.create(self.root / "world", "Preview")
        self.path, self.manifest = sprite_bundle(self.root / "actors")
        self.manifest["regions"].append({**self.manifest["regions"][0], "name": "step"})
        self.manifest["animations"] = [
            {
                "name": "idle",
                "frames": [{"region": "idle"}, {"region": "step", "duration_ms": 240}],
            },
            {
                "name": "walk",
                "frames": [
                    {"region": "step", "duration_ms": 80},
                    {"region": "idle", "duration_ms": 80},
                ],
            },
        ]
        self.path.write_text(json.dumps(self.manifest))
        self.project.artwork.import_atlas(self.path, self.revision())
        self.settings = preview_settings.defaults()
        self.settings.update(playback_speed=2, movement_speed=64, check_collisions=True)
        self.settings["mappings"] = {"actors/idle": {"idle:down": "idle", "walk:left": "walk"}}
        self.settings["selections"] = {
            "actors/idle": {"action": "walk", "direction": "left", "sequence": "idle"}
        }

    def revision(self):
        return self.project.catalog()["revision"]

    def test_settings_reopen_without_rewriting_scenes_or_assets_and_conflict(self):
        loaded = self.project.scenes.create("Room", 7, 5, 8, self.revision())
        before = self.project.scenes.load(loaded["id"])
        files = self.project.catalog()["project"]["files"]
        revision = self.revision()
        self.project.objects.save_preview(self.settings, revision)
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog()["project"]["preview"]["sprite"], self.settings)
        self.assertEqual(reopened.scenes.load(loaded["id"]), before)
        self.assertEqual(reopened.catalog()["project"]["files"], files)
        with self.assertRaises(Conflict):
            self.project.objects.save_preview(self.settings, revision)
        self.assertEqual(self.project.catalog()["project"]["preview"]["sprite"], self.settings)

    def test_interrupted_settings_save_recovers_previous_preferences(self):
        before = self.project.catalog()
        original = transactions.atomic_write

        def fail_after_manifest(path, data):
            original(path, data)
            if path == self.project.root / MANIFEST:
                raise OSError("interrupted after settings manifest")

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_after_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.objects.save_preview(self.settings, before["revision"])
        self.assertEqual(Project(self.project.root).catalog(), before)

    def test_grid_split_animations_keep_ids_after_reordering_regions(self):
        path, manifest = bundle(self.root / "terrain")
        for region in manifest["regions"]:
            region.update(x=0, width=16)
        path.write_text(json.dumps(manifest))
        self.project.artwork.import_atlas(path, self.revision())
        manifest["regions"].reverse()
        path.write_text(json.dumps(manifest))
        self.project.artwork.import_atlas(path, self.revision(), reimport=True)
        payload, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            tileset = json.loads(archive.read("assets/terrain/grid-8.tsj"))
            report = json.loads(archive.read("export.json"))
        tiles = {tile["id"]: tile for tile in tileset["tiles"]}
        self.assertEqual(
            tiles[0]["animation"], [{"tileid": 0, "duration": 100}, {"tileid": 2, "duration": 200}]
        )
        self.assertEqual(
            tiles[1]["animation"], [{"tileid": 1, "duration": 100}, {"tileid": 3, "duration": 200}]
        )
        self.assertEqual(
            report["animations"]["assets/terrain/grid-16.tsj"][0]["reason"], "incompatible grid"
        )

    def test_invalid_preferences_and_transient_fields_are_rejected_without_writes(self):
        invalid = [
            {"playback_speed": True},
            {"movement_speed": float("nan")},
            {"movement_speed": 10**1000},
            {"check_collisions": 1},
            {"footprint": {"x": 0, "y": 0, "width": 0, "height": 8}},
            {"position": {"x": 10, "y": 20}},
            {"frame": 2},
            {"playing": True},
            {"mappings": {"actors/missing": {"idle:down": "idle"}}},
            {"mappings": {"actors/idle": {"idle:down": "missing"}}},
            {"mappings": {"actors/idle": {"run:north": "idle"}}},
        ]
        before = (self.project.root / MANIFEST).read_bytes()
        for invalid_patch in invalid:
            with self.subTest(patch=invalid_patch), self.assertRaises(ValueError):
                self.project.objects.save_preview(
                    {**self.settings, **invalid_patch}, self.revision()
                )
            self.assertEqual((self.project.root / MANIFEST).read_bytes(), before)

    def test_reimport_and_atlas_deletion_prune_obsolete_settings(self):
        self.project.objects.save_preview(self.settings, self.revision())
        self.manifest["animations"] = self.manifest["animations"][:1]
        self.path.write_text(json.dumps(self.manifest))
        self.project.artwork.import_atlas(self.path, self.revision(), reimport=True)
        settings = self.project.catalog()["project"]["preview"]["sprite"]
        self.assertEqual(settings["mappings"], {"actors/idle": {"idle:down": "idle"}})
        self.project.artwork.delete_atlas("actors", self.revision())
        settings = self.project.catalog()["project"]["preview"]["sprite"]
        self.assertEqual(settings["mappings"], {})
        self.assertEqual(settings["selections"], {})

    def test_export_keeps_original_timing_and_local_ids_and_reopens_portably(self):
        path, _ = bundle(self.root / "terrain")
        self.project.artwork.import_atlas(path, self.revision())
        self.project.objects.save_preview(self.settings, self.revision())
        before = {p: p.read_bytes() for p in self.project.root.rglob("*") if p.is_file()}
        payload, _ = self.project.export_bundle("project", self.revision())
        self.assertEqual(payload, self.project.export_bundle("project", self.revision())[0])
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
            destination = self.root / "exported"
            archive.extractall(destination)
        sprite = json.loads(files["assets/actors/sprites.tsj"])
        self.assertEqual(
            sprite["tiles"][0]["animation"],
            [{"tileid": 0, "duration": 120}, {"tileid": 1, "duration": 240}],
        )
        self.assertEqual(
            sprite["tiles"][1]["animation"],
            [{"tileid": 1, "duration": 80}, {"tileid": 0, "duration": 80}],
        )
        terrain = json.loads(files["assets/terrain/grid-8.tsj"])
        self.assertEqual(
            terrain["tiles"][0]["animation"],
            [{"tileid": 0, "duration": 100}, {"tileid": 1, "duration": 200}],
        )
        report = json.loads(files["export.json"])
        self.assertTrue(
            all(
                item["status"] == "exported"
                for item in report["animations"]["assets/actors/sprites.tsj"]
            )
        )
        reopened = Project(destination)
        self.assertEqual(reopened.catalog()["project"]["preview"]["sprite"], self.settings)
        for path, expected in reopened.catalog()["project"]["files"].items():
            self.assertEqual(digest(files[path]), expected)
        reopened.scenes.create("Room", 2, 2, 8, reopened.catalog()["revision"])
        self.assertEqual(
            {p: p.read_bytes() for p in self.project.root.rglob("*") if p.is_file()}, before
        )

    def test_shared_starting_tile_is_reported_instead_of_choosing_a_sequence(self):
        self.manifest["animations"][1]["frames"][0]["region"] = "idle"
        self.path.write_text(json.dumps(self.manifest))
        self.project.artwork.import_atlas(self.path, self.revision(), reimport=True)
        payload, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            sprite = json.loads(archive.read("assets/actors/sprites.tsj"))
            report = json.loads(archive.read("export.json"))
        self.assertNotIn("animation", sprite["tiles"][0])
        entries = report["animations"]["assets/actors/sprites.tsj"]
        self.assertEqual({item["name"] for item in entries}, {"idle", "walk"})
        self.assertTrue(all(item["reason"] == "shared starting tile" for item in entries))

    def test_invalid_native_animation_dependencies_are_rejected(self):
        tileset = {
            "type": "tileset",
            "version": "1.10",
            "columns": 0,
            "tilecount": 1,
            "tiles": [
                {
                    "id": 0,
                    "image": "0.png",
                    "imagewidth": 8,
                    "imageheight": 8,
                    "animation": [{"tileid": 1, "duration": 100}],
                }
            ],
        }
        for invalid_frame in (
            {"tileid": 1, "duration": 100},
            {"tileid": 0, "duration": 0},
            {"tileid": True, "duration": 100},
        ):
            value = copy.deepcopy(tileset)
            value["tiles"][0]["animation"] = [invalid_frame]
            with self.assertRaisesRegex(ValueError, "animation frame"):
                exporting.tileset_images(value, "assets/actors/sprites.tsj")
