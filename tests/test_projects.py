"""Standalone workflows, portable Tiled files, invalid inputs and durable recovery."""

import base64
import copy
import json
import shutil
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from atlas_fixture import bundle, image, sprite_bundle

from gbc_scene_forge import atlas, png, tiled, transactions
from gbc_scene_forge.atlas import load_bundle
from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.projects import MANIFEST, Project
from gbc_scene_forge.standalone import make_handler


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
        return self.project.import_atlas(self.path, self.revision(), **kwargs)

    def write_manifest(self):
        self.path.write_text(json.dumps(self.manifest))

    def scene(self, title="Village", grid=8):
        return self.project.create_scene(title, 7, 5, grid, self.revision())

    def test_full_workflow_two_scenes_and_move(self):
        self.import_atlas()
        first, second = self.scene(), self.scene("River")
        first["scene"]["cells"][1][2] = "terrain/earth/0/0"
        saved = self.project.save_scene(
            first["id"], first["scene"], first["revision"], self.revision()
        )
        self.assertEqual(self.project.load_scene(second["id"])["scene"]["cells"][1][2], "")
        target = self.folder / "moved"
        shutil.move(str(self.project.root), target)
        shutil.rmtree(self.path.parent)
        reopened = Project(target)
        self.assertEqual(reopened.load_scene(first["id"]), saved)
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
        self.project.save_scene(scene["id"], scene["scene"], scene["revision"], self.revision())
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
            self.project.load_scene(scene["id"])["scene"]["cells"][0][0], "terrain/stone/0/0"
        )
        with self.assertRaisesRegex(ValueError, "explicit reimport"):
            self.import_atlas()

    def test_scene_read_cannot_mix_reimported_map_with_old_sprite_origin(self):
        path, manifest = sprite_bundle(self.folder / "sprites")
        self.project.import_atlas(path, self.revision())
        scene = self.scene()
        scene["scene"]["objects"] = [{"id": 1, "asset": "actors/idle", "x": 32, "y": 24}]
        scene["scene"]["next_object_id"] = 2
        saved = self.project.save_scene(
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
                    observed.append(self.project.load_scene(scene["id"])["scene"]["objects"])
                except ValueError:
                    observed.append("blocked")

        with patch.object(transactions, "atomic_write", side_effect=read_during_write):
            self.project.import_atlas(path, self.revision(), reimport=True)
        self.assertEqual(observed, ["blocked"])
        self.assertEqual(
            self.project.load_scene(scene["id"])["scene"]["objects"], saved["scene"]["objects"]
        )

    def test_save_acknowledges_its_own_bytes_even_if_an_external_edit_follows(self):
        self.import_atlas()
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        target = self.project.root / f"scenes/{scene['id']}.tmj"
        commit = self.project._commit

        def external_edit_after_commit(*args):
            commit(*args)
            document = json.loads(target.read_bytes())
            document["layers"][0]["data"][0] = 2
            target.write_text(json.dumps(document))

        with patch.object(self.project, "_commit", side_effect=external_edit_after_commit):
            result = self.project.save_scene(
                scene["id"], scene["scene"], scene["revision"], self.revision()
            )
        self.assertEqual(result["scene"]["cells"][0][0], "terrain/earth/0/0")
        self.assertEqual(
            self.project.load_scene(scene["id"])["scene"]["cells"][0][0], "terrain/stone/0/0"
        )
        with self.assertRaises(Conflict):
            self.project.save_scene(
                scene["id"], result["scene"], result["revision"], self.revision()
            )

    def test_asset_reads_reject_stale_catalogs_and_external_changes(self):
        self.import_atlas()
        revision = self.revision()
        data = self.project.asset("assets/terrain/atlas.png", revision)
        self.scene()
        with self.assertRaises(Conflict):
            self.project.asset("assets/terrain/atlas.png", revision)
        path = self.project.root / "assets/terrain/atlas.png"
        path.write_bytes(b"external edit")
        with self.assertRaises(Conflict):
            self.project.asset("assets/terrain/atlas.png", self.revision())
        self.assertNotEqual(path.read_bytes(), data)

    def test_added_regions_rewrite_gid_ranges_without_changing_other_atlas_placements(self):
        self.import_atlas()
        other, _ = bundle(self.folder / "other", "water")
        self.project.import_atlas(other, self.revision())
        scene = self.scene()
        scene["scene"]["cells"][0][:2] = ["terrain/stone/0/0", "water/earth/0/0"]
        self.project.save_scene(scene["id"], scene["scene"], scene["revision"], self.revision())
        # Overlapping same-kind regions are legal and receive independent stable identities.
        self.manifest["regions"].append(dict(self.manifest["regions"][0], name="grass"))
        self.write_manifest()
        self.assertEqual(self.import_atlas(reimport=True)["added"], ["grass"])
        reopened = self.project.load_scene(scene["id"])
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
        self.project.import_bundle(self.uploaded_bundle(), self.revision())
        first = self.project.catalog()["project"]["atlases"]
        self.project.import_atlas(self.path, self.revision(), reimport=True)
        self.assertEqual(self.project.catalog()["project"]["atlases"], first)
        self.assertEqual(
            (self.path.read_bytes(), (self.path.parent / "atlas.png").read_bytes()), before
        )
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        saved = self.project.save_scene(
            scene["id"], scene["scene"], scene["revision"], self.revision()
        )
        self.project.import_bundle(self.uploaded_bundle(), self.revision(), reimport=True)
        self.assertEqual(self.project.load_scene(scene["id"])["scene"], saved["scene"])

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
                self.project.import_bundle(dict(uploaded, **update), self.revision())
            self.assertEqual(self.project.catalog(), before)
        for png_path in ("../escape.png", "/tmp/escape.png", "C:escape.png", "folder\\escape.png"):
            modified = dict(self.manifest, png=png_path)
            with self.subTest(path=png_path), self.assertRaises(ValueError):
                self.project.import_bundle(
                    dict(uploaded, manifest=json.dumps(modified)), self.revision()
                )
            self.assertEqual(self.project.catalog(), before)

    def test_browser_bundle_supports_nested_png_and_revision_conflicts(self):
        uploaded = self.uploaded_bundle()
        uploaded["manifest"] = json.dumps(dict(self.manifest, png="images/atlas.png"))
        stale = self.revision()
        self.scene()
        with self.assertRaises(Conflict):
            self.project.import_bundle(uploaded, stale)
        self.project.import_bundle(uploaded, self.revision())
        self.assertTrue((self.project.root / "assets/terrain/atlas.png").is_file())

    def test_sprite_objects_have_native_size_origin_and_stable_references(self):
        path, manifest = sprite_bundle(self.folder / "sprites")
        self.project.import_atlas(path, self.revision())
        for grid in (8, 16, 32):
            with self.subTest(grid=grid):
                scene = self.scene(grid=grid)
                scene["scene"]["objects"] = [{"id": 7, "asset": "actors/idle", "x": 24, "y": 25}]
                scene["scene"]["next_object_id"] = 8
                saved = self.project.save_scene(
                    scene["id"], scene["scene"], scene["revision"], self.revision()
                )
                map_path = self.project.root / f"scenes/{scene['id']}.tmj"
                document = json.loads(map_path.read_bytes())
                obj = document["layers"][1]["objects"][0]
                self.assertEqual(
                    (obj["x"], obj["y"], obj["width"], obj["height"]), (16, 34, 16, 32)
                )
                self.assertEqual(document["nextobjectid"], 8)
                self.assertEqual(Project(self.project.root).load_scene(scene["id"]), saved)
        self.project.import_atlas(path, self.revision(), reimport=True)
        self.assertEqual(
            self.project.load_scene(scene["id"])["scene"]["objects"], saved["scene"]["objects"]
        )
        manifest["regions"][0]["origin"] = [7, 20]
        path.write_text(json.dumps(manifest))
        self.project.import_atlas(path, self.revision(), reimport=True)
        self.assertEqual(
            self.project.load_scene(scene["id"])["scene"]["objects"], saved["scene"]["objects"]
        )

    def test_existing_imports_gain_sprite_support_on_explicit_save(self):
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.import_atlas(path, self.revision())
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
        saved = reopened.save_scene(scene["id"], scene["scene"], scene["revision"], self.revision())
        self.assertEqual(saved["scene"]["objects"], scene["scene"]["objects"])
        self.assertTrue((self.project.root / "assets/actors/sprites.tsj").is_file())

    def test_invalid_sprites_and_unsupported_object_properties_are_preserved(self):
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.import_atlas(path, self.revision())
        loaded = self.scene()
        for objects in (
            [{"id": 1, "asset": "missing/idle", "x": 1, "y": 1}],
            [{"id": 1, "asset": "actors/idle", "x": -1, "y": 1}],
            [{"id": 1, "asset": "actors/idle", "x": 1, "y": 1}] * 2,
        ):
            scene = dict(loaded["scene"], objects=objects, next_object_id=2)
            with self.subTest(objects=objects), self.assertRaises(ValueError):
                self.project.save_scene(loaded["id"], scene, loaded["revision"], self.revision())
        scene = dict(
            loaded["scene"],
            objects=[{"id": 1, "asset": "actors/idle", "x": 8, "y": 10}],
            next_object_id=2,
        )
        saved = self.project.save_scene(loaded["id"], scene, loaded["revision"], self.revision())
        map_path = self.project.root / f"scenes/{loaded['id']}.tmj"
        document = json.loads(map_path.read_bytes())
        for extra in ({"rotation": 90}, {"properties": []}, {"width": 100}, {"gid": 0x80000001}):
            candidate = copy.deepcopy(document)
            candidate["layers"][1]["objects"][0].update(extra)
            map_path.write_text(json.dumps(candidate))
            before = map_path.read_bytes()
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.project.load_scene(saved["id"])
            self.assertEqual(map_path.read_bytes(), before)

    def test_project_scene_and_asset_conflicts_preserve_bytes(self):
        scene = self.scene()
        revision = self.revision()
        self.scene("Other")
        with self.assertRaises(Conflict):
            self.project.save_scene(scene["id"], scene["scene"], scene["revision"], revision)
        path = self.project.root / f"scenes/{scene['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaises(Conflict):
            self.project.save_scene(scene["id"], scene["scene"], scene["revision"], self.revision())
        self.import_atlas()
        image_path = self.project.root / "assets/terrain/atlas.png"
        image_path.write_bytes(b"external edit")
        with self.assertRaisesRegex(Conflict, "asset changed"):
            self.scene("Blocked")
        self.assertEqual(image_path.read_bytes(), b"external edit")

    def test_delete_scene_keeps_shared_assets_and_other_scenes(self):
        self.import_atlas()
        first, second = self.scene(), self.scene("River")
        files = self.project.catalog()["project"]["files"].copy()
        result = self.project.delete_scene(first["id"], first["revision"], self.revision())
        self.assertEqual(result["deleted"], first["id"])
        self.assertFalse((self.project.root / f"scenes/{first['id']}.tmj").exists())
        self.assertEqual(self.project.load_scene(second["id"]), second)
        self.assertEqual(self.project.catalog()["project"]["files"], files)
        self.project.delete_scene(second["id"], second["revision"], self.revision())
        self.assertEqual(Project(self.project.root).catalog()["project"]["scenes"], [])
        for path in files:
            self.assertTrue((self.project.root / path).is_file())

    def test_delete_checks_project_and_scene_revisions(self):
        first = self.scene()
        old_revision = self.revision()
        self.scene("Other")
        with self.assertRaises(Conflict):
            self.project.delete_scene(first["id"], first["revision"], old_revision)
        path = self.project.root / f"scenes/{first['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        before = self.project.catalog()
        with self.assertRaises(Conflict):
            self.project.delete_scene(first["id"], first["revision"], self.revision())
        with self.assertRaises(Conflict):
            self.project.delete_scene(first["id"], None, self.revision())
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
                self.project.delete_scene(scene["id"], scene["revision"], self.revision())
        self.assertFalse((self.project.root / f"scenes/{scene['id']}.tmj").exists())
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertEqual(reopened.load_scene(scene["id"]), scene)

    def test_delete_unused_atlas_preserves_other_assets_and_remaps_gids(self):
        self.import_atlas()
        path, _ = bundle(self.folder / "other", "aaa")
        source_before = path.read_bytes(), (path.parent / "atlas.png").read_bytes()
        self.project.import_atlas(path, self.revision())
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        saved = self.project.save_scene(
            scene["id"], scene["scene"], scene["revision"], self.revision()
        )
        map_path = self.project.root / f"scenes/{scene['id']}.tmj"
        self.assertEqual(json.loads(map_path.read_bytes())["layers"][0]["data"][0], 3)
        copied = {
            p for p in self.project.catalog()["project"]["files"] if p.startswith("assets/aaa/")
        }
        unmanaged = self.project.root / "assets/aaa/notes.txt"
        unmanaged.write_text("User-owned notes")
        result = self.project.delete_atlas(
            "aaa", self.revision(), scene_guard={"id": scene["id"], "revision": saved["revision"]}
        )
        self.assertEqual(result["deleted"], "aaa")
        reopened = Project(self.project.root)
        current = reopened.load_scene(scene["id"])
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
        self.project.import_atlas(path, self.revision())
        tile_scene, sprite_scene = self.scene("Tiles"), self.scene("Actors")
        tile_scene["scene"]["cells"][0][0] = "terrain/earth/0/0"
        sprite_scene["scene"]["objects"] = [{"id": 1, "asset": "actors/idle", "x": 8, "y": 8}]
        sprite_scene["scene"]["next_object_id"] = 2
        for loaded in (tile_scene, sprite_scene):
            self.project.save_scene(
                loaded["id"], loaded["scene"], loaded["revision"], self.revision()
            )
        before = self.project.catalog()
        for atlas_id, title in (("terrain", "Tiles"), ("actors", "Actors")):
            with self.subTest(atlas=atlas_id), self.assertRaisesRegex(ValueError, title):
                self.project.delete_atlas(atlas_id, self.revision())
            self.assertEqual(self.project.catalog(), before)

    def test_delete_atlas_checks_project_scene_and_asset_revisions(self):
        self.import_atlas()
        stale = self.revision()
        scene = self.scene()
        with self.assertRaises(Conflict):
            self.project.delete_atlas("terrain", stale)
        path = self.project.root / f"scenes/{scene['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaisesRegex(Conflict, "open scene changed"):
            self.project.delete_atlas(
                "terrain",
                self.revision(),
                scene_guard={"id": scene["id"], "revision": scene["revision"]},
            )
        image = self.project.root / "assets/terrain/atlas.png"
        image.write_bytes(b"external edit")
        with self.assertRaises(Conflict):
            self.project.delete_atlas("terrain", self.revision())
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
                self.project.delete_atlas("terrain", self.revision())
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertEqual(reopened.load_scene(scene["id"])["scene"], scene["scene"])
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

        with patch("gbc_scene_forge.atlas.build_assets", side_effect=external_edit):
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
                self.project.save_scene(
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
                    self.project.load_scene(scene["id"])
                self.assertEqual(path.read_bytes(), before)

    def test_bad_dimensions_references_and_project_versions(self):
        for value in (True, 0, 257, "7"):
            with self.subTest(width=value), self.assertRaises(ValueError):
                self.project.create_scene("Invalid", value, 5, 8, self.revision())
        scene = self.scene()
        scene["scene"]["cells"][0][0] = "missing/region/0/0"
        with self.assertRaises(ValueError):
            self.project.save_scene(scene["id"], scene["scene"], scene["revision"], self.revision())
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

    def test_gid_flags_and_unknown_tilesets_are_rejected(self):
        self.import_atlas()
        scene = self.scene()["scene"]
        project = self.project.catalog()["project"]
        document = tiled.encode(scene, project)
        document["layers"][0]["data"][0] = 0x80000001
        with self.assertRaises(ValueError):
            tiled.decode(document, project)
        document["layers"][0]["data"][0] = 0
        document["tilesets"][0]["source"] = "../../outside.tsj"
        with self.assertRaises(ValueError):
            tiled.decode(document, project)


class StandaloneHttpTests(unittest.TestCase):
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
