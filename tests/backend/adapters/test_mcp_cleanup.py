"""MCP cleanup uses native candidate handles, reviews, commits and recovery."""

import base64
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from support.cleanup_fixture import fixture

from gbc_scene_forge.adapters.mcp.schemas import TOOLS
from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import candidates, cleanup, editable, layers, png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project


class MCPCleanupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.project = Project.create(self.root / "project", "Cleanup")
        self.adapter = Adapter(self.project.root, single_project=True)
        self.spec, self.raw = fixture()

    def call(self, tool_name, **args):
        return self.adapter.call(tool_name, {"project": "project", **args})

    def create(self, compact=False):
        return self.call(
            "import_artwork_png",
            atlas_id="motif",
            name="Motif",
            png=base64.b64encode(png.encode(16, 16, self.raw)).decode(),
            project_revision=self.project.catalog()["revision"],
            compact=compact,
        )

    def test_handles_preview_resources_saved_layers_and_stale_receipts(self):
        candidate = self.create()
        source, other = layers.item("Source"), {**layers.item("Other"), "locked": True}
        candidate = self.call(
            "edit_artwork_layers", candidate=candidate, layers=[source, other], compact=True
        )
        store = candidates.ArtworkCandidates(self.project.artwork.documents)
        before = store.resolve(candidate)
        inventory = store.list()
        old_receipt = self.call("review_artwork_candidate", candidate=candidate)["receipt"]
        analysis = self.call(
            "analyze_artwork_cleanup",
            candidate=candidate,
            layer_id=source["id"],
            profile=self.spec["protected_profile"],
        )
        self.assertEqual(store.list(), inventory)
        analysis["proposal"] = json.loads(json.dumps(analysis["proposal"], sort_keys=True))
        result = self.call(
            "preview_artwork_cleanup",
            candidate=candidate,
            proposal=analysis["proposal"],
            selected=[f["id"] for f in analysis["findings"]],
        )
        self.assertIn("handle", result["candidate"])
        self.assertEqual(result["changed_pixels"], 2)
        self.assertEqual(len(result["resources"]), 3)
        for resource in result["resources"]:
            data = self.adapter.read_artifact(resource["uri"])
            w, h, _ = png.decode(base64.b64decode(data["blob"]), generic=True)
            self.assertEqual((w, h), (16, 16))
        validation = self.call(
            "validate_artwork_cleanup",
            candidate=result["candidate"],
            before_candidate=candidate,
            proposal=analysis["proposal"],
        )
        self.assertTrue(validation["passed"])
        self.assertEqual(self.project.catalog()["revision"], before["project_revision"])
        with self.assertRaises(Conflict):
            self.call("commit_artwork", candidate=result["candidate"], receipt=old_receipt)
        receipt = self.call("review_artwork_candidate", candidate=result["candidate"])["receipt"]
        saved = self.call("commit_artwork", candidate=result["candidate"], receipt=receipt)
        expected = store.resolve(result["candidate"])
        # A fresh adapter recovers the sidecar exactly even after its saved base becomes stale.
        self.adapter = Adapter(self.project.root, single_project=True)
        self.assertEqual(
            self.call("export_artwork_candidate", candidate=result["candidate"]), expected
        )
        opened = self.call(
            "open_artwork",
            target=dict(document_id=before["document_id"], atlas_id="motif", region="artwork"),
            artwork_revision=saved["artwork_revision"],
            project_revision=saved["project_revision"],
        )
        self.assertEqual(opened["rgba"], expected["rgba"])
        self.assertEqual(opened["layer_rgba"], expected["layer_rgba"])
        with self.assertRaises(Conflict):
            self.call(
                "preview_artwork_cleanup",
                candidate=candidate,
                proposal=analysis["proposal"],
                selected=[],
            )

    def test_failures_publish_no_candidate_or_resource_prefix(self):
        candidate = self.create(compact=True)
        store = candidates.ArtworkCandidates(self.project.artwork.documents)
        inventory = store.list()
        analysis = self.call(
            "analyze_artwork_cleanup", candidate=candidate, profile={"color_budget": 1}
        )
        for selected in (["island-999"], []):
            with self.assertRaises(ValueError):
                self.call(
                    "preview_artwork_cleanup",
                    candidate=candidate,
                    proposal=analysis["proposal"],
                    selected=selected,
                )
            self.assertEqual(store.list(), inventory)
            self.assertFalse(self.adapter.artifacts)
        # Validation reports actual protection failures independently of the preview operation.
        full = store.resolve(candidate)
        analysis = self.call(
            "analyze_artwork_cleanup", candidate=candidate, profile={"protected_pixels": [[12, 4]]}
        )
        bad = editable.edit_pixels(full, [dict(x=12, y=4, rgba=[0, 0, 0, 255])])
        report = self.call(
            "validate_artwork_cleanup",
            candidate=bad,
            before_candidate=candidate,
            proposal=analysis["proposal"],
        )
        self.assertFalse(report["hard_checks"]["protected_pixels"])
        self.assertEqual(store.list(), inventory)

    @unittest.skipUnless(importlib.util.find_spec("jsonschema"), "Install optional MCP SDK")
    def test_strict_wire_profiles_and_capability_inventory(self):
        import jsonschema

        candidate = self.create()
        definitions = {d["name"]: d for d in TOOLS}
        args = dict(project="project", candidate=candidate, profile={})
        definition = definitions["analyze_artwork_cleanup"]
        jsonschema.validate(args, definition["inputSchema"])
        for profile in (
            {"outline_width": 2},
            {"connectivity": True},
            {"allowed_palette": [[0, 0, 0]]},
        ):
            with self.assertRaises(jsonschema.ValidationError):
                jsonschema.validate({**args, "profile": profile}, definition["inputSchema"])
        proposal = self.call("analyze_artwork_cleanup", candidate=candidate, profile={})["proposal"]
        preview = dict(project="project", candidate=candidate, proposal=proposal, selected=[])
        jsonschema.validate(preview, definitions["preview_artwork_cleanup"]["inputSchema"])
        invalid = copy.deepcopy(preview)
        invalid["proposal"]["profile"]["unknown"] = True
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(invalid, definitions["preview_artwork_cleanup"]["inputSchema"])
        self.assertFalse(definitions["preview_artwork_cleanup"]["annotations"]["readOnlyHint"])
        for name in ("analyze_artwork_cleanup", "validate_artwork_cleanup"):
            self.assertTrue(definitions[name]["annotations"]["readOnlyHint"])
        self.assertEqual(
            self.adapter.call("capabilities", {})["artwork"]["cleanup"]["max_scan_pixels"],
            cleanup.MAX_SCAN_PIXELS,
        )

    def test_overview_marks_unsampled_hidden_source_change(self):
        # A source change between sampled overview pixels must still be marked.
        raw = bytes([20, 20, 20, 255]) * 2048 * 2
        before = self.project.artwork.documents.create(
            "wide", "Wide", "sprite", 2048, 2, self.project.catalog()["revision"]
        )
        from gbc_scene_forge.artwork import workshop

        before = workshop.with_sources(before, {"composite": raw})
        after = editable.edit_pixels(before, [dict(x=1, y=0, rgba=[22, 22, 22, 255])])
        images = cleanup.images(before, after, None, [dict(x=1, y=0)])
        w, h, changed = png.decode(images["changes"], generic=True)
        self.assertEqual((w, h), (1024, 1))
        self.assertEqual(changed[:4], bytes([255, 0, 255, 255]))

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
    def test_official_sdk_selected_cleanup_example(self):
        example = Path(__file__).resolve().parents[3] / "examples/mcp/pixel_cleanup.py"
        output = self.root / "sdk"
        subprocess.run(
            [sys.executable, str(example), "--output", str(output)],
            check=True,
            capture_output=True,
            timeout=60,
        )
        report = json.loads((output / "report.json").read_text())
        self.assertTrue(report["validation"]["passed"])
        self.assertEqual(report["changed_pixels"], 2)
        self.assertTrue(report["reopened_exact_sources"])
        self.assertTrue(report["stale_receipt_rejected"])
