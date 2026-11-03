"""Native artwork candidates, saved guards, atomic persistence and portability."""

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

from support.atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.artwork import editable, png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.formats import exporting
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import validate
from gbc_scene_forge.storage import transactions
from gbc_scene_forge.storage.files import digest


class EditableTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.project = Project.create(self.folder / "project", "Pixels")
        self.art = self.project.artwork.documents

    def revision(self):
        return self.project.catalog()["revision"]

    def create(self, **kwargs):
        return self.art.create("native", "Native", "tile", 16, 16, self.revision(), **kwargs)

    def target(self, candidate):
        return {
            "atlas_id": candidate["atlas_id"],
            "document_id": candidate["document_id"],
            "region": candidate["descriptor"]["region"],
        }

    def reopen(self, candidate, acknowledgment):
        return self.art.open(
            self.target(candidate),
            acknowledgment["project_revision"],
            acknowledgment["artwork_revision"],
        )

    def snapshot(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file() and not str(p.relative_to(self.project.root)).startswith(".forge/")
        }

    def source(self, atlas_id, region, grid=None, cell=None):
        document = self.project.read()[0]
        return {
            "atlas_id": atlas_id,
            "region": region,
            "grid": grid,
            "cell": cell,
            "artwork_revision": editable.artwork_revision(
                document["atlases"][atlas_id], document["files"]
            ),
        }

    def test_blank_edit_exact_alpha_reads_save_reopen_and_discovery(self):
        before = self.snapshot()
        candidate = self.create()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(base64.b64decode(candidate["rgba"]), bytes(16 * 16 * 4))
        changed = self.art.edit(
            candidate,
            [
                {"x": 1, "y": 2, "rgba": [77, 88, 99, 0]},
                {"x": 2, "y": 2, "rgba": [200, 150, 100, 128]},
            ],
        )
        self.assertNotEqual(candidate["revision"], changed["revision"])
        self.assertEqual(base64.b64decode(candidate["rgba"]), bytes(16 * 16 * 4))
        exact = self.art.read(changed, {"x": 1, "y": 2, "width": 2, "height": 1})
        self.assertEqual(
            base64.b64decode(exact["rgba"]), bytes([77, 88, 99, 0, 200, 150, 100, 128])
        )
        acknowledgment = self.art.save(changed)
        self.assertEqual(acknowledgment["candidate_revision"], changed["revision"])
        self.assertEqual(acknowledgment["project_revision"], self.revision())
        reopened = Project(self.project.root).artwork.documents
        self.assertEqual(
            reopened.list(self.revision())["documents"][0]["target"], self.target(changed)
        )
        saved = self.reopen(changed, acknowledgment)
        self.assertEqual(saved["rgba"], changed["rgba"])
        self.assertEqual(
            acknowledgment["png_digest"],
            digest((self.project.root / "assets/native/atlas.png").read_bytes()),
        )
        self.assertNotEqual(saved["operation"], changed["operation"])
        # Every generated grid is refreshed from exactly the same source.
        for size in (8, 16):
            tile = png.decode((self.project.root / f"assets/native/grid-{size}/0.png").read_bytes())
            self.assertEqual(
                tile[2][(2 * size + 1) * 4 : (2 * size + 1) * 4 + 4], bytes([77, 88, 99, 0])
            )

    def test_invalid_batches_are_atomic_and_candidates_are_digest_bound(self):
        candidate = self.create()
        before = copy.deepcopy(candidate)
        invalid = [
            [{"x": 0, "y": 0, "rgba": [1, 2, 3, 4]}, {"x": 16, "y": 0, "rgba": [0] * 4}],
            [{"x": True, "y": 0, "rgba": [0] * 4}],
            [{"x": 0, "y": 0, "rgba": [1, 2, 3, True]}],
            [{"x": 0, "y": 0, "rgba": [1, 2, 3, 256]}],
            [{"x": 0, "y": 0, "rgba": [1, 2, 3, float("nan")]}],
            [{"x": 0, "y": 0, "rgba": {1, 2, 3, 4}}],
            [{"x": 0, "y": 0, "rgba": [0] * 4, "extra": 1}],
            [{"x": 0, "y": 0, "rgba": [0] * 4}] * 2,
            [{}] * 65537,
        ]
        for writes in invalid:
            with self.subTest(writes=str(writes)[:100]), self.assertRaises(ValueError):
                self.art.edit(candidate, writes)
            self.assertEqual(candidate, before)
        with patch.object(editable, "MAX_BATCH", 1), self.assertRaisesRegex(ValueError, "1 MiB"):
            self.art.edit(candidate, [{"x": 0, "y": 0, "rgba": [0] * 4}])
        for rectangle in (
            {"x": 0, "y": 0, "width": 17, "height": 1},
            {"x": 0, "y": 0, "width": True, "height": 1},
            {},
        ):
            with self.assertRaises(ValueError):
                self.art.read(candidate, rectangle)
        changed = copy.deepcopy(candidate)
        changed["descriptor"]["name"] = "Changed without a new digest"
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            self.art.save(changed)
        with (
            patch.object(editable, "MAX_CANDIDATE", 1),
            self.assertRaisesRegex(ValueError, "24 MiB"),
        ):
            self.art.save(candidate)

    def test_dimensions_origin_and_unknown_fields(self):
        for kind, width, height, origin in [
            ("tile", 8, 16, [0, 0]),
            ("tile", 64, 64, [0, 0]),
            ("tile", 8, 8, [1, 0]),
            ("sprite", 0, 8, [0, 0]),
            ("sprite", 4097, 8, [0, 0]),
            ("sprite", 8, 8, [8, 0]),
            ("sprite", 8, True, [0, 0]),
            ("sprite", 8, 8, [False, 0]),
        ]:
            with self.subTest(kind=kind, width=width, height=height), self.assertRaises(ValueError):
                self.art.create("bad", "Bad", kind, width, height, self.revision(), origin=origin)
        maximum = self.art.create(
            "big", "Big", "sprite", 256, 256, self.revision(), origin=[255, 255]
        )
        self.assertEqual(len(base64.b64decode(self.art.read(maximum)["rgba"])), 262144)
        for field in ("layer", "palette_index"):
            malformed = copy.deepcopy(maximum)
            malformed[field] = 0
            with self.assertRaises(ValueError):
                self.art.save(malformed)

    def test_shared_pixel_edit_preserves_maps_metadata_and_local_ids(self):
        candidate = self.create()
        self.art.save(candidate)
        meta = {
            "terrain": "grass",
            "terrain_mask": 15,
            "solid": True,
            "shapes": [{"id": 4, "kind": "rectangle", "x": 1, "y": 2, "width": 3, "height": 4}],
            "next_shape_id": 9,
        }
        self.project.artwork.set_metadata(
            "native", "8", "native/artwork/0/0", meta, self.revision()
        )
        loaded = self.project.scenes.create("Paint", 2, 2, 8, self.revision())
        loaded["scene"]["cells"][0][0] = "native/artwork/0/0#7"
        self.project.scenes.save(loaded["id"], loaded["scene"], loaded["revision"], self.revision())
        before = self.snapshot()
        docs = self.art.list(self.revision())["documents"]
        opened = self.art.open(docs[0]["target"], self.revision(), docs[0]["artwork_revision"])
        changed = self.art.edit(opened, [{"x": 0, "y": 0, "rgba": [240, 2, 3, 255]}])
        acknowledgment = self.art.save(changed)
        self.assertEqual(acknowledgment["scene_revisions"], {})
        self.assertEqual(
            (self.project.root / f"scenes/{loaded['id']}.tmj").read_bytes(),
            before[f"scenes/{loaded['id']}.tmj"],
        )
        entry = self.project.read()[0]["atlases"]["native"]
        self.assertEqual(entry["metadata"]["8"]["native/artwork/0/0"], meta)
        self.assertEqual(
            entry["tiles"], json.loads(before["forge.project.json"])["atlases"]["native"]["tiles"]
        )
        ts = json.loads((self.project.root / "assets/native/grid-8.tsj").read_bytes())
        self.assertEqual(ts["tiles"][0]["objectgroup"]["objects"][0]["id"], 4)

    def test_imported_tile_copy_metadata_and_native_duplication(self):
        path, _ = bundle(self.folder / "import")
        self.project.artwork.import_atlas(path, self.revision())
        meta = {"terrain": "dirt", "solid": True, "shapes": [], "next_shape_id": 1}
        self.project.artwork.set_metadata(
            "terrain", "8", "terrain/stone/0/0", meta, self.revision()
        )
        source = self.source("terrain", "stone", 8, [0, 0])
        before = self.snapshot()
        copied = self.art.duplicate(source, "copy", "Copy", self.revision())
        self.assertEqual(self.snapshot(), before)
        acknowledgment = self.art.save(copied)
        self.assertEqual(
            copied["descriptor"]["provenance"]["artwork_revision"], source["artwork_revision"]
        )
        entry = self.project.read()[0]["atlases"]["copy"]
        self.assertEqual(entry["metadata"], {"8": {"copy/artwork/0/0": meta}})
        original = {p: d for p, d in before.items() if p.startswith("assets/terrain/")}
        self.assertEqual(original, {p: self.snapshot()[p] for p in original})
        native_copy = self.art.duplicate(
            self.source("copy", "artwork", 8, [0, 0]), "second", "Second", self.revision()
        )
        self.assertEqual(native_copy["rgba"], self.reopen(copied, acknowledgment)["rgba"])
        self.assertNotEqual(native_copy["document_id"], copied["document_id"])
        with self.assertRaisesRegex(ValueError, "read-only"):
            self.art.open(
                {"atlas_id": "terrain", "region": "earth", "document_id": copied["document_id"]},
                self.revision(),
                source["artwork_revision"],
            )

    def test_sprite_copy_origin_metadata_and_scene_placements(self):
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        source = self.source("actors", "idle")
        copied = self.art.duplicate(source, "sprite", "Sprite", self.revision())
        source_region = self.project.read()[0]["atlases"]["actors"]["manifest"]["regions"][0]
        self.assertEqual(copied["descriptor"]["origin"], source_region["origin"])
        acknowledgment = self.art.save(copied)
        loaded = self.project.scenes.create("Sprite", 2, 2, 8, self.revision())
        loaded["scene"]["objects"] = [
            {"id": 1, "asset": "sprite/artwork", "x": 8, "y": 8, "origin": [1, 2]}
        ]
        loaded["scene"]["next_object_id"] = 2
        saved = self.project.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], self.revision()
        )
        opened = self.art.open(
            self.target(copied), self.revision(), acknowledgment["artwork_revision"]
        )
        self.art.save(self.art.edit(opened, [{"x": 0, "y": 0, "rgba": [3, 4, 5, 6]}]))
        self.assertEqual(self.project.scenes.load(saved["id"])["scene"], saved["scene"])
        self.assertEqual(self.project.scenes.load(saved["id"])["revision"], saved["revision"])

    def test_conflicts_keep_candidates_and_never_partially_save(self):
        candidate = self.create()
        acknowledgment = self.art.save(candidate)
        opened = self.reopen(candidate, acknowledgment)
        changed = self.art.edit(opened, [{"x": 0, "y": 0, "rgba": [1, 2, 3, 4]}])
        self.project.scenes.create("Concurrent", 1, 1, 8, self.revision())
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.art.save(changed)
        self.assertEqual(self.snapshot(), before)
        # Replacing the project base alone cannot bypass the artwork base.
        stale = {k: v for k, v in changed.items() if k != "revision"}
        stale["project_revision"] = self.revision()
        stale["artwork_revision"] = "0" * 64
        with self.assertRaises(Conflict):
            self.art.save(editable.seal(stale))
        self.assertEqual(self.snapshot(), before)
        (self.project.root / "assets/native/atlas.png").write_bytes(b"drift")
        with self.assertRaisesRegex(Conflict, "changed on disk"):
            self.art.list(self.revision())

    def test_destination_collisions_and_invalid_candidate_policies(self):
        candidate = self.create()
        path = self.project.root / "assets/native"
        path.mkdir(parents=True)
        (path / "unmanaged.txt").write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "path already exists"):
            self.art.save(candidate)
        self.assertEqual((path / "unmanaged.txt").read_bytes(), b"keep")
        (path / "unmanaged.txt").unlink()
        path.rmdir()
        acknowledgment = self.art.save(candidate)
        opened = self.reopen(candidate, acknowledgment)
        for field, value in (("origin", [1, 1]), ("name", "Unexpected rename")):
            envelope = {k: copy.deepcopy(v) for k, v in opened.items() if k != "revision"}
            envelope["descriptor"][field] = value
            with self.assertRaises(ValueError):
                self.art.save(editable.seal(envelope))
        path, _ = bundle(self.folder / "reimport", "native")
        with self.assertRaisesRegex(ValueError, "cannot be reimported"):
            self.project.artwork.import_atlas(path, self.revision(), reimport=True)

    def test_external_imports_reject_reserved_native_format_without_writes(self):
        path, manifest = bundle(self.folder / "reserved-format")
        for reimport in (False, True):
            if reimport:
                self.project.artwork.import_atlas(path, self.revision())
            manifest["source_format"] = "forge-rgba"
            path.write_text(json.dumps(manifest))
            uploaded = {
                "name": path.name,
                "manifest": path.read_text(),
                "png": base64.b64encode((path.parent / "atlas.png").read_bytes()).decode(),
            }
            revision, before = self.revision(), self.snapshot()
            for intake in ("local", "upload", "preflight"):
                with (
                    self.subTest(reimport=reimport, intake=intake),
                    self.assertRaisesRegex(ValueError, "cannot be imported as an external atlas"),
                ):
                    if intake == "local":
                        self.project.artwork.import_atlas(path, revision, reimport=reimport)
                    else:
                        self.project.artwork.import_bundle(
                            uploaded, revision, reimport=reimport, dry_run=intake == "preflight"
                        )
                self.assertEqual(self.snapshot(), before)
                self.assertEqual(Project(self.project.root).catalog()["revision"], revision)
            manifest.pop("source_format")
            path.write_text(json.dumps(manifest))

    def test_final_journal_guards_scene_and_generated_paths(self):
        loaded = self.project.scenes.create("Original", 2, 2, 8, self.revision())
        candidate = self.create()
        original_commit = self.project.store.commit
        scene_path = self.project.root / f"scenes/{loaded['id']}.tmj"
        original = scene_path.read_bytes()

        def race(*args, **kwargs):
            scene_path.write_bytes(original + b"\n")
            return original_commit(*args, **kwargs)

        with patch.object(self.project.store, "commit", race), self.assertRaises(Conflict):
            self.art.save(candidate)
        self.assertFalse((self.project.root / "assets/native/atlas.png").exists())
        scene_path.write_bytes(original)

        def output_race(*args, **kwargs):
            path = self.project.root / "assets/native/atlas.png"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"concurrent")
            return original_commit(*args, **kwargs)

        with patch.object(self.project.store, "commit", output_race), self.assertRaises(Conflict):
            self.art.save(candidate)
        self.assertEqual(
            (self.project.root / "assets/native/atlas.png").read_bytes(), b"concurrent"
        )

    def test_atomic_write_failure_rolls_back_source_derived_and_maps(self):
        self.project.scenes.create("Existing", 2, 2, 8, self.revision())
        candidate = self.create()
        before = self.snapshot()
        original = transactions.atomic_write
        failed = False

        def fail_once(path, data):
            nonlocal failed
            if path == self.project.root / "assets/native/grid-8/0.png" and not failed:
                failed = True
                raise OSError("disk failure")
            return original(path, data)

        with patch.object(transactions, "atomic_write", fail_once), self.assertRaises(OSError):
            self.art.save(candidate)
        self.assertTrue(failed)
        self.assertEqual(self.snapshot(), before)
        Project(self.project.root)
        self.art.save(candidate)  # Original candidate is still usable after rollback.

    def test_portable_project_reopen_and_both_transfer_scopes_remap_documents(self):
        candidate = self.art.edit(self.create(), [{"x": 0, "y": 0, "rgba": [10, 20, 30, 0]}])
        self.art.save(candidate)
        sprite = self.art.create(
            "sprite", "Sprite", "sprite", 16, 24, self.revision(), origin=[7, 17]
        )
        sprite = self.art.edit(sprite, [{"x": 1, "y": 1, "rgba": [77, 88, 99, 123]}])
        self.art.save(sprite)
        loaded = self.project.scenes.create("Source", 2, 2, 8, self.revision())
        loaded["scene"]["cells"][0][0] = "native/artwork/0/0#3"
        saved = self.project.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], self.revision()
        )
        for scope in ("project", "scene"):
            raw, _ = self.project.export_bundle(
                scope, self.revision(), **({"scene_id": saved["id"]} if scope == "scene" else {})
            )
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                files = {p: archive.read(p) for p in archive.namelist()}
            self.assertIn("assets/native/editable.json", files)
            if scope == "project":
                root = self.folder / "extracted"
                for path, data in files.items():
                    target = root / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                reopened = Project(root)
                saved_candidate = reopened.artwork.documents.open(
                    self.target(candidate),
                    reopened.catalog()["revision"],
                    reopened.artwork.documents.list(reopened.catalog()["revision"])["documents"][0][
                        "artwork_revision"
                    ],
                )
                self.assertEqual(saved_candidate["rgba"], candidate["rgba"])
            destination = Project.create(self.folder / ("destination-" + scope), "Destination")
            encoded = base64.b64encode(raw).decode()
            rev = destination.catalog()["revision"]
            preflight = destination.imports.forge(encoded, rev)
            self.assertTrue(preflight["compatible"], preflight)
            imported = destination.imports.forge(
                encoded, rev, dry_run=False, confirmation=preflight["confirmation"]
            )
            document, revision = destination.read()
            entry = next(iter(document["atlases"].values()))
            self.assertNotEqual(entry["editable"]["id"], candidate["document_id"])
            docs = destination.artwork.documents.list(revision)["documents"]
            copied = destination.artwork.documents.open(
                docs[0]["target"], revision, docs[0]["artwork_revision"]
            )
            self.assertEqual(copied["rgba"], candidate["rgba"])
            sprite_doc = docs[1]
            copied_sprite = destination.artwork.documents.open(
                sprite_doc["target"], revision, sprite_doc["artwork_revision"]
            )
            self.assertEqual(copied_sprite["descriptor"]["origin"], [7, 17])
            self.assertEqual(copied_sprite["rgba"], sprite["rgba"])
            self.assertEqual(
                destination.scenes.load(imported["imported"][0])["scene"]["cells"][0][0],
                copied["atlas_id"] + "/artwork/0/0#3",
            )
            destination.artwork.documents.save(
                destination.artwork.documents.edit(
                    copied, [{"x": 1, "y": 0, "rgba": [1, 2, 3, 255]}]
                )
            )
            destination.export_bundle("project", destination.catalog()["revision"])

    def test_schema_rejects_duplicate_ids_unknown_fields_and_bad_descriptors(self):
        self.art.save(self.create())
        document = self.project.read()[0]
        for mutate in (
            lambda e: e["editable"].update(extra=True),
            lambda e: e["editable"].update(path="assets/other/editable.json"),
            lambda e: e["manifest"].update(extra=True),
            lambda e: e["tiles"]["8"].update({"native/other/0/0": 4}),
        ):
            invalid = copy.deepcopy(document)
            mutate(invalid["atlases"]["native"])
            with self.assertRaises(ValueError):
                validate(invalid, self.project.root)
        invalid = copy.deepcopy(document)
        del invalid["files"]["assets/native/grid-8/0.png"]
        with self.assertRaisesRegex(ValueError, "generated assets must be declared"):
            validate(invalid, self.project.root)
        path = self.project.root / "assets/native/editable.json"
        descriptor = json.loads(path.read_bytes())
        descriptor["region"] = "different"
        path.write_bytes(record_bytes(descriptor))
        document["files"]["assets/native/editable.json"] = digest(path.read_bytes())
        (self.project.root / "forge.project.json").write_bytes(record_bytes(document))
        with self.assertRaisesRegex(ValueError, "differs from atlas"):
            self.art.list(self.revision())

    def test_invalid_native_transfer_descriptor_disables_import_without_writes(self):
        self.art.save(self.create())
        self.project.scenes.create("Export", 1, 1, 8, self.revision())
        raw, _ = self.project.export_bundle("project", self.revision())
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            files = {p: archive.read(p) for p in archive.namelist()}
        descriptor = json.loads(files["assets/native/editable.json"])
        descriptor["width"] = 8
        files["assets/native/editable.json"] = record_bytes(descriptor)
        document = json.loads(files["forge.project.json"])
        document["files"]["assets/native/editable.json"] = digest(
            files["assets/native/editable.json"]
        )
        files["forge.project.json"] = record_bytes(document)
        report = json.loads(files["export.json"])
        report["files"] = {p: digest(data) for p, data in files.items() if p != "export.json"}
        files["export.json"] = record_bytes(report)
        destination = Project.create(self.folder / "bad-transfer", "Destination")
        report = destination.imports.forge(
            base64.b64encode(exporting.archive(files)).decode(), destination.catalog()["revision"]
        )
        self.assertFalse(report["compatible"])
        self.assertEqual(destination.read()[0]["atlases"], {})

    def test_interrupted_transaction_recovers_on_reopen(self):
        candidate = self.create()
        before = self.snapshot()
        original = transactions.atomic_write

        def interrupted(path, data):
            if path == self.project.root / "assets/native/grid-16.tsj":
                raise OSError("interrupted")
            return original(path, data)

        with (
            patch.object(transactions, "atomic_write", interrupted),
            patch.object(self.project.transactions, "_restore", side_effect=OSError("power lost")),
            self.assertRaisesRegex(OSError, "power lost"),
        ):
            self.art.save(candidate)
        self.assertTrue((self.project.root / "assets/native/atlas.png").exists())
        recovered = Project(self.project.root)
        self.assertEqual(self.snapshot(), before)
        acknowledgment = recovered.artwork.documents.save(candidate)
        self.assertEqual(acknowledgment["project_revision"], self.revision())

    def test_duplicate_rechecks_source_and_preserves_static_sprite_metadata(self):
        path, _ = sprite_bundle(self.folder / "sprites")
        self.project.artwork.import_atlas(path, self.revision())
        metadata = {"terrain": "", "solid": True, "shapes": [], "next_shape_id": 1}
        self.project.artwork.set_metadata(
            "actors", "sprites", "actors/idle", metadata, self.revision()
        )
        source = self.source("actors", "idle")
        candidate = self.art.duplicate(source, "copy", "Copy", self.revision())
        self.assertEqual(candidate["metadata"], {"sprites": {"copy/artwork": metadata}})
        self.art.save(candidate)
        self.assertEqual(self.project.read()[0]["atlases"]["copy"]["manifest"]["animations"], [])
        self.project.artwork.set_metadata(
            "actors", "sprites", "actors/idle", {**metadata, "solid": False}, self.revision()
        )
        before = self.snapshot()
        # Even an explicitly resealed envelope with a new project base still guards the old source.
        changed = {k: copy.deepcopy(v) for k, v in candidate.items() if k != "revision"}
        changed["project_revision"] = self.revision()
        changed["atlas_id"] = changed["descriptor"]["atlas_id"] = "fresh"
        changed["document_id"] = changed["descriptor"]["id"] = str(uuid4())
        changed["metadata"] = {"sprites": {"fresh/artwork": metadata}}
        with self.assertRaises(Conflict):
            self.art.save(editable.seal(changed))
        self.assertEqual(self.snapshot(), before)

    def test_acknowledgment_is_exact_even_when_another_writer_saves_after_commit(self):
        candidate = self.create()
        original = self.project.store.commit
        committed = {}

        def save_then_race(*args, **kwargs):
            original(*args, **kwargs)
            document, revision = self.project.read()
            committed.update(
                project=revision,
                artwork=editable.artwork_revision(document["atlases"]["native"], document["files"]),
            )
            document["name"] = "Later writer"
            original(document, revision, {}, {}, "Concurrent rename")

        with patch.object(self.project.store, "commit", save_then_race):
            acknowledgment = self.art.save(candidate)
        self.assertEqual(acknowledgment["project_revision"], committed["project"])
        self.assertEqual(acknowledgment["artwork_revision"], committed["artwork"])
        self.assertNotEqual(acknowledgment["project_revision"], self.revision())

    def test_unused_new_atlas_preserves_scene_bytes_and_later_placement_is_local(self):
        path, _ = bundle(self.folder / "tiles")
        self.project.artwork.import_atlas(path, self.revision())
        path, _ = sprite_bundle(self.folder / "actors")
        self.project.artwork.import_atlas(path, self.revision())
        loaded = self.project.scenes.create("Existing", 2, 2, 8, self.revision())
        loaded["scene"]["cells"][0][0] = "terrain/stone/0/0#5"
        loaded["scene"]["objects"] = [{"id": 3, "asset": "actors/idle", "x": 4, "y": 7}]
        loaded["scene"]["next_object_id"] = 4
        saved = self.project.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], self.revision()
        )
        other = self.project.scenes.create("Other", 2, 2, 8, self.revision())
        originals = {
            item["id"]: (self.project.root / f"scenes/{item['id']}.tmj").read_bytes()
            for item in (saved, other)
        }
        candidate = self.art.create("aaa", "First atlas", "tile", 32, 32, self.revision())
        review = self.project.artwork.reviews.review(candidate)
        acknowledgment = self.art.save(candidate, receipt=review["receipt"])
        reopened = self.project.scenes.load(saved["id"])
        self.assertEqual(reopened["scene"], saved["scene"])
        self.assertEqual(acknowledgment["scene_revisions"], {})
        self.assertEqual(reopened["revision"], saved["revision"])
        for scene_id, data in originals.items():
            self.assertEqual((self.project.root / f"scenes/{scene_id}.tmj").read_bytes(), data)
        reopened["scene"]["cells"][1][1] = "aaa/artwork/0/0#7"
        placed = self.project.scenes.save(
            reopened["id"], reopened["scene"], reopened["revision"], self.revision()
        )
        self.assertEqual(self.project.scenes.load(placed["id"])["scene"], placed["scene"])
        self.assertEqual(placed["scene"]["cells"][0][0], "terrain/stone/0/0#5")
        self.assertEqual(placed["scene"]["objects"], saved["scene"]["objects"])
        self.assertEqual(
            (self.project.root / f"scenes/{other['id']}.tmj").read_bytes(), originals[other["id"]]
        )

    def test_busy_and_post_read_drift_are_distinct_from_invalid_input(self):
        from gbc_scene_forge.core.errors import TransactionBusy

        candidate = self.create()
        original = self.art._revalidate

        def drift(revision):
            (self.project.root / "forge.project.json").write_bytes(b"{}")
            original(revision)

        with patch.object(self.project.store, "read_session", side_effect=TransactionBusy("busy")):
            with self.assertRaises(TransactionBusy):
                self.art.save(candidate)
        self.art.save(candidate)
        path = self.project.root / "forge.project.json"
        before = path.read_bytes()
        with patch.object(self.art, "_revalidate", drift), self.assertRaises(ValueError):
            self.art.list(self.revision())
        path.write_bytes(before)

    def test_aggregate_hashes_ignore_object_order_and_preserve_array_order(self):
        self.assertEqual(
            editable.canonical_bytes({"z": {"b": 1, "a": 2}, "a": [2, 1]}),
            editable.canonical_bytes({"a": [2, 1], "z": {"a": 2, "b": 1}}),
        )
        self.assertNotEqual(editable.canonical_bytes([1, 2]), editable.canonical_bytes([2, 1]))
        with self.assertRaises(ValueError):
            editable.canonical_bytes({"bad": float("nan")})

    def test_maximum_raster_roundtrip_and_batch_work_limit(self):
        candidate = self.art.create("big", "Big", "sprite", 256, 256, self.revision())
        candidate = self.art.edit(candidate, [{"x": 255, "y": 255, "rgba": [255, 254, 253, 0]}])
        acknowledgment = self.art.save(candidate)
        self.assertEqual(self.reopen(candidate, acknowledgment)["rgba"], candidate["rgba"])

    def test_reads_require_explicit_saved_project_revision(self):
        with self.assertRaisesRegex(ValueError, "project revision"):
            self.art.list(None)
        with self.assertRaisesRegex(ValueError, "project revision"):
            self.art.create("new", "New", "tile", 8, 8, None)
