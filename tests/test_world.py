"""Portable world graphs, endpoint lifecycle, read-only reports and conflict guards."""

import copy
import io
import json
import shutil
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

from gbc_scene_forge import world
from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.projects import MANIFEST, Project
from gbc_scene_forge.standalone import make_handler


class WorldTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.project = Project.create(self.root, "Connected rooms")
        result = self.project.save_object_definition(
            {"name": "Entrance", "kind": "point", "fields": []}, self.revision()
        )
        self.definition = result["definition_id"]
        self.rooms = []
        for name in ("Forest", "Cave"):
            room = self.project.create_scene(name, 10, 8, 8, self.revision())
            scene = {
                "width": 10,
                "height": 8,
                "grid": 8,
                "next_object_id": 3,
                "next_layer_id": 3,
                "layers": [
                    {
                        "id": 2,
                        "type": "objectgroup",
                        "name": "Entrances",
                        "visible": name != "Cave",
                        "objects": [
                            {
                                "id": i,
                                "kind": "point",
                                "x": i * 8,
                                "y": 8,
                                "name": f"Door {i}",
                                "definition": self.definition,
                            }
                            for i in (1, 2)
                        ],
                    }
                ],
            }
            self.rooms.append(
                self.project.save_scene(room["id"], scene, room["revision"], self.revision())
            )
        self.link = {
            "id": str(uuid4()),
            "name": "Forest to cave",
            "direction": "one-way",
            "source": {"scene": self.rooms[0]["id"], "object": 1},
            "destination": {"scene": self.rooms[1]["id"], "object": 2},
        }
        self.value = {
            "version": 1,
            "positions": {
                self.rooms[0]["id"]: {"x": -200, "y": 40},
                self.rooms[1]["id"]: {"x": 160, "y": 80},
            },
            "connections": [self.link],
        }

    def revision(self):
        return self.project.catalog()["revision"]

    def report(self, **kwargs):
        return self.project.world_report(self.revision(), **kwargs)

    def save(self):
        return self.project.save_world(
            self.value, self.revision(), self.report()["scene_revisions"]
        )

    def files(self):
        return {
            str(p.relative_to(self.root)): p.read_bytes()
            for p in self.root.rglob("*")
            if p.is_file()
        }

    def test_old_projects_have_empty_world_without_migration(self):
        original = self.files()
        self.assertNotIn("world", self.project.catalog()["project"])
        report = self.report()
        self.assertEqual(report["status"], "pass")
        self.assertFalse(report["findings"])
        self.assertEqual(self.files(), original)
        self.assertFalse(report["scenes"][1]["objects"][0]["visible"])

    def test_save_reopen_move_and_deterministic_reports(self):
        self.save()
        original = self.files()
        self.assertEqual(self.report(), self.report())
        self.assertEqual(self.files(), original)
        self.assertEqual(self.report()["status"], "pass")
        moved = self.root.parent / "moved"
        shutil.copytree(self.root, moved)
        reopened = Project(moved)
        self.assertEqual(reopened.catalog()["project"]["world"], self.value)
        self.assertEqual(reopened.world_report(self.revision()), self.report())

    def test_rename_and_duplicate_preserve_original_connections(self):
        self.save()
        first = self.rooms[0]
        self.project.rename_scene(first["id"], "Woodland", first["revision"], self.revision())
        scene = copy.deepcopy(first["scene"])
        scene["layers"][0]["objects"][0]["name"] = "South gate"
        first = self.project.save_scene(first["id"], scene, first["revision"], self.revision())
        result = self.project.duplicate_scene(
            first["id"], "Woodland copy", first["revision"], self.revision()
        )
        value = result["project"]["world"]
        self.assertEqual(value, self.value)
        self.assertNotIn(result["duplicated"], value["positions"])
        self.assertEqual(self.report()["scenes"][0]["name"], "Woodland")
        self.assertEqual(self.report()["status"], "pass")
        self.assertNotEqual(result["duplicated"], first["id"])

    def test_one_and_two_way_and_same_scene_links(self):
        self.link["direction"] = "two-way"
        self.link["destination"]["scene"] = self.rooms[0]["id"]
        self.save()
        self.assertEqual(self.report()["status"], "pass")
        self.assertEqual(self.project.catalog()["project"]["world"], self.value)

    def test_object_deletion_requires_confirmation_and_can_be_repaired(self):
        self.save()
        first = self.rooms[0]
        scene = copy.deepcopy(first["scene"])
        scene["layers"][0]["objects"] = [scene["layers"][0]["objects"][1]]
        original = self.files()
        for confirm in (False, 1, "true"):
            with self.assertRaisesRegex(ValueError, "Confirm broken"):
                self.project.save_scene(
                    first["id"],
                    scene,
                    first["revision"],
                    self.revision(),
                    confirm_broken_links=confirm,
                )
            self.assertEqual(self.files(), original)
        saved = self.project.save_scene(
            first["id"], scene, first["revision"], self.revision(), confirm_broken_links=True
        )
        self.assertEqual([f["code"] for f in self.report()["findings"]], ["missing-object"])
        self.assertEqual(self.project.catalog()["project"]["world"], self.value)
        # Restoring the original object ID repairs the connection, as Undo + Save does.
        self.project.save_scene(first["id"], first["scene"], saved["revision"], self.revision())
        self.assertEqual(self.report()["status"], "pass")

    def test_scene_deletion_requires_confirmation_and_retains_repairable_links(self):
        self.save()
        second = self.rooms[1]
        original = self.files()
        with self.assertRaisesRegex(ValueError, "Confirm"):
            self.project.delete_scene(second["id"], second["revision"], self.revision())
        self.assertEqual(self.files(), original)
        self.project.delete_scene(
            second["id"], second["revision"], self.revision(), confirm_broken_links=True
        )
        result = self.project.catalog()["project"]["world"]
        self.assertNotIn(second["id"], result["positions"])
        self.assertEqual(result["connections"], [self.link])
        self.assertEqual([f["code"] for f in self.report()["findings"]], ["missing-scene"])
        self.value = result
        self.link = result["connections"][0]
        self.link["destination"] = {"scene": self.rooms[0]["id"], "object": 2}
        self.save()
        self.assertEqual(self.report()["status"], "pass")

    def test_missing_definition_and_schema_mismatch_are_located(self):
        self.save()
        self.project.delete_object_definition(self.definition, self.revision())
        report = self.report()
        self.assertEqual([f["code"] for f in report["findings"]], ["missing-definition"] * 2)
        self.assertEqual(report["findings"][1]["layer"], 2)
        self.assertEqual(report["findings"][1]["object"], 2)
        self.assertEqual(report["findings"][1]["endpoint"], "destination")

    def test_required_fields_and_missing_definition_attachment(self):
        self.save()
        self.project.save_object_definition(
            {
                "id": self.definition,
                "name": "Entrance",
                "kind": "rectangle",
                "width": 8,
                "height": 8,
                "fields": [{"name": "facing", "type": "string", "required": True}],
            },
            self.revision(),
        )
        findings = self.report()["findings"]
        self.assertEqual([f["code"] for f in findings], ["kind", "required"] * 2)
        self.assertEqual(findings[1]["field"], "facing")
        scene = copy.deepcopy(self.rooms[0]["scene"])
        del scene["layers"][0]["objects"][0]["definition"]
        report = self.report(
            scene_id=self.rooms[0]["id"], scene_revision=self.rooms[0]["revision"], scene=scene
        )
        self.assertEqual(report["findings"][0]["code"], "missing-definition")

    def test_canvas_report_is_read_only_and_uses_saved_revisions(self):
        self.save()
        scene = copy.deepcopy(self.rooms[1]["scene"])
        scene["layers"][0]["objects"] = []
        original = self.files()
        result = self.report(
            scene_id=self.rooms[1]["id"], scene_revision=self.rooms[1]["revision"], scene=scene
        )
        self.assertEqual(result["findings"][0]["code"], "missing-object")
        self.assertEqual(result["scene_revisions"][self.rooms[1]["id"]], self.rooms[1]["revision"])
        self.assertEqual(self.files(), original)
        self.assertEqual(self.report()["status"], "pass")
        with self.assertRaises(Conflict):
            self.report(scene_id=self.rooms[1]["id"], scene_revision="stale", scene=scene)

    def test_world_mutation_rejects_stale_manifest_and_external_scene_edits(self):
        revision = self.revision()
        guards = self.report()["scene_revisions"]
        self.save()
        original = self.files()
        with self.assertRaises(Conflict):
            self.project.save_world(self.value, revision, guards)
        self.assertEqual(self.files(), original)
        path = self.root / f"scenes/{self.rooms[1]['id']}.tmj"
        path.write_bytes(path.read_bytes() + b"\n")
        original = self.files()
        with self.assertRaises(Conflict):
            self.project.save_world(self.value, self.revision(), guards)
        self.assertEqual(self.files(), original)
        with self.assertRaises(ValueError):
            self.project.save_world(self.value, self.revision(), {})

    def test_world_commit_checks_scene_guards_at_transaction_boundary(self):
        guards = self.report()["scene_revisions"]
        before = (self.root / MANIFEST).read_bytes()
        commit = self.project._commit

        def edit_then_commit(*args):
            path = self.root / f"scenes/{self.rooms[0]['id']}.tmj"
            path.write_bytes(path.read_bytes() + b"\n")
            return commit(*args)

        with patch.object(self.project, "_commit", side_effect=edit_then_commit):
            with self.assertRaises(Conflict):
                self.project.save_world(self.value, self.revision(), guards)
        self.assertEqual((self.root / MANIFEST).read_bytes(), before)

    def test_noncooperating_edit_during_report_is_detected(self):
        original = world.report

        def edit(*args):
            result = original(*args)
            path = self.root / f"scenes/{self.rooms[0]['id']}.tmj"
            path.write_bytes(path.read_bytes() + b"\n")
            return result

        with patch("gbc_scene_forge.world.report", side_effect=edit):
            with self.assertRaises(Conflict):
                self.report()

    def test_exports_retain_world_and_stable_tiled_endpoint_ids(self):
        self.link["direction"] = "two-way"
        self.save()
        original = self.files()
        for scope in ("scene", "project"):
            args = (self.rooms[0]["id"],) if scope == "scene" else ()
            first, _ = self.project.export_bundle(scope, self.revision(), *args)
            second, _ = self.project.export_bundle(scope, self.revision(), *args)
            self.assertEqual(first, second)
            with zipfile.ZipFile(io.BytesIO(first)) as archive:
                self.assertEqual(json.loads(archive.read("world.json")), self.value)
                map_data = json.loads(archive.read(f"scenes/{self.rooms[0]['id']}.tmj"))
                self.assertEqual(map_data["layers"][0]["objects"][0]["id"], 1)
                if scope == "project":
                    target = self.root.parent / "export"
                    archive.extractall(target)
                    reopened = Project(target)
                    self.assertEqual(
                        reopened.world_report(reopened.catalog()["revision"])["status"], "pass"
                    )
        self.assertEqual(self.files(), original)

    def test_strict_format_and_bounds(self):
        mutations = [
            lambda v: v.update(version=True),
            lambda v: v.update(version=2),
            lambda v: v.update(extra=1),
            lambda v: v["positions"][self.rooms[0]["id"]].update(x=True),
            lambda v: v["positions"][self.rooms[0]["id"]].update(y=100001),
            lambda v: v["connections"].append(copy.deepcopy(v["connections"][0])),
            lambda v: v["connections"][0].update(direction="both"),
            lambda v: v["connections"][0].update(name=" "),
            lambda v: v["connections"][0]["source"].update(object=True),
            lambda v: v["connections"][0]["source"].update(scene="../unsafe"),
            lambda v: v["connections"][0].update(destination=v["connections"][0]["source"]),
        ]
        original = self.files()
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                value = copy.deepcopy(self.value)
                mutate(value)
                with self.assertRaises(ValueError):
                    self.project.save_world(
                        value, self.revision(), self.report()["scene_revisions"]
                    )
                self.assertEqual(self.files(), original)
        value = copy.deepcopy(self.value)
        value["positions"][str(uuid4())] = {"x": 0, "y": 0}
        with self.assertRaisesRegex(ValueError, "existing scenes"):
            self.project.save_world(value, self.revision(), self.report()["scene_revisions"])
        value = copy.deepcopy(self.value)
        value["positions"][self.rooms[0]["id"]] = {"x": -100000, "y": 100000}
        world.check(value)
        value["connections"] = [{**self.link, "id": str(uuid4())} for _ in range(4097)]
        with self.assertRaisesRegex(ValueError, "4096"):
            world.check(value)

    def test_http_world_routes_require_token_and_surface_conflicts(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.root, token="world-token"))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}"

        def post(route, payload, token="world-token"):
            request = Request(
                url + "/api/" + route,
                json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "X-Scene-Token": token},
            )
            with urlopen(request) as response:
                return json.load(response)

        with self.assertRaises(HTTPError) as error:
            post("world-report", {"project_revision": self.revision()}, token="wrong")
        self.assertEqual(error.exception.code, 403)
        report = post("world-report", {"project_revision": self.revision()})
        result = post(
            "save-world",
            {
                "world": self.value,
                "project_revision": self.revision(),
                "scene_revisions": report["scene_revisions"],
            },
        )
        self.assertEqual(result["project"]["world"], self.value)
        with self.assertRaises(HTTPError) as error:
            post("world-report", {"project_revision": "stale"})
        self.assertEqual(error.exception.code, 409)
        manifest = json.loads((self.root / MANIFEST).read_bytes())
        self.assertEqual(manifest["world"], self.value)
