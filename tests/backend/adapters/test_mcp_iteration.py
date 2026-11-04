"""Equivalent exact-image iteration, layering, recovery, preview and lifecycle guards."""

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
from uuid import uuid4

from gbc_scene_forge.adapters.http.artwork import artwork_response
from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import editable, layers, png
from gbc_scene_forge.artwork.drafts import ArtworkDrafts
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.storage import transactions


class IterationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Iteration")
        self.adapter = Adapter(self.project.root, single_project=True)

    def call(self, tool, **args):
        return self.adapter.call(tool, dict(project="project", **args))

    def revision(self):
        return self.project.catalog()["revision"]

    def intake(self, **args):
        raw = bytes([11, 22, 33, 255, 91, 82, 73, 0]) * 32
        return self.call(
            "import_artwork_png",
            project_revision=self.revision(),
            atlas_id="picture",
            name="Picture",
            png=base64.b64encode(png.encode(8, 8, raw)).decode(),
            **args,
        )

    def export(self, candidate):
        return self.call("export_artwork_candidate", candidate=candidate)

    def commit(self, candidate):
        report = self.call("review_artwork_candidate", candidate=candidate)
        return self.call("commit_artwork", candidate=candidate, receipt=report["receipt"])

    def test_exact_png_compact_raster_receipt_and_color_counts(self):
        candidate = self.intake(compact=True)
        self.assertIn("handle", candidate)
        original = self.export(candidate)
        receipt = self.call("review_artwork_candidate", candidate=candidate)["receipt"]
        updated = self.call(
            "edit_artwork_raster",
            candidate=candidate,
            operations=[
                dict(op="replace", **{"from": [91, 82, 73, 0]}, rgba=[9, 8, 7, 0]),
                dict(
                    op="rectangle",
                    rectangle=dict(x=0, y=0, width=2, height=2),
                    rgba=[4, 5, 6, 127],
                    filled=True,
                ),
            ],
        )
        self.assertEqual(self.export(candidate), original)
        with self.assertRaises(Conflict):
            self.call("commit_artwork", candidate=updated, receipt=receipt)
        counts = self.call("artwork_colors", candidate=updated)
        self.assertEqual(sum(i["count"] for i in counts["colors"]), 64)
        self.assertIn(dict(rgba=[9, 8, 7, 0], count=30), counts["colors"])
        ack = self.commit(updated)
        self.assertEqual(ack["candidate_revision"], updated["revision"])
        self.assertEqual(
            self.project.catalog()["project"]["atlases"]["picture"]["editable"]["id"],
            original["document_id"],
        )

    def test_layers_exact_reopen_draft_and_export(self):
        candidate = self.intake()
        base, effect = layers.item("Base"), layers.item("Effect")
        candidate = self.call("edit_artwork_layers", candidate=candidate, layers=[base, effect])
        candidate = self.call(
            "edit_artwork_pixels",
            candidate=candidate,
            layer_id=effect["id"],
            writes=[dict(x=0, y=0, rgba=[255, 20, 0, 128])],
        )
        for tool in ("artwork_colors", "read_artwork_pixels"):
            inspected = self.call(tool, candidate=candidate, layer_id=effect["id"])
            self.assertEqual(inspected["candidate_revision"], candidate["revision"])
            self.assertEqual(inspected["layer_id"], effect["id"])
        owner = str(uuid4())
        drafts = ArtworkDrafts(self.project.artwork.documents)
        ack = drafts.write(
            dict(
                id=str(uuid4()),
                owner=owner,
                revision=None,
                project_id=candidate["project_id"],
                name="Layers",
                original=candidate,
                candidate=candidate,
            )
        )
        listed = drafts.list()["drafts"][0]
        self.assertEqual(drafts.restore(listed["id"], ack["revision"])["candidate"], candidate)
        ack = self.commit(candidate)
        opened = self.call(
            "open_artwork",
            target=dict(document_id=candidate["document_id"], atlas_id="picture", region="artwork"),
            project_revision=ack["project_revision"],
            artwork_revision=ack["artwork_revision"],
        )
        self.assertEqual(opened["layer_rgba"], candidate["layer_rgba"])
        self.assertEqual(opened["descriptor"], candidate["descriptor"])
        self.assertEqual(opened["rgba"], candidate["rgba"])
        archive, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            bundle.extractall(self.root / "reopened")
        reopened = Project(self.root / "reopened")
        reopened.store.current(reopened.catalog()["revision"])
        self.assertEqual(
            (reopened.root / f"assets/picture/layers/{base['id']}.png").read_bytes(),
            (self.project.root / f"assets/picture/layers/{base['id']}.png").read_bytes(),
        )

    def test_explicit_layer_targets_locked_layers_and_aggregate_limits(self):
        candidate = self.intake()
        base = layers.item("Base")
        candidate = self.call("edit_artwork_layers", candidate=candidate, layers=[base])
        with self.assertRaises(ValueError):
            self.call(
                "edit_artwork_pixels",
                candidate=candidate,
                writes=[dict(x=0, y=0, rgba=[1, 2, 3, 4])],
            )
        locked = self.call(
            "edit_artwork_layers", candidate=candidate, layers=[{**base, "locked": True}]
        )
        with self.assertRaises(ValueError):
            self.call(
                "edit_artwork_raster",
                candidate=locked,
                layer_id=base["id"],
                operations=[dict(op="fill", at=[0, 0], rgba=[1, 2, 3, 4])],
            )
        unlocked = self.call("edit_artwork_layers", candidate=locked, layers=[base])
        self.assertEqual(unlocked, candidate)
        descriptor = copy.deepcopy(candidate["descriptor"])
        descriptor.update(width=2048, height=2048)
        with self.assertRaisesRegex(ValueError, "aggregate"):
            editable.check_descriptor(descriptor)

    def test_atomic_batch_overlap_resize_and_simultaneous_remapping(self):
        candidate = self.intake()
        before = copy.deepcopy(candidate)
        with self.assertRaises(ValueError):
            self.call(
                "edit_artwork_raster",
                candidate=candidate,
                operations=[
                    dict(op="fill", at=[0, 0], rgba=[1, 2, 3, 4]),
                    dict(op="move", rectangle=dict(x=0, y=0, width=8, height=8), to=[7, 7]),
                ],
            )
        self.assertEqual(candidate, before)
        changed = self.call(
            "edit_artwork_raster",
            candidate=candidate,
            operations=[
                dict(op="move", rectangle=dict(x=0, y=0, width=2, height=1), to=[1, 0]),
                dict(
                    op="resize",
                    rectangle=dict(x=1, y=0, width=2, height=1),
                    to=[0, 1],
                    width=4,
                    height=2,
                ),
                dict(
                    op="remap",
                    colors=[[[11, 22, 33, 255], [91, 82, 73, 0]], [[91, 82, 73, 0], [1, 2, 3, 4]]],
                ),
            ],
        )
        raw = editable.check_candidate(changed)
        self.assertEqual(raw[:12], bytes([0, 0, 0, 0, 91, 82, 73, 0, 1, 2, 3, 4]))
        self.assertEqual(raw[32:48], bytes([91, 82, 73, 0]) * 2 + bytes([1, 2, 3, 4]) * 2)

    def test_unpublished_adoption_return_and_stale_inspection(self):
        source = self.intake(compact=True)
        owner = str(uuid4())
        adopted = artwork_response(
            self.project, "candidate-adopt", dict(candidate=source, owner=owner)
        )
        self.assertEqual(adopted["owner"], owner)
        self.assertNotEqual(adopted, source)
        self.assertEqual(self.export(adopted), self.export(source))
        changed = self.call(
            "edit_artwork_raster",
            candidate=adopted,
            operations=[dict(op="fill", at=[0, 0], rgba=[1, 2, 3, 4])],
        )
        self.assertEqual(changed["owner"], owner)
        self.assertNotEqual(changed["revision"], source["revision"])
        self.commit(changed)
        with self.assertRaises(Conflict):
            artwork_response(
                self.project, "candidate-adopt", dict(candidate=source, owner=str(uuid4()))
            )
        self.assertEqual(self.export(source)["atlas_id"], "picture")

    def test_deletion_preview_guards_and_recoverable_stale_candidates(self):
        candidate = self.intake(compact=True)
        saved = self.commit(candidate)
        value = self.export(candidate)
        candidate = self.call(
            "open_artwork",
            target=dict(document_id=value["document_id"], atlas_id="picture", region="artwork"),
            project_revision=saved["project_revision"],
            artwork_revision=saved["artwork_revision"],
        )
        candidate = self.call("retain_artwork_candidate", candidate=candidate)
        plan = self.call(
            "delete_artwork", atlas_id="picture", project_revision=self.revision(), dry_run=True
        )
        self.assertFalse(plan["blockers"])
        self.assertIn("picture", self.project.catalog()["project"]["atlases"])
        ack = self.call(
            "delete_artwork", atlas_id="picture", project_revision=self.revision(), plan=plan
        )
        self.assertEqual(ack["deleted"], "picture")
        self.assertNotIn("picture", self.project.catalog()["project"]["atlases"])
        self.assertEqual(self.export(candidate)["atlas_id"], "picture")
        with self.assertRaises(Conflict):
            self.commit(candidate)

    def test_camera_free_scene_overview(self):
        scene = self.project.scenes.create("No camera", 4, 4, 8, self.revision())
        result = self.call(
            "review_artwork",
            project_revision=self.revision(),
            scene_id=scene["id"],
            scene_revision=scene["revision"],
        )
        self.assertIsNone(result["camera"])
        self.assertNotIn("camera_resource", result)
        self.assertEqual(result["overview_resource"]["mimeType"], "image/png")

    def test_interrupted_layer_save_restores_sources_composite_and_manifest(self):
        candidate = self.intake()
        base, effect = layers.item("Base"), layers.item("Effect")
        candidate = layers.edit(candidate, [base, effect])
        ack = self.commit(candidate)
        before = self.project.catalog()
        candidate = self.call(
            "open_artwork",
            target=dict(document_id=candidate["document_id"], atlas_id="picture", region="artwork"),
            project_revision=ack["project_revision"],
            artwork_revision=ack["artwork_revision"],
        )
        changed = self.call(
            "edit_artwork_raster",
            candidate=candidate,
            layer_id=effect["id"],
            operations=[dict(op="fill", at=[0, 0], rgba=[41, 42, 43, 127])],
        )
        write = transactions.atomic_write

        def fail_manifest(path, data):
            if path == self.project.root / "forge.project.json":
                raise OSError("interrupted layer publication")
            write(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_manifest),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.project.artwork.documents.save(changed)
        reopened = Project(self.project.root)
        self.assertEqual(reopened.catalog(), before)
        restored = reopened.artwork.documents.open(
            dict(document_id=candidate["document_id"], atlas_id="picture", region="artwork"),
            ack["project_revision"],
            ack["artwork_revision"],
        )
        self.assertEqual(restored["layer_rgba"], candidate["layer_rgba"])
        self.assertEqual(restored["rgba"], candidate["rgba"])

    def test_count_budget_and_explicit_empty_rectangle_rejection(self):
        raw = bytes(
            channel for i in range(257 * 256) for channel in (i & 255, (i >> 8) & 255, i >> 16, 0)
        )
        candidate = self.call(
            "import_artwork_png",
            project_revision=self.revision(),
            atlas_id="colors",
            name="Colors",
            png=base64.b64encode(png.encode(257, 256, raw)).decode(),
        )
        with self.assertRaisesRegex(ValueError, "smaller rectangle"):
            self.call("artwork_colors", candidate=candidate)
        with self.assertRaises(ValueError):
            self.call(
                "edit_artwork_raster",
                candidate=candidate,
                operations=[
                    dict(op="replace", **{"from": [0, 0, 0, 0]}, rgba=[1, 2, 3, 4], rectangle={})
                ],
            )
        report = self.call(
            "artwork_colors", candidate=candidate, rectangle=dict(x=0, y=0, width=257, height=1)
        )
        self.assertEqual(len(report["colors"]), 256)
        self.assertEqual(report["next_offset"], 256)

    def test_layered_sheet_copy_and_scene_transfer_preserve_sources(self):
        art = self.project.artwork.documents
        candidate = art.create_sheet(
            "tile",
            "Layered",
            "tile",
            8,
            8,
            self.revision(),
            frames=[
                dict(
                    id="artwork",
                    name="Tile",
                    kind="tile",
                    x=0,
                    y=0,
                    width=8,
                    height=8,
                    origin=[0, 0],
                )
            ],
            sequences=[],
        )
        base, effect = layers.item("Base"), layers.item("Hidden")
        candidate = layers.edit(candidate, [base, {**effect, "visible": False}])
        candidate = layers.apply(
            candidate,
            effect["id"],
            lambda flat: art.edit(flat, [dict(x=0, y=0, rgba=[71, 72, 73, 0])]),
        )
        renamed = layers.edit(candidate, [base, {**effect, "name": "Renamed", "visible": False}])
        drafts = ArtworkDrafts(art)
        checkpoint = dict(
            id=str(uuid4()),
            owner=str(uuid4()),
            project_id=candidate["project_id"],
            name="Sheet layers",
            revision=None,
            original=candidate,
            candidate=renamed,
        )
        stored = drafts.write(checkpoint)
        self.assertEqual(drafts.restore(checkpoint["id"], stored["revision"])["candidate"], renamed)
        ack = art.save(candidate)
        source = dict(
            atlas_id="tile",
            region="artwork",
            grid=None,
            cell=None,
            artwork_revision=ack["artwork_revision"],
        )
        copied = art.duplicate_sheet(source, "copy", "Copy", self.revision())
        self.assertEqual(copied["layer_rgba"], candidate["layer_rgba"])
        self.assertEqual(copied["descriptor"]["layers"], candidate["descriptor"]["layers"])
        art.save(copied)
        scene = self.project.scenes.create("Tile", 2, 2, 8, self.revision())
        scene["scene"]["cells"][0][0] = "tile/artwork/0/0"
        self.project.scenes.save(scene["id"], scene["scene"], scene["revision"], self.revision())
        archive, _ = self.project.export_bundle("scene", self.revision(), scene["id"])
        destination = Project.create(self.root / "destination", "Destination")
        payload = base64.b64encode(archive).decode()
        revision = destination.catalog()["revision"]
        report = destination.imports.forge(payload, revision)
        self.assertTrue(report["compatible"], report)
        destination.imports.forge(
            payload, revision, dry_run=False, confirmation=report["confirmation"]
        )
        inventory = destination.artwork.documents.list(destination.catalog()["revision"])
        item = inventory["documents"][0]
        reopened = destination.artwork.documents.open(
            item["target"], destination.catalog()["revision"], item["artwork_revision"]
        )
        self.assertEqual(reopened["layer_rgba"], candidate["layer_rgba"])

    def test_intake_rejects_bad_png_collision_and_stale_base_without_writes(self):
        revision = self.revision()
        for value in ("invalid!", base64.b64encode(b"not PNG").decode()):
            with self.assertRaises(ValueError):
                self.call(
                    "import_artwork_png",
                    project_revision=revision,
                    atlas_id="bad",
                    name="Bad",
                    png=value,
                )
        self.assertEqual(self.revision(), revision)
        raw = bytes([19, 20, 21, 0]) * 15
        candidate = self.call(
            "import_artwork_png",
            project_revision=revision,
            atlas_id="odd",
            name="Odd",
            png=base64.b64encode(png.encode(3, 5, raw)).decode(),
        )
        self.assertEqual(editable.check_candidate(candidate), raw)
        self.commit(candidate)
        with self.assertRaises(Conflict):
            self.call(
                "import_artwork_png",
                project_revision=revision,
                atlas_id="new",
                name="Stale",
                png=base64.b64encode(png.encode(3, 5, raw)).decode(),
            )
        with self.assertRaises(ValueError):
            self.call(
                "import_artwork_png",
                project_revision=self.revision(),
                atlas_id="odd",
                name="Collision",
                png=base64.b64encode(png.encode(3, 5, raw)).decode(),
            )

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
    def test_sdk_inline_previews_and_resource_fallback_budget(self):
        asyncio.run(self.sdk_previews())

    async def sdk_previews(self):
        from mcp import ClientSession, StdioServerParameters, types
        from mcp.client.stdio import stdio_client

        from gbc_scene_forge.adapters.mcp.server import create_server

        parameters = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.mcp_server", "--project", str(self.project.root)],
            env=dict(os.environ),
        )
        candidate = self.intake(compact=True)
        async with stdio_client(parameters) as streams, ClientSession(*streams) as client:
            await client.initialize()
            response = await client.call_tool(
                "review_artwork_candidate", dict(project="project", candidate=candidate)
            )
            self.assertFalse(response.isError, response)
            images = [item for item in response.content if item.type == "image"]
            self.assertTrue(images)
            self.assertLessEqual(len(images), 2)
            self.assertLessEqual(
                sum(len(base64.b64decode(item.data)) for item in images), 4 * 1024 * 1024
            )
            self.assertTrue(any(item.type == "resource_link" for item in response.content))
            resource = response.structuredContent["resources"][0]
            read = await client.read_resource(resource["uri"])
            self.assertEqual(
                png.decode(base64.b64decode(read.contents[0].blob), generic=True)[0], 8
            )
        # Oversized resources stay linked without decoding/embedding them again.
        artifact = self.adapter.artifact(png.encode(1, 1, bytes(4)), "image/png", "enlarged.png")
        artifact["size"] = 4 * 1024 * 1024 + 1
        server = create_server(self.adapter)
        with (
            patch.object(self.adapter, "call", return_value={"resources": [artifact]}),
            patch.object(
                self.adapter, "read_artifact", side_effect=AssertionError("oversized inline read")
            ),
        ):
            response = await server.request_handlers[types.CallToolRequest](
                types.CallToolRequest(
                    params=types.CallToolRequestParams(
                        name="review_artwork_candidate",
                        arguments=dict(project="project", candidate=candidate),
                    )
                )
            )
        self.assertFalse(response.root.isError)
        self.assertFalse(any(item.type == "image" for item in response.root.content))
        self.assertTrue(any(item.type == "resource_link" for item in response.root.content))
