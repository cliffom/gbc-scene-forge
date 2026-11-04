"""Illustration budgets across native persistence, bounded review and transports."""

import base64
import io
import random
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from gbc_scene_forge.adapters.http.artwork import artwork_response
from gbc_scene_forge.adapters.mcp.artwork import capabilities
from gbc_scene_forge.adapters.mcp.schemas import TOOLS
from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import dimensions, editable, png
from gbc_scene_forge.artwork.drafts import ArtworkDrafts
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project


class LargeArtworkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "project", "Illustrations")
        self.art = self.project.artwork.documents

    def create(self, width, height):
        return self.art.create(
            "card", "Card", "sprite", width, height, self.project.catalog()["revision"]
        )

    def test_dimension_boundaries_and_preallocation_validation(self):
        for width, height in ((1, 1), (4096, 1), (1, 4096), (2048, 2048), (4096, 1024)):
            dimensions.check(width, height)
        for width, height, message in (
            (0, 1, "axes"),
            (-1, 1, "axes"),
            (True, 1, "axes"),
            (1.5, 1, "axes"),
            (4097, 1, "axes"),
            (1, 4097, "axes"),
            (2048, 2049, "area"),
            (4096, 4096, "area"),
        ):
            with self.subTest(width=width, height=height):
                with patch.object(self.art, "_envelope") as allocate:
                    with self.assertRaisesRegex(ValueError, message):
                        self.create(width, height)
                    allocate.assert_not_called()
        for kind, width, height in (("tile", 9, 9), ("tile", 384, 544)):
            with self.assertRaises(ValueError):
                self.art.create(
                    "bad", "Bad", kind, width, height, self.project.catalog()["revision"]
                )

    def test_card_sizes_edit_review_commit_reopen_recover_export(self):
        for width, height in (
            (384, 544),
            (375, 525),
            (411, 561),
            (750, 1050),
            (822, 1122),
            (1500, 2100),
        ):
            with self.subTest(width=width, height=height):
                project = Project.create(self.root / f"p{width}", "Card")
                art = project.artwork.documents
                original = art.create(
                    "card", "Card", "sprite", width, height, project.catalog()["revision"]
                )
                candidate = art.edit(
                    original, [{"x": width - 1, "y": height - 1, "rgba": [77, 88, 99, 0]}]
                )
                raw = base64.b64decode(candidate["rgba"])
                self.assertEqual(raw[-4:], bytes([77, 88, 99, 0]))
                with self.assertRaisesRegex(ValueError, "65536"):
                    art.read(candidate)
                detail = {"x": width - 1, "y": height - 1, "width": 1, "height": 1}
                self.assertEqual(base64.b64decode(art.read(candidate, detail)["rgba"]), raw[-4:])
                drafts = ArtworkDrafts(art)
                data = dict(
                    id=str(uuid4()),
                    owner=str(uuid4()),
                    project_id=original["project_id"],
                    original=original,
                    candidate=candidate,
                    name="Card",
                    revision=None,
                )
                draft_ack = drafts.write(data)
                recovered = drafts.restore(data["id"], draft_ack["revision"])
                self.assertEqual(recovered["candidate"], candidate)
                copy_id = str(uuid4())
                copy_ack = drafts.write(
                    {**recovered, "id": copy_id, "owner": str(uuid4()), "revision": None}
                )
                self.assertEqual(drafts.read(data["id"])[1], draft_ack["revision"])
                self.assertEqual(
                    drafts.restore(copy_id, copy_ack["revision"])["candidate"], candidate
                )
                review = project.artwork.reviews.review(candidate)
                for key in ("native_png", "enlarged_png"):
                    w, h, _ = png.decode(review["after"][key], generic=True)
                    self.assertLessEqual(max(w, h), 1024)
                zoom = project.artwork.reviews.review(candidate, rectangle=detail)
                self.assertEqual(png.decode(zoom["after"]["native_png"], generic=True)[2], raw[-4:])
                ack = art.save(candidate, receipt=zoom["receipt"])
                target = {
                    "atlas_id": "card",
                    "document_id": candidate["document_id"],
                    "region": "artwork",
                }
                reopened = Project(project.root).artwork.documents.open(
                    target, ack["project_revision"], ack["artwork_revision"]
                )
                self.assertEqual(reopened["rgba"], candidate["rgba"])
                exported, _ = project.export_bundle("project", ack["project_revision"])
                with zipfile.ZipFile(io.BytesIO(exported)) as archive:
                    self.assertEqual(
                        png.decode(archive.read("assets/card/sprites/0.png"), generic=True)[2], raw
                    )
                with self.assertRaises(Conflict):
                    drafts.restore(data["id"], draft_ack["revision"])

    def test_incompressible_png_exceeds_old_payload_budget_and_preserves_rgba(self):
        width, height = 1500, 2100
        raw = random.Random(181).randbytes(width * height * 4)
        image = png.encode(width, height, raw)
        self.assertGreater(len(image), 4 * 1024 * 1024)
        self.assertEqual(png.decode(image, generic=True), (width, height, raw))
        original = self.create(width, height)
        candidate = editable.seal(
            {
                **{k: v for k, v in original.items() if k != "revision"},
                "rgba": base64.b64encode(raw).decode(),
            }
        )
        self.art.save(candidate)
        scene = self.project.scenes.create("Card", 2, 2, 8, self.project.catalog()["revision"])
        scene["scene"]["objects"] = [{"id": 1, "asset": "card/artwork", "x": 0, "y": 0}]
        scene["scene"]["next_object_id"] = 2
        self.project.scenes.save(
            scene["id"], scene["scene"], scene["revision"], self.project.catalog()["revision"]
        )
        bundle, _ = self.project.export_bundle("project", self.project.catalog()["revision"])
        self.assertGreater(len(bundle), 5 * 1024 * 1024)
        payload = base64.b64encode(bundle).decode()
        destination = Project.create(self.root / "imported", "Imported")
        revision = destination.catalog()["revision"]
        report = destination.imports.forge(payload, revision)
        self.assertTrue(report["compatible"], report)
        result = destination.imports.forge(
            payload, revision, dry_run=False, confirmation=report["confirmation"]
        )
        atlas = result["assets"][0]["destination"]
        self.assertEqual(
            png.decode(
                (destination.root / f"assets/{atlas}/sprites/0.png").read_bytes(), generic=True
            )[2],
            raw,
        )
        with patch.object(png.zlib, "decompressobj") as decompress:
            invalid = png.encode(4096, 1025, b"")
            with self.assertRaisesRegex(ValueError, "area"):
                png.decode(invalid, generic=True)
            decompress.assert_not_called()

    def test_compact_http_and_mcp_patch_contracts(self):
        candidate = self.create(375, 525)
        for transport in ("http", "mcp"):
            with self.subTest(transport=transport):
                if transport == "http":
                    owner = str(uuid4())

                    def call(action, **data):
                        return artwork_response(self.project, action, {"owner": owner, **data})

                    retain, edit, export, release = (
                        "candidate-retain",
                        "edit",
                        "candidate-export",
                        "candidate-release",
                    )
                else:
                    adapter = Adapter(self.project.root, single_project=True)

                    def call(action, **data):
                        return adapter.call(action, {"project": "project", **data})

                    retain, edit, export, release = (
                        "retain_artwork_candidate",
                        "edit_artwork_pixels",
                        "export_artwork_candidate",
                        "release_artwork_candidate",
                    )
                handle = call(retain, candidate=candidate)
                rectangle = dict(x=374, y=524, width=1, height=1)
                changed = call(
                    edit, candidate=handle, patch=dict(rectangle=rectangle, rgba="AQIDAA==")
                )
                self.assertNotIn("rgba", changed)
                self.assertEqual(
                    base64.b64decode(call(export, candidate=changed)["rgba"])[-4:],
                    b"\x01\x02\x03\0",
                )
                with self.assertRaisesRegex(ValueError, "Choose pixel writes"):
                    call(
                        edit,
                        candidate=handle,
                        writes=[],
                        patch=dict(rectangle=rectangle, rgba="AQIDAA=="),
                    )
                call(release, candidate=changed)
                call(release, candidate=handle)
        self.assertEqual(capabilities()["sprite_dimension"]["maximum"], dimensions.MAX_AXIS)
        shape = next(t for t in TOOLS if t["name"] == "create_artwork")["inputSchema"]
        self.assertEqual(shape["properties"]["width"]["maximum"], dimensions.MAX_AXIS)
        self.assertEqual(capabilities()["max_document_pixels"], dimensions.MAX_PIXELS)
        with self.assertRaisesRegex(ValueError, "65536"):
            editable.patch_pixels(
                candidate, dict(rectangle=dict(x=0, y=0, width=375, height=525), rgba="")
            )

    def test_browser_candidate_cleanup_preserves_other_sessions_and_mcp(self):
        candidate = self.create(375, 525)
        adapter = Adapter(self.project.root, single_project=True)

        def mcp(action, **data):
            return adapter.call(action, {"project": "project", **data})

        def http(action, **data):
            return artwork_response(self.project, action, data)

        shared = mcp("retain_artwork_candidate", candidate=candidate)
        owner, other_owner = str(uuid4()), str(uuid4())
        first = http("candidate-retain", candidate=candidate, owner=owner)
        second = http("candidate-retain", candidate=candidate, owner=other_owner)
        self.assertNotEqual(first, second)
        self.assertEqual(first["owner"], owner)
        changed = http(
            "edit",
            candidate=first,
            patch=dict(rectangle=dict(x=0, y=0, width=1, height=1), rgba="AQIDAA=="),
        )
        self.assertEqual(changed["owner"], owner)
        # Every owner's copy counts against the same project quota.
        with patch("gbc_scene_forge.artwork.candidates.MAX_COUNT", 4):
            with self.assertRaisesRegex(ValueError, "limit"):
                http("candidate-retain", candidate=candidate, owner=str(uuid4()))
        for invalid in (None, "../escape", 42):
            with self.assertRaisesRegex(ValueError, "owner UUID"):
                http("candidate-retain", candidate=candidate, owner=invalid)
        http("candidate-release", candidate=first)
        self.assertEqual(http("candidate-export", candidate=second), candidate)
        self.assertEqual(mcp("export_artwork_candidate", candidate=shared), candidate)
        http("candidate-release", candidate=changed)
        # Scoped copies remain discoverable/exportable after a server restart,
        # including abandoned browser transfers that need explicit cleanup.
        adapter = Adapter(self.project.root, single_project=True)
        listing = mcp("list_artwork_candidates")["candidates"]
        self.assertEqual(len(listing), 2)
        listed = next(c for c in listing if c.get("owner") == other_owner)
        listed = {
            k: listed[k] for k in ("handle", "project_id", "project_revision", "revision", "owner")
        }
        self.assertEqual(mcp("export_artwork_candidate", candidate=listed), candidate)
        continued = mcp(
            "edit_artwork_pixels",
            candidate=listed,
            writes=[dict(x=0, y=0, rgba=[4, 5, 6, 0])],
        )
        self.assertEqual(continued["owner"], other_owner)
        mcp("release_artwork_candidate", candidate=shared)
        self.assertEqual(http("candidate-export", candidate=second), candidate)
        mcp("release_artwork_candidate", candidate=listed)
        mcp("release_artwork_candidate", candidate=continued)
        self.assertEqual(mcp("list_artwork_candidates")["candidates"], [])
