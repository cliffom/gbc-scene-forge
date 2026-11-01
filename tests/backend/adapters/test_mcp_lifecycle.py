"""Saved lifecycle contracts, atomic failures and installed official-SDK workflow."""

import asyncio
import copy
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning import world
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.scene_objects.definitions import resolve
from gbc_scene_forge.storage.files import digest


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Lifecycle", starter="blockout")
        self.adapter = Adapter(self.project.root, single_project=True)
        self.loaded = self.project.scenes.create("Source", 4, 4, 8, self.revision())
        self.definition = next(
            d
            for d in self.project.catalog()["project"]["object_definitions"]["definitions"]
            if d["name"] == "Player spawn"
        )
        self.override = [
            dict(name="design_note", type="int", value=7),
            dict(name="route", type="string", value="retained"),
        ]
        self.adapter.call(
            "edit_scene",
            {
                **self.args(),
                "operations": [
                    dict(op="create_layer", name="Objects", type="objectgroup"),
                    dict(
                        op="place",
                        definition_id=self.definition["id"],
                        layer_id=2,
                        x=8,
                        y=8,
                        properties=self.override,
                    ),
                    dict(op="update_layer", layer_id=2, changes=dict(visible=False)),
                ],
            },
        )
        self.scene = self.project.scenes.load(self.loaded["id"])["scene"]
        saved = self.adapter.call(
            "save_stamp", {**self.guard(), "name": "Reusable", "scene": self.scene, "slots": [0, 0]}
        )
        self.stamp_id = saved["project"]["stamps"][-1]["id"]
        self.adapter.call(
            "save_stamp",
            {
                **self.guard(),
                "name": "Unrelated",
                "scene": dict(width=1, height=1, grid=8, cells=[[""]]),
                "slots": [0],
            },
        )
        self.unrelated = copy.deepcopy(self.project.catalog()["project"]["stamps"][-1])

    def revision(self):
        return self.project.catalog()["revision"]

    def guard(self):
        return dict(project="project", project_revision=self.revision())

    def args(self, scene_id=None):
        loaded = self.project.scenes.load(scene_id or self.loaded["id"])
        return {**self.guard(), "scene_id": loaded["id"], "scene_revision": loaded["revision"]}

    def files(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file()
        }

    def linked_world(self):
        other = self.project.scenes.duplicate(
            self.loaded["id"], "Other", self.args()["scene_revision"], self.revision()
        )
        destination = other["duplicated"]
        link = dict(
            id=str(uuid4()),
            name="Door",
            direction="two-way",
            source=dict(scene=self.loaded["id"], object=1),
            destination=dict(scene=destination, object=1),
        )
        world = dict(version=1, positions={self.loaded["id"]: dict(x=4, y=8)}, connections=[link])
        revisions = {
            s["id"]: self.project.scenes.load(s["id"])["revision"]
            for s in self.project.catalog()["project"]["scenes"]
        }
        self.project.planning.save_world(world, self.revision(), revisions)
        return link, destination

    def test_rename_duplicate_and_delete_preserve_native_content(self):
        source = self.project.root / f"scenes/{self.loaded['id']}.tmj"
        before = source.read_bytes()
        renamed = self.adapter.call("rename_scene", {**self.args(), "name": "Renamed"})
        self.assertEqual(renamed["renamed"], self.loaded["id"])
        self.assertEqual(renamed["revision"], self.revision())
        self.assertEqual(source.read_bytes(), before)
        copied = self.adapter.call("duplicate_scene", {**self.args(), "name": "Copy"})
        self.assertNotEqual(copied["duplicated"], self.loaded["id"])
        self.assertEqual(copied["source_scene_id"], self.loaded["id"])
        loaded = self.project.scenes.load(copied["duplicated"])
        self.assertEqual(loaded["scene"], self.scene)
        self.assertEqual(loaded["revision"], copied["scene_revision"])
        deleted = self.adapter.call("delete_scene", self.args(copied["duplicated"]))
        self.assertEqual(deleted["deleted"], copied["duplicated"])
        self.assertEqual(deleted["revision"], self.revision())
        self.assertFalse((self.project.root / f"scenes/{copied['duplicated']}.tmj").exists())
        self.assertEqual(source.read_bytes(), before)

    def test_linked_delete_requires_inspectable_acknowledgment(self):
        link, other = self.linked_world()
        before = self.files()
        preview = self.adapter.call("delete_scene", {**self.args(), "dry_run": True})
        self.assertEqual(preview["consequences"]["connections"], [link])
        self.assertEqual(preview["consequences"]["world_position"], dict(x=4, y=8))
        self.assertEqual(self.files(), before)
        for options in ({}, dict(confirm_broken_links="true"), dict(confirm_broken_links=1)):
            with self.assertRaises(ValueError):
                self.adapter.call("delete_scene", {**self.args(), **options})
            self.assertEqual(self.files(), before)
        deleted = self.adapter.call("delete_scene", {**self.args(), "confirm_broken_links": True})
        self.assertEqual(deleted["consequences"], preview["consequences"])
        self.assertEqual(deleted["project"]["world"]["connections"], [link])
        self.assertNotIn(self.loaded["id"], deleted["project"]["world"]["positions"])
        self.assertEqual(self.project.scenes.load(other)["scene"], self.scene)

    def test_referenced_definition_cleanup_retains_overrides_and_stamps(self):
        before = self.files()
        original_library = copy.deepcopy(
            self.project.catalog()["project"]["object_definitions"]["definitions"]
        )
        arguments = {**self.guard(), "definition_id": self.definition["id"]}
        preview = self.adapter.call("delete_object_definition", {**arguments, "dry_run": True})
        self.assertEqual(self.files(), before)
        refs = preview["consequences"]
        self.assertEqual(refs["scene_references"][0]["object_id"], 1)
        self.assertEqual(refs["scene_references"][0]["scene_id"], self.loaded["id"])
        self.assertEqual(refs["stamp_references"][0]["stamp_id"], self.stamp_id)
        item = tiled.scene_layers(self.scene)[1]["objects"][0]
        effective, _ = resolve(item, [self.definition])
        self.assertGreater(len(effective), len(self.override))
        deleted = self.adapter.call("delete_object_definition", arguments)
        self.assertEqual(deleted["consequences"], refs)
        self.assertEqual(deleted["revision"], self.revision())
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], self.scene)
        library = deleted["project"]["object_definitions"]["definitions"]
        self.assertEqual(
            resolve(item, library), (self.override, [dict(field="", code="missing-definition")])
        )
        self.assertEqual(deleted["project"]["stamps"][0]["scene"], self.scene)
        self.assertEqual(deleted["project"]["stamps"][1], self.unrelated)
        self.assertEqual(
            library,
            [d for d in original_library if d["id"] != self.definition["id"]],
        )

    def test_stamp_cleanup_preserves_actual_placements(self):
        self.adapter.call(
            "edit_scene",
            {
                **self.args(),
                "operations": [dict(op="update_layer", layer_id=2, changes=dict(visible=True))],
            },
        )
        self.adapter.call("place_stamp", {**self.args(), "stamp_id": self.stamp_id, "x": 0, "y": 0})
        placed = self.project.scenes.load(self.loaded["id"])["scene"]
        before = self.files()
        arguments = {**self.guard(), "stamp_id": self.stamp_id}
        self.adapter.call("delete_stamp", {**arguments, "dry_run": True})
        self.assertEqual(before, self.files())
        result = self.adapter.call("delete_stamp", arguments)
        self.assertEqual(result["deleted_stamp_id"], self.stamp_id)
        self.assertEqual(result["project"]["stamps"], [self.unrelated])
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], placed)

    def operations(self):
        return [
            ("rename_scene", {**self.args(), "name": "New"}),
            ("duplicate_scene", {**self.args(), "name": "Copy"}),
            ("delete_scene", self.args()),
            ("delete_object_definition", {**self.guard(), "definition_id": self.definition["id"]}),
            ("delete_stamp", {**self.guard(), "stamp_id": self.stamp_id}),
        ]

    def test_invalid_paths_unknown_ids_and_stale_revisions_are_atomic(self):
        for tool, arguments in self.operations():
            identity = (
                "scene_id"
                if "scene_id" in arguments
                else "definition_id"
                if "definition_id" in arguments
                else "stamp_id"
            )
            for bad in (
                dict(project="../escape"),
                {identity: str(uuid4())},
                dict(extra=True),
                dict(project_revision="0" * 64),
                dict(project_revision=None),
                *([dict(scene_revision="0" * 64)] if "scene_id" in arguments else []),
                *([dict(name=" ")] if "name" in arguments else [dict(dry_run="true")]),
            ):
                before = self.files()
                with self.subTest(tool=tool, bad=bad), self.assertRaises(ValueError):
                    self.adapter.call(tool, {**arguments, **bad})
                self.assertEqual(before, self.files())
        stale = self.operations()
        self.project.scenes.create("Concurrent", 1, 1, 8, self.revision())
        before = self.files()
        for tool, arguments in stale:
            for options in [{}, dict(dry_run=True)] if tool.startswith("delete") else [{}]:
                with self.assertRaises(Conflict):
                    self.adapter.call(tool, {**arguments, **options})
                self.assertEqual(before, self.files())

    def test_final_transaction_rejects_racing_scene_and_manifest_writes(self):
        commit = ProjectStore.commit
        for tool, _ in self.operations():
            arguments = dict(self.operations())[tool]
            later = None

            def concurrent(store, *args, **kwargs):
                nonlocal later
                if later is None:
                    with patch.object(ProjectStore, "commit", commit):
                        if "scene_id" in arguments or tool == "delete_object_definition":
                            loaded = self.project.scenes.load(self.loaded["id"])
                            loaded["scene"]["layers"][1]["objects"][0]["x"] += 1
                            self.project.scenes.save(
                                loaded["id"], loaded["scene"], loaded["revision"], self.revision()
                            )
                        else:
                            self.project.scenes.create("Concurrent", 1, 1, 8, self.revision())
                    later = self.files()
                return commit(store, *args, **kwargs)

            with patch.object(ProjectStore, "commit", concurrent), self.assertRaises(Conflict):
                self.adapter.call(tool, arguments)
            self.assertEqual(self.files(), later)

    def test_acknowledgments_do_not_adopt_a_later_writer(self):
        commit = ProjectStore.commit
        # Delete source last; other operations still need it.
        for tool, _ in sorted(self.operations(), key=lambda op: op[0] == "delete_scene"):
            arguments = dict(self.operations())[tool]
            committed = None

            def later_write(store, *args, **kwargs):
                nonlocal committed
                commit(store, *args, **kwargs)
                committed = copy.deepcopy(args[0])
                with patch.object(ProjectStore, "commit", commit):
                    self.project.scenes.create("Later writer", 1, 1, 8, self.revision())

            with patch.object(ProjectStore, "commit", later_write):
                result = self.adapter.call(tool, arguments)
            self.assertNotEqual(result["revision"], self.revision())
            self.assertEqual(result["project"], committed)
            self.assertEqual(result["revision"], digest(json_text(committed).encode()))

    def test_deletion_preview_revalidates_concurrent_manifest_changes(self):
        references = world.references
        guards = ProjectStore.scene_guards

        def changed_references(*args):
            result = references(*args)
            self.project.scenes.create("Later preview writer", 1, 1, 8, self.revision())
            return result

        def changed_guards(store, *args):
            result = guards(store, *args)
            self.project.scenes.create("Later reference writer", 1, 1, 8, self.revision())
            return result

        with patch.object(world, "references", changed_references), self.assertRaises(Conflict):
            self.adapter.call("delete_scene", {**self.args(), "dry_run": True})
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], self.scene)
        with (
            patch.object(ProjectStore, "scene_guards", changed_guards),
            self.assertRaises(Conflict),
        ):
            self.adapter.call(
                "delete_object_definition",
                {**self.guard(), "definition_id": self.definition["id"], "dry_run": True},
            )
        self.assertIn(
            self.definition, self.project.catalog()["project"]["object_definitions"]["definitions"]
        )

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
    def test_real_sdk_lifecycle_and_schema_guards(self):
        asyncio.run(self.sdk_session())

    async def sdk_session(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        link, _ = self.linked_world()
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.mcp_server", "--project", str(self.project.root)],
            env=dict(os.environ),
        )
        async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
            await client.initialize()
            inventory = await client.list_tools()
            for tool, arguments in self.operations():
                shape = next(t.inputSchema for t in inventory.tools if t.name == tool)
                self.assertFalse(shape["additionalProperties"])
                for bad in (
                    dict(extra=True),
                    dict(project_revision="bad"),
                    *([dict(dry_run="true")] if tool.startswith("delete") else []),
                ):
                    result = await client.call_tool(tool, {**arguments, **bad})
                    self.assertTrue(result.isError)

            async def call(tool, arguments):
                result = await client.call_tool(tool, arguments)
                self.assertFalse(result.isError, result.content)
                return result.structuredContent

            await call("rename_scene", {**self.args(), "name": "SDK source"})
            copied = await call("duplicate_scene", {**self.args(), "name": "SDK copy"})
            loaded = await call("get_scene", dict(project="project", scene_id=copied["duplicated"]))
            self.assertEqual(loaded["scene"], self.scene)
            await call(
                "edit_scene",
                {
                    **self.args(copied["duplicated"]),
                    "operations": [dict(op="update_layer", layer_id=2, changes=dict(visible=True))],
                },
            )
            placed = await call(
                "place_stamp",
                {**self.args(copied["duplicated"]), "stamp_id": self.stamp_id, "x": 0, "y": 0},
            )
            arguments = {**self.guard(), "definition_id": self.definition["id"]}
            preview = await call("delete_object_definition", {**arguments, "dry_run": True})
            self.assertEqual(len(preview["consequences"]["scene_references"]), 4)
            deleted = await call("delete_object_definition", arguments)
            self.assertEqual(deleted["consequences"], preview["consequences"])
            conflict = await client.call_tool("delete_object_definition", arguments)
            self.assertTrue(conflict.isError)
            self.assertEqual(conflict.structuredContent["error"]["code"], "conflict")
            await call("delete_stamp", {**self.guard(), "stamp_id": self.stamp_id})
            retained = await call(
                "get_scene", dict(project="project", scene_id=copied["duplicated"])
            )
            self.assertEqual(retained["scene"], placed["scene"])
            for item in tiled.scene_layers(retained["scene"])[1]["objects"]:
                self.assertEqual(
                    resolve(item, deleted["project"]["object_definitions"]["definitions"]),
                    (self.override, [dict(field="", code="missing-definition")]),
                )
            await call("delete_scene", self.args(copied["duplicated"]))
            arguments = self.args()
            preview = await call("delete_scene", {**arguments, "dry_run": True})
            self.assertEqual(preview["consequences"]["connections"], [link])
            rejected = await client.call_tool("delete_scene", arguments)
            self.assertTrue(rejected.isError)
            await call("delete_scene", {**arguments, "confirm_broken_links": True})
            catalog = await call("get_project", dict(project="project"))
            self.assertEqual(catalog["project"]["stamps"], [self.unrelated])
            self.assertEqual(catalog["project"]["world"]["connections"], [link])
