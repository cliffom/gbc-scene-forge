"""Compact agent-only sheets, explicit handoff and recoverable immutable candidates."""

import base64
import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from backend.artwork.test_sheets import frame, sequence
from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork.candidates import ArtworkCandidates
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project


class McpSheets(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Project.create(Path(temporary.name) / "project", "Sheets")
        self.adapter = Adapter(self.project.root, single_project=True)

    def call(self, tool_name, **args):
        return self.adapter.call(tool_name, {"project": "project", **args})

    def create(self, **args):
        return self.call(
            "create_artwork_sheet",
            atlas_id="player",
            name="Player",
            kind="sprite",
            width=16,
            height=8,
            frames=[frame("idle"), frame("step", 8)],
            sequences=[sequence()],
            project_revision=self.project.catalog()["revision"],
            **args,
        )

    def test_compact_agent_create_edit_review_commit_restart_and_manual_handoff(self):
        compact = self.create(compact=True)
        full = self.call("export_artwork_candidate", candidate=compact)
        self.assertLess(len(json.dumps(compact)), len(json.dumps(full)) / 3)
        edited = self.call(
            "edit_artwork_pixels",
            candidate=compact,
            writes=[{"x": 1, "y": 1, "rgba": [77, 88, 99, 0]}],
        )
        self.assertNotEqual(compact["revision"], edited["revision"])
        self.assertEqual(self.call("export_artwork_candidate", candidate=compact), full)
        pixels = self.call(
            "read_artwork_pixels",
            candidate=edited,
            rectangle={"x": 1, "y": 1, "width": 1, "height": 1},
        )
        self.assertEqual(base64.b64decode(pixels["rgba"]), bytes([77, 88, 99, 0]))
        animation = self.call(
            "review_artwork_animation", candidate=edited, sequence_id="walk", scale=2
        )
        frame_review = self.call("review_artwork_frame", candidate=edited, frame_id="idle", scale=1)
        self.assertEqual(frame_review["frame"]["origin"], [3, 5])
        self.assertEqual(frame_review["receipt"]["candidate_revision"], edited["revision"])
        self.assertEqual(animation["animation_resource"]["mimeType"], "image/apng")
        self.assertEqual(animation["receipt"]["candidate_revision"], edited["revision"])
        with self.assertRaises(Conflict):
            self.call("commit_artwork", candidate=compact, receipt=animation["receipt"])
        ack = self.call("commit_artwork", candidate=edited, receipt=animation["receipt"])
        # Handles remain exportable against stale bases after committing and restarting.
        self.adapter = Adapter(self.project.root, single_project=True)
        listing = self.call("list_artwork_candidates")
        self.assertEqual(len(listing["candidates"]), 2)
        self.assertEqual(
            self.call("export_artwork_candidate", candidate=edited)["revision"], edited["revision"]
        )
        inventory = self.call("list_artwork", project_revision=ack["project_revision"])
        native = inventory["documents"][0]
        opened = self.call(
            "open_artwork",
            target=native["target"],
            project_revision=ack["project_revision"],
            artwork_revision=native["artwork_revision"],
            compact=True,
        )
        manual = self.project.artwork.documents.open(
            native["target"], ack["project_revision"], native["artwork_revision"]
        )
        manual = self.project.artwork.documents.edit(
            manual, [{"x": 9, "y": 2, "rgba": [11, 22, 33, 128]}]
        )
        sequences = copy.deepcopy(manual["descriptor"]["sequences"])
        sequences[0]["frames"][0]["duration_ms"] = 333
        manual = self.project.artwork.documents.layout(
            manual, manual["descriptor"]["frames"], sequences
        )
        report = self.project.artwork.reviews.animation(manual, "walk", scale=1)
        saved = self.project.artwork.documents.save(manual, receipt=report["receipt"])
        with self.assertRaises(Conflict):
            self.call(
                "edit_artwork_pixels",
                candidate=opened,
                writes=[{"x": 0, "y": 0, "rgba": [0, 0, 0, 255]}],
            )
        continued = self.call(
            "open_artwork",
            target=native["target"],
            project_revision=saved["project_revision"],
            artwork_revision=saved["artwork_revision"],
            compact=True,
        )
        envelope = self.call("export_artwork_candidate", candidate=continued)
        self.assertEqual(envelope["descriptor"]["sequences"][0]["frames"][0]["duration_ms"], 333)
        self.assertEqual(envelope["rgba"], manual["rgba"])
        self.call("release_artwork_candidate", candidate=compact)
        with self.assertRaisesRegex(ValueError, "unavailable"):
            self.call("export_artwork_candidate", candidate=compact)
        restored = self.call("retain_artwork_candidate", candidate=full)
        self.assertEqual(restored, compact)

    def test_corruption_wrong_project_and_quota_retain_original_pixels(self):
        handle = self.create(compact=True)
        full = self.call("export_artwork_candidate", candidate=handle)
        candidates = ArtworkCandidates(self.project.artwork.documents)
        with patch("gbc_scene_forge.artwork.candidates.MAX_COUNT", 1):
            with self.assertRaisesRegex(ValueError, "limit"):
                self.call(
                    "edit_artwork_pixels",
                    candidate=handle,
                    writes=[{"x": 0, "y": 0, "rgba": [1, 2, 3, 0]}],
                )
        self.assertEqual(self.call("export_artwork_candidate", candidate=handle), full)
        wrong = {**handle, "project_revision": "0" * 64}
        with self.assertRaisesRegex(ValueError, "identity"):
            candidates.resolve(wrong)
        candidates.path(handle["revision"]).write_text("{}")
        with self.assertRaises(ValueError):
            candidates.resolve(handle)
        self.assertIn("error", candidates.list()["candidates"][0])

    def test_sdk_compact_sheet_animation_and_strict_nested_schemas(self):
        import asyncio
        import importlib.util

        if not importlib.util.find_spec("mcp"):
            self.skipTest("Install optional MCP SDK")
        asyncio.run(self.sdk_workflow())

    async def sdk_workflow(self):
        import os
        import sys

        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        parameters = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.mcp_server", "--project", str(self.project.root)],
            env=dict(os.environ),
        )
        async with stdio_client(parameters) as (read, write), ClientSession(read, write) as client:
            await client.initialize()
            definitions = {tool.name: tool for tool in (await client.list_tools()).tools}
            tools = set(definitions)
            self.assertFalse(definitions["create_artwork_sheet"].annotations.readOnlyHint)
            self.assertFalse(definitions["create_artwork_sheet"].annotations.destructiveHint)
            self.assertTrue(
                {
                    "create_artwork_sheet",
                    "review_artwork_frame",
                    "review_artwork_animation",
                    "review_sprite_tile_conversion",
                }
                <= tools
            )

            async def call(tool, **arguments):
                result = await client.call_tool(tool, {"project": "project", **arguments})
                self.assertFalse(result.isError, result.content)
                return result.structuredContent

            candidate = await call(
                "create_artwork_sheet",
                atlas_id="sdk_player",
                name="SDK player",
                kind="sprite",
                width=16,
                height=8,
                project_revision=self.project.catalog()["revision"],
                frames=[frame("idle"), frame("step", 8)],
                sequences=[sequence()],
                compact=True,
            )
            self.assertNotIn("rgba", candidate)
            full = await call("export_artwork_candidate", candidate=candidate)
            owner = str(uuid4())
            scoped = ArtworkCandidates(self.project.artwork.documents).retain(full, owner=owner)
            self.assertEqual(await call("export_artwork_candidate", candidate=scoped), full)
            changed = await call(
                "edit_artwork_pixels",
                candidate=scoped,
                writes=[dict(x=0, y=0, rgba=[1, 2, 3, 0])],
            )
            self.assertEqual(changed["owner"], owner)
            await call("release_artwork_candidate", candidate=scoped)
            await call("release_artwork_candidate", candidate=changed)
            self.assertEqual(await call("export_artwork_candidate", candidate=candidate), full)
            for bad in (
                {"candidate": {**candidate, "unexpected": True}},
                {"candidate": {**candidate, "owner": "../escape"}},
                {"frames": [{**frame("idle"), "x": True}]},
            ):
                result = await client.call_tool(
                    "edit_artwork_layout",
                    {
                        "project": "project",
                        "candidate": candidate,
                        "frames": [frame("idle"), frame("step", 8)],
                        "sequences": [sequence()],
                        **bad,
                    },
                )
                self.assertTrue(result.isError)
            candidate = await call(
                "edit_artwork_pixels",
                candidate=candidate,
                writes=[
                    dict(x=0, y=0, rgba=[17, 28, 39, 0]),
                    dict(x=2, y=2, rgba=[140, 180, 90, 255]),
                    dict(x=10, y=3, rgba=[140, 180, 90, 255]),
                ],
            )
            report = await call(
                "review_artwork_animation", candidate=candidate, sequence_id="walk", scale=1
            )
            resource = await client.read_resource(report["animation_resource"]["uri"])
            self.assertTrue(resource.contents)
            await call("review_artwork_frame", candidate=candidate, frame_id="idle", scale=2)
            saved = await call("commit_artwork", candidate=candidate, receipt=report["receipt"])
            inventory = await call("list_artwork", project_revision=saved["project_revision"])
            item = inventory["documents"][0]
            opened = await call(
                "open_artwork",
                project_revision=saved["project_revision"],
                target=item["target"],
                artwork_revision=item["artwork_revision"],
                compact=True,
            )
            full = await call("export_artwork_candidate", candidate=opened)
            self.assertEqual(base64.b64decode(full["rgba"])[:4], bytes([17, 28, 39, 0]))
            self.assertEqual(full["descriptor"]["sequences"], [sequence()])
            tile = await call(
                "create_artwork_sheet",
                atlas_id="sdk_tiles",
                name="SDK tiles",
                kind="tile",
                width=8,
                height=8,
                project_revision=saved["project_revision"],
                frames=[frame("ground", kind="tile")],
                sequences=[],
                compact=True,
            )
            tile = await call(
                "edit_artwork_pixels",
                candidate=tile,
                writes=[dict(x=0, y=0, rgba=[80, 110, 50, 255])],
            )
            reviewed = await call("review_artwork_candidate", candidate=tile, scale=1)
            tile_saved = await call("commit_artwork", candidate=tile, receipt=reviewed["receipt"])
            scene = await call(
                "create_scene",
                name="SDK authored scene",
                width=4,
                height=2,
                grid=8,
                project_revision=tile_saved["project_revision"],
            )
            contents = {
                "width": 4,
                "height": 2,
                "grid": 8,
                "cells": [["sdk_tiles/ground/0/0"] * 4 for _ in range(2)],
                "objects": [{"id": 1, "asset": "sdk_player/idle", "x": 11, "y": 13}],
                "next_object_id": 2,
            }
            placed = await call(
                "save_scene",
                scene_id=scene["id"],
                scene_revision=scene["revision"],
                project_revision=scene["project_revision"],
                scene=contents,
            )
            reopened = await call("get_scene", scene_id=scene["id"])
            self.assertEqual(reopened["scene"], placed["scene"])
            exported = await call(
                "export_bundle", scope="project", project_revision=reopened["project_revision"]
            )
            resource = await client.read_resource(exported["resource"]["uri"])
            with zipfile.ZipFile(
                io.BytesIO(base64.b64decode(resource.contents[0].blob))
            ) as archive:
                archive.extractall(self.project.root.parent / "sdk-export")
            restored = Project(self.project.root.parent / "sdk-export")
            self.assertEqual(restored.scenes.load(scene["id"])["scene"], placed["scene"])
            native = restored.artwork.documents.list(restored.catalog()["revision"])
            player = next(d for d in native["documents"] if d["target"]["atlas_id"] == "sdk_player")
            restored_player = restored.artwork.documents.open(
                player["target"], restored.catalog()["revision"], player["artwork_revision"]
            )
            self.assertEqual(restored_player["rgba"], full["rgba"])
            self.assertEqual(restored_player["descriptor"], full["descriptor"])
