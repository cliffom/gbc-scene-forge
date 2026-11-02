"""Forge ZIP transfers preserve authored scenes without touching destination content."""

import base64
import io
import json
import stat
import unittest
import zipfile
from unittest.mock import patch

from support.atlas_fixture import bundle, image

from backend.project import test_exporting as fixture
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.formats import exporting, transfer
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.storage.files import digest


class TransferTests(unittest.TestCase):
    revision = fixture.ExportTests.revision
    export = fixture.ExportTests.export
    files = fixture.ExportTests.files
    source_files = fixture.ExportTests.source_files

    def setUp(self):
        fixture.ExportTests.setUp(self)
        self.destination = Project.create(self.folder / "destination", "Destination")
        self.existing = self.destination.scenes.create("Room", 2, 2, 8, self.dest_revision())

    def dest_revision(self):
        return self.destination.catalog()["revision"]

    def payload(self, scope="project"):
        return base64.b64encode(self.export(scope)[0]).decode()

    def check(self, payload=None, selection=None, **kwargs):
        return self.destination.imports.forge(
            payload or self.payload(), self.dest_revision(), selection=selection, **kwargs
        )

    def snapshot(self):
        return {
            str(p.relative_to(self.destination.root)): p.read_bytes()
            for p in self.destination.root.rglob("*")
            if p.is_file()
        }

    def import_checked(self, payload, selection):
        report = self.check(payload, selection)
        self.assertTrue(report["compatible"], report)
        result = self.check(payload, selection, dry_run=False, confirmation=report["confirmation"])
        return result

    def legacy_mixed_source(self):
        source = Project.create(self.folder / "legacy", "Legacy")
        path, manifest = bundle(self.folder / "mixed", "mixed")
        manifest["cell_palettes"] = [0] * 4
        manifest["regions"] = [
            {"name": "earth", "kind": "tile", "x": 0, "y": 0, "width": 8, "height": 16},
            {"name": "idle", "kind": "sprite", "x": 8, "y": 0, "width": 8, "height": 16},
        ]
        manifest["animations"] = []
        path.write_text(json_text(manifest))
        (path.parent / "atlas.png").write_bytes(image(16, 16, rgb=(255, 255, 255)))
        source.artwork.import_atlas(path, source.catalog()["revision"])
        loaded = source.scenes.create("Legacy scene", 2, 2, 8, source.catalog()["revision"])
        loaded["scene"]["cells"][0][0] = "mixed/earth/0/0"
        source.scenes.save(
            loaded["id"], loaded["scene"], loaded["revision"], source.catalog()["revision"]
        )
        # Supported native projects predating sprite placement have neither
        # sprite mappings nor generated sprite files or map references.
        document, _ = source.read()
        document["atlases"]["mixed"]["tiles"].pop("sprites")
        for asset_path in list(document["files"]):
            if asset_path.startswith("assets/mixed/sprites"):
                (source.root / asset_path).unlink()
                del document["files"][asset_path]
        map_path = source.root / document["scenes"][0]["path"]
        encoded = json.loads(map_path.read_bytes())
        encoded["tilesets"] = [
            ref for ref in encoded["tilesets"] if not ref["source"].endswith("/sprites.tsj")
        ]
        map_path.write_text(json_text(encoded))
        (source.root / "forge.project.json").write_text(json_text(document))
        return source, source.scenes.load(loaded["id"])

    def test_legacy_mixed_atlas_materializes_sprites_without_changing_source(self):
        from gbc_scene_forge.artwork import png

        source, loaded = self.legacy_mixed_source()
        before = {p: p.read_bytes() for p in source.root.rglob("*") if p.is_file()}
        for scope in ("project", "scene"):
            with self.subTest(scope=scope):
                raw, _ = source.export_bundle(
                    scope,
                    source.catalog()["revision"],
                    **({"scene_id": loaded["id"]} if scope == "scene" else {}),
                )
                payload = base64.b64encode(raw).decode()
                selection = {loaded["id"]: "Legacy " + scope}
                destination_before = self.snapshot()
                self.assertTrue(self.check(payload, selection)["compatible"])
                self.assertEqual(self.snapshot(), destination_before)
                result = self.import_checked(payload, selection)
                target = result["assets"][0]["destination"]
                entry = self.destination.read()[0]["atlases"][target]
                self.assertEqual(entry["tiles"]["sprites"], {target + "/idle": 0})
                self.assertTrue((self.destination.root / f"assets/{target}/sprites.tsj").is_file())
                sprite = self.destination.root / f"assets/{target}/sprites/0.png"
                self.assertEqual(
                    png.decode(sprite.read_bytes()), (8, 16, bytes([255]) * 8 * 16 * 4)
                )
                reopened = Project(self.destination.root)
                self.assertEqual(
                    reopened.scenes.load(result["imported"][0])["scene"],
                    transfer.remap_scene(loaded["scene"], {"mixed": target}, {}),
                )
                reopened.export_bundle("project", self.dest_revision())
        self.assertEqual({p: p.read_bytes() for p in source.root.rglob("*") if p.is_file()}, before)

    def test_legacy_sprite_omission_cannot_hide_declared_missing_dependencies(self):
        source, loaded = self.legacy_mixed_source()
        raw, _ = source.export_bundle("project", source.catalog()["revision"])
        before = self.snapshot()
        for declaration in ("inventory", "mapping", "map"):
            with self.subTest(declaration=declaration):
                files = self.files(raw)
                document = json.loads(files["forge.project.json"])
                path = "assets/mixed/sprites.tsj"
                if declaration == "inventory":
                    document["files"][path] = digest(b"missing")
                elif declaration == "mapping":
                    document["atlases"]["mixed"]["tiles"]["sprites"] = {"mixed/idle": 0}
                else:
                    map_path = document["scenes"][0]["path"]
                    encoded = json.loads(files[map_path])
                    encoded["tilesets"].append(
                        {"firstgid": 3, "source": "../assets/mixed/sprites.tsj"}
                    )
                    files[map_path] = json_text(encoded).encode()
                files["forge.project.json"] = json_text(document).encode()
                report = json.loads(files["export.json"])
                report["files"] = {
                    p: digest(data) for p, data in files.items() if p != "export.json"
                }
                files["export.json"] = json_text(report).encode()
                payload = base64.b64encode(exporting.archive(files)).decode()
                report = self.check(payload, {loaded["id"]: "Invalid legacy"})
                self.assertFalse(report["compatible"])
                self.assertIn(path, "; ".join(report["errors"]))
                with self.assertRaises(ValueError):
                    self.check(payload, {loaded["id"]: "Invalid legacy"}, dry_run=False)
                self.assertEqual(self.snapshot(), before)

    def test_preflight_names_selection_and_existing_scene_unchanged(self):
        before = self.snapshot()
        report = self.check()
        self.assertFalse(report["compatible"])
        self.assertEqual(len(report["scenes"]), 2)
        self.assertIn("Existing scene: Room", report["scenes"][0]["conflicts"][0])
        self.assertEqual(self.snapshot(), before)
        selection = {self.loaded["id"]: "Transferred room"}
        report = self.check(selection=selection)
        self.assertTrue(report["compatible"], report)
        self.assertEqual(
            [s["name"] for s in report["scenes"] if s["selected"]], ["Transferred room"]
        )
        self.assertEqual(report["scenes"][0]["assets"], ["actors", "terrain"])
        self.assertEqual(self.snapshot(), before)
        result = self.import_checked(self.payload(), selection)
        self.assertEqual(len(result["imported"]), 1)
        self.assertEqual(self.destination.scenes.load(self.existing["id"]), self.existing)
        self.assertEqual(len(self.destination.catalog()["project"]["scenes"]), 2)
        for path, data in before.items():
            if path != "forge.project.json":
                self.assertEqual((self.destination.root / path).read_bytes(), data)

    def test_duplicate_incoming_names_and_skip_resolution(self):
        document, revision = self.project.read()
        document["scenes"][1]["name"] = "Room"
        self.project.store.commit(document, revision, {}, {}, "Duplicate names fixture")
        report = self.check(selection={self.loaded["id"]: "New", self.other["id"]: "New"})
        self.assertFalse(report["compatible"])
        self.assertTrue(all("Duplicate incoming" in r["conflicts"][0] for r in report["scenes"]))
        result = self.import_checked(self.payload(), {self.other["id"]: "New"})
        self.assertEqual(len(result["imported"]), 1)
        self.assertEqual([a["source"] for a in result["assets"]], ["actors"])  # Unpainted catalog.

    def test_roundtrip_scene_and_project_layers_transforms_metadata_shared_assets(self):
        metadata = self.project.read()[0]["atlases"]["terrain"]["metadata"]["8"][
            "terrain/earth/0/0"
        ]
        self.project.artwork.set_metadata(
            "terrain", "8", "terrain/earth/0/0", {**metadata, "terrain_mask": 15}, self.revision()
        )
        self.scene["layers"][0]["cells"][1][1] += "#7"
        self.loaded = self.project.scenes.save(
            self.loaded["id"], self.scene, self.loaded["revision"], self.revision()
        )
        for scope in ("scene", "project"):
            with self.subTest(scope=scope):
                payload = self.payload(scope)
                result = self.import_checked(payload, {self.loaded["id"]: "Imported " + scope})
                loaded = self.destination.scenes.load(result["imported"][0])
                mapping = {a["source"]: a["destination"] for a in result["assets"]}
                self.assertEqual(loaded["scene"], transfer.remap_scene(self.scene, mapping, {}))
                document = self.destination.catalog()["project"]
                source_meta = self.project.catalog()["project"]["atlases"]["terrain"]["metadata"]
                target_meta = document["atlases"][mapping["terrain"]]["metadata"]
                self.assertEqual(
                    source_meta["8"]["terrain/earth/0/0"],
                    target_meta["8"][mapping["terrain"] + "/earth/0/0"],
                )
                reopened = Project(self.destination.root)
                self.assertEqual(reopened.scenes.load(loaded["id"]), loaded)
                raw, _ = reopened.export_bundle("project", self.dest_revision())
                self.assertIn("forge.project.json", self.files(raw))

    def test_scene_asset_and_definition_collisions_are_remapped_once(self):
        definition = {
            "id": self.loaded["id"],
            "name": "NPC",
            "kind": "sprite",
            "asset": "actors/idle",
            "fields": [{"name": "health", "type": "int", "required": True, "default": 3}],
        }
        document, revision = self.project.read()
        document["object_definitions"] = {"version": 1, "definitions": [definition]}
        self.project.store.commit(document, revision, {}, {}, "Definitions fixture")
        self.scene["layers"][1]["objects"][0]["definition"] = definition["id"]
        self.loaded = self.project.scenes.save(
            self.loaded["id"], self.scene, self.loaded["revision"], self.revision()
        )
        # Importing into its source exercises every identity collision at once.
        self.destination = self.project
        before_scenes = [
            self.project.scenes.load(s["id"]) for s in self.project.read()[0]["scenes"]
        ]
        payload = self.payload()
        selection = {self.loaded["id"]: "Copy one", self.other["id"]: "Copy two"}
        result = self.import_checked(payload, selection)
        self.assertEqual(len(result["assets"]), 2)
        self.assertEqual(len(result["definitions"]), 1)
        copied = self.project.scenes.load(result["imported"][0])["scene"]
        obj = copied["layers"][1]["objects"][0]
        self.assertNotEqual(obj["definition"], definition["id"])
        self.assertEqual(obj["definition"], result["definitions"][0]["destination"])
        self.assertNotEqual(obj["asset"], "actors/idle")
        for scene in before_scenes:
            self.assertEqual(self.project.scenes.load(scene["id"]), scene)

    def mutate_zip(self, edit):
        files = self.files(self.export()[0])
        edit(files)
        report = json.loads(files["export.json"])
        report["files"] = {p: digest(data) for p, data in files.items() if p != "export.json"}
        files["export.json"] = json_text(report).encode()
        return base64.b64encode(exporting.archive(files)).decode()

    def test_invalid_missing_unsafe_and_unsupported_dependencies_leave_no_writes(self):
        before = self.snapshot()
        edits = [
            lambda files: files.pop("assets/terrain/grid-8/0.png"),
            lambda files: files.update({"../outside": b"bad"}),
            lambda files: files.update({"assets/terrain/grid-8.tsj": b"{}"}),
            lambda files: files.update({f"scenes/{self.loaded['id']}.tmj": b"{}"}),
        ]
        for edit in edits:
            with self.subTest(edit=edit):
                payload = self.mutate_zip(edit)
                report = self.check(payload, {self.loaded["id"]: "Copy"})
                self.assertFalse(report["compatible"])
                with self.assertRaises(ValueError):
                    self.check(payload, {self.loaded["id"]: "Copy"}, dry_run=False)
                self.assertEqual(self.snapshot(), before)

    def test_stale_confirmation_project_assets_and_failed_transaction(self):
        payload, selection = self.payload(), {self.loaded["id"]: "Copy"}
        report = self.check(payload, selection)
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.check(
                payload,
                {self.loaded["id"]: "Changed"},
                dry_run=False,
                confirmation=report["confirmation"],
            )
        with patch.object(self.destination.transactions, "apply", side_effect=ValueError("failed")):
            with self.assertRaises(Conflict):
                self.check(payload, selection, dry_run=False, confirmation=report["confirmation"])
        self.assertEqual(self.snapshot(), before)
        revision = self.dest_revision()
        self.destination.scenes.create("Concurrent", 2, 2, 8, revision)
        with self.assertRaises(Conflict):
            self.destination.imports.forge(
                payload,
                revision,
                selection=selection,
                dry_run=False,
                confirmation=report["confirmation"],
            )

    def test_archive_limits_duplicates_symlinks_and_old_scene_export(self):
        payload = self.payload("scene")
        before = self.snapshot()
        with patch.object(transfer, "MAX_ZIP", 1):
            self.assertFalse(self.check(payload)["compatible"])
        with patch.object(transfer, "MAX_EXPANDED", 1):
            self.assertFalse(self.check(payload)["compatible"])
        for symlink in (False, True):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                info = zipfile.ZipInfo("link")
                info.external_attr = (stat.S_IFLNK | 0o777) << 16 if symlink else 0
                archive.writestr(info, b"outside")
                if not symlink:
                    with self.assertWarns(UserWarning):
                        archive.writestr("link", b"duplicate")
            self.assertFalse(self.check(base64.b64encode(stream.getvalue()).decode())["compatible"])
        payload = self.mutate_zip(lambda files: files.pop("forge-transfer.json"))
        self.assertIn("older scene export", self.check(payload)["errors"][0])
        self.assertEqual(self.snapshot(), before)

    def test_world_and_settings_are_reported_and_not_copied(self):
        document, revision = self.project.read()
        document["world"] = {
            "version": 1,
            "positions": {self.loaded["id"]: {"x": 2, "y": 3}},
            "connections": [],
        }
        document["preview"] = {"speed": 1.5}
        self.project.store.commit(document, revision, {}, {}, "Settings fixture")
        before = self.destination.read()[0]
        report = self.import_checked(self.payload(), {self.loaded["id"]: "Copy"})
        self.assertTrue(
            any("World positions and connections are omitted" in n for n in report["notes"])
        )
        after = self.destination.read()[0]
        self.assertEqual(before.get("world"), after.get("world"))
        self.assertEqual(before["preview"], after["preview"])

    def test_generic_sheet_transfer_retains_slicing_and_unpainted_catalog(self):
        from backend.artwork.test_intake import sheet

        self.project.artwork.import_tilesheet(sheet(id="plain"), self.revision())
        generic = self.project.scenes.create("Generic source", 2, 2, 8, self.revision())
        payload = self.payload()
        report = self.import_checked(payload, {generic["id"]: "Generic catalog"})
        mapping = {a["source"]: a["destination"] for a in report["assets"]}
        self.assertIn("plain", mapping)
        entry = self.destination.read()[0]["atlases"][mapping["plain"]]
        self.assertEqual(entry["manifest"]["slicing"], {"grid": 8, "margin": 1, "spacing": 1})
        self.assertEqual(len(entry["manifest"]["regions"]), 2)
        # No unrelated scenes or unreferenced definitions were copied.
        self.assertEqual(len(self.destination.read()[0]["scenes"]), 2)

    def test_missing_definition_and_manifest_scene_mismatch_disable_import(self):
        self.scene["layers"][1]["objects"][0]["definition"] = self.loaded["id"]
        self.loaded = self.project.scenes.save(
            self.loaded["id"], self.scene, self.loaded["revision"], self.revision()
        )
        report = self.check(selection={self.loaded["id"]: "Missing definition"})
        self.assertFalse(report["compatible"])
        self.assertEqual(len(report["scenes"]), 2)
        self.assertIn("Missing object definition", report["scenes"][0]["errors"][0])
        # The invalid scene can be skipped without importing it.
        self.assertTrue(self.check(selection={self.other["id"]: "Other copy"})["compatible"])
        payload = self.mutate_zip(lambda files: files.update({"export.json": b"{}"}))
        self.assertFalse(self.check(payload)["compatible"])

    def test_invalid_animation_and_changed_tile_pixels_are_reported(self):
        from gbc_scene_forge.artwork import png

        for change in ("animation", "image"):

            def edit(files):
                manifest = json.loads(files["forge-transfer.json"])
                if change == "animation":
                    path = "assets/terrain/grid-8.tsj"
                    ts = json.loads(files[path])
                    ts["tiles"][0]["animation"][0]["duration"] = 999
                    files[path] = json_text(ts).encode()
                else:
                    path = "assets/terrain/grid-8/0.png"
                    w, h, pixels = png.decode(files[path])
                    changed = bytearray(pixels)
                    changed[0] ^= 255
                    files[path] = png.encode(w, h, changed)
                manifest["files"][path] = digest(files[path])
                files["forge-transfer.json"] = json_text(manifest).encode()

            report = self.check(self.mutate_zip(edit), {self.loaded["id"]: "Invalid copy"})
            self.assertFalse(report["compatible"])
            self.assertEqual(len(report["scenes"]), 1)
            self.assertIn("differs from", report["scenes"][0]["errors"][0])

    def test_failed_write_rolls_back_scene_assets_and_manifest(self):
        from gbc_scene_forge.storage import transactions

        payload, selection = self.payload(), {self.loaded["id"]: "Copy"}
        report = self.check(payload, selection)
        before = {p: data for p, data in self.snapshot().items() if not p.startswith(".forge/")}
        original_write = transactions.atomic_write
        scene_path = self.destination.root / f"scenes/{report['scenes'][0]['destination_id']}.tmj"
        failed = False

        def fail_scene_once(path, data):
            nonlocal failed
            if path == scene_path and not failed:
                failed = True
                raise OSError("Simulated disk failure")
            return original_write(path, data)

        with patch.object(transactions, "atomic_write", fail_scene_once):
            with self.assertRaisesRegex(OSError, "Simulated disk failure"):
                self.check(payload, selection, dry_run=False, confirmation=report["confirmation"])
        self.assertTrue(failed)
        after = {p: data for p, data in self.snapshot().items() if not p.startswith(".forge/")}
        self.assertEqual(after, before)
        self.assertEqual(
            Project(self.destination.root).scenes.load(self.existing["id"]), self.existing
        )

    def test_http_route_and_output_limit_keep_reviewable_scene_list(self):
        from gbc_scene_forge.adapters.http.routes import ProjectAPI
        from gbc_scene_forge.project.store import ProjectStore

        payload, selection = self.payload(), {self.loaded["id"]: "Copy"}
        api = ProjectAPI(self.destination.root, self.destination)
        response = api.post(
            "/api/import-forge",
            {"zip": payload, "selection": selection, "project_revision": self.dest_revision()},
        )
        self.assertTrue(response.body["compatible"])
        self.assertTrue(response.body["dry_run"])
        original = ProjectStore.prepare_commit

        def fail_preparation(store, document, changes):
            original(store, document, changes)
            raise ValueError("Project manifest exceeds 8 MiB")

        before = self.snapshot()
        with patch.object(ProjectStore, "prepare_commit", fail_preparation):
            report = self.check(payload, selection)
        self.assertFalse(report["compatible"])
        self.assertEqual(len(report["scenes"]), 2)
        self.assertIn("exceeds 8 MiB", report["errors"][0])
        self.assertEqual(self.snapshot(), before)

    def test_all_existing_same_name_scene_conflicts_are_listed(self):
        other = self.destination.scenes.create("room", 2, 2, 8, self.dest_revision())
        report = self.check(selection={self.loaded["id"]: " ROOM "})
        self.assertFalse(report["compatible"])
        conflicts = report["scenes"][0]["conflicts"]
        self.assertEqual(len(conflicts), 2)
        self.assertIn(self.existing["id"], conflicts[0])
        self.assertIn(other["id"], conflicts[1])

    def test_missing_revision_and_malformed_sprite_metadata_cannot_bypass_validation(self):
        with self.assertRaisesRegex(ValueError, "current revision"):
            self.destination.imports.forge(self.payload(), None)

        def edit(files):
            source = json.loads(files["forge-transfer.json"])
            entry = source["atlases"]["actors"]
            local = entry["tiles"]["sprites"].pop("actors/idle")
            entry["tiles"]["sprites"]["actors/missing"] = local
            entry["metadata"] = {
                "sprites": {
                    "actors/missing": {
                        "terrain": "",
                        "solid": False,
                        "shapes": [],
                        "next_shape_id": 1,
                    }
                }
            }
            files["forge-transfer.json"] = json_text(source).encode()

        before = self.snapshot()
        report = self.check(self.mutate_zip(edit), {self.loaded["id"]: "Invalid sprite"})
        self.assertFalse(report["compatible"])
        self.assertTrue(report["errors"][0])
        self.assertEqual(self.snapshot(), before)
