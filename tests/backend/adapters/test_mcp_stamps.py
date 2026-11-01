"""Saved composition placement, atomic guards and real installed-SDK review flow."""

import asyncio
import base64
import copy
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from support.atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.scene_objects import compositions
from gbc_scene_forge.scenes import authoring


class StampTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Stamps", starter="blockout")
        self.adapter = Adapter(self.project.root, single_project=True)
        for factory, directory in ((bundle, "tiles"), (sprite_bundle, "sprites")):
            path, _ = factory(self.root / directory)
            self.project.artwork.import_atlas(path, self.project.catalog()["revision"])
        self.loaded = self.project.planning.create_blockout(
            "Stage",
            dict(width=128, height=64, grid=8, camera_width=32, camera_height=32),
            self.project.catalog()["revision"],
        )
        scene = copy.deepcopy(self.loaded["scene"])
        scene["layers"] = [scene["layers"][0], scene["layers"][-1]]
        scene["layers"][0]["name"] = "Ground"
        # Two matching tile and object slots; IDs deliberately differ from the stamp.
        self.ground_id = scene["layers"][0]["id"]
        scene["layers"][0]["cells"][0][0] = "terrain/stone/0/0"
        spawn = next(
            d
            for d in self.project.catalog()["project"]["object_definitions"]["definitions"]
            if d["name"] == "Player spawn"
        )
        for kind, name in (
            ("tilelayer", "Ground"),
            ("objectgroup", "Props"),
            ("objectgroup", "Props"),
        ):
            layer = dict(id=scene["next_layer_id"], type=kind, name=name, visible=True)
            scene["next_layer_id"] += 1
            layer["cells" if kind == "tilelayer" else "objects"] = (
                [["terrain/stone/0/0"] * scene["width"] for _ in range(scene["height"])]
                if kind == "tilelayer"
                else []
            )
            scene["layers"].append(layer)
        self.project.scenes.save(self.loaded["id"], scene, self.loaded["revision"], self.revision())
        self.source = dict(
            width=2,
            height=2,
            grid=8,
            next_layer_id=5,
            next_object_id=4,
            layers=[
                dict(
                    id=1,
                    type="tilelayer",
                    name="Ground",
                    visible=True,
                    cells=[["terrain/earth/0/0#5", ""], ["", "terrain/earth/0/0"]],
                ),
                dict(
                    id=2,
                    type="tilelayer",
                    name="Ground",
                    visible=True,
                    cells=[["", "terrain/stone/0/0"], ["", ""]],
                ),
                dict(
                    id=3,
                    type="objectgroup",
                    name="Props",
                    visible=True,
                    objects=[
                        dict(
                            id=1,
                            kind="point",
                            x=1,
                            y=2,
                            name="Marker",
                            definition=spawn["id"],
                            properties=[dict(name="route", type="string", value="north")],
                        )
                    ],
                ),
                dict(
                    id=4,
                    type="objectgroup",
                    name="Props",
                    visible=True,
                    objects=[
                        dict(id=2, kind="rectangle", x=0, y=0, width=16, height=8),
                        dict(id=3, asset="actors/idle", x=8, y=8, origin=[8, 23]),
                    ],
                ),
            ],
        )
        saved = self.adapter.call(
            "save_stamp",
            dict(
                project="project",
                project_revision=self.revision(),
                name="Doorway",
                scene=self.source,
                slots=[0, 1, 0, 1],
            ),
        )
        self.stamp_id = saved["project"]["stamps"][-1]["id"]

    def revision(self):
        return self.project.catalog()["revision"]

    def args(self):
        return dict(
            project="project",
            project_revision=self.revision(),
            scene_id=self.loaded["id"],
            scene_revision=self.project.scenes.load(self.loaded["id"])["revision"],
        )

    def place(self, **options):
        return self.adapter.call(
            "place_stamp", {**self.args(), "stamp_id": self.stamp_id, "x": 2, "y": 2, **options}
        )

    def files(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file()
        }

    def test_repeated_placements_slots_tiles_objects_and_export(self):
        before = self.project.scenes.load(self.loaded["id"])["scene"]
        result = self.place()
        scene = result["scene"]
        self.assertEqual(
            result["allocated_object_ids"], [before["next_object_id"] + i for i in range(3)]
        )
        self.assertEqual(result["allocated_layer_ids"], [])
        self.assertEqual(result["placement"]["tile_write_count"], 8)
        self.assertEqual(result["placement"]["object_count"], 3)
        self.assertEqual(
            [m["target_layer_id"] for m in result["placement"]["layer_mapping"]],
            [before["layers"][i]["id"] for i in (0, 2, 3, 4)],
        )
        self.assertEqual(scene["layers"][0]["cells"][2][2:4], self.source["layers"][0]["cells"][0])
        self.assertEqual(scene["layers"][2]["cells"][3][2:4], ["", ""])
        self.assertEqual(scene["layers"][0]["cells"][0][0], "terrain/stone/0/0")
        self.assertEqual(scene["layers"][1], before["layers"][1])
        marker = scene["layers"][3]["objects"][0]
        self.assertEqual((marker["x"], marker["y"]), (17, 18))
        self.assertEqual(marker["properties"], self.source["layers"][2]["objects"][0]["properties"])
        self.assertEqual(scene["layers"][4]["objects"][1]["origin"], [8, 23])
        again = self.place(x=4, y=2)
        self.assertEqual(
            again["allocated_object_ids"], [scene["next_object_id"] + i for i in range(3)]
        )
        self.assertEqual(again["scene"]["layers"][4]["objects"][:2], scene["layers"][4]["objects"])
        self.assertEqual(self.project.catalog()["project"]["stamps"][0]["scene"], self.source)
        exported = self.adapter.call("export_bundle", {**self.args(), "scope": "scene"})
        raw = base64.b64decode(self.adapter.read_artifact(exported["resource"]["uri"])["blob"])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            stored = json.loads(archive.read(f"scenes/{self.loaded['id']}.tmj"))
        self.assertEqual(tiled.decode(stored, self.project.catalog()["project"]), again["scene"])

    def test_dry_run_artwork_and_blockout_review_then_save(self):
        files = self.files()
        candidate = self.place(dry_run=True)
        self.assertEqual(self.files(), files)
        self.assertEqual(candidate, self.place(dry_run=True))
        for tool in ("review_artwork", "review_blockout"):
            report = self.adapter.call(tool, {**self.args(), "scene": candidate["scene"]})
            self.assertEqual(report["snapshot_revision"], candidate["changes"]["after_snapshot"])
        resource = self.adapter.read_artifact(report["overview_resource"]["uri"])
        self.assertIn("Marker", resource["text"])
        report = self.adapter.call("review_artwork", {**self.args(), "scene": candidate["scene"]})
        raw = base64.b64decode(
            self.adapter.read_artifact(report["overview_resource"]["uri"])["blob"]
        )
        width, _, pixels = png.decode(raw, generic=True)
        self.assertEqual(pixels[(16 * width + 16) * 4 + 3], 255)
        self.assertEqual(self.files(), files)
        saved = self.adapter.call("save_scene", {**self.args(), "scene": candidate["scene"]})
        self.assertEqual(saved["scene"], candidate["scene"])
        self.assertEqual(self.project.scenes.load(saved["id"])["scene"], saved["scene"])

    def test_missing_or_hidden_later_layer_is_atomic(self):
        for change in ("missing", "hidden"):
            scene = self.project.scenes.load(self.loaded["id"])
            scene["scene"]["layers"][-1]["name"] = "Missing" if change == "missing" else "Props"
            scene["scene"]["layers"][-1]["visible"] = change != "hidden"
            self.project.scenes.save(
                scene["id"], scene["scene"], scene["revision"], self.revision()
            )
            files = self.files()
            for dry_run in (False, True):
                with self.assertRaisesRegex(ValueError, "Show or create matching layer"):
                    self.place(dry_run=dry_run)
                self.assertEqual(self.files(), files)

    def test_edges_bad_arguments_and_grid_mismatch_are_atomic(self):
        files = self.files()
        for bad in (
            dict(x=-1),
            dict(x=True),
            dict(y=1.5),
            dict(x=15),
            dict(y=7),
            dict(stamp_id="unknown"),
            dict(dry_run="false"),
            dict(extra=True),
            dict(project="../escape"),
            dict(stamp_id="x" * (4 * 1024 * 1024)),
        ):
            with self.subTest(bad=list(bad)), self.assertRaises(ValueError):
                self.place(**bad)
            self.assertEqual(self.files(), files)
        self.place(x=14, y=6, dry_run=True)  # Exact bottom/right boundary fits.
        loaded = self.project.scenes.create("Wrong grid", 8, 8, 16, self.revision())
        with self.assertRaisesRegex(ValueError, "same grid"):
            self.place(scene_id=loaded["id"], scene_revision=loaded["revision"])

    def test_stale_scene_and_project_guards_include_dry_run_and_reviews(self):
        old = self.args()
        self.place()
        for dry_run in (False, True):
            with self.assertRaises(Conflict):
                self.place(**old, dry_run=dry_run)
        for tool in ("review_artwork", "review_blockout"):
            with self.assertRaises(Conflict):
                self.adapter.call(tool, {**old, "scene": self.source})
        old = self.args()
        self.project.scenes.create("Other", 2, 2, 8, old["project_revision"])
        for dry_run in (False, True):
            with self.assertRaises(Conflict):
                self.place(**old, dry_run=dry_run)
            with self.assertRaises(Conflict):
                self.place(project_revision=None, dry_run=dry_run)

    def test_final_transaction_rejects_concurrent_scene_write(self):
        commit = ProjectStore.commit
        raced = False
        later = None

        def concurrent(store, *args, **kwargs):
            nonlocal raced, later
            if not raced:
                raced = True
                current = self.project.scenes.load(self.loaded["id"])
                current["scene"]["layers"][0]["cells"][0][0] = ""
                later = self.project.scenes.save(
                    current["id"], current["scene"], current["revision"], self.revision()
                )
            return commit(store, *args, **kwargs)

        with patch.object(ProjectStore, "commit", concurrent), self.assertRaises(Conflict):
            self.place()
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], later["scene"])

    def test_candidate_preparation_rejects_concurrent_manifest_change(self):
        place = compositions.place

        def concurrent(*args):
            result = place(*args)
            self.project.scenes.create("Concurrent", 2, 2, 8, self.revision())
            return result

        with patch.object(compositions, "place", concurrent), self.assertRaises(Conflict):
            self.place(dry_run=True)

    def test_object_limits_and_exhausted_ids_reject_whole_placement(self):
        for exhausted in (False, True):
            current = self.project.scenes.load(self.loaded["id"])
            scene = current["scene"]
            scene["layers"][-1]["objects"] = (
                [] if exhausted else [dict(id=100 + i, kind="point", x=0, y=0) for i in range(4095)]
            )
            scene["next_object_id"] = 2147483646 if exhausted else 5000
            self.project.scenes.save(current["id"], scene, current["revision"], self.revision())
            files = self.files()
            with self.assertRaises(ValueError):
                self.place()
            self.assertEqual(self.files(), files)

    def test_flat_scene_slot_and_counter_defaults(self):
        document = self.project.catalog()["project"]
        flat = dict(width=4, height=4, grid=8, cells=[[""] * 4 for _ in range(4)])
        stamp = dict(
            id="flat", name="Flat", scene=dict(width=1, height=1, grid=8, cells=[[""]]), slots=[0]
        )
        document["stamps"] = [stamp]
        original = copy.deepcopy(flat)
        candidate, allocated, _ = compositions.place(flat, document, "flat", 0, 0)
        self.assertEqual(flat, original)
        self.assertEqual(allocated, [])
        self.assertEqual(candidate["next_layer_id"], 2)
        self.assertEqual(candidate["next_object_id"], 1)

    def test_artwork_candidate_rejects_invalid_content_and_changed_assets(self):
        candidate = self.place(dry_run=True)["scene"]
        candidate["layers"][0]["cells"][0][0] = "missing/tile"
        with self.assertRaises(ValueError):
            self.adapter.call("review_artwork", {**self.args(), "scene": candidate})
        candidate = self.place(dry_run=True)["scene"]
        path = self.project.root / "assets/terrain/atlas.png"
        path.write_bytes(path.read_bytes() + b"changed")
        with self.assertRaises(Conflict):
            self.adapter.call("review_artwork", {**self.args(), "scene": candidate})

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
    def test_real_sdk_stamp_placement_review_save_repeat_and_conflicts(self):
        asyncio.run(self.sdk_session())

    async def sdk_session(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.adapters.mcp.server", "--project", str(self.project.root)],
            env=dict(os.environ),
        )
        async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
            await client.initialize()

            async def call(tool, arguments):
                result = await client.call_tool(tool, arguments)
                self.assertFalse(result.isError, result.content)
                return result.structuredContent

            inventory = await client.list_tools()
            self.assertIn("place_stamp", [tool.name for tool in inventory.tools])
            saved_stamp = await call(
                "save_stamp",
                dict(
                    project="project",
                    project_revision=self.revision(),
                    name="SDK doorway",
                    scene=self.source,
                    slots=[0, 1, 0, 1],
                ),
            )
            stamp_id = saved_stamp["project"]["stamps"][-1]["id"]
            arguments = {**self.args(), "stamp_id": stamp_id, "x": 2, "y": 2}
            preview = await call("place_stamp", {**arguments, "dry_run": True})
            for tool in ("review_artwork", "review_blockout"):
                report = await call(tool, {**self.args(), "scene": preview["scene"]})
                self.assertEqual(report["snapshot_revision"], preview["changes"]["after_snapshot"])
                resource = await client.read_resource(report["overview_resource"]["uri"])
                self.assertEqual(
                    resource.contents[0].mimeType,
                    "image/png" if tool == "review_artwork" else "image/svg+xml",
                )
            unchanged = await call("get_scene", dict(project="project", scene_id=self.loaded["id"]))
            self.assertEqual(unchanged["revision"], arguments["scene_revision"])
            saved = await call("place_stamp", arguments)
            self.assertEqual(saved["scene"], preview["scene"])
            self.assertEqual(saved["allocated_object_ids"], preview["allocated_object_ids"])
            for dry_run in (False, True):
                conflict = await client.call_tool("place_stamp", {**arguments, "dry_run": dry_run})
                self.assertTrue(conflict.isError)
                self.assertEqual(conflict.structuredContent["error"]["code"], "conflict")
            for bad in (
                dict(x=True),
                dict(x=1.5),
                dict(x=-1),
                dict(dry_run="yes"),
                dict(extra=True),
            ):
                rejected = await client.call_tool(
                    "place_stamp", {**self.args(), "stamp_id": stamp_id, "x": 2, "y": 2, **bad}
                )
                self.assertTrue(rejected.isError)
            again = await call("place_stamp", {**self.args(), "stamp_id": stamp_id, "x": 4, "y": 2})
            self.assertTrue(
                set(saved["allocated_object_ids"]).isdisjoint(again["allocated_object_ids"])
            )
            reopened = await call("get_scene", dict(project="project", scene_id=self.loaded["id"]))
            self.assertEqual(reopened["scene"], again["scene"])
            self.assertEqual(
                authoring.snapshot(reopened["scene"]), again["changes"]["after_snapshot"]
            )
