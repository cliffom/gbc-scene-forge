"""Authored tileset properties and collision geometry survive project asset operations."""

import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from support.atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.artwork import metadata as tile_metadata
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.storage import transactions


class TileMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.project = Project.create(self.folder / "world", "Terrain")
        self.path, self.manifest = bundle(self.folder / "input")
        self.project.artwork.import_atlas(self.path, self.revision())
        self.loaded = self.project.scenes.create("Room", 7, 5, 8, self.revision())
        self.asset = "terrain/earth/0/0"
        self.tsj = self.project.root / "assets/terrain/grid-8.tsj"
        self.value = {
            "terrain": "water",
            "solid": True,
            "next_shape_id": 9,
            "shapes": [
                {"id": 2, "kind": "rectangle", "x": 0, "y": 4, "width": 8, "height": 4},
                {"id": 4, "kind": "ellipse", "x": 1, "y": 0, "width": 6, "height": 8},
                {"id": 7, "kind": "polygon", "points": [[0, 8], [8, 8], [8, 0]]},
            ],
        }

    def revision(self):
        return self.project.catalog()["revision"]

    def save(self, value=None, revision=None):
        return self.project.artwork.set_metadata(
            "terrain",
            "8",
            self.asset,
            self.value if value is None else value,
            revision or self.revision(),
        )

    def test_terrain_transition_persists_reimports_and_exports(self):
        self.value["terrain_mask"] = 6
        self.save()
        tile = json.loads(self.tsj.read_bytes())["tiles"][0]
        properties = {p["name"]: p["value"] for p in tile["properties"]}
        self.assertEqual(properties["forge:terrain_mask"], 6)
        payload, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            exported = json.loads(archive.read("assets/terrain/grid-8.tsj"))
            props = {p["name"]: p["value"] for p in exported["tiles"][0]["properties"]}
            self.assertEqual(props["forge:terrain_mask"], 6)
        before_shapes = tile["objectgroup"]
        self.project.artwork.import_atlas(self.path, self.revision(), reimport=True)
        reopened = Project(self.project.root)
        self.assertEqual(
            reopened.catalog()["project"]["atlases"]["terrain"]["metadata"]["8"][self.asset],
            self.value,
        )
        tile = json.loads(self.tsj.read_bytes())["tiles"][0]
        self.assertEqual(tile["objectgroup"], before_shapes)
        # Removing a rule also removes the portable property, preserving collision.
        del self.value["terrain_mask"]
        self.save()
        tile = json.loads(self.tsj.read_bytes())["tiles"][0]
        self.assertNotIn("forge:terrain_mask", {p["name"] for p in tile["properties"]})
        self.assertEqual(tile["objectgroup"], before_shapes)

    def test_terrain_rule_validation_is_atomic(self):
        revision = self.revision()
        before = self.tsj.read_bytes()
        for mask in (-1, 16, 1.5, True, "3", None):
            with self.subTest(mask=mask), self.assertRaises(ValueError):
                self.save(dict(self.value, terrain_mask=mask))
            self.assertEqual(self.revision(), revision)
            self.assertEqual(self.tsj.read_bytes(), before)
        with self.assertRaises(ValueError):
            self.save(dict(self.value, terrain="  ", terrain_mask=0))
        for mask in range(16):
            self.save(dict(self.value, terrain_mask=mask))

    def test_tsj_properties_shapes_and_source_separation(self):
        original = self.project.catalog()["project"]["atlases"]["terrain"]["manifest"]
        source_before = self.path.read_bytes()
        runtime = self.project.root / "assets/terrain/terrain.atlas.json"
        runtime_before = runtime.read_bytes()
        map_before = self.project.scenes.load(self.loaded["id"])
        before_revision = self.revision()
        result = self.save()
        self.assertNotEqual(result["revision"], before_revision)
        self.assertEqual(
            result["project"]["atlases"]["terrain"]["metadata"]["8"][self.asset], self.value
        )
        self.assertEqual(result["project"]["atlases"]["terrain"]["manifest"], original)
        self.assertEqual(self.path.read_bytes(), source_before)
        self.assertEqual(runtime.read_bytes(), runtime_before)
        self.assertEqual(self.project.scenes.load(self.loaded["id"]), map_before)
        tile = json.loads(self.tsj.read_bytes())["tiles"][0]
        properties = {p["name"]: (p["type"], p["value"]) for p in tile["properties"]}
        self.assertEqual(properties["forge:terrain"], ("string", "water"))
        self.assertEqual(properties["forge:solid"], ("bool", True))
        self.assertEqual(properties["forge:next_shape_id"], ("int", 9))
        shapes = tile["objectgroup"]["objects"]
        self.assertEqual([o["id"] for o in shapes], [2, 4, 7])
        self.assertTrue(shapes[1]["ellipse"])
        self.assertEqual(
            shapes[2]["polygon"], [{"x": 0, "y": 8}, {"x": 8, "y": 8}, {"x": 8, "y": 0}]
        )
        self.assertEqual(
            result["project"]["files"]["assets/terrain/grid-8.tsj"],
            transactions.digest(self.tsj.read_bytes()),
        )
        # The current project revision can save the still-open scene revision.
        self.project.scenes.save(
            self.loaded["id"], self.loaded["scene"], self.loaded["revision"], result["revision"]
        )

    def test_metadata_survives_artwork_reimport_restart_and_project_move(self):
        self.save()
        bundle(self.path.parent, rgb=(82, 82, 82))
        self.project.artwork.import_atlas(self.path, self.revision(), reimport=True)
        before = self.tsj.read_bytes()
        moved = self.folder / "moved"
        self.project.root.rename(moved)
        reopened = Project(moved)
        self.assertEqual(
            reopened.catalog()["project"]["atlases"]["terrain"]["metadata"]["8"][self.asset],
            self.value,
        )
        self.assertEqual((moved / "assets/terrain/grid-8.tsj").read_bytes(), before)
        self.assertIn("objectgroup", json.loads(before)["tiles"][0])
        self.assertEqual(
            reopened.catalog()["project"]["atlases"]["terrain"]["manifest"], self.manifest
        )

    def test_full_tile_fallback_and_sprite_native_dimensions(self):
        self.save({"terrain": "wall", "solid": True, "shapes": [], "next_shape_id": 1})
        shape = json.loads(self.tsj.read_bytes())["tiles"][0]["objectgroup"]["objects"][0]
        self.assertEqual((shape["x"], shape["y"], shape["width"], shape["height"]), (0, 0, 8, 8))
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        value = {
            "terrain": "actor",
            "solid": False,
            "shapes": [{"id": 1, "kind": "ellipse", "x": 0, "y": 24, "width": 16, "height": 8}],
            "next_shape_id": 2,
        }
        self.project.artwork.set_metadata(
            "actors", "sprites", "actors/idle", value, self.revision()
        )
        with self.assertRaises(ValueError):
            self.project.artwork.set_metadata(
                "actors", "sprites", "actors/idle", dict(value, terrain_mask=0), self.revision()
            )
        shape = json.loads((self.project.root / "assets/actors/sprites.tsj").read_bytes())["tiles"][
            0
        ]["objectgroup"]["objects"][0]
        self.assertEqual(shape["y"], 24)
        self.assertEqual(shape["width"], 16)
        # Clearing a classification/geometry really removes generated collision data.
        self.save(copy.deepcopy(tile_metadata.DEFAULT))
        self.assertNotIn("objectgroup", json.loads(self.tsj.read_bytes())["tiles"][0])

    def test_invalid_geometry_is_rejected_without_any_mutation(self):
        before, revision = self.tsj.read_bytes(), self.revision()
        variants = [
            dict(self.value, solid=1),
            dict(self.value, next_shape_id=7),
            dict(self.value, terrain="x" * 101),
            dict(self.value, unknown=True),
        ]
        for shape in (
            {"id": 1, "kind": "rectangle", "x": 7, "y": 0, "width": 2, "height": 8},
            {"id": 1, "kind": "ellipse", "x": 0.5, "y": 0, "width": 2, "height": 8},
            {"id": 1, "kind": "polygon", "points": [[0, 0], [8, 8], [0, 8], [7, 0]]},
            {"id": 1, "kind": "polygon", "points": [[0, 0], [4, 0], [8, 0]]},
            {"id": 1, "kind": "polygon", "points": [[0, 0], [8, 8], [0, 0]]},
            {"id": 1, "kind": "polygon", "points": [[0, 0], [9, 8], [0, 8]]},
        ):
            variants.append(dict(self.value, shapes=[shape]))
        variants.append(dict(self.value, shapes=[self.value["shapes"][0]] * 2))
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.save(value)
            self.assertEqual(self.tsj.read_bytes(), before)
            self.assertEqual(self.revision(), revision)
        for group, asset in (("16", self.asset), ("bad", self.asset), ("8", "other/key")):
            with self.subTest(group=group), self.assertRaises(ValueError):
                self.project.artwork.set_metadata("terrain", group, asset, self.value, revision)

    def test_revision_and_external_asset_conflicts_preserve_data(self):
        revision = self.revision()
        self.save()
        before = self.tsj.read_bytes()
        with self.assertRaises(Conflict):
            self.save(copy.deepcopy(tile_metadata.DEFAULT), revision)
        self.assertEqual(self.tsj.read_bytes(), before)
        revision = self.revision()
        external = before + b"\n"
        self.tsj.write_bytes(external)
        with self.assertRaises(Conflict):
            self.save(copy.deepcopy(tile_metadata.DEFAULT), revision)
        self.assertEqual(self.tsj.read_bytes(), external)

    def test_interrupted_metadata_save_recovers_tileset_and_manifest_together(self):
        before = self.project.catalog()
        tsj_before = self.tsj.read_bytes()
        real_write = transactions.atomic_write
        count = 0

        def interrupted(path, data):
            nonlocal count
            real_write(path, data)
            if path.name == "grid-8.tsj":
                count += 1
                if count == 1:
                    raise OSError("interrupted after tileset")

        with patch.object(transactions, "atomic_write", interrupted):
            with self.assertRaises(OSError):
                self.save()
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        self.assertEqual(self.tsj.read_bytes(), tsj_before)
        self.assertEqual(
            json.loads((self.project.root / MANIFEST).read_bytes())["atlases"]["terrain"].get(
                "metadata"
            ),
            None,
        )
