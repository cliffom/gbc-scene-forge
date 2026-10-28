"""Definition inheritance, invalidation, portable exports and transaction boundaries."""

import copy
import io
import json
import tempfile
import threading
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from atlas_fixture import sprite_bundle

from gbc_scene_forge import object_definitions as definitions
from gbc_scene_forge import tiled
from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.projects import MANIFEST, Project
from gbc_scene_forge.standalone import make_handler


class DefinitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.project = Project.create(self.folder / "world", "Definitions")
        self.loaded = self.project.create_scene("Room", 8, 8, 8, self.revision())
        self.path = self.project.root / f"scenes/{self.loaded['id']}.tmj"
        self.definition = self.store(
            {
                "name": "Entrance",
                "kind": "point",
                "fields": [
                    {
                        "name": "facing",
                        "type": "string",
                        "required": True,
                        "default": "south",
                        "choices": ["north", "south"],
                    },
                    {"name": "speed", "type": "float", "required": False, "default": 1.5, "min": 0},
                    {"name": "enabled", "type": "bool", "required": True, "default": False},
                    {"name": "priority", "type": "int", "required": True, "min": 0, "max": 10},
                ],
            }
        )
        self.item = {
            "id": 2,
            "kind": "point",
            "x": 8,
            "y": 8,
            "definition": self.definition["id"],
            "class": "Entrance",
            "properties": [{"name": "priority", "type": "int", "value": 2}],
        }
        self.scene = {
            "width": 8,
            "height": 8,
            "grid": 8,
            "next_object_id": 3,
            "next_layer_id": 5,
            "layers": [
                {
                    "id": 4,
                    "type": "objectgroup",
                    "name": "Markers",
                    "visible": False,
                    "objects": [self.item],
                }
            ],
        }

    def revision(self):
        return self.project.catalog()["revision"]

    def store(self, value):
        result = self.project.save_object_definition(value, self.revision())
        return next(
            d
            for d in result["project"]["object_definitions"]["definitions"]
            if d["id"] == result["definition_id"]
        )

    def save(self):
        self.loaded = self.project.save_scene(
            self.loaded["id"], self.scene, self.loaded["revision"], self.revision()
        )
        return self.loaded

    def test_inheritance_changes_do_not_rewrite_maps_or_overrides(self):
        self.save()
        original = self.path.read_bytes()
        encoded = json.loads(original)["layers"][0]["objects"][0]
        values = {p["name"]: p["value"] for p in encoded["properties"]}
        self.assertEqual(values["enabled"], False)
        self.assertEqual(values["facing"], "south")
        self.assertEqual(json.loads(values["forge:overrides"]), ["priority"])
        self.assertEqual(self.loaded["scene"], self.scene)
        changed = copy.deepcopy(self.definition)
        changed["fields"][0]["default"] = "north"
        changed["fields"][3]["default"] = 9
        self.store(changed)
        self.assertEqual(self.path.read_bytes(), original)
        reopened = Project(self.project.root).load_scene(self.loaded["id"])
        self.assertEqual(reopened["scene"], self.scene)
        effective, findings = definitions.resolve(self.item, [changed])
        self.assertFalse(findings)
        values = {p["name"]: p["value"] for p in effective}
        self.assertEqual(values["priority"], 2)
        self.assertEqual(values["facing"], "north")
        # Resetting an override opts back into inheritance.
        self.item["properties"] = []
        self.save()
        effective, _ = definitions.resolve(self.item, [changed])
        self.assertEqual(next(p["value"] for p in effective if p["name"] == "priority"), 9)

        # An explicit value equal to today's default must not become inheritance.
        self.item["properties"] = [{"name": "facing", "type": "string", "value": "north"}]
        self.save()
        changed["fields"][0]["default"] = "south"
        self.store(changed)
        reloaded = self.project.load_scene(self.loaded["id"])["scene"]["layers"][0]["objects"][0]
        effective, _ = definitions.resolve(reloaded, [changed])
        self.assertEqual(next(p["value"] for p in effective if p["name"] == "facing"), "north")

    def test_invalidation_is_deterministic_navigable_and_non_destructive(self):
        self.save()
        changed = copy.deepcopy(self.definition)
        changed["kind"] = "rectangle"
        changed.update(width=8, height=8)
        changed["fields"][3]["type"] = "string"
        changed["fields"][3].pop("min")
        changed["fields"][3].pop("max")
        changed["fields"].append({"name": "destination", "type": "string", "required": True})
        self.store(changed)
        before = self.path.read_bytes()
        report = self.project.object_report(
            self.loaded["id"], self.revision(), self.loaded["revision"]
        )
        self.assertEqual(
            [(f["field"], f["code"]) for f in report["findings"]],
            [("", "kind"), ("priority", "type"), ("destination", "required")],
        )
        for finding in report["findings"]:
            self.assertEqual(
                (finding["scene"], finding["layer"], finding["object"]), (self.loaded["id"], 4, 2)
            )
        self.assertEqual(
            report,
            self.project.object_report(self.loaded["id"], self.revision(), self.loaded["revision"]),
        )
        self.assertEqual(self.path.read_bytes(), before)
        self.save()  # Invalid instances remain saveable and repairable.
        self.assertEqual(self.loaded["scene"], self.scene)
        self.project.delete_object_definition(changed["id"], self.revision())
        self.assertEqual(self.project.load_scene(self.loaded["id"])["scene"], self.scene)
        self.assertEqual(
            self.project.object_report(self.loaded["id"], self.revision(), self.loaded["revision"])[
                "findings"
            ][0]["code"],
            "missing-definition",
        )

    def test_field_constraints_and_unknown_overrides(self):
        item = copy.deepcopy(self.item)
        item["properties"] = [
            {"name": "priority", "type": "int", "value": 11},
            {"name": "facing", "type": "string", "value": ""},
            {"name": "retired", "type": "string", "value": "keep"},
        ]
        effective, findings = definitions.resolve(item, [self.definition])
        self.assertEqual(
            [f["code"] for f in findings], ["required", "choices", "max", "unknown-field"]
        )
        self.assertEqual(next(p for p in effective if p["name"] == "retired")["value"], "keep")
        for key, value in [("default", 1.1), ("default", True), ("min", False), ("max", -1)]:
            candidate = copy.deepcopy(self.definition)
            candidate["fields"][3][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.store(candidate)
        variants = [
            {"type": "str"},
            {"name": "forge:reserved"},
            {"required": 1},
            {"choices": [1]},
            {"choices": ["a", "a"]},
            {"min": 1},
            {"default": "east"},
        ]
        for update in variants:
            candidate = copy.deepcopy(self.definition)
            candidate["fields"][0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.store(candidate)

    def test_exports_refresh_defaults_and_preserve_identity_and_library(self):
        self.save()
        original = self.path.read_bytes()
        changed = copy.deepcopy(self.definition)
        changed["fields"][0]["default"] = "north"
        self.store(changed)
        for scope in ("scene", "project"):
            payload, _ = self.project.export_bundle(
                scope, self.revision(), self.loaded["id"] if scope == "scene" else None
            )
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                library = json.loads(archive.read("object-definitions.json"))
                self.assertEqual(library["definitions"][0], changed)
                encoded = json.loads(archive.read(f"scenes/{self.loaded['id']}.tmj"))
                props = encoded["layers"][0]["objects"][0]["properties"]
                self.assertEqual(next(p["value"] for p in props if p["name"] == "facing"), "north")
                self.assertEqual(tiled.decode(encoded, self.project.read()[0]), self.scene)
                if scope == "project":
                    archive.extractall(self.folder / "moved")
                    moved = Project(self.folder / "moved")
                    self.assertEqual(moved.load_scene(self.loaded["id"])["scene"], self.scene)
        self.assertEqual(self.path.read_bytes(), original)
        result = self.project.duplicate_scene(
            self.loaded["id"], "Copy", self.loaded["revision"], self.revision()
        )
        copied = self.project.load_scene(result["duplicated"])
        self.assertEqual(copied["scene"], self.scene)

    def test_sprite_rectangle_definitions_and_atlas_dependency(self):
        path, _ = sprite_bundle(self.folder / "art")
        self.project.import_atlas(path, self.revision())
        self.loaded = self.project.load_scene(self.loaded["id"])
        sprite = self.store(
            {"name": "Guard", "kind": "sprite", "asset": "actors/idle", "fields": []}
        )
        rectangle = self.store(
            {"name": "Area", "kind": "rectangle", "width": 8, "height": 8, "fields": []}
        )
        self.scene["layers"][0]["objects"] += [
            {
                "id": 3,
                "x": 24,
                "y": 24,
                "asset": "actors/idle",
                "origin": [4, 16],
                "definition": sprite["id"],
            },
            {
                "id": 4,
                "x": 32,
                "y": 32,
                "kind": "rectangle",
                "width": 8,
                "height": 8,
                "definition": rectangle["id"],
            },
        ]
        self.scene["next_object_id"] = 5
        self.save()
        self.assertEqual(self.loaded["scene"], self.scene)
        with self.assertRaisesRegex(ValueError, "definition Guard"):
            self.project.delete_atlas("actors", self.revision())
        # A definition alone also protects artwork, without a scene instance.
        self.scene["layers"][0]["objects"] = [self.item]
        self.save()
        with self.assertRaisesRegex(ValueError, "definition Guard"):
            self.project.delete_atlas("actors", self.revision())
        self.project.delete_object_definition(sprite["id"], self.revision())
        self.project.delete_atlas("actors", self.revision())

    def test_revision_conflicts_and_interrupted_library_write(self):
        old = self.revision()
        self.store({**self.definition, "name": "Renamed"})
        with self.assertRaises(Conflict):
            self.project.save_object_definition(self.definition, old)
        with self.assertRaises(Conflict):
            self.project.delete_object_definition(self.definition["id"], old)
        self.save()
        with self.assertRaises(Conflict):
            self.project.object_report(self.loaded["id"], self.revision(), "stale")
        original = (self.project.root / MANIFEST).read_bytes()
        # Simulate an interruption after replacement: recovery rolls the transaction back.
        from gbc_scene_forge import transactions

        replace = transactions.atomic_write

        def interrupted(path, data):
            replace(path, data)
            if path == self.project.root / MANIFEST:
                raise KeyboardInterrupt()

        with (
            patch.object(transactions, "atomic_write", side_effect=interrupted),
            patch.object(transactions.Transactions, "_restore", side_effect=KeyboardInterrupt()),
            self.assertRaises(KeyboardInterrupt),
        ):
            self.store({**self.definition, "name": "Interrupted"})
        Project(self.project.root)
        self.assertEqual((self.project.root / MANIFEST).read_bytes(), original)

    def test_strict_metadata_rejects_corruption(self):
        self.save()
        encoded = json.loads(self.path.read_bytes())
        for value in ["null", '["priority", "priority"]', '["missing"]']:
            candidate = copy.deepcopy(encoded)
            next(
                p
                for p in candidate["layers"][0]["objects"][0]["properties"]
                if p["name"] == "forge:overrides"
            )["value"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                tiled.decode(candidate, self.project.read()[0])
        for invalid in [{"version": 2, "definitions": []}, {"version": True, "definitions": []}]:
            with self.assertRaises(ValueError):
                definitions.check_library(invalid, {})
        with self.assertRaises(ValueError):
            self.store({**self.definition, "id": str(uuid4())})

    def test_maximum_inherited_and_override_sets_round_trip(self):
        definition = self.store(
            {
                "name": "Many fields",
                "kind": "point",
                "fields": [
                    {"name": f"default-{n:03}", "type": "int", "required": False, "default": n}
                    for n in range(128)
                ],
            }
        )
        self.item["definition"] = definition["id"]
        self.item["properties"] = [
            {"name": f"extra-{n:03}", "type": "string", "value": "keep"} for n in range(128)
        ]
        self.save()
        self.assertEqual(
            Project(self.project.root).load_scene(self.loaded["id"])["scene"], self.scene
        )
        self.assertEqual(len(definitions.resolve(self.item, [definition])[0]), 256)

    def test_external_edits_to_inherited_properties_are_not_discarded(self):
        self.save()
        encoded = json.loads(self.path.read_bytes())
        properties = encoded["layers"][0]["objects"][0]["properties"]
        inherited = next(p for p in properties if p["name"] == "facing")
        inherited["value"] = "north"
        with self.assertRaisesRegex(ValueError, "refusing to discard data"):
            tiled.decode(encoded, self.project.read()[0])
        # An explicit promotion preserves the externally authored override.
        names = next(p for p in properties if p["name"] == "forge:overrides")
        names["value"] = json.dumps(["priority", "facing"])
        snapshot = next(p for p in properties if p["name"] == "forge:inherited")
        snapshot["value"] = json.dumps(
            [p for p in json.loads(snapshot["value"]) if p["name"] != "facing"]
        )
        decoded = tiled.decode(encoded, self.project.read()[0])
        self.assertIn(inherited, decoded["layers"][0]["objects"][0]["properties"])

    def test_report_detects_changes_during_analysis_and_checks_unsaved_canvas(self):
        self.save()
        unsaved = copy.deepcopy(self.scene)
        unsaved["layers"][0]["objects"][0]["properties"] = []
        original = self.path.read_bytes()
        result = self.project.object_report(
            self.loaded["id"], self.revision(), self.loaded["revision"], unsaved
        )
        self.assertEqual(result["findings"][0]["code"], "required")
        self.assertEqual(self.path.read_bytes(), original)
        analyze = definitions.report

        def external_edit(*args):
            self.path.write_bytes(original + b"\n")
            return analyze(*args)

        with (
            patch.object(definitions, "report", side_effect=external_edit),
            self.assertRaises(Conflict),
        ):
            self.project.object_report(self.loaded["id"], self.revision(), self.loaded["revision"])

    def test_http_mutation_token_and_report_conflicts(self):
        self.save()
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.project.root, "secret"))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        def request(route, payload, token="secret"):
            return urlopen(
                Request(
                    f"http://127.0.0.1:{server.server_port}/api/{route}",
                    json.dumps(payload).encode(),
                    {"Content-Type": "application/json", "X-Scene-Token": token},
                )
            )

        with self.assertRaises(HTTPError) as error:
            request(
                "save-object-definition",
                {"definition": self.definition, "project_revision": self.revision()},
                "wrong",
            )
        self.assertEqual(error.exception.code, 403)
        with request(
            "object-report",
            {
                "scene_id": self.loaded["id"],
                "project_revision": self.revision(),
                "scene_revision": self.loaded["revision"],
            },
        ) as response:
            self.assertEqual(json.load(response)["status"], "pass")
        with self.assertRaises(HTTPError) as error:
            request(
                "object-report",
                {
                    "scene_id": self.loaded["id"],
                    "project_revision": "stale",
                    "scene_revision": self.loaded["revision"],
                },
            )
        self.assertEqual(error.exception.code, 409)
