"""Native adapter safety and optional real SDK stdio interoperability."""

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
from uuid import uuid4

from atlas_fixture import bundle
from blockout_fixture import opening_forest

from gbc_scene_forge import authoring, blockout, tiled, transactions
from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.mcp_tools import MAX_ARTIFACT, MAX_CACHE, TOOLS, Adapter
from gbc_scene_forge.projects import MANIFEST, Project


class AdapterTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.adapter = Adapter(self.root / "projects")
        self.adapter.call("create_project", {"name": "Plan", "starter": "blockout"})
        self.project = Project(self.root / "projects/plan")
        self.loaded, self.identities = opening_forest(self.project)

    def args(self):
        return dict(
            project="plan",
            project_revision=self.project.catalog()["revision"],
            scene_id=self.loaded["id"],
            scene_revision=self.project.load_scene(self.loaded["id"])["revision"],
        )

    def test_discovery_canonical_equivalence_and_export(self):
        catalog = self.adapter.call("get_project", dict(project="plan"))
        self.assertEqual(catalog, self.project.catalog())
        self.assertEqual(self.adapter.call("list_projects", {})["projects"][0]["directory"], "plan")
        loaded = self.adapter.call("get_scene", dict(project="plan", scene_id=self.loaded["id"]))
        self.assertEqual(loaded["scene"], self.loaded["scene"])
        result = self.adapter.call("export_bundle", {**self.args(), "scope": "scene"})
        contents = self.adapter.read_artifact(result["resource"]["uri"])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(contents["blob"]))) as archive:
            exported = json.loads(archive.read(f"scenes/{loaded['id']}.tmj"))
        self.assertEqual(tiled.decode(exported, catalog["project"]), loaded["scene"])

    def test_dry_run_review_then_save_preserves_ids_and_input(self):
        original = copy.deepcopy(self.loaded["scene"])
        args = {
            **self.args(),
            "operations": [
                dict(
                    op="update", object_id=self.identities["Vine landing"], changes=dict(width=72)
                ),
                dict(op="update", object_id=self.identities["Forest patrol"], changes=dict(x=112)),
                dict(
                    op="update",
                    object_id=self.identities["Short vine"],
                    changes=dict(y=184, height=56),
                ),
            ],
        }
        preview = self.adapter.call("edit_scene", {**args, "dry_run": True})
        self.assertEqual(self.project.load_scene(self.loaded["id"])["scene"], original)
        self.assertEqual(preview["changes"]["object_change_count"], 3)
        report = self.adapter.call("review_blockout", {**self.args(), "scene": preview["scene"]})
        self.assertEqual(report["snapshot_revision"], preview["changes"]["after_snapshot"])
        self.assertEqual(report["camera"]["y"], 136)
        self.assertEqual(report["camera"]["width"], 160)
        self.assertIn(
            "Vine landing", self.adapter.read_artifact(report["overview_resource"]["uri"])["text"]
        )
        saved = self.adapter.call("save_scene", {**self.args(), "scene": preview["scene"]})
        self.assertEqual(saved["scene"], preview["scene"])
        self.assertEqual(self.loaded["scene"], original)
        self.assertEqual(self.project.load_scene(saved["id"])["scene"], saved["scene"])
        definitions = self.project.catalog()["project"]["object_definitions"]
        source, _ = bundle(self.root / "art")
        self.project.import_atlas(source, self.project.catalog()["revision"])
        self.assertEqual(self.project.load_scene(saved["id"])["scene"], saved["scene"])
        self.assertEqual(self.project.catalog()["project"]["object_definitions"], definitions)

    def test_atomic_invalid_and_oversized_batches(self):
        before = self.project.load_scene(self.loaded["id"])
        for operations in (
            [
                dict(op="delete", object_id=self.identities["Short vine"]),
                dict(op="update", object_id=99999, changes={}),
            ],
            [dict(op="delete", object_id=1)] * 129,
            [dict(op="update", object_id=True)],
            [],
            [dict(op="shell", command="pwd")],
            [dict(op="update", object_id=1, changes=dict(id=4))],
        ):
            with self.subTest(operations=operations[:2]), self.assertRaises(ValueError):
                self.adapter.call("edit_scene", {**self.args(), "operations": operations})
            self.assertEqual(self.project.load_scene(self.loaded["id"]), before)
        with self.assertRaisesRegex(ValueError, "4 MiB"):
            self.adapter.call("capabilities", {"x": "x" * (authoring.MAX_INPUT + 1)})

    def test_stale_browser_and_mcp_revisions_preserve_both_candidates(self):
        old = self.args()
        browser = copy.deepcopy(self.loaded["scene"])
        browser["layers"][-1]["objects"][0]["x"] = 16
        result = self.adapter.call(
            "edit_scene",
            {
                **old,
                "operations": [
                    dict(
                        op="update", object_id=self.identities["Forest patrol"], changes=dict(x=112)
                    )
                ],
            },
        )
        with self.assertRaises(Conflict):
            self.project.save_scene(
                self.loaded["id"], browser, old["scene_revision"], old["project_revision"]
            )
        with self.assertRaises(Conflict):
            self.adapter.call("edit_scene", {**old, "operations": [dict(op="delete", object_id=1)]})
        self.assertEqual(browser["layers"][-1]["objects"][0]["x"], 16)
        self.assertEqual(self.project.load_scene(self.loaded["id"])["scene"], result["scene"])
        definition = copy.deepcopy(
            self.project.catalog()["project"]["object_definitions"]["definitions"][0]
        )
        definition["name"] = "Changed by browser"
        self.project.save_object_definition(definition, old["project_revision"])
        with self.assertRaises(Conflict):
            self.adapter.call(
                "diagnostics", dict(project="plan", project_revision=old["project_revision"])
            )

    def test_interrupted_write_uses_native_recovery(self):
        original = self.project.load_scene(self.loaded["id"])
        real = transactions.atomic_write
        failed = False

        def interrupt(path, data):
            nonlocal failed
            if path == self.project.root / MANIFEST and not failed:
                failed = True
                raise KeyboardInterrupt("Simulated process interruption")
            return real(path, data)

        # Model a process that cannot run rollback: leave the applying journal
        # and the changed map behind for a fresh Project instance to recover.
        with (
            patch.object(transactions, "atomic_write", side_effect=interrupt),
            patch.object(
                transactions.Transactions,
                "_restore",
                side_effect=KeyboardInterrupt("Process ended"),
            ),
        ):
            with self.assertRaises(KeyboardInterrupt):
                self.adapter.call(
                    "edit_scene",
                    {
                        **self.args(),
                        "operations": [
                            dict(
                                op="update",
                                object_id=self.identities["Forest patrol"],
                                changes=dict(x=112),
                            )
                        ],
                    },
                )
        path = self.project.root / "scenes" / f"{self.loaded['id']}.tmj"
        self.assertNotEqual(transactions.digest(path.read_bytes()), original["revision"])
        reopened = Project(self.project.root)
        self.assertEqual(reopened.load_scene(self.loaded["id"]), original)
        self.assertTrue(any(r["status"] == "recovered" for r in reopened.transactions.records()))

    def test_declared_paths_and_artifacts(self):
        for path in ("../plan", str(self.root), "plan/sub", ".", ".."):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.adapter.call("get_project", dict(project=path))
        (self.root / "projects/link").symlink_to(self.project.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.adapter.call("get_project", dict(project="link"))
        with self.assertRaises(ValueError):
            self.adapter.call("execute_shell", {})
        with self.assertRaises(ValueError):
            self.adapter.read_artifact("file:///etc/passwd")
        one = self.adapter.artifact(b"a" * MAX_ARTIFACT, "application/zip", "one.zip")
        self.adapter.artifact(b"b" * MAX_ARTIFACT, "application/zip", "two.zip")
        self.assertLessEqual(sum(len(v[0]) for v in self.adapter.artifacts.values()), MAX_CACHE)
        with self.assertRaises(ValueError):
            self.adapter.read_artifact(one["uri"])
        with self.assertRaises(ValueError):
            self.adapter.artifact(b"a" * (MAX_ARTIFACT + 1), "application/zip", "large.zip")
        single = Adapter(self.project.root, single_project=True)
        self.assertEqual(
            single.call("get_project", dict(project="project")), self.project.catalog()
        )
        with self.assertRaises(ValueError):
            single.call("create_project", dict(name="Escape"))
        with self.assertRaises(ValueError):
            single.call("get_project", dict(project="plan"))

    def test_duplicate_place_delete_and_validation(self):
        document = self.project.catalog()["project"]
        definition = next(
            d for d in document["object_definitions"]["definitions"] if d["name"] == "Solid ground"
        )
        next_id = self.loaded["scene"]["next_object_id"]
        result = self.adapter.call(
            "edit_scene",
            {
                **self.args(),
                "operations": [
                    dict(op="place", definition_id=definition["id"], x=0, y=0, width=8, height=8),
                    dict(
                        op="duplicate",
                        object_id=self.identities["Forest patrol"],
                        changes=dict(x=120),
                    ),
                    dict(op="delete", object_id=self.identities["Stage pacing"]),
                ],
            },
        )
        self.assertEqual(result["allocated_object_ids"], [next_id, next_id + 1])
        with self.assertRaises(ValueError):
            self.adapter.call("save_scene", {**self.args(), "scene": {"layers": []}})

    def test_inventory_definition_world_and_diagnostics(self):
        caps = self.adapter.call("capabilities", {})
        self.assertEqual(set(caps["tools"]), {t["name"] for t in TOOLS})
        revision = self.args()["project_revision"]
        report = self.adapter.call("diagnostics", dict(project="plan", project_revision=revision))
        self.assertEqual(report["project_revision"], revision)
        definition = copy.deepcopy(
            self.project.catalog()["project"]["object_definitions"]["definitions"][0]
        )
        definition["name"] = "Custom ground"
        result = self.adapter.call(
            "save_object_definition",
            dict(project="plan", project_revision=revision, definition=definition),
        )
        self.assertEqual(result["definition_id"], definition["id"])
        with self.assertRaises(Conflict):
            self.adapter.call(
                "save_world",
                dict(project="plan", project_revision=revision, world={}, scene_revisions={}),
            )

    def test_project_tools_world_stamp_palette_and_plain_scene(self):
        guards = self.args()
        report = self.adapter.call("palette_report", guards)
        self.assertEqual(report["status"], "disabled")
        world = dict(version=1, positions={self.loaded["id"]: dict(x=0, y=0)}, connections=[])
        self.adapter.call(
            "save_world",
            dict(
                project="plan",
                project_revision=guards["project_revision"],
                world=world,
                scene_revisions={self.loaded["id"]: guards["scene_revision"]},
            ),
        )
        result = self.adapter.call(
            "save_stamp",
            dict(
                project="plan",
                project_revision=self.args()["project_revision"],
                name="Route",
                scene=self.loaded["scene"],
                slots=[0] * 5,
            ),
        )
        self.assertEqual(result["project"]["stamps"][0]["name"], "Route")
        plain = self.adapter.call(
            "create_scene",
            dict(
                project="plan",
                project_revision=result["revision"],
                name="Artwork",
                width=4,
                height=4,
                grid=8,
            ),
        )
        self.assertEqual(plain["scene"]["width"], 4)

    def test_semantic_placement_matches_shared_browser_service(self):
        loaded = self.project.create_blockout_scene(
            "Equivalent", {}, self.project.catalog()["revision"]
        )
        document = self.project.catalog()["project"]
        definition = next(
            d for d in document["object_definitions"]["definitions"] if d["name"] == "Solid ground"
        )
        expected, identity = blockout.place(
            loaded["scene"], document, definition["id"], 16, 32, width=40, height=8
        )
        result = self.adapter.call(
            "edit_scene",
            dict(
                project="plan",
                project_revision=self.project.catalog()["revision"],
                scene_id=loaded["id"],
                scene_revision=loaded["revision"],
                operations=[
                    dict(op="place", definition_id=definition["id"], x=16, y=32, width=40, height=8)
                ],
            ),
        )
        self.assertEqual(result["scene"], tiled.decode(tiled.encode(expected, document), document))
        self.assertEqual(result["changes"]["after_snapshot"], authoring.snapshot(result["scene"]))
        self.assertEqual(result["allocated_object_ids"], [identity])

    def test_canonical_tile_edits_and_broken_world_link_guard(self):
        source, _ = bundle(self.root / "art")
        self.project.import_atlas(source, self.project.catalog()["revision"])
        scene = copy.deepcopy(self.loaded["scene"])
        scene["layers"][0]["cells"][0][0] = "terrain/earth/0/0"
        saved = self.adapter.call("save_scene", {**self.args(), "scene": scene})
        self.assertEqual(saved["scene"], scene)
        scene["layers"][0]["cells"][0][0] = "unknown/asset"
        with self.assertRaises(ValueError):
            self.adapter.call("save_scene", {**self.args(), "scene": scene})
        world = dict(
            version=1,
            positions={},
            connections=[
                dict(
                    id=str(uuid4()),
                    name="Route",
                    direction="one-way",
                    source=dict(scene=self.loaded["id"], object=self.identities["Player spawn"]),
                    destination=dict(
                        scene=self.loaded["id"], object=self.identities["Stage exit proposal"]
                    ),
                )
            ],
        )
        self.project.save_world(
            world, self.args()["project_revision"], {self.loaded["id"]: saved["revision"]}
        )
        with self.assertRaisesRegex(ValueError, "linked objects"):
            self.adapter.call(
                "edit_scene",
                {
                    **self.args(),
                    "operations": [dict(op="delete", object_id=self.identities["Player spawn"])],
                },
            )
        self.assertEqual(self.project.load_scene(saved["id"])["scene"], saved["scene"])


@unittest.skipUnless(
    importlib.util.find_spec("mcp"), "Install the optional MCP extra to test SDK stdio"
)
class ProtocolTests(unittest.TestCase):
    def test_real_sdk_client(self):
        asyncio.run(self.session())

    async def session(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        with tempfile.TemporaryDirectory() as folder:
            params = StdioServerParameters(
                command=sys.executable,
                args=[
                    "-m",
                    "gbc_scene_forge.mcp_server",
                    "--project-root",
                    folder,
                ],
                env=dict(os.environ),
            )
            async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
                initialized = await client.initialize()
                self.assertTrue(initialized.capabilities.tools)
                inventory = await client.list_tools()
                self.assertEqual(len(inventory.tools), len(TOOLS))

                async def call(name, arguments):
                    result = await client.call_tool(name, arguments)
                    self.assertFalse(result.isError, result.content)
                    return result.structuredContent

                project = await call("create_project", dict(name="Protocol", starter="blockout"))
                loaded = await call(
                    "create_blockout_scene",
                    dict(project="protocol", project_revision=project["revision"], name="Opening"),
                )
                args = dict(
                    project="protocol",
                    project_revision=loaded["project_revision"],
                    scene_id=loaded["id"],
                    scene_revision=loaded["revision"],
                )
                preview = await call("review_blockout", args)
                resource = await client.read_resource(preview["overview_resource"]["uri"])
                self.assertIn("<svg", resource.contents[0].text)
                resources = await client.list_resources()
                self.assertEqual(len(resources.resources), 2)
                exported = await call(
                    "export_bundle",
                    dict(
                        project="protocol",
                        project_revision=args["project_revision"],
                        scope="project",
                    ),
                )
                resource = await client.read_resource(exported["resource"]["uri"])
                with zipfile.ZipFile(
                    io.BytesIO(base64.b64decode(resource.contents[0].blob))
                ) as archive:
                    self.assertIn(MANIFEST, archive.namelist())
                for name, bad in (
                    ("edit_scene", {**args, "operations": []}),
                    ("get_project", dict(project="../escape")),
                    ("get_project", dict(project="protocol", extra=True)),
                    ("not_supported", {}),
                ):
                    result = await client.call_tool(name, bad)
                    self.assertTrue(result.isError)
                result = await client.call_tool(
                    "review_blockout", {**args, "scene_revision": "0" * 64}
                )
                self.assertTrue(result.isError)
                self.assertEqual(result.structuredContent["error"]["code"], "conflict")
