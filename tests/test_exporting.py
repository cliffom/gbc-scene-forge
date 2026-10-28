"""Portable exports preserve authored data, dependency closure and source revisions."""

import copy
import io
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge import exporting, tiled
from gbc_scene_forge.documents import Conflict, json_text
from gbc_scene_forge.projects import MANIFEST, Project
from gbc_scene_forge.transactions import digest


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.project = Project.create(self.folder / "world", "Portable world")
        path, _ = bundle(self.folder / "input")
        self.project.import_atlas(path, self.revision())
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.import_atlas(path, self.revision())
        loaded = self.project.create_scene("Room", 7, 5, 8, self.revision())
        self.scene = {
            "width": 7,
            "height": 5,
            "grid": 8,
            "next_layer_id": 4,
            "next_object_id": 5,
            "layers": [
                {
                    "id": 1,
                    "name": "Ground",
                    "type": "tilelayer",
                    "visible": True,
                    "cells": loaded["scene"]["cells"],
                },
                {
                    "id": 3,
                    "name": "Actors and markers",
                    "type": "objectgroup",
                    "visible": False,
                    "objects": [
                        {
                            "id": 1,
                            "asset": "actors/idle",
                            "x": 32,
                            "y": 24,
                            "origin": [4, 16],
                            "class": "npc",
                            "properties": [{"name": "enabled", "type": "bool", "value": False}],
                        },
                        {
                            "id": 2,
                            "kind": "point",
                            "name": "Entry",
                            "class": "spawn",
                            "x": 8,
                            "y": 8,
                        },
                        {
                            "id": 4,
                            "kind": "rectangle",
                            "class": "trigger",
                            "x": 40,
                            "y": 24,
                            "width": 16,
                            "height": 16,
                        },
                    ],
                },
            ],
        }
        self.scene["layers"][0]["cells"][1][1] = "terrain/earth/0/0"
        self.loaded = self.project.save_scene(
            loaded["id"], self.scene, loaded["revision"], self.revision()
        )
        self.other = self.project.create_scene("Other room", 4, 4, 16, self.revision())
        self.project.save_tile_metadata(
            "terrain",
            "8",
            "terrain/earth/0/0",
            {
                "terrain": "water",
                "solid": True,
                "next_shape_id": 3,
                "shapes": [{"id": 2, "kind": "polygon", "points": [[0, 8], [8, 8], [8, 0]]}],
            },
            self.revision(),
        )
        self.map_path = self.project.root / f"scenes/{self.loaded['id']}.tmj"
        self.tile_path = self.project.root / "assets/terrain/grid-8.tsj"

    def revision(self):
        return self.project.catalog()["revision"]

    def export(self, scope="scene", **kwargs):
        if scope == "scene":
            kwargs.setdefault("scene_id", self.loaded["id"])
            kwargs.setdefault("scene_revision", self.loaded["revision"])
        return self.project.export_bundle(scope, self.revision(), **kwargs)

    def files(self, payload):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            self.assertIsNone(archive.testzip())
            for info in archive.infolist():
                self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertFalse(info.filename.startswith("/"))
                self.assertNotIn("..", Path(info.filename).parts)
            return {info.filename: archive.read(info) for info in archive.infolist()}

    def source_files(self):
        return {
            str(path.relative_to(self.project.root)): path.read_bytes()
            for path in self.project.root.rglob("*")
            if path.is_file()
        }

    def test_scene_export_is_deterministic_complete_and_read_only(self):
        before = self.source_files()
        payload, name = self.export()
        self.assertEqual((payload, name), self.export())
        self.assertEqual(name, f"forge-scene-{self.loaded['id']}.zip")
        files = self.files(payload)
        self.assertNotIn(MANIFEST, files)
        self.assertNotIn(f"scenes/{self.other['id']}.tmj", files)
        self.assertNotIn("assets/terrain/atlas.png", files)
        self.assertNotIn("assets/terrain/grid-16.tsj", files)
        self.assertFalse(any(path.startswith(".forge/") for path in files))
        self.assertEqual(files[f"scenes/{self.loaded['id']}.tmj"], self.map_path.read_bytes())
        self.assertEqual(files["assets/terrain/grid-8.tsj"], self.tile_path.read_bytes())
        report = json.loads(files["export.json"])
        self.assertFalse(report["scenes"][0]["canvas_override"])
        self.assertEqual(report["scenes"][0]["source_revision"], self.loaded["revision"])
        self.assertEqual(set(report["files"]), set(files) - {"export.json"})
        for path, expected in report["files"].items():
            self.assertEqual(digest(files[path]), expected)
        destination = self.folder / "scene-export"
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            archive.extractall(destination)
        moved = self.folder / "moved-scene-export"
        destination.rename(moved)
        moved = moved.resolve()
        self.assertEqual(
            tiled.decode(
                json.loads((moved / f"scenes/{self.loaded['id']}.tmj").read_bytes()),
                self.project.catalog()["project"],
            ),
            self.scene,
        )
        # Every Tiled reference stays within the moved export and resolves there.
        for path in moved.rglob("*.tmj"):
            for ref in json.loads(path.read_bytes())["tilesets"]:
                tileset_path = (path.parent / ref["source"]).resolve()
                self.assertTrue(tileset_path.is_relative_to(moved))
                for tile in json.loads(tileset_path.read_bytes())["tiles"]:
                    image = (tileset_path.parent / tile["image"]).resolve()
                    self.assertTrue(image.is_relative_to(moved))
                    self.assertTrue(image.is_file())
        self.assertEqual(self.source_files(), before)

    def test_project_export_reopens_without_inputs_or_original_workspace(self):
        (self.project.root / "private-notes.txt").write_text("not managed")
        payload, _ = self.export("project")
        files = self.files(payload)
        self.assertNotIn("private-notes.txt", files)
        self.assertIn(MANIFEST, files)
        original = self.project.catalog()["project"]
        for path in original["files"]:
            self.assertIn(path, files)
        destination = self.folder / "project-export"
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            archive.extractall(destination)
        moved = self.folder / "moved-project-export"
        destination.rename(moved)
        shutil.rmtree(self.project.root)
        shutil.rmtree(self.folder / "input")
        shutil.rmtree(self.folder / "sprites")
        reopened = Project(moved)
        self.assertEqual(reopened.catalog()["project"], original)
        self.assertEqual(reopened.load_scene(self.loaded["id"])["scene"], self.scene)
        reopened.create_scene("New room", 3, 3, 8, reopened.catalog()["revision"])

    def test_canvas_override_changes_only_downloaded_map(self):
        before = self.source_files()
        canvas = copy.deepcopy(self.scene)
        canvas["layers"][1]["name"] = "Edited objects"
        canvas["layers"][1]["objects"][1]["name"] = "Unsaved entry"
        for scope in ("scene", "project"):
            payload, _ = self.export(
                scope,
                scene_id=self.loaded["id"],
                scene=canvas,
                scene_revision=self.loaded["revision"],
            )
            files = self.files(payload)
            actual = tiled.decode(
                json.loads(files[f"scenes/{self.loaded['id']}.tmj"]),
                self.project.catalog()["project"],
            )
            self.assertEqual(actual, canvas)
            report = json.loads(files["export.json"])
            self.assertEqual(
                [item["id"] for item in report["scenes"] if item["canvas_override"]],
                [self.loaded["id"]],
            )
        self.assertEqual(self.source_files(), before)

    def test_stale_project_or_scene_revisions_are_rejected(self):
        revision = self.revision()
        self.project.create_scene("Another", 2, 2, 8, revision)
        with self.assertRaisesRegex(Conflict, "Project changed"):
            self.project.export_bundle("project", revision)
        before = self.map_path.read_bytes() + b"\n"
        self.map_path.write_bytes(before)
        with self.assertRaisesRegex(Conflict, "Scene changed"):
            self.export(scene=copy.deepcopy(self.scene))
        self.assertEqual(self.map_path.read_bytes(), before)

    def test_missing_dependencies_and_external_assets_are_actionable(self):
        image = self.project.root / "assets/terrain/grid-8/0.png"
        original = image.read_bytes()
        image.unlink()
        with self.assertRaisesRegex(ValueError, "Missing dependency.*grid-8/0.png"):
            self.export()
        image.write_bytes(original + b"\n")
        with self.assertRaisesRegex(Conflict, "asset changed.*grid-8/0.png"):
            self.export()
        self.assertEqual(image.read_bytes(), original + b"\n")

    def replace_tileset(self, document):
        self.tile_path.write_text(json_text(document))
        manifest = json.loads((self.project.root / MANIFEST).read_bytes())
        manifest["files"]["assets/terrain/grid-8.tsj"] = digest(self.tile_path.read_bytes())
        (self.project.root / MANIFEST).write_text(json_text(manifest))

    def test_unsupported_fields_and_unsafe_references_are_never_silently_omitted(self):
        document = json.loads(self.tile_path.read_bytes())
        variants = []
        for change in (
            {"image": "../../../../outside.png"},
            {"image": "/outside.png"},
            {"animation": []},
            {"imagewidth": 16},
            {"properties": [{"name": "file", "type": "file", "value": "secret.txt"}]},
        ):
            candidate = copy.deepcopy(document)
            candidate["tiles"][0].update(change)
            variants.append(candidate)
        candidate = copy.deepcopy(document)
        candidate["tiles"][0]["objectgroup"]["objects"][0]["template"] = "outside.tx"
        variants.append(candidate)
        for candidate in variants:
            self.replace_tileset(candidate)
            before = self.source_files()
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                self.export()
            self.assertEqual(self.source_files(), before)
        source = json.loads(self.map_path.read_bytes())
        source["properties"] = []
        self.map_path.write_text(json_text(source))
        with self.assertRaisesRegex(ValueError, "Unsupported Tiled map"):
            self.export()

    def test_external_edits_during_collection_are_detected(self):
        image = self.project.root / "assets/terrain/grid-8/0.png"
        original = Path.read_bytes
        changed = False

        def concurrent_read(path):
            nonlocal changed
            data = original(path)
            if path == image and not changed:
                changed = True
                path.write_bytes(data + b"\n")
            return data

        with patch.object(Path, "read_bytes", concurrent_read):
            with self.assertRaisesRegex(Conflict, "changed while exporting"):
                self.export()

    def test_empty_project_and_size_limit(self):
        empty = Project.create(self.folder / "empty", "Empty")
        payload, _ = empty.export_bundle("project", empty.catalog()["revision"])
        self.assertEqual(set(self.files(payload)), {MANIFEST, "EXPORT.md", "export.json"})
        before = self.source_files()
        with patch.object(exporting, "MAX_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "Export exceeds"):
                self.export()
        self.assertEqual(self.source_files(), before)
