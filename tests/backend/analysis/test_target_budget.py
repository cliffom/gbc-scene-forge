"""Independent source-coordinate and rectangular OAM boundary fixtures."""

import copy
import io
import json
import unittest
import zipfile
from unittest.mock import patch

from backend.analysis import test_palette_budget as palette_tests
from gbc_scene_forge.analysis import diagnostics, palette_budget, target_budget
from gbc_scene_forge.core.errors import Conflict

HARDWARE = {
    "id": "gbc-static-split-v1",
    "sprite_height": 16,
    "bg_tiles_reserved": 0,
    "obj_tiles_reserved": 0,
    "oam_reserved": 0,
}
TARGET = {**palette_tests.PROFILE, "version": 2, "hardware": HARDWARE}


class TargetBudgetTests(unittest.TestCase):
    def setUp(self):
        self.document = {
            "atlases": {
                "test": {
                    "manifest": {
                        "regions": [
                            {
                                "name": "ground",
                                "kind": "tile",
                                "x": 0,
                                "y": 0,
                                "width": 2056,
                                "height": 8,
                            },
                            {
                                "name": "actor",
                                "kind": "sprite",
                                "x": 0,
                                "y": 8,
                                "width": 16,
                                "height": 16,
                            },
                            {
                                "name": "frame",
                                "kind": "sprite",
                                "x": 16,
                                "y": 8,
                                "width": 16,
                                "height": 32,
                            },
                        ],
                        "animations": [
                            {"name": "walk", "frames": [{"region": n} for n in ("actor", "frame")]}
                        ],
                    }
                }
            }
        }
        self.scene = {
            "width": 257,
            "height": 1,
            "grid": 8,
            "cells": [[f"test/ground/{i}/0" for i in range(256)] + [""]],
            "objects": [],
        }

    def report(self, profile=None):
        return target_budget.report(
            self.scene, self.document, HARDWARE if profile is None else profile, "example"
        )

    def test_tile_boundary_and_reservations(self):
        self.assertEqual(self.report()["metrics"]["bg_tiles"]["status"], "within-estimate")
        self.scene["cells"][0][256] = "test/ground/256/0"
        result = self.report()
        self.assertEqual(result["metrics"]["bg_tiles"]["required"], 257)
        self.assertEqual(result["metrics"]["bg_tiles"]["status"], "over-estimate")
        self.assertEqual(result["status"], "unverified")
        self.assertEqual(result, self.report())
        self.scene["cells"][0][256] = "test/ground/0/0#1"
        self.assertEqual(self.report()["metrics"]["bg_tiles"]["required"], 256)
        self.assertEqual(
            self.report({**HARDWARE, "bg_tiles_reserved": 1})["metrics"]["bg_tiles"]["status"],
            "over-estimate",
        )

    def test_metasprites_closure_reuse_and_oam_boundary(self):
        self.scene["objects"] = [
            {"id": i + 1, "asset": "test/actor", "x": 8, "y": 16} for i in range(10)
        ]
        result = self.report()
        self.assertEqual(result["metrics"]["obj_tiles"]["required"], 12)
        self.assertEqual(result["metrics"]["oam"]["required"], 40)
        self.assertEqual(result["metrics"]["oam"]["status"], "within-estimate")
        self.assertEqual(result["metrics"]["oam"]["contributors"][0]["object_id"], 1)
        self.scene["objects"].append({"id": 11, "asset": "test/actor", "x": 8, "y": 16})
        self.assertEqual(self.report()["metrics"]["oam"]["status"], "over-estimate")
        self.assertEqual(
            self.report({**HARDWARE, "sprite_height": 8})["metrics"]["oam"]["required"], 88
        )

    def test_obj_tile_boundary_and_incompatible_sprite_size(self):
        manifest = self.document["atlases"]["test"]["manifest"]
        manifest["animations"] = []
        actor = manifest["regions"][1]
        actor.update(width=128, height=128)
        self.scene["objects"] = [{"id": 1, "asset": "test/actor", "x": 0, "y": 0}]
        self.assertEqual(self.report()["metrics"]["obj_tiles"]["required"], 256)
        actor["width"] = 136
        self.assertEqual(self.report()["metrics"]["obj_tiles"]["status"], "over-estimate")
        actor["height"] = 8
        self.assertTrue(self.report()["unverified_contributors"])
        self.assertFalse(self.report({**HARDWARE, "sprite_height": 8})["unverified_contributors"])

    def test_unknown_missing_alignment_and_hidden_layers(self):
        self.assertIsNone(
            self.report({**HARDWARE, "oam_reserved": None})["metrics"]["oam"]["available"]
        )
        self.scene["cells"][0][0] = "missing/art/0/0"
        self.assertEqual(self.report()["metrics"]["bg_tiles"]["status"], "unverified")
        self.assertEqual(self.report()["unverified_contributors"][0]["x"], 0)
        self.scene["cells"][0][0] = "test/ground/0/0"
        self.scene["layers"] = [
            {
                "id": 1,
                "name": "Hidden",
                "type": "tilelayer",
                "visible": False,
                "cells": self.scene.pop("cells"),
            }
        ]
        self.assertEqual(self.report()["metrics"]["bg_tiles"]["required"], 256)
        self.document["atlases"]["test"]["manifest"]["regions"][0]["x"] = 1
        self.assertTrue(self.report()["unverified_contributors"])

    def test_16px_offsets_and_per_pool_identity(self):
        self.scene = {
            "width": 2,
            "height": 1,
            "grid": 16,
            "cells": [["test/ground/0/0", "test/ground/1/0"]],
        }
        self.document["atlases"]["test"]["manifest"]["regions"][0]["height"] = 16
        result = self.report()
        self.assertEqual(result["metrics"]["bg_tiles"]["required"], 8)
        self.assertEqual(result["metrics"]["obj_tiles"]["required"], 0)
        self.assertEqual(result["metrics"]["bg_tiles"]["contributors"][1]["x"], 1)

    def test_strict_profile_validation(self):
        palette_budget.check_profile(TARGET)
        for hardware in (
            {},
            {**HARDWARE, "id": "unknown"},
            {**HARDWARE, "sprite_height": True},
            {**HARDWARE, "sprite_height": 12},
            {**HARDWARE, "oam_reserved": 41},
            {**HARDWARE, "bg_tiles_reserved": 257},
            {**HARDWARE, "obj_tiles_reserved": -1},
            {**HARDWARE, "oam_reserved": True},
            {**HARDWARE, "oam_reserved": 1.5},
            {**HARDWARE, "extra": 0},
        ):
            with self.subTest(hardware=hardware), self.assertRaises(ValueError):
                palette_budget.check_profile({**TARGET, "hardware": hardware})

    def test_work_budget_is_unverified(self):
        with patch.object(target_budget, "WORK_LIMIT", 10):
            self.assertTrue(
                any("work limit" in v["reason"] for v in self.report()["unverified_contributors"])
            )


