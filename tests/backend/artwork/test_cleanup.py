"""Structural cleanup guarantees, including intentional details the heuristics damage."""

import base64
import copy
import json
import tempfile
import unittest
from unittest.mock import patch

from support.cleanup_fixture import fixture

from gbc_scene_forge.artwork import cleanup, editable, layers, workshop
from gbc_scene_forge.project.application import Project


class CleanupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        project = Project.create(temp.name, "Cleanup")
        self.spec, raw = fixture()
        self.candidate = workshop.with_sources(
            project.artwork.documents.create(
                "motif", "Motif", "sprite", 16, 16, project.catalog()["revision"]
            ),
            {"composite": raw},
        )

    def preview(self, candidate=None, profile=None):
        candidate = candidate or self.candidate
        analysis = cleanup.analyze(candidate, profile or {})
        return cleanup.preview(
            candidate, analysis["proposal"], [f["id"] for f in analysis["findings"]]
        )

    def test_exact_golden_changes_diagonals_and_protected_glint(self):
        profile = self.spec["protected_profile"]
        analysis = cleanup.analyze(self.candidate, profile)
        result = self.preview(profile=profile)
        self.assertEqual(
            [[p["x"], p["y"]] for p in result["changes"]], self.spec["expected_protected_changes"]
        )
        self.assertEqual(result["candidate"]["descriptor"], self.candidate["descriptor"])
        self.assertTrue(result["validation"]["passed"])
        self.assertEqual(analysis, cleanup.analyze(self.candidate, profile))
        self.assertEqual(result, self.preview(profile=profile))
        # This is intentional damage, not evidence that every suggestion is a defect.
        damaged = self.preview()
        self.assertIn((12, 4), {(p["x"], p["y"]) for p in damaged["changes"]})
        jagged = self.preview(profile={"connectivity": 4})
        self.assertIn((5, 5), {(p["x"], p["y"]) for p in jagged["changes"]})

    def test_selection_binding_pages_and_atomic_rejection(self):
        analysis = cleanup.analyze(self.candidate, {})
        proposal = analysis["proposal"]
        selected = analysis["findings"][0]["id"]
        result = cleanup.preview(self.candidate, proposal, [selected])
        self.assertEqual(result["changed_pixels"], 1)
        self.assertEqual(cleanup.preview(self.candidate, proposal, [])["candidate"], self.candidate)
        self.assertEqual(
            cleanup.analyze(self.candidate, {}, offset=1)["findings"], analysis["findings"][1:]
        )
        for ids in ([selected, selected], [selected, "island-999"], [1]):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                cleanup.preview(self.candidate, proposal, ids)
        changed = editable.edit_pixels(self.candidate, [dict(x=0, y=0, rgba=[1, 2, 3, 255])])
        with self.assertRaisesRegex(ValueError, "stale"):
            cleanup.preview(changed, proposal, [selected])
        altered = copy.deepcopy(proposal)
        altered["profile"]["connectivity"] = 4
        with self.assertRaisesRegex(ValueError, "mismatched"):
            cleanup.preview(self.candidate, altered, [selected])
        with patch.object(cleanup, "PAGE_SIZE", 1):
            page = cleanup.analyze(self.candidate, {})
            self.assertEqual(page["next_offset"], 1)
            self.assertEqual(len(page["findings"]), 1)

    def test_proposal_survives_reordered_json_keys(self):
        for profile in (
            {},
            {
                "rectangle": dict(x=0, y=0, width=16, height=16),
                "protected_rectangles": [dict(x=11, y=3, width=3, height=3)],
            },
        ):
            with self.subTest(profile=profile):
                analysis = cleanup.analyze(self.candidate, profile)
                proposal = analysis["proposal"]
                reordered = json.loads(json.dumps(proposal, sort_keys=True))
                self.assertEqual(proposal, reordered)
                self.assertEqual(
                    cleanup.analyze(self.candidate, reordered["profile"])["proposal"], proposal
                )
                selected = [f["id"] for f in analysis["findings"]]
                self.assertEqual(
                    cleanup.preview(self.candidate, reordered, selected),
                    cleanup.preview(self.candidate, proposal, selected),
                )

    def test_scope_and_partial_components_are_never_clipped(self):
        profile = {"rectangle": dict(x=2, y=10, width=3, height=3)}
        result = self.preview(profile=profile)
        self.assertEqual([(p["x"], p["y"]) for p in result["changes"]], [(3, 11)])
        boundary = {"rectangle": dict(x=3, y=10, width=3, height=3)}
        self.assertEqual(self.preview(profile=boundary)["changed_pixels"], 0)
        protected = {
            "protected_rectangles": [dict(x=2, y=10, width=8, height=4)],
            "protected_pixels": [[12, 4]],
        }
        self.assertEqual(self.preview(profile=protected)["changed_pixels"], 0)
        # Actual-output validation detects arbitrary edits outside the intended scope.
        bad = editable.edit_pixels(result["candidate"], [dict(x=0, y=0, rgba=[9, 8, 7, 255])])
        self.assertFalse(
            cleanup.validate(self.candidate, bad, profile)["hard_checks"]["editable_region"]
        )

    def test_alpha_hidden_rgb_and_independent_actual_output_validation(self):
        raw = bytes([20, 30, 40, 127]) * 256
        raw = bytearray(raw)
        raw[(5 * 16 + 5) * 4 : (5 * 16 + 5) * 4 + 4] = bytes([24, 32, 41, 127])
        raw[(8 * 16 + 8) * 4 : (8 * 16 + 8) * 4 + 4] = bytes([20, 30, 40, 0])
        before = workshop.with_sources(self.candidate, {"composite": bytes(raw)})
        result = self.preview(candidate=before)
        self.assertEqual(result["changed_pixels"], 1)
        output = base64.b64decode(result["candidate"]["rgba"])
        self.assertEqual(output[(8 * 16 + 8) * 4 : (8 * 16 + 8) * 4 + 4], bytes([20, 30, 40, 0]))
        bad = editable.edit_pixels(result["candidate"], [dict(x=8, y=8, rgba=[1, 2, 3, 0])])
        self.assertFalse(cleanup.validate(before, bad, {})["hard_checks"]["hidden_transparent_rgb"])
        bad = editable.edit_pixels(before, [dict(x=5, y=5, rgba=[24, 32, 41, 255])])
        self.assertFalse(cleanup.validate(before, bad, {})["hard_checks"]["alpha"])

    def test_layers_locks_composite_palette_and_recovery(self):
        base, hidden = layers.item("Base"), {**layers.item("Hidden"), "visible": False}
        layered = layers.edit(self.candidate, [base, hidden])
        hidden_candidate = layers.apply(
            layered,
            hidden["id"],
            lambda flat: workshop.with_sources(
                flat, {"composite": base64.b64decode(self.candidate["rgba"])}
            ),
        )
        with self.assertRaisesRegex(ValueError, "explicit layer"):
            cleanup.analyze(hidden_candidate, {})
        analysis = cleanup.analyze(hidden_candidate, {}, hidden["id"])
        result = cleanup.preview(
            hidden_candidate, analysis["proposal"], [analysis["findings"][0]["id"]]
        )
        self.assertEqual(result["candidate"]["rgba"], hidden_candidate["rgba"])
        self.assertEqual(
            result["candidate"]["layer_rgba"][base["id"]], layered["layer_rgba"][base["id"]]
        )
        self.assertTrue(result["validation"]["passed"])
        # Hidden source still counts even when the visible composite has fewer colors.
        self.assertFalse(
            cleanup.validate(
                hidden_candidate, result["candidate"], {"color_budget": 1}, hidden["id"]
            )["passed"]
        )
        locked = layers.edit(hidden_candidate, [base, {**hidden, "locked": True}])
        locked_analysis = cleanup.analyze(locked, {}, hidden["id"])
        with self.assertRaisesRegex(ValueError, "locked"):
            cleanup.preview(locked, locked_analysis["proposal"], [])
        modified_base = layers.apply(
            result["candidate"],
            base["id"],
            lambda flat: editable.edit_pixels(flat, [dict(x=1, y=1, rgba=[9, 8, 7, 255])]),
        )
        report = cleanup.validate(hidden_candidate, modified_base, {}, hidden["id"])
        self.assertFalse(report["hard_checks"]["other_layers"])

    def test_palette_constraints_reject_unsatisfied_output_and_unknown_rules(self):
        profile = {"allowed_palette": [self.spec["background"]], "color_budget": 1}
        analysis = cleanup.analyze(self.candidate, profile)
        self.assertFalse(analysis["validation"]["passed"])
        with self.assertRaisesRegex(ValueError, "hard constraints"):
            cleanup.preview(self.candidate, analysis["proposal"], [])
        for profile in (
            {"outline_width": 2},
            {"connectivity": True},
            {"max_island_size": 17},
            {"max_color_distance": None},
            {"color_budget": True},
            {"allowed_palette": [[0, 0, 0]]},
        ):
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                cleanup.analyze(self.candidate, profile)
        with (
            patch.object(cleanup, "MAX_SCAN_PIXELS", 1),
            self.assertRaisesRegex(ValueError, "scan"),
        ):
            cleanup.analyze(self.candidate, {})
        with (
            patch.object(cleanup, "MAX_FINDINGS", 1),
            self.assertRaisesRegex(ValueError, "findings"),
        ):
            cleanup.analyze(self.candidate, {})
        with patch.object(cleanup, "MAX_WORK", 1), self.assertRaisesRegex(ValueError, "work"):
            cleanup.analyze(self.candidate, {})
        with (
            patch.object(cleanup, "MAX_PROFILE_BYTES", 50),
            self.assertRaisesRegex(ValueError, "Normalized"),
        ):
            cleanup.analyze(self.candidate, {})

    def test_satisfied_palette_budget_and_simultaneous_tie_breaking(self):
        palette = [
            self.spec["background"],
            [24, 16, 24, 255],
            [220, 220, 210, 255],
            [240, 240, 235, 255],
        ]
        result = self.preview(
            profile={
                **self.spec["protected_profile"],
                "color_budget": 4,
                "allowed_palette": palette,
            }
        )
        self.assertTrue(result["validation"]["passed"])
        # Equal support and distance resolve by lexicographic RGBA.
        raw = bytearray(bytes([50, 50, 50, 255]) * 256)
        for x, y, color in [
            (8, 8, [30, 30, 30, 255]),
            (7, 8, [20, 20, 20, 255]),
            (8, 7, [20, 20, 20, 255]),
            (9, 8, [40, 40, 40, 255]),
            (8, 9, [40, 40, 40, 255]),
        ]:
            pos = (y * 16 + x) * 4
            raw[pos : pos + 4] = bytes(color)
        before = workshop.with_sources(self.candidate, {"composite": bytes(raw)})
        analysis = cleanup.analyze(before, {"min_boundary_percent": 50})
        center = next(f for f in analysis["findings"] if f["pixels"] == [[8, 8]])
        self.assertEqual(center["replacement"], [20, 20, 20, 255])
        result = cleanup.preview(before, analysis["proposal"], [center["id"]])
        self.assertEqual(result["changes"][0]["after"], [20, 20, 20, 255])

    def test_composite_constraints_and_geometry_cannot_be_bypassed(self):
        # A permitted transparent target layer does not excuse a disallowed composite.
        base, overlay = layers.item("Base"), layers.item("Overlay")
        before = layers.edit(self.candidate, [base, overlay])
        report = cleanup.validate(
            before, before, {"allowed_palette": [[0, 0, 0, 0]]}, overlay["id"]
        )
        self.assertFalse(report["hard_checks"]["allowed_palette_source_and_composite"])
        report = cleanup.validate(before, before, {"color_budget": 1}, overlay["id"])
        self.assertFalse(report["hard_checks"]["color_budget_source_and_composite"])
        # Identity/metadata/base changes fail even when source pixels are unchanged.
        body = {k: copy.deepcopy(v) for k, v in self.candidate.items() if k != "revision"}
        body["descriptor"]["name"] = "Changed metadata"
        report = cleanup.validate(self.candidate, editable.seal(body), {})
        self.assertFalse(report["passed"])
        self.assertEqual(report["hard_checks"], {"identity_geometry_metadata_and_base": False})
