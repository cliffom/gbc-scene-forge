"""Independent project diagnostics, geometry, HTTP and snapshot regressions."""

import copy
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge import diagnostics, preview_settings
from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.projects import Project
from gbc_scene_forge.standalone import make_handler


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = Project.create(self.root / "project", "Diagnostics")
        path, _ = bundle(self.root / "atlas")
        self.project.import_atlas(path, self.rev())
        self.spawn = self.project.save_object_definition(
            {
                "name": "Spawn",
                "kind": "point",
                "fields": [{"name": "team", "type": "string", "required": True}],
            },
            self.rev(),
        )["definition_id"]
        self.goal = self.project.save_object_definition(
            {"name": "Goal", "kind": "point", "fields": []}, self.rev()
        )["definition_id"]
        self.rooms = []
        for name in ("Forest", "Cave"):
            room = self.project.create_scene(name, 8, 6, 8, self.rev())
            scene = {
                "width": 8,
                "height": 6,
                "grid": 8,
                "next_layer_id": 3,
                "next_object_id": 4,
                "layers": [
                    {
                        "id": 1,
                        "name": "Ground",
                        "type": "tilelayer",
                        "visible": True,
                        "cells": [[""] * 8 for _ in range(6)],
                    },
                    {
                        "id": 2,
                        "name": "Markers",
                        "type": "objectgroup",
                        "visible": True,
                        "objects": [
                            {"id": 1, "kind": "point", "x": 12, "y": 12, "definition": self.spawn},
                            {"id": 2, "kind": "point", "x": 14, "y": 12, "definition": self.spawn},
                            {"id": 3, "kind": "point", "x": 52, "y": 12, "definition": self.goal},
                        ],
                    },
                ],
            }
            self.rooms.append(
                self.project.save_scene(room["id"], scene, room["revision"], self.rev())
            )
        self.config = {
            "movement": "grid-four-way",
            "spawn_definitions": [self.spawn],
            "entrance_definitions": [self.spawn],
            "goal_definitions": [self.goal],
        }

    def rev(self):
        return self.project.catalog()["revision"]

    def report(self, **kwargs):
        return self.project.diagnostics_report(self.rev(), self.config, **kwargs)

    def files(self):
        return {str(p): p.read_bytes() for p in self.project.root.rglob("*") if p.is_file()}

    def save_scene(self, scene):
        room = self.rooms[0]
        self.rooms[0] = self.project.save_scene(room["id"], scene, room["revision"], self.rev())

    def test_multi_scene_deterministic_read_only_and_locations(self):
        before = self.files()
        report = self.report()
        self.assertEqual(report, self.report())
        self.assertEqual(self.files(), before)
        required = [f for f in report["findings"] if f["code"] == "required"]
        self.assertEqual(len(required), 4)
        self.assertEqual({f["scene"] for f in required}, {r["id"] for r in self.rooms})
        self.assertTrue(all(f["layer"] == 2 and f["object"] in (1, 2) for f in required))
        self.assertEqual(sum(f["code"] == "overlapping-spawns" for f in report["findings"]), 2)
        self.assertFalse(any(f["code"] == "unreachable" for f in report["findings"]))
        self.assertTrue(any(f["code"] == "unused-asset" for f in report["findings"]))

    def test_wall_blocks_entrance_and_routes_with_navigable_locations(self):
        asset = "terrain/earth/0/0"
        self.project.save_tile_metadata(
            "terrain",
            "8",
            asset,
            {"terrain": "", "solid": True, "shapes": [], "next_shape_id": 1},
            self.rev(),
        )
        scene = copy.deepcopy(self.rooms[0]["scene"])
        for row in scene["layers"][0]["cells"]:
            row[3] = asset
        scene["layers"][0]["cells"][1][1] = asset
        self.save_scene(scene)
        findings = [f for f in self.report()["findings"] if f.get("scene") == self.rooms[0]["id"]]
        self.assertTrue(any(f["code"] == "blocked-entrance" and f["object"] == 1 for f in findings))
        self.assertTrue(
            any(
                f["code"] == "unreachable" and f["object"] == 3 and f["start"] == 2
                for f in findings
            )
        )
        # A wide opening restores a route to the second spawn; no diagonal shortcuts needed.
        scene["layers"][0]["cells"][1][1] = ""
        scene["layers"][0]["cells"][3][3] = ""
        scene["layers"][0]["cells"][4][3] = ""
        self.save_scene(scene)
        self.assertFalse(
            any(
                f["code"] == "unreachable"
                and f.get("scene") == self.rooms[0]["id"]
                and f["start"] == 2
                for f in self.report()["findings"]
            )
        )

    def test_hidden_layers_exclusions_and_unsupported_assumptions(self):
        scene = copy.deepcopy(self.rooms[0]["scene"])
        scene["layers"][1]["visible"] = False
        self.save_scene(scene)
        findings = self.report()["findings"]
        self.assertFalse(
            any(f["code"] == "required" and f.get("scene") == self.rooms[0]["id"] for f in findings)
        )
        self.config["include_hidden"] = True
        self.assertEqual(sum(f["code"] == "required" for f in self.report()["findings"]), 4)
        self.config.update(excluded_scenes=[self.rooms[0]["id"]], excluded_codes=["required"])
        report = self.report()
        self.assertEqual(report["suppressed"], 2)
        self.assertFalse(any(f["code"] == "required" for f in report["findings"]))
        self.config["movement"] = "none"
        self.assertTrue(any(f["code"] == "unverified-movement" for f in self.report()["findings"]))
        self.config["movement"] = "platformer"
        with self.assertRaisesRegex(ValueError, "Unsupported movement"):
            self.report()

    def test_connections_and_unsaved_snapshot(self):
        report = self.project.world_report(self.rev())
        link = {
            "id": str(uuid4()),
            "name": "Broken",
            "source": {"scene": self.rooms[0]["id"], "object": 1},
            "destination": {"scene": str(uuid4()), "object": 9},
            "direction": "one-way",
        }
        self.project.save_world(
            {"version": 1, "positions": {}, "connections": [link]},
            self.rev(),
            report["scene_revisions"],
        )
        self.assertTrue(
            any(
                f["code"] == "missing-scene" and f["connection"] == link["id"]
                for f in self.report()["findings"]
            )
        )
        scene = copy.deepcopy(self.rooms[0]["scene"])
        scene["layers"][1]["objects"][0]["properties"] = [
            {"name": "team", "type": "string", "value": "blue"}
        ]
        before = self.files()
        report = self.report(
            scene_id=self.rooms[0]["id"], scene_revision=self.rooms[0]["revision"], scene=scene
        )
        self.assertFalse(
            any(
                f["code"] == "required"
                and f.get("scene") == self.rooms[0]["id"]
                and f.get("object") == 1
                for f in report["findings"]
            )
        )
        self.assertEqual(self.files(), before)
        with self.assertRaises(Conflict):
            self.report(scene_id=self.rooms[0]["id"], scene_revision="stale", scene=scene)

    def test_scene_race_during_report_is_rejected(self):
        original = diagnostics.report
        path = self.project.root / "scenes" / f"{self.rooms[1]['id']}.tmj"

        def raced(*args):
            result = original(*args)
            path.write_bytes(path.read_bytes() + b"\n")
            return result

        with (
            patch("gbc_scene_forge.diagnostics.report", side_effect=raced),
            self.assertRaises(Conflict),
        ):
            self.report()

    def test_asset_dependencies_include_stamps_and_animation_frames(self):
        # The fixture animation uses earth and stone: one used frame retains both regions.
        scene = copy.deepcopy(self.rooms[0]["scene"])
        scene["layers"][0]["cells"][0][0] = "terrain/earth/0/0"
        self.save_scene(scene)
        self.assertFalse(
            any(
                f["code"] == "unused-asset" and f["group"] == "8" for f in self.report()["findings"]
            )
        )

    def test_preview_asset_keys_count_as_usage(self):
        path, _ = sprite_bundle(self.root / "sprites")
        self.project.import_atlas(path, self.rev())

        def unused_assets():
            return {
                finding["asset"]
                for finding in self.report()["findings"]
                if finding["code"] == "unused-asset"
            }

        self.assertIn("actors/idle", unused_assets())
        for collection, value in (
            ("mappings", {"idle:down": "idle"}),
            ("selections", {"action": "idle", "direction": "down", "sequence": "idle"}),
        ):
            with self.subTest(collection=collection):
                settings = preview_settings.defaults()
                settings[collection] = {"actors/idle": value}
                self.project.save_preview_settings(settings, self.rev())
                before = self.files()
                unused = unused_assets()
                self.assertNotIn("actors/idle", unused)
                self.assertIn("terrain/earth/0/0", unused)
                self.assertEqual(self.files(), before)

        self.project.save_preview_settings(preview_settings.defaults(), self.rev())
        self.assertIn("actors/idle", unused_assets())

    def test_exact_collision_geometry_and_bounds(self):
        self.assertFalse(
            diagnostics.shape_overlap(
                (8, 0, 4, 4), {"kind": "rectangle", "x": 0, "y": 0, "width": 8, "height": 8}
            )
        )
        self.assertFalse(
            diagnostics.shape_overlap(
                (0, 0, 1, 1), {"kind": "ellipse", "x": 0, "y": 0, "width": 8, "height": 8}
            )
        )
        triangle = {"kind": "polygon", "points": [[0, 0], [8, 0], [0, 8]]}
        self.assertFalse(diagnostics.shape_overlap((6, 6, 2, 2), triangle))
        self.assertTrue(diagnostics.shape_overlap((1, 1, 2, 2), triangle))
        blocked = diagnostics.collision_test(
            self.rooms[0]["scene"], self.project.catalog()["project"], False
        )
        self.assertTrue(blocked((-1, 0, 2, 2)))
        self.assertFalse(blocked((0, 0, 2, 2)))

    def test_http_requires_token_and_rejects_stale_revision(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.project.root, "secret"))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/api/diagnostics-report"

        def request(token, revision):
            return urlopen(
                Request(
                    url,
                    json.dumps({"project_revision": revision, "options": self.config}).encode(),
                    {"Content-Type": "application/json", "X-Scene-Token": token},
                )
            )

        with self.assertRaises(HTTPError) as error:
            request("wrong", self.rev())
        self.assertEqual(error.exception.code, 403)
        with self.assertRaises(HTTPError) as error:
            request("secret", "stale")
        self.assertEqual(error.exception.code, 409)
        with request("secret", self.rev()) as response:
            self.assertEqual(json.load(response)["version"], 1)

    def test_oversized_search_and_missing_roles_are_unverified(self):
        document = self.project.catalog()["project"]
        config = diagnostics.options(self.config, document)
        findings = []

        def emit(code, severity, message, marker=None, **extra):
            findings.append(code)

        scene = {"width": 257, "height": 256, "grid": 8, "layers": []}
        markers = [
            {"id": 1, "x": 12, "y": 12, "spawn": True, "entrance": False, "goal": False},
            {"id": 2, "x": 24, "y": 12, "spawn": False, "entrance": False, "goal": True},
        ]
        diagnostics.movement(scene, document, config, markers, emit)
        self.assertEqual(findings, ["unverified-movement"])
        for value in (
            {"movement": []},
            {"include_hidden": 1},
            {"footprint": {}},
            {"excluded_codes": ["nonsense"]},
            {"spawn_definitions": [str(uuid4())]},
        ):
            with self.assertRaises(ValueError):
                diagnostics.options(value, document)

    def test_large_footprint_skips_empty_buckets_and_bounds_collision_work(self):
        document = self.project.catalog()["project"]
        config = diagnostics.options(
            {
                **self.config,
                "footprint": {"x": -2048, "y": -2048, "width": 4096, "height": 4096},
            },
            document,
        )
        scene = {"width": 256, "height": 256, "grid": 32, "layers": []}
        markers = [
            {"id": 1, "x": 4096, "y": 4096, "spawn": True, "entrance": True, "goal": False},
            {"id": 2, "x": 4128, "y": 4096, "spawn": False, "entrance": False, "goal": True},
        ]
        findings = []

        def emit(code, severity, message, marker=None, **extra):
            findings.append((code, message))

        # Even a zero budget permits the empty-artwork scene: no buckets are scanned.
        with patch.object(diagnostics, "COLLISION_WORK_LIMIT", 0):
            diagnostics.movement(scene, document, config, markers, emit)
        self.assertEqual(findings, [])

        # One distant solid tile activates the index without blocking these markers.
        cells = [[""] * 256 for _ in range(256)]
        cells[0][0] = "terrain/earth/0/0"
        scene["layers"] = [{"id": 1, "type": "tilelayer", "visible": True, "cells": cells}]
        document["atlases"]["terrain"]["metadata"] = {
            "32": {"terrain/earth/0/0": {"solid": True, "shapes": []}}
        }
        diagnostics.movement(scene, document, config, markers, emit)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0][0], "unverified-movement")
        self.assertIn("Collision-work budget exceeded", findings[0][1])

        # Index construction also shares the budget and cannot scan unbounded buckets.
        findings.clear()
        with patch.object(diagnostics, "COLLISION_WORK_LIMIT", 0):
            diagnostics.movement(scene, document, config, markers, emit)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0][0], "unverified-movement")

    def test_sprite_collision_uses_native_and_instance_origins(self):
        path, _ = sprite_bundle(self.root / "sprites")
        self.project.import_atlas(path, self.rev())
        self.project.save_tile_metadata(
            "actors",
            "sprites",
            "actors/idle",
            {"terrain": "", "solid": True, "shapes": [], "next_shape_id": 1},
            self.rev(),
        )
        scene = copy.deepcopy(self.rooms[0]["scene"])
        scene["layers"][1]["objects"] = [{"id": 1, "x": 32, "y": 32, "asset": "actors/idle"}]
        document = self.project.catalog()["project"]
        blocked = diagnostics.collision_test(scene, document, False)
        self.assertTrue(blocked((24, 9, 1, 1)))
        self.assertFalse(blocked((23, 9, 1, 1)))
        scene["layers"][1]["objects"][0]["origin"] = [0, 0]
        blocked = diagnostics.collision_test(scene, document, False)
        self.assertFalse(blocked((24, 9, 1, 1)))
        self.assertTrue(blocked((32, 32, 1, 1)))
        scene["layers"][1]["visible"] = False
        self.assertFalse(diagnostics.collision_test(scene, document, False)((32, 32, 1, 1)))
        self.assertTrue(diagnostics.collision_test(scene, document, True)((32, 32, 1, 1)))

    def test_transformed_tiles_keep_collision_and_asset_usage(self):
        asset = "terrain/earth/0/0"
        self.project.save_tile_metadata(
            "terrain",
            "8",
            asset,
            {
                "terrain": "",
                "solid": False,
                "shapes": [{"id": 1, "kind": "rectangle", "x": 0, "y": 0, "width": 2, "height": 8}],
                "next_shape_id": 2,
            },
            self.rev(),
        )
        scene = copy.deepcopy(self.rooms[0]["scene"])
        scene["layers"][0]["cells"][0][0] = asset + "#1"
        document = self.project.catalog()["project"]
        blocked = diagnostics.collision_test(scene, document, False)
        self.assertFalse(blocked((0, 0, 2, 2)))
        self.assertTrue(blocked((6, 0, 2, 2)))
        scene["layers"][0]["cells"][0][0] = asset + "#4"
        blocked = diagnostics.collision_test(scene, document, False)
        self.assertTrue(blocked((0, 0, 2, 2)))
        self.assertFalse(blocked((0, 6, 2, 2)))
        self.project.save_stamp("Rotated wall", scene, [0, 0], self.rev())
        self.assertFalse(
            any(
                f["code"] == "unused-asset" and f["asset"] == asset
                for f in self.report()["findings"]
            )
        )
