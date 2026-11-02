"""Client-held artwork authoring, review fences and optional installed SDK proof."""

import asyncio
import base64
import copy
import importlib.util
import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from support.atlas_fixture import sprite_bundle

from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.errors import Conflict, TransactionBusy
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.storage.files import digest
from gbc_scene_forge.storage.transactions import Transactions


class NativeArtworkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Pixels")
        self.adapter = Adapter(self.project.root, single_project=True)
        self.loaded = self.project.scenes.create("Tile test", 4, 4, 8, self.revision())

    def revision(self):
        return self.project.catalog()["revision"]

    def guard(self):
        return dict(project="project", project_revision=self.revision())

    def create(self, **kwargs):
        return self.adapter.call(
            "create_artwork",
            {
                **self.guard(),
                "atlas_id": "new_tile",
                "name": "New tile",
                "kind": "tile",
                "width": 8,
                "height": 8,
                **kwargs,
            },
        )

    def candidate_args(self, candidate):
        return dict(project="project", candidate=candidate)

    def review(self, candidate, **kwargs):
        return self.adapter.call(
            "review_artwork_candidate",
            {
                **self.candidate_args(candidate),
                **kwargs,
            },
        )

    def commit(self, candidate, report=None):
        report = report or self.review(candidate)
        return self.adapter.call(
            "commit_artwork",
            {
                **self.candidate_args(candidate),
                "receipt": report["receipt"],
            },
        )

    def edit(self, candidate, writes=None):
        return self.adapter.call(
            "edit_artwork_pixels",
            {
                **self.candidate_args(candidate),
                "writes": writes
                or [dict(x=0, y=0, rgba=[17, 83, 201, 255]), dict(x=1, y=0, rgba=[51, 52, 53, 0])],
            },
        )

    def snapshot(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file()
        }

    def scene_context(self, candidate):
        loaded = self.project.scenes.load(self.loaded["id"])
        scene = copy.deepcopy(loaded["scene"])
        tiled.scene_layers(scene)[0]["cells"][0][0] = candidate["atlas_id"] + "/artwork/0/0"
        return dict(
            scene_id=loaded["id"],
            scene_revision=loaded["revision"],
            scene=scene,
            viewport=dict(x=0, y=0, width=32, height=32),
        )

    def pixels(self, resource):
        return png.decode(base64.b64decode(self.adapter.read_artifact(resource["uri"])["blob"]))

    def test_create_edit_review_commit_place_export_reopen(self):
        before = self.snapshot()
        blank = self.create()
        candidate = self.edit(blank)
        self.assertNotEqual(blank["revision"], candidate["revision"])
        self.assertEqual(base64.b64decode(blank["rgba"]), bytes(256))
        args = self.candidate_args(candidate)
        exact = self.adapter.call(
            "read_artwork_pixels",
            {
                **args,
                "rectangle": dict(x=0, y=0, width=2, height=1),
            },
        )
        self.assertEqual(base64.b64decode(exact["rgba"]), bytes([17, 83, 201, 255, 51, 52, 53, 0]))
        context = self.scene_context(candidate)
        report = self.review(candidate, scene=context)
        self.assertEqual(
            self.pixels(report["after"]["native_resource"])[2][:8],
            base64.b64decode(candidate["rgba"])[:8],
        )
        self.assertEqual(
            self.pixels(report["scene"]["after_resource"])[2][:4], bytes([17, 83, 201, 255])
        )
        self.assertEqual(self.pixels(report["scene"]["before_resource"])[2], bytes(4096))
        self.assertEqual(len(report["resources"]), 4)
        self.assertEqual(before, self.snapshot())
        saved = self.commit(candidate, report)
        self.assertEqual(saved["candidate_revision"], candidate["revision"])
        self.assertEqual(saved["review_revision"], report["receipt"]["revision"])
        self.assertEqual(saved["project_revision"], self.revision())
        self.assertEqual(
            saved["png_digest"],
            digest((self.project.root / "assets/new_tile/atlas.png").read_bytes()),
        )
        inventory = self.adapter.call("list_artwork", self.guard())
        native = inventory["documents"][0]
        reopened = self.adapter.call(
            "open_artwork",
            {
                **self.guard(),
                "target": native["target"],
                "artwork_revision": native["artwork_revision"],
            },
        )
        self.assertEqual(reopened["rgba"], candidate["rgba"])
        loaded = self.adapter.call("get_scene", dict(project="project", scene_id=self.loaded["id"]))
        layer = tiled.scene_layers(loaded["scene"])[0]["id"]
        self.adapter.call(
            "edit_scene",
            {
                **self.guard(),
                "scene_id": loaded["id"],
                "scene_revision": loaded["revision"],
                "operations": [
                    dict(
                        op="paint_tiles",
                        layer_id=layer,
                        cells=[dict(x=0, y=0, tile="new_tile/artwork/0/0")],
                    )
                ],
            },
        )
        self.assertEqual(
            tiled.scene_layers(self.project.scenes.load(loaded["id"])["scene"])[0]["cells"][0][0],
            "new_tile/artwork/0/0",
        )
        exported = self.adapter.call("export_bundle", {**self.guard(), "scope": "project"})
        raw = base64.b64decode(self.adapter.read_artifact(exported["resource"]["uri"])["blob"])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            archive.extractall(self.root / "reopened")
        restored = Project(self.root / "reopened")
        documents = restored.artwork.documents.list(restored.catalog()["revision"])["documents"]
        self.assertEqual(documents[0]["target"], native["target"])
        self.assertEqual(
            restored.scenes.load(loaded["id"])["scene"],
            self.project.scenes.load(loaded["id"])["scene"],
        )

    def test_duplicate_imported_sprite_retains_origin_and_original(self):
        path, _ = sprite_bundle(self.root / "input")
        self.project.artwork.import_atlas(path, self.revision())
        inventory = self.adapter.call("list_artwork", self.guard())
        self.assertFalse(inventory["documents"])
        source = inventory["sources"][0]
        original = (self.project.root / "assets/actors/atlas.png").read_bytes()
        candidate = self.adapter.call(
            "duplicate_artwork",
            {
                **self.guard(),
                "atlas_id": "copy",
                "name": "Sprite copy",
                "source": dict(
                    atlas_id="actors",
                    region="idle",
                    grid=None,
                    cell=None,
                    artwork_revision=source["artwork_revision"],
                ),
            },
        )
        self.assertEqual(candidate["descriptor"]["origin"], [8, 23])
        self.commit(self.edit(candidate))
        self.assertEqual(original, (self.project.root / "assets/actors/atlas.png").read_bytes())
        with self.assertRaisesRegex(ValueError, "read-only"):
            self.adapter.call(
                "open_artwork",
                {
                    **self.guard(),
                    "target": dict(
                        document_id=candidate["document_id"], atlas_id="actors", region="idle"
                    ),
                    "artwork_revision": source["artwork_revision"],
                },
            )

    def test_invalid_batches_changed_receipts_and_cross_project_write_nothing(self):
        candidate = self.create()
        report = self.review(candidate)
        before = self.snapshot()
        for writes in (
            [dict(x=8, y=0, rgba=[0] * 4)],
            [dict(x=0, y=0, rgba=[True, 0, 0, 0])],
            [dict(x=0, y=0, rgba=[0] * 4)] * 2,
            [dict(x=0, y=0, rgba=[1] * 4), dict(x=1, y=0, rgba=[256] * 4)],
            [dict(x=0, y=0, rgba=[0] * 4, extra=True)],
        ):
            with self.assertRaises(ValueError):
                self.edit(candidate, writes)
        changed = self.edit(candidate)
        with self.assertRaises(Conflict):
            self.commit(changed, report)
        for receipt in (None, {}, {**report["receipt"], "extra": True}):
            with self.assertRaises(ValueError):
                self.adapter.call(
                    "commit_artwork", {**self.candidate_args(candidate), "receipt": receipt}
                )
        with self.assertRaises(ValueError):
            self.adapter.call("commit_artwork", self.candidate_args(candidate))
        other = Project.create(self.root / "other", "Other")
        adapter = Adapter(other.root, single_project=True)
        with self.assertRaises(ValueError):
            adapter.call(
                "commit_artwork", {**self.candidate_args(candidate), "receipt": report["receipt"]}
            )
        self.assertEqual(before, self.snapshot())

    def test_stale_scene_and_competing_save_conflict_without_partial_files(self):
        candidate = self.create()
        report = self.review(candidate, scene=self.scene_context(candidate))
        scene_path = self.project.root / "scenes" / f"{self.loaded['id']}.tmj"
        scene_path.write_bytes(scene_path.read_bytes() + b" ")
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.commit(candidate, report)
        self.assertEqual(before, self.snapshot())
        report = self.review(candidate)
        competitor = Adapter(self.project.root, single_project=True)
        competitor.call(
            "commit_artwork", {**self.candidate_args(candidate), "receipt": report["receipt"]}
        )
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.commit(candidate, report)
        with self.assertRaises(Conflict):
            self.adapter.call("read_artwork_pixels", self.candidate_args(candidate))
        self.assertEqual(before, self.snapshot())

    def test_shared_edit_reviews_saved_references_and_keeps_scene_bytes(self):
        candidate = self.edit(self.create())
        self.commit(candidate)
        loaded = self.project.scenes.load(self.loaded["id"])
        scene = loaded["scene"]
        tiled.scene_layers(scene)[0]["cells"][0][:2] = [
            "new_tile/artwork/0/0",
            "new_tile/artwork/0/0#1",
        ]
        self.project.scenes.save(loaded["id"], scene, loaded["revision"], self.revision())
        native = self.adapter.call("list_artwork", self.guard())["documents"][0]
        opened = self.adapter.call(
            "open_artwork",
            {
                **self.guard(),
                "target": native["target"],
                "artwork_revision": native["artwork_revision"],
            },
        )
        changed = self.edit(opened, [dict(x=0, y=0, rgba=[240, 2, 3, 255])])
        loaded = self.project.scenes.load(loaded["id"])
        report = self.review(
            changed,
            scene=dict(
                scene_id=loaded["id"],
                scene_revision=loaded["revision"],
                scene=None,
                viewport=dict(x=0, y=0, width=32, height=32),
            ),
        )
        self.assertEqual(report["references"]["total"], 2)
        self.assertEqual(
            self.pixels(report["before"]["native_resource"])[2][:4], bytes([17, 83, 201, 255])
        )
        self.assertEqual(
            self.pixels(report["after"]["native_resource"])[2][:4], bytes([240, 2, 3, 255])
        )
        path = self.project.root / "scenes" / f"{loaded['id']}.tmj"
        before = path.read_bytes()
        saved = self.commit(changed, report)
        self.assertEqual(saved["scene_revisions"], {})
        self.assertEqual(path.read_bytes(), before)

    def test_busy_and_final_scene_race_never_replay_or_write_partially(self):
        candidate = self.create()
        report = self.review(candidate)
        before = self.snapshot()
        with patch.object(Transactions, "apply", side_effect=TransactionBusy("busy")) as apply:
            with self.assertRaises(Conflict):
                self.commit(candidate, report)
            self.assertEqual(apply.call_count, 1)
        self.assertEqual(before, self.snapshot())
        path = self.project.root / "scenes" / f"{self.loaded['id']}.tmj"
        original = Transactions.apply

        def race(transaction, *args, **kwargs):
            path.write_bytes(path.read_bytes() + b" ")
            return original(transaction, *args, **kwargs)

        with patch.object(Transactions, "apply", race), self.assertRaises(Conflict):
            self.commit(candidate, report)
        after = self.snapshot()
        self.assertEqual(set(before), set(after))
        for name, data in before.items():
            self.assertEqual(
                after[name], data + b" " if name == f"scenes/{self.loaded['id']}.tmj" else data
            )

    def test_input_and_review_bounds_are_explicit(self):
        candidate = self.create(kind="sprite", width=256, height=256)
        before = self.snapshot()
        for kwargs in (dict(scale=5), dict(scale=True), dict(offset=-1)):
            with self.assertRaises(ValueError):
                self.review(candidate, **kwargs)
        with self.assertRaises(ValueError):
            self.adapter.call(
                "read_artwork_pixels",
                {
                    **self.candidate_args(candidate),
                    "rectangle": dict(x=255, y=0, width=2, height=1),
                },
            )
        with self.assertRaises(ValueError):
            self.edit(candidate, [dict(x=0, y=0, rgba=[0] * 4)] * 65537)
        self.assertEqual(before, self.snapshot())
        caps = self.adapter.call("capabilities", {})["artwork"]
        self.assertTrue(caps["commit_requires_review_receipt"])
        self.assertEqual(caps["max_review_scenes"], 64)

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
    def test_official_sdk_new_tile_workflow_and_strict_schemas(self):
        asyncio.run(self.sdk_workflow())

    async def sdk_workflow(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.mcp_server", "--project", str(self.project.root)],
            env=dict(os.environ),
        )
        async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
            await client.initialize()
            tools = {t.name: t for t in (await client.list_tools()).tools}
            self.assertIn("commit_artwork", tools)

            async def call(name, args):
                response = await client.call_tool(name, args)
                self.assertFalse(response.isError, response.content)
                return response.structuredContent

            guard = self.guard()
            candidate = await call(
                "create_artwork",
                {
                    **guard,
                    "atlas_id": "sdk_tile",
                    "name": "SDK tile",
                    "kind": "tile",
                    "width": 8,
                    "height": 8,
                },
            )
            for bad in (
                {"candidate": {**candidate, "unexpected": True}},
                {"writes": [dict(x=True, y=0, rgba=[0] * 4)]},
                {"writes": [dict(x=0, y=0, rgba=[0] * 4, path="outside")]},
                {"extra": True},
            ):
                response = await client.call_tool(
                    "edit_artwork_pixels",
                    {
                        **self.candidate_args(candidate),
                        "writes": [dict(x=0, y=0, rgba=[0] * 4)],
                        **bad,
                    },
                )
                self.assertTrue(response.isError)
            candidate = await call(
                "edit_artwork_pixels",
                {
                    **self.candidate_args(candidate),
                    "writes": [
                        dict(x=0, y=0, rgba=[1, 2, 3, 0]),
                        dict(x=1, y=0, rgba=[127, 210, 41, 128]),
                    ],
                },
            )
            exact = await call("read_artwork_pixels", self.candidate_args(candidate))
            self.assertEqual(
                base64.b64decode(exact["rgba"])[:8], bytes([1, 2, 3, 0, 127, 210, 41, 128])
            )
            context = self.scene_context(candidate)
            response = await client.call_tool(
                "review_artwork_candidate",
                {
                    **self.candidate_args(candidate),
                    "scene": context,
                },
            )
            self.assertFalse(response.isError, response.content)
            report = response.structuredContent
            self.assertEqual(sum(c.type == "resource_link" for c in response.content), 4)
            resource = await client.read_resource(report["after"]["native_resource"]["uri"])
            self.assertEqual(
                png.decode(base64.b64decode(resource.contents[0].blob))[2],
                base64.b64decode(candidate["rgba"]),
            )
            # A post-review revision must be reviewed again; the old receipt
            # cannot authorize different pixels through the real transport.
            candidate = await call(
                "edit_artwork_pixels",
                {
                    **self.candidate_args(candidate),
                    "writes": [dict(x=2, y=0, rgba=[89, 180, 51, 255])],
                },
            )
            invalid = await client.call_tool(
                "commit_artwork",
                {
                    **self.candidate_args(candidate),
                    "receipt": report["receipt"],
                },
            )
            self.assertTrue(invalid.isError)
            self.assertEqual(invalid.structuredContent["error"]["code"], "conflict")
            report = await call(
                "review_artwork_candidate",
                {
                    **self.candidate_args(candidate),
                    "scene": context,
                },
            )
            before = self.snapshot()
            with self.project.transactions.locked():
                busy = await client.call_tool(
                    "commit_artwork",
                    {
                        **self.candidate_args(candidate),
                        "receipt": report["receipt"],
                    },
                )
            self.assertTrue(busy.isError)
            self.assertEqual(busy.structuredContent["error"]["code"], "busy")
            self.assertEqual(before, self.snapshot())
            saved = await call(
                "commit_artwork",
                {
                    **self.candidate_args(candidate),
                    "receipt": report["receipt"],
                },
            )
            self.assertEqual(saved["project_revision"], self.revision())
            self.assertEqual(saved["candidate_revision"], candidate["revision"])
            inventory = await call("list_artwork", self.guard())
            native = inventory["documents"][0]
            opened = await call(
                "open_artwork",
                {
                    **self.guard(),
                    "target": native["target"],
                    "artwork_revision": native["artwork_revision"],
                },
            )
            self.assertEqual(opened["rgba"], candidate["rgba"])
            duplicate = await call(
                "duplicate_artwork",
                {
                    **self.guard(),
                    "atlas_id": "sdk_copy",
                    "name": "SDK copy",
                    "source": dict(
                        atlas_id="sdk_tile",
                        region="artwork",
                        grid=8,
                        cell=[0, 0],
                        artwork_revision=native["artwork_revision"],
                    ),
                },
            )
            self.assertEqual(duplicate["rgba"], candidate["rgba"])
            loaded = await call("get_scene", dict(project="project", scene_id=self.loaded["id"]))
            layer = tiled.scene_layers(loaded["scene"])[0]["id"]
            await call(
                "edit_scene",
                {
                    **self.guard(),
                    "scene_id": loaded["id"],
                    "scene_revision": loaded["revision"],
                    "operations": [
                        dict(
                            op="paint_tiles",
                            layer_id=layer,
                            cells=[dict(x=0, y=0, tile="sdk_tile/artwork/0/0")],
                        )
                    ],
                },
            )
            stale = await client.call_tool(
                "commit_artwork",
                {
                    **self.candidate_args(candidate),
                    "receipt": report["receipt"],
                },
            )
            self.assertTrue(stale.isError)
            self.assertEqual(stale.structuredContent["error"]["code"], "conflict")
            self.assertEqual(
                tiled.scene_layers(self.project.scenes.load(loaded["id"])["scene"])[0]["cells"][0][
                    0
                ],
                "sdk_tile/artwork/0/0",
            )
            loaded = self.project.scenes.load(loaded["id"])
            selection = dict(
                scene_id=loaded["id"], scene_revision=loaded["revision"], layer_id=layer, x=0, y=0
            )
            variation_args = {
                **self.guard(),
                "atlas_id": "sdk_variation",
                "name": "SDK variation",
                "source": dict(
                    atlas_id="sdk_tile",
                    region="artwork",
                    grid=8,
                    cell=[0, 0],
                    artwork_revision=native["artwork_revision"],
                ),
                "placements": [selection],
            }
            for invalid in (
                [{**selection, "x": True}],
                [{**selection, "extra": True}],
                [selection] * 257,
            ):
                response = await client.call_tool(
                    "duplicate_artwork", {**variation_args, "placements": invalid}
                )
                self.assertTrue(response.isError)
            variation = await call("duplicate_artwork", variation_args)
            variation = await call(
                "edit_artwork_pixels",
                {
                    **self.candidate_args(variation),
                    "writes": [dict(x=0, y=0, rgba=[220, 100, 50, 255])],
                },
            )
            report = await call(
                "review_artwork_candidate",
                {
                    **self.candidate_args(variation),
                    "scene": dict(
                        scene_id=loaded["id"],
                        scene_revision=loaded["revision"],
                        scene=None,
                        viewport=dict(x=0, y=0, width=32, height=32),
                    ),
                },
            )
            self.assertEqual(report["replacements"], [selection])
            self.assertEqual(report["references"]["total"], 1)
            self.assertNotEqual(
                report["scene"]["before_resource"]["uri"], report["scene"]["after_resource"]["uri"]
            )
            ack = await call(
                "commit_artwork", {**self.candidate_args(variation), "receipt": report["receipt"]}
            )
            self.assertEqual(ack["replaced_scenes"], [loaded["id"]])
            self.assertEqual(
                tiled.scene_layers(self.project.scenes.load(loaded["id"])["scene"])[0]["cells"][0][
                    0
                ],
                "sdk_variation/artwork/0/0",
            )
            original = self.project.artwork.documents.open(
                native["target"], self.revision(), native["artwork_revision"]
            )
            self.assertEqual(original["rgba"], candidate["rgba"])
