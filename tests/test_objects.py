"""Generic object authoring, typed metadata and the Tiled coordinate boundary."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from atlas_fixture import sprite_bundle

from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.projects import Project


class ObjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.project = Project.create(self.folder / "world", "Objects")
        self.path, self.manifest = sprite_bundle(self.folder / "atlas")
        self.project.import_atlas(self.path, self.revision())
        self.loaded = self.project.create_scene("Room", 7, 5, 8, self.revision())
        self.map_path = self.project.root / f"scenes/{self.loaded['id']}.tmj"
        self.scene = {
            "width": 7,
            "height": 5,
            "grid": 8,
            "next_object_id": 8,
            "next_layer_id": 4,
            "layers": [
                {
                    "id": 3,
                    "name": "Objects",
                    "type": "objectgroup",
                    "visible": True,
                    "objects": [
                        {
                            "id": 1,
                            "kind": "point",
                            "name": "Arrival",
                            "class": "spawn",
                            "x": 8,
                            "y": 16,
                            "properties": [
                                {"name": "enabled", "type": "bool", "value": True},
                                {"name": "facing", "type": "string", "value": "south"},
                                {"name": "priority", "type": "int", "value": -2},
                                {"name": "speed", "type": "float", "value": 1.25},
                            ],
                        },
                        {
                            "id": 4,
                            "kind": "rectangle",
                            "name": "Door",
                            "class": "trigger",
                            "x": 24,
                            "y": 8,
                            "width": 16,
                            "height": 24,
                            "properties": [
                                {"name": "destination", "type": "string", "value": "room-b"}
                            ],
                        },
                        {
                            "id": 7,
                            "asset": "actors/idle",
                            "name": "Guard",
                            "class": "npc",
                            "x": 40,
                            "y": 32,
                            "origin": [4, 16],
                            "properties": [
                                {"name": "dialogue", "type": "string", "value": "Hello <world>"}
                            ],
                        },
                    ],
                },
            ],
        }

    def revision(self):
        return self.project.catalog()["revision"]

    def save(self):
        return self.project.save_scene(
            self.loaded["id"], self.scene, self.loaded["revision"], self.revision()
        )

    def test_all_objects_and_typed_properties_survive_save_reopen_and_move(self):
        saved = self.save()
        self.assertEqual(saved["scene"], self.scene)
        document = json.loads(self.map_path.read_text())
        point, rectangle, sprite = document["layers"][0]["objects"]
        self.assertTrue(point["point"])
        self.assertEqual((point["x"], point["y"], point["width"], point["height"]), (8, 16, 0, 0))
        self.assertEqual(point["type"], "spawn")
        self.assertEqual(rectangle["type"], "trigger")
        self.assertEqual(
            (rectangle["x"], rectangle["y"], rectangle["width"], rectangle["height"]),
            (24, 8, 16, 24),
        )
        self.assertEqual((sprite["x"], sprite["y"]), (36, 48))
        self.assertEqual(
            sprite["properties"][-2:],
            [
                {"name": "forge:origin_x", "type": "int", "value": 4},
                {"name": "forge:origin_y", "type": "int", "value": 16},
            ],
        )
        self.assertEqual(Project(self.project.root).load_scene(saved["id"])["scene"], self.scene)
        moved = self.folder / "moved"
        self.project.root.rename(moved)
        self.assertEqual(Project(moved).load_scene(saved["id"])["scene"], self.scene)

    def test_generic_objects_need_no_atlas_and_do_not_block_unused_atlas_deletion(self):
        self.scene["layers"][0]["objects"].pop()
        saved = self.save()
        self.project.delete_atlas("actors", self.revision())
        self.assertEqual(self.project.load_scene(saved["id"])["scene"], self.scene)
        self.assertEqual(self.project.catalog()["project"]["atlases"], {})

    def test_origin_override_and_generic_metadata_survive_atlas_origin_changes(self):
        self.scene["layers"][0]["objects"].append(
            {"id": 6, "asset": "actors/idle", "x": 32, "y": 24}
        )
        saved = self.save()
        self.manifest["regions"][0]["origin"] = [0, 0]
        self.path.write_text(json.dumps(self.manifest))
        self.project.import_atlas(self.path, self.revision(), reimport=True)
        self.assertEqual(self.project.load_scene(saved["id"])["scene"], self.scene)
        document = json.loads(self.map_path.read_text())
        override, inherited = document["layers"][0]["objects"][-2:]
        self.assertEqual((override["x"], override["y"]), (36, 48))
        self.assertEqual((inherited["x"], inherited["y"]), (32, 56))

    def test_invalid_metadata_and_shapes_leave_saved_bytes_untouched(self):
        saved = self.save()
        before = self.map_path.read_bytes()
        variants = []
        for prop in (
            {"name": "enabled", "type": "int", "value": True},
            {"name": "count", "type": "int", "value": 1.5},
            {"name": "count", "type": "int", "value": 2**53},
            {"name": "bad", "type": "float", "value": float("inf")},
            {"name": "forge:origin_x", "type": "int", "value": 2},
            {"name": "file", "type": "file", "value": "other.json"},
            {"name": "enabled", "type": "bool", "value": False},
        ):
            variant = copy.deepcopy(self.scene)
            variant["layers"][0]["objects"][0]["properties"].append(prop)
            variants.append(variant)
        for index, update in (
            (0, {"x": 0.5}),
            (1, {"width": 40}),
            (2, {"origin": [17, 0]}),
            (1, {"id": 1}),
        ):
            variant = copy.deepcopy(self.scene)
            variant["layers"][0]["objects"][index].update(update)
            variants.append(variant)
        for variant in variants:
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.project.save_scene(saved["id"], variant, saved["revision"], self.revision())
            self.assertEqual(self.map_path.read_bytes(), before)
        document = json.loads(before)
        for update in (
            {"ellipse": True},
            {"polygon": []},
            {"rotation": 1},
            {"properties": [{"name": "forge:origin_x", "type": "int", "value": 2}]},
        ):
            candidate = copy.deepcopy(document)
            candidate["layers"][0]["objects"][2].update(update)
            self.map_path.write_text(json.dumps(candidate))
            changed = self.map_path.read_bytes()
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.project.load_scene(saved["id"])
            self.assertEqual(self.map_path.read_bytes(), changed)

    def test_oversize_object_metadata_cannot_create_an_unreopenable_map(self):
        before = self.map_path.read_bytes()
        revision = self.revision()
        properties = [{"name": f"p{i}", "type": "string", "value": "x" * 4096} for i in range(128)]
        self.scene["layers"][0]["objects"] = [
            {"id": i, "kind": "point", "x": i, "y": i, "properties": properties}
            for i in range(1, 9)
        ]
        self.scene["next_object_id"] = 9
        with self.assertRaisesRegex(ValueError, "4 MiB"):
            self.save()
        self.assertEqual(self.map_path.read_bytes(), before)
        self.assertEqual(self.revision(), revision)
        self.project.load_scene(self.loaded["id"])

    def test_object_save_conflicts_preserve_external_edits(self):
        saved = self.save()
        external = self.map_path.read_bytes() + b"\n"
        self.map_path.write_bytes(external)
        self.scene["layers"][0]["objects"][0]["name"] = "New name"
        with self.assertRaises(Conflict):
            self.project.save_scene(saved["id"], self.scene, saved["revision"], self.revision())
        self.assertEqual(self.map_path.read_bytes(), external)
