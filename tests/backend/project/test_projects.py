"""Standalone workflows, portable Tiled files, invalid inputs and durable recovery."""

import base64
import copy
import io
import json
import shutil
import tempfile
import threading
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from support.atlas_fixture import bundle, image, sprite_bundle

from gbc_scene_forge.adapters.http.server import make_handler
from gbc_scene_forge.artwork import atlas, png
from gbc_scene_forge.artwork.atlas import load_bundle
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.scene_objects import preview as preview_settings
from gbc_scene_forge.storage import transactions


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.project = Project.create(self.folder / "world", "My world")
        self.path, self.manifest = bundle(self.folder / "input")

    def revision(self):
        return self.project.catalog()["revision"]

    def import_atlas(self, **kwargs):
        return self.project.artwork.import_atlas(self.path, self.revision(), **kwargs)

    def write_manifest(self):
        self.path.write_text(json.dumps(self.manifest))

    def scene(self, title="Village", grid=8):
        return self.project.scenes.create(title, 7, 5, grid, self.revision())

    def test_ordered_layers_survive_save_reopen_and_atlas_rewrites(self):
        self.import_atlas()
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        loaded = self.scene()
        cells = loaded["scene"]["cells"]
        cells[1][1] = "terrain/earth/0/0"
        scene = {
            "width": 7,
            "height": 5,
            "grid": 8,
            "next_object_id": 10,
            "next_layer_id": 12,
            "layers": [
                {
                    "id": 4,
                    "name": "Behind",
                    "type": "objectgroup",
                    "visible": True,
                    "objects": [{"id": 3, "asset": "actors/idle", "x": 32, "y": 24}],
                },
                {"id": 8, "name": "Canopy", "type": "tilelayer", "visible": False, "cells": cells},
                {
                    "id": 11,
                    "name": "Empty objects",
                    "type": "objectgroup",
                    "visible": False,
                    "objects": [],
                },
            ],
        }
        saved = self.project.scenes.save(loaded["id"], scene, loaded["revision"], self.revision())
        self.assertEqual(saved["scene"], scene)
        self.assertEqual(Project(self.project.root).scenes.load(loaded["id"])["scene"], scene)
        document = json.loads((self.project.root / f"scenes/{loaded['id']}.tmj").read_text())
        self.assertEqual([layer["id"] for layer in document["layers"]], [4, 8, 11])
        self.assertFalse(document["layers"][1]["visible"])
        self.assertEqual(document["nextlayerid"], 12)
        self.assertEqual(document["layers"][0]["objects"][0]["y"], 33)
        # Hidden and non-ground layers protect their dependencies from deletion.
        for atlas_id in ("terrain", "actors"):
            with self.assertRaisesRegex(ValueError, "Village"):
                self.project.artwork.delete_atlas(atlas_id, self.revision())
        self.project.artwork.import_atlas(self.path, self.revision(), reimport=True)
        self.assertEqual(self.project.scenes.load(loaded["id"])["scene"], scene)
        # Duplicate IDs, unsupported fields and transforms must never be dropped.
        variants = []
        for update in (
            {"opacity": 0.5},
            {"offsetx": 2},
            {"properties": []},
            {"type": "group"},
            {"id": 4},
            {"visible": 1},
            {"name": ""},
        ):
            variant = copy.deepcopy(document)
            variant["layers"][1].update(update)
            variants.append(variant)
        variant = copy.deepcopy(document)
        variant["layers"][2]["objects"] = copy.deepcopy(variant["layers"][0]["objects"])
        variants.append(variant)
        variants.append(dict(document, nextlayerid=8))
        for variant in variants:
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                tiled.decode(variant, self.project.catalog()["project"])
        # An object-only scene and empty layers also round trip.
        scene["layers"] = [scene["layers"][2]]
        self.assertEqual(
            tiled.decode(
                tiled.encode(scene, self.project.catalog()["project"]),
                self.project.catalog()["project"],
            ),
            scene,
        )

    def test_full_workflow_two_scenes_and_move(self):
        self.import_atlas()
        first, second = self.scene(), self.scene("River")
        first["scene"]["cells"][1][2] = "terrain/earth/0/0"
        saved = self.project.scenes.save(
            first["id"], first["scene"], first["revision"], self.revision()
        )
        self.assertEqual(saved.pop("project_revision"), self.revision())
        self.assertEqual(self.project.scenes.load(second["id"])["scene"]["cells"][1][2], "")
        target = self.folder / "moved"
        shutil.move(str(self.project.root), target)
        shutil.rmtree(self.path.parent)
        reopened = Project(target)
        self.assertEqual(reopened.scenes.load(first["id"]), saved)
        catalog = reopened.catalog()["project"]
        self.assertEqual(catalog["name"], "My world")
        self.assertEqual(len(catalog["scenes"]), 2)
        for path in catalog["files"]:
            self.assertTrue((target / path).is_file())
        document = json.loads((target / f"scenes/{first['id']}.tmj").read_text())
        self.assertEqual(document["layers"][0]["data"][9], 1)
        source = document["tilesets"][0]
        tsj_path = target / "scenes" / source["source"]
        tileset = json.loads(tsj_path.read_text())
        self.assertEqual(tileset["tiles"][0]["properties"][0]["value"], "terrain/earth/0/0")
        self.assertTrue((tsj_path.parent / tileset["tiles"][0]["image"]).is_file())

    def test_reimport_preserves_ids_and_reports_metadata_and_pixels(self):
        self.import_atlas()
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "terrain/stone/0/0"
        self.project.scenes.save(scene["id"], scene["scene"], scene["revision"], self.revision())
        old = copy.deepcopy(self.project.catalog()["project"]["atlases"])
        self.assertFalse(self.import_atlas(reimport=True)["artwork_changed"])
        self.assertEqual(self.project.catalog()["project"]["atlases"], old)
        self.manifest["regions"][0]["origin"] = [2, 3]
        self.manifest["regions"][1]["origin"] = [2, 3]
        self.manifest["regions"].reverse()
        self.write_manifest()
        (self.path.parent / "atlas.png").write_bytes(image(rgb=(255, 255, 255)))
        report = self.import_atlas(reimport=True)
        self.assertEqual(report["changed"], ["earth", "stone"])
        self.assertTrue(report["artwork_changed"])
        self.assertTrue(report["metadata_changed"])
        self.assertEqual(
            self.project.catalog()["project"]["atlases"]["terrain"]["tiles"],
            old["terrain"]["tiles"],
        )
        self.assertEqual(
            self.project.scenes.load(scene["id"])["scene"]["cells"][0][0], "terrain/stone/0/0"
        )
        with self.assertRaisesRegex(ValueError, "explicit reimport"):
            self.import_atlas()

    def test_scene_read_cannot_mix_reimported_map_with_old_sprite_origin(self):
        path, manifest = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        scene = self.scene()
        scene["scene"]["objects"] = [{"id": 1, "asset": "actors/idle", "x": 32, "y": 24}]
        scene["scene"]["next_object_id"] = 2
        saved = self.project.scenes.save(
            scene["id"], scene["scene"], scene["revision"], self.revision()
        )
        manifest["regions"][0]["origin"] = [7, 20]
        path.write_text(json.dumps(manifest))
        target = self.project.root / f"scenes/{scene['id']}.tmj"
        original = transactions.atomic_write
        observed = []

        def read_during_write(file, data):
            original(file, data)
            if file == target:
                try:
                    observed.append(self.project.scenes.load(scene["id"])["scene"]["objects"])
                except ValueError:
                    observed.append("blocked")

        with patch.object(transactions, "atomic_write", side_effect=read_during_write):
            self.project.artwork.import_atlas(path, self.revision(), reimport=True)
        self.assertEqual(observed, ["blocked"])
        self.assertEqual(
            self.project.scenes.load(scene["id"])["scene"]["objects"], saved["scene"]["objects"]
        )

    def test_save_acknowledges_its_own_bytes_even_if_an_external_edit_follows(self):
        self.import_atlas()
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        target = self.project.root / f"scenes/{scene['id']}.tmj"
        commit = self.project.store.commit
        expected_project_revision = self.revision()

        def external_edit_after_commit(*args):
            commit(*args)
            document = json.loads(target.read_bytes())
            document["layers"][0]["data"][0] = 2
            target.write_text(json.dumps(document))
            manifest = self.project.root / MANIFEST
            value = json.loads(manifest.read_bytes())
            value["name"] = "Renamed externally"
            manifest.write_text(json.dumps(value))

        with patch.object(self.project.store, "commit", side_effect=external_edit_after_commit):
            result = self.project.scenes.save(
                scene["id"], scene["scene"], scene["revision"], self.revision()
            )
        self.assertEqual(result["project_revision"], expected_project_revision)
        self.assertNotEqual(result["project_revision"], self.revision())
        self.assertEqual(result["scene"]["cells"][0][0], "terrain/earth/0/0")
        self.assertEqual(
            self.project.scenes.load(scene["id"])["scene"]["cells"][0][0], "terrain/stone/0/0"
        )
        with self.assertRaises(Conflict):
            self.project.scenes.save(
                scene["id"], result["scene"], result["revision"], self.revision()
            )

    def test_asset_reads_reject_stale_catalogs_and_external_changes(self):
        self.import_atlas()
        revision = self.revision()
        data = self.project.artwork.asset("assets/terrain/atlas.png", revision)
        self.scene()
        with self.assertRaises(Conflict):
            self.project.artwork.asset("assets/terrain/atlas.png", revision)
        path = self.project.root / "assets/terrain/atlas.png"
        path.write_bytes(b"external edit")
        with self.assertRaises(Conflict):
            self.project.artwork.asset("assets/terrain/atlas.png", self.revision())
        self.assertNotEqual(path.read_bytes(), data)

    def test_added_regions_rewrite_gid_ranges_without_changing_other_atlas_placements(self):
        self.import_atlas()
        other, _ = bundle(self.folder / "other", "water")
        self.project.artwork.import_atlas(other, self.revision())
        scene = self.scene()
        scene["scene"]["cells"][0][:2] = ["terrain/stone/0/0", "water/earth/0/0"]
        self.project.scenes.save(scene["id"], scene["scene"], scene["revision"], self.revision())
        # Overlapping same-kind regions are legal and receive independent stable identities.
        self.manifest["regions"].append(dict(self.manifest["regions"][0], name="grass"))
        self.write_manifest()
        self.assertEqual(self.import_atlas(reimport=True)["added"], ["grass"])
        reopened = self.project.scenes.load(scene["id"])
        self.assertEqual(reopened["scene"]["cells"][0][:2], scene["scene"]["cells"][0][:2])
        self.assertEqual(
            self.project.catalog()["project"]["atlases"]["terrain"]["tiles"]["8"][
                "terrain/grass/0/0"
            ],
            2,
        )

    def test_incompatible_reimport_changes_nothing(self):
        self.import_atlas()
        before = self.project.catalog()
        self.manifest["regions"] = [dict(self.manifest["regions"][0], width=16)]
        self.manifest["animations"] = []
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "Incompatible reimport"):
            self.import_atlas(reimport=True)
        self.assertEqual(self.project.catalog(), before)

    def test_large_stamps_and_grid_sizes(self):
        self.manifest["regions"] = [dict(self.manifest["regions"][0], width=16, height=16)]
        self.manifest["cell_palettes"] = [0] * 4
        self.manifest["animations"] = []
        self.write_manifest()
        (self.path.parent / "atlas.png").write_bytes(image(16, 16))
        self.import_atlas()
        atlas = self.project.catalog()["project"]["atlases"]["terrain"]
        self.assertEqual(len(atlas["tiles"]["8"]), 4)
        self.assertEqual(len(atlas["tiles"]["16"]), 1)
        self.assertFalse(atlas["tiles"]["32"])
        self.assertEqual(self.scene(grid=16)["scene"]["grid"], 16)

    def uploaded_bundle(self):
        return {
            "name": self.path.name,
            "manifest": self.path.read_text(),
            "png": base64.b64encode((self.path.parent / "atlas.png").read_bytes()).decode(),
        }

    def test_browser_bundle_matches_path_import_and_preserves_source_files(self):
        before = self.path.read_bytes(), (self.path.parent / "atlas.png").read_bytes()
        self.project.artwork.import_bundle(self.uploaded_bundle(), self.revision())
        first = self.project.catalog()["project"]["atlases"]
        self.project.artwork.import_atlas(self.path, self.revision(), reimport=True)
        self.assertEqual(self.project.catalog()["project"]["atlases"], first)
        self.assertEqual(
            (self.path.read_bytes(), (self.path.parent / "atlas.png").read_bytes()), before
        )
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        saved = self.project.scenes.save(
            scene["id"], scene["scene"], scene["revision"], self.revision()
        )
        self.project.artwork.import_bundle(self.uploaded_bundle(), self.revision(), reimport=True)
        self.assertEqual(self.project.scenes.load(scene["id"])["scene"], saved["scene"])

    def test_browser_bundle_rejects_invalid_input_without_project_changes(self):
        before = self.project.catalog()
        uploaded = self.uploaded_bundle()
        for update in (
            {"name": "../escape.atlas.json"},
            {"name": "C:escape.atlas.json"},
            {"png": "not base64!"},
            {"manifest": "[]"},
            {"png": ""},
        ):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.project.artwork.import_bundle(dict(uploaded, **update), self.revision())
            self.assertEqual(self.project.catalog(), before)
        for png_path in ("../escape.png", "/tmp/escape.png", "C:escape.png", "folder\\escape.png"):
            modified = dict(self.manifest, png=png_path)
            with self.subTest(path=png_path), self.assertRaises(ValueError):
                self.project.artwork.import_bundle(
                    dict(uploaded, manifest=json.dumps(modified)), self.revision()
                )
            self.assertEqual(self.project.catalog(), before)

    def test_browser_bundle_supports_nested_png_and_revision_conflicts(self):
        uploaded = self.uploaded_bundle()
        uploaded["manifest"] = json.dumps(dict(self.manifest, png="images/atlas.png"))
        stale = self.revision()
        self.scene()
        with self.assertRaises(Conflict):
            self.project.artwork.import_bundle(uploaded, stale)
        self.project.artwork.import_bundle(uploaded, self.revision())
        self.assertTrue((self.project.root / "assets/terrain/atlas.png").is_file())

    def test_sprite_objects_have_native_size_origin_and_stable_references(self):
        path, manifest = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        for grid in (8, 16, 32):
            with self.subTest(grid=grid):
                scene = self.scene(grid=grid)
                scene["scene"]["objects"] = [{"id": 7, "asset": "actors/idle", "x": 24, "y": 25}]
                scene["scene"]["next_object_id"] = 8
                saved = self.project.scenes.save(
                    scene["id"], scene["scene"], scene["revision"], self.revision()
                )
                map_path = self.project.root / f"scenes/{scene['id']}.tmj"
                document = json.loads(map_path.read_bytes())
                obj = document["layers"][1]["objects"][0]
                self.assertEqual(
                    (obj["x"], obj["y"], obj["width"], obj["height"]), (16, 34, 16, 32)
                )
                self.assertEqual(document["nextobjectid"], 8)
                self.assertEqual(saved.pop("project_revision"), self.revision())
                self.assertEqual(Project(self.project.root).scenes.load(scene["id"]), saved)
        self.project.artwork.import_atlas(path, self.revision(), reimport=True)
        self.assertEqual(
            self.project.scenes.load(scene["id"])["scene"]["objects"], saved["scene"]["objects"]
        )
        manifest["regions"][0]["origin"] = [7, 20]
        path.write_text(json.dumps(manifest))
        self.project.artwork.import_atlas(path, self.revision(), reimport=True)
        self.assertEqual(
            self.project.scenes.load(scene["id"])["scene"]["objects"], saved["scene"]["objects"]
        )

    def test_existing_imports_gain_sprite_support_on_explicit_save(self):
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        scene = self.scene()
        # Simulate an existing project made before sprite placement support.
        document, _ = self.project.read()
        document["atlases"]["actors"]["tiles"].pop("sprites")
        for path in list(document["files"]):
            if "/sprites" in path:
                (self.project.root / path).unlink()
                del document["files"][path]
        (self.project.root / MANIFEST).write_text(json.dumps(document))
        before = (self.project.root / MANIFEST).read_bytes()
        reopened = Project(self.project.root)
        self.assertEqual(
            reopened.catalog()["project"]["atlases"]["actors"]["tiles"]["sprites"],
            {"actors/idle": 0},
        )
        self.assertEqual((self.project.root / MANIFEST).read_bytes(), before)
        scene["scene"]["objects"] = [{"id": 1, "asset": "actors/idle", "x": 8, "y": 10}]
        scene["scene"]["next_object_id"] = 2
        saved = reopened.scenes.save(
            scene["id"], scene["scene"], scene["revision"], self.revision()
        )
        self.assertEqual(saved["project_revision"], self.revision())
        self.assertEqual(saved["scene"]["objects"], scene["scene"]["objects"])
        self.assertTrue((self.project.root / "assets/actors/sprites.tsj").is_file())

    def test_invalid_sprites_and_unsupported_object_properties_are_preserved(self):
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        loaded = self.scene()
        for objects in (
            [{"id": 1, "asset": "missing/idle", "x": 1, "y": 1}],
            [{"id": 1, "asset": "actors/idle", "x": -1, "y": 1}],
            [{"id": 1, "asset": "actors/idle", "x": 1, "y": 1}] * 2,
        ):
            scene = dict(loaded["scene"], objects=objects, next_object_id=2)
            with self.subTest(objects=objects), self.assertRaises(ValueError):
                self.project.scenes.save(loaded["id"], scene, loaded["revision"], self.revision())
        scene = dict(
            loaded["scene"],
            objects=[{"id": 1, "asset": "actors/idle", "x": 8, "y": 10}],
            next_object_id=2,
        )
        saved = self.project.scenes.save(loaded["id"], scene, loaded["revision"], self.revision())
        map_path = self.project.root / f"scenes/{loaded['id']}.tmj"
        document = json.loads(map_path.read_bytes())
        for extra in (
            {"rotation": 90},
            {"properties": [{"name": "x", "type": "file", "value": "foo"}]},
            {"width": 100},
            {"gid": 0x80000001},
        ):
            candidate = copy.deepcopy(document)
            candidate["layers"][1]["objects"][0].update(extra)
            map_path.write_text(json.dumps(candidate))
            before = map_path.read_bytes()
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.project.scenes.load(saved["id"])
            self.assertEqual(map_path.read_bytes(), before)

    def test_project_scene_and_asset_conflicts_preserve_bytes(self):
        scene = self.scene()
        revision = self.revision()
        self.scene("Other")
        with self.assertRaises(Conflict):
            self.project.scenes.save(scene["id"], scene["scene"], scene["revision"], revision)
        path = self.project.root / f"scenes/{scene['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaises(Conflict):
            self.project.scenes.save(
                scene["id"], scene["scene"], scene["revision"], self.revision()
            )
        self.import_atlas()
        image_path = self.project.root / "assets/terrain/atlas.png"
        image_path.write_bytes(b"external edit")
        with self.assertRaisesRegex(Conflict, "asset changed"):
            self.scene("Blocked")
        self.assertEqual(image_path.read_bytes(), b"external edit")

    def test_rename_preserves_scene_identity_bytes_and_reopen(self):
        loaded = self.scene()
        path = self.project.root / f"scenes/{loaded['id']}.tmj"
        before = path.read_bytes()
        result = self.project.scenes.rename(
            loaded["id"], "  Courtyard  ", loaded["revision"], self.revision()
        )
        self.assertEqual(
            result["project"]["scenes"],
            [{"id": loaded["id"], "name": "Courtyard", "path": f"scenes/{loaded['id']}.tmj"}],
        )
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(
            Project(self.project.root).scenes.load(loaded["id"]), dict(loaded, name="Courtyard")
        )

    def test_duplicate_saved_and_unsaved_keep_source_and_share_assets(self):
        self.import_atlas()
        loaded = self.scene()
        candidate = copy.deepcopy(loaded["scene"])
        candidate["cells"][0][0] = "terrain/earth/0/0#1"
        before = self.project.catalog()["project"]["files"]
        first = self.project.scenes.duplicate(
            loaded["id"], "Saved copy", loaded["revision"], self.revision()
        )["duplicated"]
        second = self.project.scenes.duplicate(
            loaded["id"], "Canvas copy", loaded["revision"], self.revision(), candidate
        )["duplicated"]
        self.assertEqual(len({first, second, loaded["id"]}), 3)
        self.assertEqual(self.project.scenes.load(first)["scene"], loaded["scene"])
        self.assertEqual(self.project.scenes.load(second)["scene"]["cells"], candidate["cells"])
        self.assertEqual(self.project.scenes.load(loaded["id"]), loaded)
        self.assertEqual(self.project.catalog()["project"]["files"], before)
        changed = self.project.scenes.load(first)
        changed["scene"]["cells"][0][1] = "terrain/stone/0/0"
        self.project.scenes.save(first, changed["scene"], changed["revision"], self.revision())
        self.assertEqual(self.project.scenes.load(loaded["id"]), loaded)
        moved = self.folder / "moved"
        shutil.move(self.project.root, moved)
        reopened = Project(moved)
        self.assertEqual(reopened.scenes.load(second)["scene"]["cells"], candidate["cells"])
        payload, _ = reopened.export_bundle("project", reopened.catalog()["revision"])
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            self.assertTrue(any(second in path for path in archive.namelist()))

    def test_scene_management_conflicts_invalid_names_and_invalid_snapshot(self):
        loaded = self.scene()
        stale = self.revision()
        self.scene("Other")
        for method in (self.project.scenes.rename, self.project.scenes.duplicate):
            with self.assertRaises(Conflict):
                method(loaded["id"], "Changed", loaded["revision"], stale)
            before = self.project.catalog()
            for title in ("", "a" * 101, None):
                with self.assertRaises(ValueError):
                    method(loaded["id"], title, loaded["revision"], self.revision())
            self.assertEqual(self.project.catalog(), before)
        with self.assertRaises(ValueError):
            self.project.scenes.duplicate(
                loaded["id"], "Bad", loaded["revision"], self.revision(), {"width": 0}
            )
        path = self.project.root / f"scenes/{loaded['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        before = self.project.catalog()
        for method in (self.project.scenes.rename, self.project.scenes.duplicate):
            with self.assertRaises(Conflict):
                method(loaded["id"], "Changed", loaded["revision"], self.revision())
        self.assertEqual(self.project.catalog(), before)

    def test_management_guards_source_again_at_publication(self):
        loaded = self.scene()
        path = self.project.root / f"scenes/{loaded['id']}.tmj"
        original = self.project.store.commit

        def external_change(*args, **kwargs):
            path.write_bytes(path.read_bytes() + b"\n")
            return original(*args, **kwargs)

        for method in (self.project.scenes.rename, self.project.scenes.duplicate):
            loaded = self.project.scenes.load(loaded["id"])
            before = self.project.catalog()
            with patch.object(self.project.store, "commit", side_effect=external_change):
                with self.assertRaises(Conflict):
                    method(loaded["id"], "Changed", loaded["revision"], self.revision())
            self.assertEqual(self.project.catalog(), before)
            self.assertEqual(len(list((self.project.root / "scenes").glob("*.tmj"))), 1)

    def test_resized_layered_snapshot_duplicate_export_and_interrupted_save(self):
        self.import_atlas()
        source = self.scene()
        candidate = {
            "width": 2,
            "height": 2,
            "grid": 8,
            "next_layer_id": 10,
            "next_object_id": 9,
            "layers": [
                {
                    "id": 4,
                    "name": "Hidden",
                    "visible": False,
                    "type": "tilelayer",
                    "cells": [["terrain/earth/0/0#5", ""], ["", ""]],
                },
                {
                    "id": 6,
                    "name": "Entrances",
                    "visible": True,
                    "type": "objectgroup",
                    "objects": [
                        {
                            "id": 7,
                            "kind": "rectangle",
                            "x": 0,
                            "y": 0,
                            "width": 16,
                            "height": 8,
                            "name": "Door",
                            "class": "exit",
                            "properties": [{"name": "enabled", "type": "bool", "value": True}],
                        }
                    ],
                },
            ],
        }
        duplicate = self.project.scenes.duplicate(
            source["id"], "Resized snapshot", source["revision"], self.revision(), candidate
        )["duplicated"]
        self.assertEqual(self.project.scenes.load(duplicate)["scene"], candidate)
        payload, _ = self.project.export_bundle("scene", self.revision(), duplicate)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            maps = [entry for entry in archive.namelist() if entry.endswith(".tmj")]
            native = json.loads(archive.read(maps[0]))
            self.assertEqual((native["width"], native["height"]), (2, 2))
            self.assertEqual(native["layers"][1]["objects"][0]["id"], 7)
        # A resize uses the existing durable save: interrupt after map publication.
        before = self.project.catalog()
        original = transactions.atomic_write

        def fail_manifest(path, data):
            if path == self.project.root / MANIFEST:
                raise OSError("interrupted resized scene save")
            original(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.scenes.save(
                    source["id"], candidate, source["revision"], self.revision()
                )
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertEqual(reopened.scenes.load(source["id"]), source)
        saved = reopened.scenes.save(source["id"], candidate, source["revision"], self.revision())
        self.assertEqual(saved["scene"], candidate)
        self.assertEqual(Project(self.project.root).scenes.load(source["id"])["scene"], candidate)

    def test_duplicate_interruption_recovers_map_and_manifest_together(self):
        loaded = self.scene()
        before = self.project.catalog()
        original = transactions.atomic_write

        def fail_manifest(path, data):
            if path == self.project.root / MANIFEST:
                raise OSError("interrupted after duplicated map publication")
            original(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.scenes.duplicate(
                    loaded["id"], "Copy", loaded["revision"], self.revision()
                )
        self.assertEqual(len(list((self.project.root / "scenes").glob("*.tmj"))), 2)
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertEqual(len(list((self.project.root / "scenes").glob("*.tmj"))), 1)
        self.assertEqual(reopened.scenes.load(loaded["id"]), loaded)

    def test_delete_scene_keeps_shared_assets_and_other_scenes(self):
        self.import_atlas()
        first, second = self.scene(), self.scene("River")
        files = self.project.catalog()["project"]["files"].copy()
        result = self.project.scenes.delete(first["id"], first["revision"], self.revision())
        self.assertEqual(result["deleted"], first["id"])
        self.assertFalse((self.project.root / f"scenes/{first['id']}.tmj").exists())
        self.assertEqual(self.project.scenes.load(second["id"]), second)
        self.assertEqual(self.project.catalog()["project"]["files"], files)
        self.project.scenes.delete(second["id"], second["revision"], self.revision())
        self.assertEqual(Project(self.project.root).catalog()["project"]["scenes"], [])
        for path in files:
            self.assertTrue((self.project.root / path).is_file())

    def test_delete_checks_project_and_scene_revisions(self):
        first = self.scene()
        old_revision = self.revision()
        self.scene("Other")
        with self.assertRaises(Conflict):
            self.project.scenes.delete(first["id"], first["revision"], old_revision)
        path = self.project.root / f"scenes/{first['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        before = self.project.catalog()
        with self.assertRaises(Conflict):
            self.project.scenes.delete(first["id"], first["revision"], self.revision())
        with self.assertRaises(Conflict):
            self.project.scenes.delete(first["id"], None, self.revision())
        self.assertEqual(self.project.catalog(), before)
        self.assertTrue(path.is_file())

    def test_interrupted_delete_recovers_scene_and_manifest_together(self):
        scene = self.scene()
        before = self.project.catalog()
        original = transactions.atomic_write

        def fail_manifest(path, data):
            if path == self.project.root / MANIFEST:
                raise OSError("interrupted after scene removal")
            original(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.scenes.delete(scene["id"], scene["revision"], self.revision())
        self.assertFalse((self.project.root / f"scenes/{scene['id']}.tmj").exists())
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertEqual(reopened.scenes.load(scene["id"]), scene)

    def test_delete_unused_atlas_preserves_other_assets_and_remaps_gids(self):
        self.import_atlas()
        path, _ = bundle(self.folder / "other", "aaa")
        source_before = path.read_bytes(), (path.parent / "atlas.png").read_bytes()
        self.project.artwork.import_atlas(path, self.revision())
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        saved = self.project.scenes.save(
            scene["id"], scene["scene"], scene["revision"], self.revision()
        )
        map_path = self.project.root / f"scenes/{scene['id']}.tmj"
        self.assertEqual(json.loads(map_path.read_bytes())["layers"][0]["data"][0], 3)
        copied = {
            p for p in self.project.catalog()["project"]["files"] if p.startswith("assets/aaa/")
        }
        unmanaged = self.project.root / "assets/aaa/notes.txt"
        unmanaged.write_text("User-owned notes")
        result = self.project.artwork.delete_atlas(
            "aaa", self.revision(), scene_guard={"id": scene["id"], "revision": saved["revision"]}
        )
        self.assertEqual(result["deleted"], "aaa")
        reopened = Project(self.project.root)
        current = reopened.scenes.load(scene["id"])
        self.assertEqual(current["scene"], saved["scene"])
        self.assertEqual(result["scene_revisions"][scene["id"]], current["revision"])
        document = json.loads(map_path.read_bytes())
        self.assertEqual(document["layers"][0]["data"][0], 1)
        self.assertFalse(any("/aaa/" in t["source"] for t in document["tilesets"]))
        self.assertFalse(any((self.project.root / p).exists() for p in copied))
        self.assertEqual(unmanaged.read_text(), "User-owned notes")
        self.assertTrue((self.project.root / "assets/terrain/atlas.png").is_file())
        self.assertEqual(
            (path.read_bytes(), (path.parent / "atlas.png").read_bytes()), source_before
        )

    def test_delete_atlas_blocks_saved_tile_and_sprite_placements(self):
        self.import_atlas()
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        tile_scene, sprite_scene = self.scene("Tiles"), self.scene("Actors")
        tile_scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        sprite_scene["scene"]["objects"] = [{"id": 1, "asset": "actors/idle", "x": 8, "y": 8}]
        sprite_scene["scene"]["next_object_id"] = 2
        for loaded in (tile_scene, sprite_scene):
            self.project.scenes.save(
                loaded["id"], loaded["scene"], loaded["revision"], self.revision()
            )
        before = self.project.catalog()
        for atlas_id, title in (("terrain", "Tiles"), ("actors", "Actors")):
            with self.subTest(atlas=atlas_id), self.assertRaisesRegex(ValueError, title):
                self.project.artwork.delete_atlas(atlas_id, self.revision())
            self.assertEqual(self.project.catalog(), before)

    def test_delete_atlas_checks_project_scene_and_asset_revisions(self):
        self.import_atlas()
        stale = self.revision()
        scene = self.scene()
        with self.assertRaises(Conflict):
            self.project.artwork.delete_atlas("terrain", stale)
        path = self.project.root / f"scenes/{scene['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaisesRegex(Conflict, "open scene changed"):
            self.project.artwork.delete_atlas(
                "terrain",
                self.revision(),
                scene_guard={"id": scene["id"], "revision": scene["revision"]},
            )
        image = self.project.root / "assets/terrain/atlas.png"
        image.write_bytes(b"external edit")
        with self.assertRaises(Conflict):
            self.project.artwork.delete_atlas("terrain", self.revision())
        self.assertEqual(image.read_bytes(), b"external edit")

    def test_interrupted_atlas_deletion_restores_assets_maps_and_manifest(self):
        self.import_atlas()
        scene = self.scene()
        before = self.project.catalog()
        original = transactions.atomic_write

        def fail_manifest(path, data):
            if path == self.project.root / MANIFEST:
                raise OSError("interrupted after removing atlas assets")
            original(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.artwork.delete_atlas("terrain", self.revision())
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertEqual(reopened.scenes.load(scene["id"])["scene"], scene["scene"])
        for path, revision in before["project"]["files"].items():
            self.assertEqual(transactions.digest((self.project.root / path).read_bytes()), revision)

    def test_interrupted_multi_file_import_recovers(self):
        before = self.project.catalog()
        original = transactions.atomic_write
        count = 0

        def fail_install(path, data):
            nonlocal count
            if path == self.project.root / "assets/terrain/atlas.png":
                count += 1
                if count == 1:
                    original(path, data)
                    raise OSError("power loss")
            original(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_install),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.import_atlas()
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertFalse((self.project.root / "assets/terrain/atlas.png").exists())

    def test_interrupted_first_creation_can_be_retried(self):
        root = self.folder / "interrupted"
        original = transactions.atomic_write

        def fail_manifest(path, data):
            if path == root / MANIFEST:
                raise OSError("interrupted before publishing manifest")
            original(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                Project.create(root, "First attempt")
        make_handler(root, "token")
        reopened = Project.create(root, "Retried")
        self.assertEqual(reopened.catalog()["project"]["name"], "Retried")

    def test_dependency_change_during_import_is_guarded(self):
        self.import_atlas()
        before = self.project.catalog()
        original = atlas.build_assets
        asset_path = self.project.root / "assets/terrain/atlas.png"

        def external_edit(*args, **kwargs):
            result = original(*args, **kwargs)
            asset_path.write_bytes(b"external edit during preparation")
            return result

        with patch("gbc_scene_forge.artwork.atlas.build_assets", side_effect=external_edit):
            with self.assertRaises(Conflict):
                self.import_atlas(reimport=True)
        self.assertEqual(self.project.catalog(), before)
        self.assertEqual(asset_path.read_bytes(), b"external edit during preparation")

    def test_recovery_preserves_external_changes(self):
        scene = self.scene()
        path = self.project.root / f"scenes/{scene['id']}.tmj"
        original = transactions.atomic_write

        def fail_manifest(target, data):
            if target == self.project.root / MANIFEST:
                raise OSError("interrupted")
            original(target, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.scenes.save(
                    scene["id"], scene["scene"], scene["revision"], self.revision()
                )
        path.write_bytes(b"external edit")
        with self.assertRaisesRegex(ValueError, "later edit was preserved"):
            Project(self.project.root)
        self.assertEqual(path.read_bytes(), b"external edit")

    def test_unsupported_tiled_data_is_not_discarded(self):
        scene = self.scene()
        path = self.project.root / f"scenes/{scene['id']}.tmj"
        document = json.loads(path.read_text())
        variants = [
            dict(document, infinite=True),
            dict(document, properties=[]),
            dict(document, layers=document["layers"] * 2),
        ]
        for modified in variants:
            with self.subTest(modified=modified):
                path.write_text(json.dumps(modified))
                before = path.read_bytes()
                with self.assertRaises(ValueError):
                    self.project.scenes.load(scene["id"])
                self.assertEqual(path.read_bytes(), before)

    def test_bad_dimensions_references_and_project_versions(self):
        for value in (True, 0, 1025, "7"):
            with self.subTest(width=value), self.assertRaises(ValueError):
                self.project.scenes.create("Invalid", value, 5, 8, self.revision())
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "missing/region/0/0"
        with self.assertRaises(ValueError):
            self.project.scenes.save(
                scene["id"], scene["scene"], scene["revision"], self.revision()
            )
        path = self.project.root / MANIFEST
        manifest = json.loads(path.read_bytes())
        manifest["version"] = 2
        path.write_text(json.dumps(manifest))
        before = path.read_bytes()
        with self.assertRaises(ValueError):
            Project(self.project.root)
        self.assertEqual(path.read_bytes(), before)

    def test_invalid_imports_are_atomic(self):
        before = self.project.catalog()
        mutations = [
            {"version": 2},
            {"version": True},
            {"png": "../atlas.png"},
            {"source": "../optional.aseprite"},
            {"png": "/tmp/atlas.png"},
            {"regions": self.manifest["regions"] * 2},
            {"cell_palettes": []},
            {"animations": [{"name": "bad", "frames": [{"region": "missing"}]}]},
        ]
        for fields in mutations:
            with self.subTest(fields=fields):
                self.path.write_text(json.dumps(dict(self.manifest, **fields)))
                with self.assertRaises(ValueError):
                    self.import_atlas()
                self.assertEqual(self.project.catalog(), before)
        self.write_manifest()
        (self.path.parent / "atlas.png").unlink()
        with self.assertRaises(OSError):
            self.import_atlas()
        outside = self.folder / "outside.png"
        outside.write_bytes(image())
        (self.path.parent / "atlas.png").symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            self.import_atlas()

    def test_png_corruption_and_indexed_input(self):
        path, _ = bundle(self.folder / "indexed", "indexed", indexed=True)
        manifest, _, width, pixels = load_bundle(path)
        self.assertEqual(manifest["id"], "indexed")
        self.assertEqual((width, len(pixels)), (16, 16 * 8 * 4))
        encoded = png.encode(16, 8, pixels)
        self.assertEqual(png.decode(encoded)[2], pixels)
        for data in (encoded[:-1], encoded + b"trailing", encoded[:40] + b"bad" + encoded[43:]):
            with self.assertRaises(ValueError):
                png.decode(data)

    def test_transformed_tiles_roundtrip_save_export_and_reimport(self):
        self.import_atlas()
        loaded = self.scene()
        cells = loaded["scene"]["cells"]
        for flags in range(8):
            cells[flags // 7][flags % 7] = "terrain/earth/0/0" + (f"#{flags}" if flags else "")
        project = self.project.catalog()["project"]
        encoded = tiled.encode(loaded["scene"], project)
        base = encoded["layers"][0]["data"][0]
        for flags in range(8):
            self.assertEqual(
                encoded["layers"][0]["data"][flags],
                base | ((flags & 1) << 31) | ((flags & 2) << 29) | ((flags & 4) << 27),
            )
        saved = self.project.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], self.revision()
        )
        self.assertEqual(saved["scene"]["cells"], cells)
        self.assertEqual(self.project.scenes.load(saved["id"])["scene"]["cells"], cells)
        archive, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            document = json.loads(exported.read(f"scenes/{saved['id']}.tmj"))
            self.assertEqual(tiled.decode(document, project)["cells"], cells)
        self.import_atlas(reimport=True)
        self.assertEqual(self.project.scenes.load(saved["id"])["scene"]["cells"], cells)
        for invalid in ("#1", "terrain/earth/0/0#8", "terrain/earth/0/0#0", "unknown#1"):
            loaded["scene"]["cells"][0][0] = invalid
            with self.assertRaises(ValueError):
                tiled.check_scene(loaded["scene"], project)

    def test_stamps_persist_conflict_guard_export_and_protect_assets(self):
        self.import_atlas()
        scene = self.scene()["scene"]
        scene["cells"][0][0] = "terrain/earth/0/0#5"
        before = self.revision()
        result = self.project.objects.save_stamp("Doorway", scene, [0], before)
        stamp = result["project"]["stamps"][0]
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog()["project"]["stamps"][0], stamp)
        with self.assertRaises(Conflict):
            self.project.objects.save_stamp("Stale", scene, [0], before)
        with self.assertRaisesRegex(ValueError, "stamp layer mapping"):
            self.project.objects.save_stamp("Bad", scene, [], self.revision())
        with self.assertRaisesRegex(ValueError, "stamp Doorway"):
            self.project.artwork.delete_atlas("terrain", self.revision())
        self.import_atlas(reimport=True)
        archive, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            manifest = json.loads(exported.read(MANIFEST))
            self.assertEqual(manifest["stamps"], [stamp])
        with self.assertRaises(Conflict):
            self.project.objects.delete_stamp(stamp["id"], before)
        self.project.objects.delete_stamp(stamp["id"], self.revision())
        self.assertEqual(self.project.catalog()["project"]["stamps"], [])
        self.project.artwork.delete_atlas("terrain", self.revision())

    def test_hex_flags_and_unknown_tilesets_are_rejected(self):
        self.import_atlas()
        scene = self.scene()["scene"]
        project = self.project.catalog()["project"]
        document = tiled.encode(scene, project)
        document["layers"][0]["data"][0] = 0x10000001
        with self.assertRaises(ValueError):
            tiled.decode(document, project)
        document["layers"][0]["data"][0] = 0
        document["tilesets"][0]["source"] = "../../outside.tsj"
        with self.assertRaises(ValueError):
            tiled.decode(document, project)


class StandaloneHttpTests(unittest.TestCase):
    def test_creation_screen_and_retry_after_recovery_removes_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "project"
            original = transactions.atomic_write

            def fail_after_manifest(path, data):
                original(path, data)
                if path == root / MANIFEST:
                    raise OSError("process exited after installing manifest")

            with (
                patch.object(transactions, "atomic_write", side_effect=fail_after_manifest),
                patch.object(
                    transactions.Transactions, "_restore", side_effect=OSError("process exited")
                ),
            ):
                with self.assertRaises(OSError):
                    Project.create(root, "Interrupted")
            self.assertTrue((root / MANIFEST).exists())
            server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(root, "secret"))
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}"
                with urlopen(url + "/api/project", timeout=5) as response:
                    self.assertIsNone(json.load(response)["project"])
                self.assertFalse((root / MANIFEST).exists())
                with urlopen(
                    Request(
                        url + "/api/create-project",
                        data=json.dumps({"name": "Retried"}).encode(),
                        headers={"Content-Type": "application/json", "X-Scene-Token": "secret"},
                    ),
                    timeout=5,
                ) as response:
                    self.assertEqual(json.load(response)["project"]["name"], "Retried")
            finally:
                server.shutdown()
                server.server_close()
                worker.join()

    def test_create_security_and_conflict(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "project"
            server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(root, "secret"))
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}"

                def request(route, body=None, token="secret", host=None):
                    headers = {"Content-Type": "application/json", "X-Scene-Token": token}
                    if host:
                        headers["Host"] = host
                    return urlopen(
                        Request(
                            url + route,
                            data=json.dumps(body).encode() if body is not None else None,
                            headers=headers,
                        ),
                        timeout=5,
                    )

                with request("/api/project") as response:
                    self.assertIsNone(json.load(response)["project"])
                for kwargs in ({"token": "wrong"}, {"host": "remote.example"}):
                    with self.assertRaises(HTTPError) as caught:
                        request("/api/create-project", {"name": "World"}, **kwargs)
                    self.assertEqual(caught.exception.code, 403)
                with request("/api/create-project", {"name": "World"}) as response:
                    catalog = json.load(response)
                path, _ = bundle(Path(folder) / "input")
                upload = {
                    "name": path.name,
                    "manifest": path.read_text(),
                    "png": base64.b64encode((path.parent / "atlas.png").read_bytes()).decode(),
                }
                imported = {"bundle": upload, "project_revision": catalog["revision"]}
                with self.assertRaises(HTTPError) as caught:
                    request("/api/import-atlas", imported, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/import-atlas", imported) as response:
                    self.assertEqual(json.load(response)["atlas"], "terrain")
                with request("/api/project") as response:
                    catalog = json.load(response)
                with request(
                    "/api/create-scene",
                    {
                        "name": "First",
                        "width": 2,
                        "height": 2,
                        "grid": 8,
                        "project_revision": catalog["revision"],
                    },
                ) as response:
                    scene = json.load(response)
                with self.assertRaises(HTTPError) as caught:
                    request("/api/save-scene", {**scene, "project_revision": catalog["revision"]})
                self.assertEqual(caught.exception.code, 409)
                with request("/api/project") as response:
                    current = json.load(response)
                for route in ("rename-scene", "duplicate-scene"):
                    body = {
                        "id": scene["id"],
                        "revision": scene["revision"],
                        "name": "Managed",
                        "project_revision": current["revision"],
                    }
                    with self.assertRaises(HTTPError) as caught:
                        request("/api/" + route, body, token="wrong")
                    self.assertEqual(caught.exception.code, 403)
                    with request("/api/" + route, body) as response:
                        current = json.load(response)
                    # A stale project revision must not change either source or copy.
                    with self.assertRaises(HTTPError) as caught:
                        request("/api/" + route, body)
                    self.assertEqual(caught.exception.code, 409)
                metadata_request = {
                    "atlas": "terrain",
                    "group": "8",
                    "asset": "terrain/earth/0/0",
                    "metadata": {
                        "terrain": "wall",
                        "solid": True,
                        "shapes": [],
                        "next_shape_id": 1,
                    },
                    "project_revision": current["revision"],
                }
                with self.assertRaises(HTTPError) as caught:
                    request("/api/save-tile-metadata", metadata_request, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/save-tile-metadata", metadata_request) as response:
                    current = json.load(response)
                with self.assertRaises(HTTPError) as caught:
                    request("/api/save-tile-metadata", metadata_request)
                self.assertEqual(caught.exception.code, 409)
                preview_request = {
                    "settings": preview_settings.defaults(),
                    "project_revision": current["revision"],
                }
                with self.assertRaises(HTTPError) as caught:
                    request("/api/save-preview-settings", preview_request, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/save-preview-settings", preview_request) as response:
                    current = json.load(response)
                with self.assertRaises(HTTPError) as caught:
                    request("/api/save-preview-settings", preview_request)
                self.assertEqual(caught.exception.code, 409)
                stamp_request = {
                    "name": "Empty room",
                    "scene": scene["scene"],
                    "slots": [0],
                    "project_revision": current["revision"],
                }
                with self.assertRaises(HTTPError) as caught:
                    request("/api/save-stamp", stamp_request, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/save-stamp", stamp_request) as response:
                    current = json.load(response)
                with self.assertRaises(HTTPError) as caught:
                    request("/api/save-stamp", stamp_request)
                self.assertEqual(caught.exception.code, 409)
                deletion_stamp = {
                    "id": current["project"]["stamps"][0]["id"],
                    "project_revision": current["revision"],
                }
                with self.assertRaises(HTTPError) as caught:
                    request("/api/delete-stamp", deletion_stamp, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/delete-stamp", deletion_stamp) as response:
                    current = json.load(response)
                with self.assertRaises(HTTPError) as caught:
                    request("/api/delete-stamp", deletion_stamp)
                self.assertEqual(caught.exception.code, 409)
                export_request = {
                    "scope": "scene",
                    "scene_id": scene["id"],
                    "scene_revision": scene["revision"],
                    "project_revision": current["revision"],
                }
                with self.assertRaises(HTTPError) as caught:
                    request("/api/export", export_request, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/export", export_request) as response:
                    self.assertEqual(response.headers["Content-Type"], "application/zip")
                    self.assertIn(".zip", response.headers["Content-Disposition"])
                    with zipfile.ZipFile(io.BytesIO(response.read())) as exported:
                        self.assertIsNone(exported.testzip())
                        self.assertIn(f"scenes/{scene['id']}.tmj", exported.namelist())
                deletion = {
                    "id": scene["id"],
                    "revision": scene["revision"],
                    "project_revision": current["revision"],
                }
                with self.assertRaises(HTTPError) as caught:
                    request("/api/delete-scene", deletion, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/delete-scene", deletion) as response:
                    self.assertEqual(json.load(response)["deleted"], scene["id"])
                with request("/api/project") as response:
                    current = json.load(response)
                delete_atlas = {"id": "terrain", "project_revision": current["revision"]}
                with self.assertRaises(HTTPError) as caught:
                    request("/api/delete-atlas", delete_atlas, token="wrong")
                self.assertEqual(caught.exception.code, 403)
                with request("/api/delete-atlas", delete_atlas) as response:
                    self.assertEqual(json.load(response)["project"]["atlases"], {})
                with self.assertRaises(HTTPError):
                    request("/assets/../forge.project.json")
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)