class TargetIntegrationTests(unittest.TestCase):
    def test_guarded_profile_reports_diagnostics_and_export(self):
        fixture = palette_tests.PaletteBudgetTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        project = fixture.project
        old = fixture.revision()
        project.reports.save_profile(copy.deepcopy(TARGET), old)
        with self.assertRaises(Conflict):
            project.reports.save_profile(TARGET, old)
        result = fixture.report()
        self.assertEqual(result["status"], "unverified")
        self.assertEqual(result["pools"]["BG"]["status"], "pass")
        self.assertEqual(result["hardware"]["metrics"]["bg_tiles"]["required"], 12)
        self.assertEqual(result["hardware"]["metrics"]["obj_tiles"]["required"], 6)
        self.assertEqual(result["hardware"]["metrics"]["oam"]["required"], 2)
        document = project.catalog()["project"]
        scenes = {fixture.loaded["id"]: {**fixture.loaded, "scene": fixture.scene}}
        report = diagnostics.report(document, scenes, diagnostics.options(None, document))
        self.assertTrue(any(f["code"] == "gbc-budget" for f in report["findings"]))
        raw, _ = project.export_bundle("project", fixture.revision())
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            manifest = json.loads(archive.read("forge.project.json"))
            self.assertEqual(manifest["gbc_palette_profile"], TARGET)
            for name in archive.namelist():
                if name.endswith(".tmj"):
                    self.assertNotIn("gbc_palette_profile", archive.read(name).decode())
        original = target_budget.report

        def external_edit(*args):
            path = fixture.root / f"scenes/{fixture.loaded['id']}.tmj"
            path.write_bytes(path.read_bytes() + b"\n")
            return original(*args)

        with (
            patch.object(target_budget, "report", side_effect=external_edit),
            self.assertRaises(Conflict),
        ):
            fixture.report()
        path = fixture.root
        self.assertEqual(
            json.loads((path / "forge.project.json").read_text())["gbc_palette_profile"], TARGET
        )
