"""Forge aggregation against independent gbc-atlas v0.3.1 conformance fixtures."""

import copy
import io
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from atlas_fixture import image

from gbc_scene_forge.adapters.http.server import make_handler
from gbc_scene_forge.analysis import palette_budget
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.storage import transactions

FIXTURES = Path(__file__).parent / "fixtures/palette-semantics"
PROFILE = {"version": 1, "bg_reserved": 0, "obj_reserved": 0}


class PaletteBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "world"
        self.project = Project.create(self.root, "Palette examples")
        for name in ("mixed", "bank", "reordered"):
            self.project.artwork.import_atlas(
                FIXTURES / name / f"{name}.atlas.json", self.revision()
            )
        self.loaded = self.project.scenes.create("Boundary", 16, 4, 8, self.revision())
        self.scene = self.loaded["scene"]
        self.scene["cells"][0][:4] = [f"mixed/ground/{x}/{y}" for y in range(2) for x in range(2)]
        self.scene["cells"][1][:8] = [f"bank/strip/{x}/0" for x in range(8)]
        self.scene["objects"] = [
            {"id": 1, "asset": "mixed/actor_a", "x": 8, "y": 16},
            {"id": 2, "asset": "bank/actor", "x": 16, "y": 16},
        ]
        self.scene["next_object_id"] = 3
        self.project.reports.save_profile(PROFILE, self.revision())

    def revision(self):
        return self.project.catalog()["revision"]

    def report(self, scene=None):
        return self.project.reports.palettes(
            self.loaded["id"],
            self.revision(),
            self.loaded["revision"],
            self.scene if scene is None else scene,
        )

    def test_upstream_boundary_sharing_order_transparency_and_animation_closure(self):
        before = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        report = self.report()
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["pools"]["BG"]["required"], 8)
        self.assertEqual(report["pools"]["OBJ"]["required"], 2)
        expected = json.loads((FIXTURES / "expected.json").read_text())["identities"]
        for pool, labels in (("BG", "ABDEFGHI"), ("OBJ", "AC")):
            actual = [list(map(list, p["entries"])) for p in report["pools"][pool]["palettes"]]
            self.assertCountEqual(actual, [expected[pool][key] for key in labels])
        sources = [s for p in report["pools"]["OBJ"]["palettes"] for s in p["contributors"]]
        frame = next(s for s in sources if s["region"] == "actor_b")
        self.assertEqual(frame["animation"], "walk")
        self.assertEqual(frame["object_id"], 1)
        self.assertEqual(frame["source_cells"], [3, 7])
        # Equivalent local IDs and cross-atlas OBJ entry-zero differences share slots.
        shared = next(p for p in report["pools"]["OBJ"]["palettes"] if len(p["contributors"]) == 2)
        self.assertEqual({s["atlas"] for s in shared["contributors"]}, {"mixed", "bank"})
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()})
        self.assertEqual(report, self.report())
        self.scene["cells"][2][0] = "reordered/swapped/0/0"
        over = self.report()
        self.assertEqual(over["status"], "fail")
        self.assertEqual(over["pools"]["BG"]["required"], 9)
        self.project.reports.save_profile({**PROFILE, "bg_reserved": None}, self.revision())
        self.assertEqual(self.report()["status"], "fail")

    def test_linked_animation_closure_keeps_tile_offsets_and_terminates_cycles(self):
        folder = Path(self.temp.name) / "motion"
        folder.mkdir()
        (folder / "atlas.png").write_bytes(image(48, 8))
        manifest = {
            "version": 1,
            "id": "motion",
            "png": "atlas.png",
            "palettes": [[[0, 0, 0], [v, 1, 2], [20, 20, 20], [31, 31, 31]] for v in range(4)],
            "cell_palettes": [0, 1, 2, 1, 3, 1],
            "regions": [
                {"name": name, "kind": "tile", "x": x, "y": 0, "width": 16, "height": 8}
                for name, x in (("a", 0), ("b", 16), ("c", 32))
            ],
            "animations": [
                {
                    "name": name,
                    "frames": [{"region": region, "duration_ms": 100} for region in frames],
                }
                for name, frames in (("ab", "ab"), ("bc", "bc"), ("ca", "ca"))
            ],
        }
        path = folder / "motion.atlas.json"
        path.write_text(json.dumps(manifest))
        self.project.artwork.import_atlas(path, self.revision())
        self.loaded = self.project.scenes.load(self.loaded["id"])
        scene = {"width": 1, "height": 1, "grid": 8, "cells": [["motion/a/0/0"]]}
        report = self.report(scene)
        self.assertEqual(report["pools"]["BG"]["required"], 3)
        self.assertEqual(
            [p["contributors"][0]["source_cells"] for p in report["pools"]["BG"]["palettes"]],
            [[0], [2], [4]],
        )
        scene["cells"][0][0] = "motion/a/1/0"
        self.assertEqual(self.report(scene)["pools"]["BG"]["required"], 1)

    def test_profile_interruption_recovers_and_external_asset_edits_conflict(self):
        before = self.project.catalog()
        original = transactions.atomic_write

        def interrupt(path, data):
            original(path, data)
            if path == self.root / "forge.project.json":
                raise OSError("power loss")

        with (
            patch.object(transactions, "atomic_write", side_effect=interrupt),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.reports.save_profile({**PROFILE, "bg_reserved": 2}, self.revision())
        self.project = Project(self.root)
        self.assertEqual(self.project.catalog(), before)
        asset = self.root / "assets/mixed/atlas.png"
        asset.write_bytes(asset.read_bytes() + b"external edit")
        with self.assertRaises(Conflict):
            self.report()

    def test_reservations_unknown_disabled_and_profile_validation(self):
        self.project.reports.save_profile({**PROFILE, "bg_reserved": 1}, self.revision())
        report = self.report()
        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["pools"]["BG"]["available"], 7)
        self.project.reports.save_profile({**PROFILE, "obj_reserved": None}, self.revision())
        report = self.report()
        self.assertEqual(report["status"], "unverified")
        self.assertIsNone(report["pools"]["OBJ"]["available"])
        self.project.reports.save_profile(None, self.revision())
        self.assertEqual(self.report()["status"], "disabled")
        for value in (
            {},
            {**PROFILE, "version": True},
            {**PROFILE, "bg_reserved": -1},
            {**PROFILE, "obj_reserved": 9},
            {**PROFILE, "bg_reserved": True},
            {**PROFILE, "bg_reserved": 0.5},
            {**PROFILE, "extra": 1},
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.project.reports.save_profile(value, self.revision())

    def test_obj_boundary_separate_pools_and_missing_metadata(self):
        document = self.project.catalog()["project"]
        objects = []
        for i in range(9):
            entry = copy.deepcopy(document["atlases"]["mixed"])
            entry["manifest"]["id"] = f"actor_{i}"
            entry["manifest"]["animations"] = []
            entry["manifest"]["palettes"][2][1] = [i, 1, 2]
            document["atlases"][f"actor_{i}"] = entry
            objects.append({"id": i + 1, "asset": f"actor_{i}/actor_a", "x": i, "y": 0})
        scene = {
            "width": 16,
            "height": 4,
            "grid": 8,
            "cells": [[""] * 16 for _ in range(4)],
            "objects": objects,
        }
        report = palette_budget.report(scene, document, PROFILE, "example")
        self.assertEqual(report["pools"]["BG"]["required"], 0)
        self.assertEqual(report["pools"]["OBJ"]["required"], 9)
        self.assertEqual(report["status"], "fail")
        objects.pop()
        self.assertEqual(
            palette_budget.report(scene, document, PROFILE, "example")["status"], "pass"
        )
        del document["atlases"]["actor_0"]["manifest"]["palettes"]
        report = palette_budget.report(scene, document, PROFILE, "example")
        self.assertEqual(report["status"], "unverified")
        self.assertEqual(report["unverified_contributors"][0]["object_id"], 1)

    def test_hidden_layers_and_16px_tile_offsets(self):
        scene = {
            "width": 16,
            "height": 4,
            "grid": 8,
            "layers": tiled.scene_layers(self.scene),
            "next_object_id": 3,
            "next_layer_id": 3,
        }
        scene["layers"][0]["visible"] = False
        scene["layers"][1]["visible"] = False
        self.assertEqual(self.report(scene)["status"], "pass")
        self.assertEqual(self.report(scene)["pools"]["BG"]["required"], 8)
        scene = {"width": 1, "height": 1, "grid": 16, "cells": [["mixed/ground/0/0"]]}
        report = self.report(scene)
        self.assertEqual(report["pools"]["BG"]["required"], 1)
        sources = report["pools"]["BG"]["palettes"][0]["contributors"]
        self.assertEqual([s["source_cells"] for s in sources], [[0, 4], [1, 5]])

    def test_persistence_move_export_reimport_and_revision_guards(self):
        self.loaded = self.project.scenes.save(
            self.loaded["id"], self.scene, self.loaded["revision"], self.revision()
        )
        self.assertEqual(
            self.project.reports.palettes(
                self.loaded["id"], self.revision(), self.loaded["revision"]
            )["status"],
            "pass",
        )
        raw, _ = self.project.export_bundle("project", self.revision())
        exported = Path(self.temp.name) / "exported"
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            archive.extractall(exported)
        reopened = Project(exported)
        self.assertEqual(reopened.catalog()["project"]["gbc_palette_profile"], PROFILE)
        self.assertNotIn(
            "gbc_palette_profile", self.project.scenes.load(self.loaded["id"])["scene"]
        )
        moved = Path(self.temp.name) / "moved"
        shutil.move(str(self.root), moved)
        self.root = moved
        self.project = Project(moved)
        self.assertEqual(self.report()["pools"]["BG"]["required"], 8)
        old = self.revision()
        self.project.reports.save_profile({**PROFILE, "bg_reserved": 1}, old)
        with self.assertRaises(Conflict):
            self.project.reports.palettes(
                self.loaded["id"], old, self.loaded["revision"], self.scene
            )
        with self.assertRaises(Conflict):
            self.project.reports.save_profile(PROFILE, old)
        self.project.artwork.import_atlas(
            FIXTURES / "mixed/mixed.atlas.json", self.revision(), reimport=True
        )
        self.loaded = self.project.scenes.load(self.loaded["id"])
        self.assertEqual(self.report()["status"], "fail")
        path = self.root / f"scenes/{self.loaded['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaises(Conflict):
            self.report()

    def test_changes_during_analysis_and_cli_exit_status(self):
        original = palette_budget.report

        def edit(*args):
            path = self.root / f"scenes/{self.loaded['id']}.tmj"
            path.write_bytes(path.read_bytes() + b"\n")
            return original(*args)

        with (
            patch("gbc_scene_forge.analysis.palette_budget.report", side_effect=edit),
            self.assertRaises(Conflict),
        ):
            self.report()
        self.loaded = self.project.scenes.load(self.loaded["id"])
        command = [
            sys.executable,
            "-m",
            "gbc_scene_forge",
            "--project",
            str(self.root),
            "--palette-preflight",
            self.loaded["id"],
        ]
        passing = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(passing.returncode, 0, passing.stderr)
        self.assertEqual(json.loads(passing.stdout)["status"], "pass")
        self.project.reports.save_profile(None, self.revision())
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)

    def test_http_preflight_failure_and_token_protection(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.root, "secret"))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.scene["cells"][2][0] = "reordered/swapped/0/0"
        body = {
            "scene_id": self.loaded["id"],
            "scene_revision": self.loaded["revision"],
            "project_revision": self.revision(),
            "scene": self.scene,
        }
        url = f"http://127.0.0.1:{server.server_port}/api/palette-preflight"

        def request(token):
            return Request(
                url,
                json.dumps(body).encode(),
                {"Content-Type": "application/json", "X-Scene-Token": token},
            )

        for token, code in (("wrong", 403), ("secret", 422)):
            with self.assertRaises(HTTPError) as error:
                urlopen(request(token))
            self.assertEqual(error.exception.code, code)
            if code == 422:
                self.assertEqual(json.load(error.exception)["status"], "fail")
            error.exception.close()
