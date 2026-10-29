"""Independent PNG/Tiled intake, guard, portability and no-silent-loss regressions."""

import base64
import copy
import io
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from atlas_fixture import image

from gbc_scene_forge.adapters.http.routes import ProjectAPI
from gbc_scene_forge.analysis import palette_budget
from gbc_scene_forge.artwork import png
from gbc_scene_forge.artwork.metadata import DEFAULT
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project


def encoded(width=19, height=10, rgb=(12, 45, 67)):
    return base64.b64encode(image(width, height, rgb)).decode()


def sheet(**updates):
    return {"id": "generic", "png": encoded(), "grid": 8, "margin": 1, "spacing": 1, **updates}


def external():
    ts = {
        "type": "tileset",
        "name": "External",
        "tilewidth": 8,
        "tileheight": 8,
        "image": "sheet.png",
        "imagewidth": 19,
        "imageheight": 10,
        "margin": 1,
        "spacing": 1,
        "columns": 2,
        "tilecount": 2,
    }
    source = {
        "type": "map",
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "width": 2,
        "height": 1,
        "tilewidth": 8,
        "tileheight": 8,
        "nextlayerid": 8,
        "nextobjectid": 1,
        "tilesets": [{"firstgid": 3, "source": "art/tiles.tsj"}],
        "layers": [
            {
                "id": 7,
                "name": "Background",
                "type": "tilelayer",
                "width": 2,
                "height": 1,
                "visible": False,
                "data": [3, 0xA0000004],
            }
        ],
    }
    return {
        "map": "map.tmj",
        "name": "Imported map",
        "id": "tiled",
        "files": {
            "map.tmj": json.dumps(source),
            "art/tiles.tsj": json.dumps(ts),
            "art/sheet.png": encoded(),
        },
    }


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = Project.create(self.root / "project", "Generic art")

    def revision(self):
        return self.project.catalog()["revision"]

    def snapshot(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file()
        }

    def import_map(self, payload):
        rev = self.revision()
        report = self.project.imports.tiled(payload, rev)
        self.assertTrue(report["compatible"], report)
        return self.project.imports.tiled(
            payload, rev, dry_run=False, confirmation=report["confirmation"]
        )

    def test_png_preflight_does_not_write_and_keeps_colors(self):
        before = self.snapshot()
        report = self.project.artwork.import_tilesheet(sheet(), self.revision(), dry_run=True)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual([(r["x"], r["y"]) for r in report["regions"]], [(1, 1), (10, 1)])
        self.project.artwork.import_tilesheet(sheet(), self.revision())
        document = Project(self.project.root).catalog()["project"]
        entry = document["atlases"]["generic"]
        self.assertNotIn("palettes", entry["manifest"])
        data = (self.project.root / "assets/generic/grid-8/0.png").read_bytes()
        self.assertEqual(png.decode(data)[2][:4], bytes([12, 45, 67, 255]))
        self.assertEqual(
            entry["tiles"]["8"], {"generic/tile_0_0/0/0": 0, "generic/tile_1_0/0/0": 1}
        )

    def test_rgba_grid_32_preserves_alpha_and_subdivisions(self):
        rgba = bytes([131, 67, 201, 127]) * (32 * 32)
        value = sheet(
            png=base64.b64encode(png.encode(32, 32, rgba)).decode(), grid=32, margin=0, spacing=0
        )
        self.project.artwork.import_tilesheet(value, self.revision())
        entry = self.project.catalog()["project"]["atlases"]["generic"]
        self.assertEqual([len(entry["tiles"][str(size)]) for size in (8, 16, 32)], [16, 4, 1])
        data = (self.project.root / "assets/generic/grid-32/0.png").read_bytes()
        self.assertEqual(png.decode(data)[2], rgba)

    def test_png_limits_and_invalid_slicing_are_nonmutating(self):
        for updates in (
            {"png": encoded(20, 10)},
            {"grid": 12},
            {"margin": -1},
            {"spacing": True},
            {"id": "../bad"},
            {"png": "invalid"},
            {"png": encoded(2049, 8)},
            {"png": encoded(256, 256), "margin": 0, "spacing": 0},
        ):
            with self.subTest(updates={k: str(v)[:30] for k, v in updates.items()}):
                before = self.snapshot()
                with self.assertRaises(ValueError):
                    self.project.artwork.import_tilesheet(sheet(**updates), self.revision())
                self.assertEqual(self.snapshot(), before)

    def test_generic_sheet_can_exceed_old_atlas_dimensions(self):
        self.project.artwork.import_tilesheet(
            sheet(png=encoded(320, 8), margin=0, spacing=0), self.revision()
        )
        Project(self.project.root)
        self.project.export_bundle("project", self.revision())

    def test_reimport_preserves_ids_metadata_and_placements(self):
        self.project.artwork.import_tilesheet(sheet(), self.revision())
        loaded = self.project.scenes.create("Painted", 2, 1, 8, self.revision())
        loaded["scene"]["cells"][0][0] = "generic/tile_1_0/0/0#1"
        saved = self.project.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], self.revision()
        )
        for value in (sheet(), sheet(png=encoded(10, 10)), sheet(grid=16)):
            with self.assertRaises(ValueError):
                self.project.artwork.import_tilesheet(
                    value, self.revision(), reimport=value != sheet()
                )
        metadata = {**DEFAULT, "terrain": "grass", "solid": True}
        self.project.artwork.set_metadata(
            "generic", "8", "generic/tile_1_0/0/0", metadata, self.revision()
        )
        old = self.project.catalog()["project"]["atlases"]["generic"]["tiles"]
        report = self.project.artwork.import_tilesheet(
            sheet(png=encoded(28, 10, (99, 33, 17))), self.revision(), reimport=True
        )
        self.assertTrue(report["artwork_changed"])
        self.assertEqual(report["added"], ["tile_2_0"])
        new = self.project.catalog()["project"]["atlases"]["generic"]["tiles"]
        for key, local in old["8"].items():
            self.assertEqual(new["8"][key], local)
        self.assertEqual(self.project.scenes.load(loaded["id"])["scene"], saved["scene"])
        entry = self.project.catalog()["project"]["atlases"]["generic"]
        self.assertEqual(entry["metadata"]["8"]["generic/tile_1_0/0/0"], metadata)

    def test_generic_palette_report_is_unverified(self):
        self.project.artwork.import_tilesheet(sheet(), self.revision())
        document = self.project.catalog()["project"]
        scene = {"width": 1, "height": 1, "grid": 8, "cells": [["generic/tile_0_0/0/0"]]}
        report = palette_budget.report(
            scene, document, {"version": 1, "bg_reserved": 0, "obj_reserved": 0}, "test"
        )
        self.assertEqual(report["status"], "unverified")

    def test_tiled_preflight_atomic_import_and_moved_export(self):
        payload = external()
        before = self.snapshot()
        report = self.project.imports.tiled(payload, self.revision())
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(report["dependencies"], ["map.tmj", "art/tiles.tsj", "art/sheet.png"])
        imported = self.import_map(payload)
        loaded = self.project.scenes.load(imported["imported"])
        layer = loaded["scene"]["layers"][0]
        self.assertEqual(layer["name"], "Background")
        self.assertFalse(layer["visible"])
        self.assertEqual(layer["cells"], [["tiled_1/tile_0_0/0/0", "tiled_1/tile_1_0/0/0#5"]])
        moved = self.root / "moved"
        shutil.move(self.project.root, moved)
        project = Project(moved)
        data, _ = project.export_bundle("project", project.catalog()["revision"])
        extracted = self.root / "extracted"
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            archive.extractall(extracted)
        reopened = Project(extracted)
        self.assertEqual(reopened.scenes.load(loaded["id"])["scene"], loaded["scene"])
        self.assertEqual(payload, external())

    def test_embedded_tilesets_and_multiple_layers(self):
        payload = external()
        source = json.loads(payload["files"]["map.tmj"])
        ts = json.loads(payload["files"].pop("art/tiles.tsj"))
        ts["image"] = "art/sheet.png"
        source["tilesets"] = [{"firstgid": 3, **ts}]
        layer = copy.deepcopy(source["layers"][0])
        layer.update(id=2, name="Foreground", visible=True, data=[0, 4])
        source["layers"].append(layer)
        payload["files"]["map.tmj"] = json.dumps(source)
        result = self.import_map(payload)
        self.assertEqual(len(self.project.scenes.load(result["imported"])["scene"]["layers"]), 2)

    def test_reject_unsupported_content_missing_dependencies_and_paths(self):
        mutations = [
            lambda m, t: m.update(orientation="isometric"),
            lambda m, t: m.update(infinite=True),
            lambda m, t: m.update(properties=[{"name": "keep", "value": "me"}]),
            lambda m, t: m.update(backgroundcolor="#ffffff"),
            lambda m, t: m["layers"][0].update(opacity=0.5),
            lambda m, t: m["layers"][0].update(type="objectgroup", objects=[]),
            lambda m, t: m["layers"][0].update(data=[3, 99]),
            lambda m, t: m["layers"][0].update(tintcolor="#ff0000"),
            lambda m, t: m["tilesets"][0].update(source="../outside.tsj"),
            lambda m, t: t.update(image="/absolute.png"),
            lambda m, t: t.update(image="missing.png"),
            lambda m, t: t.update(tiles=[{"id": 0, "animation": []}]),
            lambda m, t: t.update(transparentcolor="#000000"),
            lambda m, t: t.update(columns=3),
        ]
        for mutate in mutations:
            payload = external()
            source = json.loads(payload["files"]["map.tmj"])
            ts = json.loads(payload["files"]["art/tiles.tsj"])
            mutate(source, ts)
            payload["files"]["map.tmj"] = json.dumps(source)
            payload["files"]["art/tiles.tsj"] = json.dumps(ts)
            before = self.snapshot()
            report = self.project.imports.tiled(payload, self.revision())
            self.assertFalse(report["compatible"], mutate)
            with self.assertRaises(ValueError):
                self.project.imports.tiled(payload, self.revision(), dry_run=False)
            self.assertEqual(self.snapshot(), before)

    def test_collisions_stale_project_and_changed_confirmation(self):
        payload = external()
        revision = self.revision()
        report = self.project.imports.tiled(payload, revision)
        with self.assertRaises(Conflict):
            self.project.imports.tiled(payload, revision, dry_run=False, confirmation="bad")
        self.import_map(payload)
        with self.assertRaises(Conflict):
            self.project.imports.tiled(
                payload, revision, dry_run=False, confirmation=report["confirmation"]
            )
        report = self.project.imports.tiled(payload, self.revision())
        self.assertFalse(report["compatible"])
        self.assertIn("already exists", report["errors"][0])

    def test_existing_maps_retain_semantic_references(self):
        self.project.artwork.import_tilesheet(sheet(id="zzz"), self.revision())
        old = self.project.scenes.create("Existing", 1, 1, 8, self.revision())
        old["scene"]["cells"] = [["zzz/tile_1_0/0/0"]]
        old = self.project.scenes.save(old["id"], old["scene"], old["revision"], self.revision())
        self.import_map(external())
        self.assertEqual(self.project.scenes.load(old["id"])["scene"], old["scene"])

    def test_http_routes_use_native_services(self):
        api = ProjectAPI(self.project.root, self.project)
        response = api.post(
            "/api/import-tilesheet", {"sheet": sheet(), "project_revision": self.revision()}
        )
        self.assertTrue(response.body["dry_run"])
        response = api.post(
            "/api/import-tiled", {"bundle": external(), "project_revision": self.revision()}
        )
        self.assertTrue(response.body["compatible"])
