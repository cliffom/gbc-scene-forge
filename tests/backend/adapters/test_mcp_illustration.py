"""Illustration lifecycle, preparation, atomic edits and portable inspection regressions."""

import base64
import copy
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from gbc_scene_forge.adapters.mcp.schemas import TOOLS
from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import candidates, editable, layers, png, raster, workshop
from gbc_scene_forge.artwork.candidates import ArtworkCandidates
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.storage.files import digest


class IllustrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Illustration")
        self.adapter = Adapter(self.project.root, single_project=True)
        self.store = ArtworkCandidates(self.project.artwork.documents)

    def revision(self):
        return self.project.catalog()["revision"]

    def call(self, tool, **args):
        return self.adapter.call(tool, {"project": "project", **args})

    def create(self, **args):
        return self.call(
            "create_artwork",
            atlas_id="picture",
            name="Picture",
            kind="sprite",
            width=4,
            height=4,
            project_revision=self.revision(),
            **args,
        )

    def commit(self, candidate):
        receipt = self.call("review_artwork_candidate", candidate=candidate)["receipt"]
        return self.call("commit_artwork", candidate=candidate, receipt=receipt)

    @staticmethod
    def upload(w, h, raw):
        return base64.b64encode(png.encode(w, h, raw)).decode()

    def artifact(self, result):
        resource = self.adapter.read_artifact(result["resource"]["uri"])
        return (
            resource["text"].encode() if "text" in resource else base64.b64decode(resource["blob"])
        )

    def test_complete_static_workflow_and_exact_portable_recovery(self):
        original, overlay = layers.item("Night"), layers.item("Stars")
        raw = bytes([12, 24, 48, 255, 7, 8, 9, 0]) * 8
        candidate = self.call(
            "import_artwork_layers",
            atlas_id="intake",
            name="Night sky",
            width=4,
            height=4,
            project_revision=self.revision(),
            compact=True,
            layers=[
                dict(layer=original, png=self.upload(4, 4, raw), offset=[0, 0]),
                dict(
                    layer={**overlay, "visible": False, "opacity": 127},
                    png=self.upload(1, 1, bytes([240, 240, 241, 128])),
                    offset=[2, 1],
                ),
            ],
        )
        candidate = self.call(
            "prepare_artwork_document",
            candidate=candidate,
            atlas_id="prepared",
            name="Prepared",
            width=8,
            height=8,
            mode="nearest",
            anchor="top-left",
        )["candidate"]
        palette = self.call(
            "convert_artwork_palette", candidate=candidate, palette=[[0, 0, 0], [255, 255, 255]]
        )
        self.assertFalse(palette["report"]["dither"])
        candidate = palette["candidate"]
        candidate = self.call(
            "edit_artwork_batch",
            candidate=candidate,
            operations=[
                dict(
                    op="pixels",
                    layer_id=overlay["id"],
                    writes=[dict(x=1, y=1, rgba=[255, 255, 255, 255])],
                ),
                dict(op="layers", layers=[original, {**overlay, "locked": True}]),
            ],
        )
        full = self.call("export_artwork_candidate", candidate=candidate)
        inspection = self.call(
            "inspect_artwork_candidate",
            candidate=candidate,
            rectangles=[dict(x=0, y=0, width=8, height=8)],
            scale=4,
            changed_overlay=True,
        )
        self.assertTrue(inspection["complete"])
        self.assertEqual(inspection["receipt"]["candidate_revision"], full["revision"])
        self.assertIn(b"x=0 y=0 8x8 @4x", self.artifact(inspection))
        bundle = self.artifact(self.call("export_artwork_bundle", candidate=candidate))
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            self.assertEqual(json.loads(archive.read("candidate.json")), full)
            self.assertEqual(json.loads(archive.read("document.json")), full["descriptor"])
            for key, raw in full["layer_rgba"].items():
                self.assertEqual(
                    png.decode(archive.read(f"layers/{key}.png"), generic=True)[2],
                    base64.b64decode(raw),
                )
        ack = self.call("commit_artwork", candidate=candidate, receipt=inspection["receipt"])
        inventory = self.call("list_artwork_candidates")
        item = next(i for i in inventory["candidates"] if i["revision"] == full["revision"])
        self.assertTrue(item["saved_content"]["matches"])
        self.assertEqual(item["saved_content"]["artwork_revision"], ack["artwork_revision"])
        self.assertTrue(item["stale_project_base"])
        opened = self.call(
            "open_artwork",
            target=dict(document_id=full["document_id"], atlas_id="prepared", region="artwork"),
            project_revision=ack["project_revision"],
            artwork_revision=ack["artwork_revision"],
        )
        self.assertEqual(opened["descriptor"], full["descriptor"])
        self.assertEqual(opened["layer_rgba"], full["layer_rgba"])
        self.assertEqual(opened["rgba"], full["rgba"])
        archive, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            bundle.extractall(self.root / "reopened")
        reopened = Project(self.root / "reopened")
        inventory = reopened.artwork.documents.list(reopened.catalog()["revision"])
        item = inventory["documents"][0]
        again = reopened.artwork.documents.open(
            item["target"], inventory["project_revision"], item["artwork_revision"]
        )
        self.assertEqual(again["layer_rgba"], full["layer_rgba"])
        with self.assertRaises(Conflict):
            self.call(
                "edit_artwork_batch",
                candidate=candidate,
                operations=[dict(op="layers", layers=[original])],
            )

    def test_archive_survives_restart_partial_release_and_preserves_owner_bases(self):
        full = self.create()
        handles = [self.store.retain(full), self.store.retain(full, owner=str(uuid4()))]
        real_release = self.store.release

        def fail_one(handle):
            if "owner" in handle:
                raise OSError("simulated interrupted release")
            return real_release(handle)

        with patch.object(self.store, "release", side_effect=fail_one):
            report = self.store.archive(handles, release=True)
        self.assertTrue(report["results"][0]["released"])
        self.assertIn("error", report["results"][1])
        restarted = Adapter(self.project.root, single_project=True)
        listed = restarted.call("list_artwork_candidates", dict(project="project"))
        self.assertEqual(listed["used_count"], 1)
        self.assertEqual(listed["remaining_bytes"], candidates.MAX_TOTAL - listed["used_bytes"])
        self.assertEqual(listed["archives"][0]["archive"], report["archive"])
        chunk = self.call("read_artwork_archive", archive=report["archive"])
        raw = base64.b64decode(chunk["data"])
        self.assertIsNone(chunk["next_offset"])
        self.assertEqual(digest(raw), report["sha256"])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for handle in handles:
                name = self.store.path(handle["revision"], handle.get("owner")).name
                restored = self.call(
                    "retain_artwork_candidate",
                    candidate=json.loads(archive.read(name)),
                    **({"owner": handle["owner"]} if "owner" in handle else {}),
                )
                self.assertEqual(restored, handle)
        self.assertEqual(self.store.resolve(handles[0]), full)
        with patch.object(candidates, "atomic_write", side_effect=OSError("archive interrupted")):
            with self.assertRaises(OSError):
                self.store.archive(handles, release=True)
        self.assertEqual(len(self.store.list()["candidates"]), 2)
        with patch.object(candidates, "MAX_COUNT", 2):
            changed = editable.edit_pixels(full, [dict(x=0, y=0, rgba=[1, 2, 3, 255])])
            with self.assertRaisesRegex(
                ValueError, "remaining.*requested.*archive_artwork_candidates"
            ):
                self.store.retain(changed)
        self.assertEqual(len(self.store.list()["candidates"]), 2)

    def test_composite_match_never_proves_layer_match(self):
        base, hidden = layers.item("Base"), {**layers.item("Hidden"), "visible": False}
        full = layers.edit(self.create(), [base, hidden])
        changed = layers.apply(
            full,
            hidden["id"],
            lambda flat: editable.edit_pixels(flat, [dict(x=0, y=0, rgba=[7, 8, 9, 0])]),
        )
        one, two = self.store.retain(full), self.store.retain(changed)
        self.assertEqual(full["rgba"], changed["rgba"])
        self.commit(changed)
        listed = {i["revision"]: i for i in self.store.list()["candidates"]}
        self.assertFalse(listed[one["revision"]]["saved_content"]["matches"])
        self.assertTrue(listed[two["revision"]]["saved_content"]["matches"])

    def test_batch_is_atomic_matches_separate_edits_and_invalidates_receipt(self):
        candidate = self.create(compact=True)
        original = self.store.resolve(candidate)
        base, light = layers.item("Base"), layers.item("Light")
        ops = [
            dict(op="layers", layers=[base, light]),
            dict(
                op="patch",
                layer_id=light["id"],
                patch=dict(
                    rectangle=dict(x=1, y=1, width=1, height=1),
                    rgba=base64.b64encode(bytes([9, 8, 7, 0])).decode(),
                ),
            ),
            dict(
                op="raster",
                layer_id=light["id"],
                operations=[
                    dict(
                        op="rectangle",
                        rectangle=dict(x=0, y=0, width=4, height=4),
                        rgba=[40, 50, 60, 127],
                        filled=False,
                    )
                ],
            ),
            dict(op="layers", layers=[base, {**light, "locked": True}]),
        ]
        receipt = self.call("review_artwork_candidate", candidate=candidate)["receipt"]
        with self.assertRaises(ValueError):
            self.call(
                "edit_artwork_batch",
                candidate=candidate,
                operations=ops
                + [
                    dict(
                        op="pixels",
                        layer_id=light["id"],
                        writes=[dict(x=0, y=0, rgba=[1, 2, 3, 4])],
                    )
                ],
            )
        self.assertEqual(self.store.list()["used_count"], 1)
        updated = self.call("edit_artwork_batch", candidate=candidate, operations=ops)
        self.assertEqual(self.store.list()["used_count"], 2)
        separate = layers.edit(original, [base, light])
        separate = layers.apply(
            separate, light["id"], lambda c: editable.patch_pixels(c, ops[1]["patch"])
        )
        separate = layers.apply(
            separate,
            light["id"],
            lambda c: raster.edit(c, ops[2]["operations"]),
        )
        separate = layers.edit(separate, ops[3]["layers"])
        self.assertEqual(self.store.resolve(updated), separate)
        self.assertEqual(self.store.resolve(candidate), original)
        with self.assertRaises(Conflict):
            self.call("commit_artwork", candidate=updated, receipt=receipt)

    def test_resize_canvas_origins_alpha_and_layer_properties(self):
        candidate = self.call(
            "import_artwork_png",
            atlas_id="odd",
            name="Odd",
            project_revision=self.revision(),
            png=self.upload(3, 1, bytes([1, 2, 3, 0, 4, 5, 6, 128, 7, 8, 9, 255])),
        )
        item = layers.item("Ink")
        candidate = layers.edit(candidate, [item])
        result = self.call(
            "prepare_artwork_document",
            candidate=candidate,
            atlas_id="wide",
            name="Wide",
            width=6,
            height=2,
            mode="nearest",
            anchor="center",
        )
        output = base64.b64decode(result["candidate"]["layer_rgba"][item["id"]])
        self.assertEqual(
            output[:24],
            bytes([1, 2, 3, 0]) * 2 + bytes([4, 5, 6, 128]) * 2 + bytes([7, 8, 9, 255]) * 2,
        )
        self.assertEqual(output[24:], output[:24])
        self.assertEqual(
            result["candidate"]["descriptor"]["layers"], candidate["descriptor"]["layers"]
        )
        padded = self.call(
            "prepare_artwork_document",
            candidate=candidate,
            atlas_id="pad",
            name="Pad",
            width=5,
            height=3,
            mode="canvas",
            anchor="center",
        )["candidate"]
        self.assertEqual(padded["descriptor"]["origin"], [1, 1])
        self.assertEqual(
            base64.b64decode(padded["layer_rgba"][item["id"]])[24:36],
            base64.b64decode(candidate["layer_rgba"][item["id"]]),
        )
        with self.assertRaisesRegex(ValueError, "origin"):
            self.call(
                "prepare_artwork_document",
                candidate=candidate,
                atlas_id="crop",
                name="Crop",
                width=1,
                height=1,
                mode="canvas",
                anchor="bottom-right",
            )
        locked = layers.edit(candidate, [{**item, "locked": True}])
        with self.assertRaisesRegex(ValueError, "Unlock"):
            self.call(
                "prepare_artwork_document",
                candidate=locked,
                atlas_id="locked",
                name="Locked",
                width=2,
                height=2,
                mode="nearest",
                anchor="top-left",
            )

    def test_quantization_deterministic_exact_alpha_and_declared_budget(self):
        raw = bytes([10, 20, 30, 0, 12, 20, 30, 128, 200, 201, 202, 255, 190, 195, 199, 255])
        candidate = self.call(
            "import_artwork_png",
            atlas_id="color",
            name="Colors",
            project_revision=self.revision(),
            png=self.upload(4, 1, raw),
        )
        before = copy.deepcopy(candidate)
        result = self.call("convert_artwork_palette", candidate=candidate, budget=3)
        self.assertEqual(
            result, self.call("convert_artwork_palette", candidate=candidate, budget=3)
        )
        converted = base64.b64decode(result["candidate"]["rgba"])
        self.assertEqual(converted[:4], raw[:4])
        self.assertEqual(converted[3::4], raw[3::4])
        self.assertLessEqual(result["report"]["after"]["composite_colors"], 3)
        self.assertEqual(candidate, before)
        for args in (
            {"budget": True},
            {"budget": 1},
            {"palette": [[0, 0, 0]], "budget": 3},
            {"palette": [[0, 0, True]]},
            {},
        ):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.call("convert_artwork_palette", candidate=candidate, **args)
        exact = self.call(
            "convert_artwork_palette", candidate=candidate, palette=[[255, 255, 255], [0, 0, 0]]
        )
        self.assertEqual(base64.b64decode(exact["candidate"]["rgba"])[:4], raw[:4])

    def test_bounds_and_invalid_intake_leave_inventory_and_retention_unchanged(self):
        candidate = self.create(compact=True)
        before = self.store.list()
        for args in (
            dict(rectangles=[]),
            dict(rectangles=[dict(x=0, y=0, width=5, height=1)]),
            dict(rectangles=[dict(x=0, y=0, width=4, height=4)], scale=True),
        ):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.call("inspect_artwork_candidate", candidate=candidate, **args)
        item = layers.item()
        for items in (
            [dict(layer=item, png="bad!", offset=[0, 0])],
            [dict(layer=item, png=self.upload(2, 2, bytes(16)), offset=[3, 0])],
            [dict(layer=item, png=self.upload(1, 1, bytes(4)), offset=[0, 0])] * 2,
        ):
            with self.assertRaises(ValueError):
                self.call(
                    "import_artwork_layers",
                    atlas_id="bad",
                    name="Bad",
                    width=4,
                    height=4,
                    project_revision=self.revision(),
                    layers=items,
                    compact=True,
                )
        self.assertEqual(self.store.list(), before)
        self.assertFalse(self.project.catalog()["project"]["atlases"])
        with self.assertRaises(ValueError):
            self.store.archive([candidate, candidate], release=True)
        with self.assertRaises(ValueError):
            self.call("read_artwork_archive", archive="../outside")
        with patch.object(workshop, "MAX_BATCH_WORK", 1), self.assertRaises(ValueError):
            self.call(
                "edit_artwork_batch",
                candidate=candidate,
                operations=[dict(op="layers", layers=[item])],
            )

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
    def test_new_wire_schemas_are_closed_and_classify_sidecar_writes(self):
        import jsonschema

        tools = {t["name"]: t for t in TOOLS}
        full = self.create()
        args = dict(
            project="project",
            candidate=full,
            operations=[
                dict(op="pixels", layer_id=None, writes=[dict(x=0, y=0, rgba=[0, 0, 0, 0])])
            ],
        )
        shape = tools["edit_artwork_batch"]["inputSchema"]
        jsonschema.validate(args, shape)
        args["operations"][0]["writes"][0]["extra"] = True
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(args, shape)
        for name in (
            "edit_artwork_batch",
            "prepare_artwork_document",
            "convert_artwork_palette",
            "import_artwork_layers",
        ):
            self.assertFalse(tools[name]["annotations"]["readOnlyHint"])
            self.assertFalse(tools[name]["annotations"]["destructiveHint"])
        self.assertTrue(tools["archive_artwork_candidates"]["annotations"]["destructiveHint"])

    def test_prepared_copy_preserves_saved_content_and_requires_sheet_choice(self):
        documents = self.project.artwork.documents
        full = self.create()
        ack = self.commit(full)
        scene = self.project.scenes.create("Unrelated", 2, 2, 8, self.revision())
        scene_path = self.project.root / "scenes" / f"{scene['id']}.tmj"
        original_scene = scene_path.read_bytes()
        original_png = (self.project.root / "assets/picture/atlas.png").read_bytes()
        full = self.call(
            "open_artwork",
            target=dict(document_id=full["document_id"], atlas_id="picture", region="artwork"),
            project_revision=self.revision(),
            artwork_revision=ack["artwork_revision"],
        )
        prepared = self.call(
            "prepare_artwork_document",
            candidate=full,
            atlas_id="copy",
            name="Copy",
            width=8,
            height=8,
            mode="canvas",
            anchor="bottom-right",
        )["candidate"]
        self.commit(prepared)
        self.assertEqual(scene_path.read_bytes(), original_scene)
        self.assertEqual(
            (self.project.root / "assets/picture/atlas.png").read_bytes(), original_png
        )
        sheet = documents.create_sheet(
            "sheet",
            "Sheet",
            "sprite",
            8,
            8,
            self.revision(),
            frames=[
                dict(
                    id="pose",
                    name="Pose",
                    kind="sprite",
                    x=0,
                    y=0,
                    width=8,
                    height=8,
                    origin=[3, 5],
                )
            ],
            sequences=[],
        )
        args = dict(
            candidate=sheet,
            atlas_id="static",
            name="Static",
            width=16,
            height=16,
            mode="nearest",
            anchor="top-left",
        )
        with self.assertRaisesRegex(ValueError, "flatten_sheet"):
            self.call("prepare_artwork_document", **args)
        flattened = self.call("prepare_artwork_document", **args, flatten_sheet=True)
        self.assertTrue(flattened["report"]["frames_discarded"])
        self.assertEqual(flattened["candidate"]["descriptor"]["version"], 1)
        self.assertNotIn("frames", flattened["candidate"]["descriptor"])
        self.assertEqual(sheet["descriptor"]["frames"][0]["origin"], [3, 5])

    def test_archive_byte_quota_chunks_and_unrelated_candidate_preservation(self):
        full = self.create()
        first = self.store.retain(full)
        second = self.store.retain(
            editable.edit_pixels(full, [dict(x=1, y=1, rgba=[2, 3, 4, 255])])
        )
        with patch.object(candidates, "MAX_TOTAL", 1):
            with self.assertRaisesRegex(ValueError, "requested"):
                self.store.retain(editable.edit_pixels(full, [dict(x=2, y=2, rgba=[7, 8, 9, 255])]))
        archived = self.store.archive([first], release=True)
        self.assertEqual(self.store.resolve(second)["revision"], second["revision"])
        self.assertEqual(self.store.list()["used_count"], 1)
        data = bytes(range(256)) * 5000
        key = digest(data)
        self.store.archive_path(key).write_bytes(data)
        first_chunk = self.store.read_archive(key)
        self.assertEqual(first_chunk["next_offset"], 1024 * 1024)
        last = self.store.read_archive(key, first_chunk["next_offset"])
        self.assertIsNone(last["next_offset"])
        self.assertEqual(
            base64.b64decode(first_chunk["data"]) + base64.b64decode(last["data"]), data
        )
        with self.assertRaises(ValueError):
            self.store.read_archive(archived["archive"], -1)
        outside = self.root / "outside.zip"
        outside.write_bytes(b"outside declared project")
        linked = self.store.archive_path("a" * 64)
        linked.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.store.list()
        linked.unlink()
        self.assertEqual(outside.read_bytes(), b"outside declared project")

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
    def test_official_sdk_static_illustration_example(self):
        import subprocess
        import sys

        example = Path(__file__).resolve().parents[3] / "examples/mcp/illustration_workflow.py"
        output = self.root / "sdk-workflow"
        subprocess.run(
            [sys.executable, str(example), "--output", str(output)],
            check=True,
            capture_output=True,
            timeout=60,
        )
        report = json.loads((output / "report.json").read_text())
        self.assertEqual(report["final_storage"]["used_count"], 0)
        self.assertTrue(all(item["released"] for item in report["archive"]["results"]))
        self.assertTrue(report["inspection"]["complete"])
        self.assertEqual(
            digest((output / "recovery.zip").read_bytes()), report["archive"]["sha256"]
        )

    def test_satisfied_budget_is_lossless_and_hidden_layers_still_consume_budget(self):
        raw = bytes([20, 40, 60, 127, 180, 160, 140, 255])
        full = self.call(
            "import_artwork_png",
            atlas_id="alpha",
            name="Alpha",
            project_revision=self.revision(),
            png=self.upload(2, 1, raw),
        )
        result = self.call("convert_artwork_palette", candidate=full, budget=2)
        self.assertEqual(result["candidate"], full)
        base, hidden = layers.item("Base"), {**layers.item("Hidden"), "visible": False}
        full = layers.edit(self.create(), [base, hidden])
        full = layers.apply(
            full,
            hidden["id"],
            lambda flat: editable.edit_pixels(flat, [dict(x=0, y=0, rgba=[7, 8, 9, 0])]),
        )
        with self.assertRaisesRegex(ValueError, "hidden transparent RGB"):
            self.call("convert_artwork_palette", candidate=full, budget=1)
