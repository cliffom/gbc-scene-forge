"""Draft persistence, revision conflicts, limits and loopback protection."""

import copy
import json
import shutil
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.drafts import Drafts
from gbc_scene_forge.projects import Project
from gbc_scene_forge.standalone import make_handler


class DraftTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = Project.create(self.root / "world", "World")
        path, _ = bundle(self.root / "art")
        self.project.import_atlas(path, self.project.catalog()["revision"])
        self.scene = self.project.create_scene("Room", 7, 5, 8, self.project.catalog()["revision"])
        self.store = Drafts(self.project)
        document, revision = self.project.read()
        self.payload = {
            "id": str(uuid4()),
            "revision": None,
            "project_id": document["id"],
            "scene_id": self.scene["id"],
            "name": "Room",
            "scene_revision": self.scene["revision"],
            "project_revision": revision,
            "scene": copy.deepcopy(self.scene["scene"]),
        }
        self.payload["scene"]["cells"][1][1] = "terrain/earth/0/0"

    def checkpoint(self):
        self.payload.update(self.store.write(self.payload))
        return self.payload["revision"]

    def test_transformed_composition_survives_checkpoint_and_explicit_save(self):
        scene = self.payload["scene"]
        scene["cells"][1][1] = "terrain/earth/0/0#7"
        scene["objects"] = [
            {
                "id": 5,
                "kind": "rectangle",
                "name": "Copied door",
                "class": "trigger",
                "x": 8,
                "y": 8,
                "width": 4,
                "height": 8,
                "properties": [{"name": "target", "type": "string", "value": "room"}],
            }
        ]
        scene["next_object_id"] = 6
        self.checkpoint()
        restored = self.store.restore(self.payload["id"], self.payload["revision"])
        self.assertEqual(restored["scene"]["cells"][1][1], "terrain/earth/0/0#7")
        self.assertEqual(restored["scene"]["objects"], scene["objects"])
        self.assertEqual(self.project.load_scene(self.scene["id"])["scene"]["cells"][1][1], "")
        saved = self.project.save_scene(
            self.scene["id"],
            restored["scene"],
            restored["revision"],
            self.project.catalog()["revision"],
        )
        self.assertEqual(saved["scene"], restored["scene"])

    def test_restart_move_restore_does_not_commit_until_explicit_save(self):
        self.checkpoint()
        original = self.project.load_scene(self.scene["id"])
        moved = self.root / "moved"
        shutil.move(self.project.root, moved)
        reopened = Project(moved)
        store = Drafts(reopened)
        self.assertEqual(len(store.list()["drafts"]), 1)
        restored = store.restore(self.payload["id"], self.payload["revision"])
        self.assertEqual(restored["scene"]["cells"][1][1], "terrain/earth/0/0")
        self.assertEqual(reopened.load_scene(self.scene["id"]), original)
        saved = reopened.save_scene(
            restored["id"], restored["scene"], restored["revision"], reopened.catalog()["revision"]
        )
        store.delete(self.payload["id"], self.payload["revision"])
        self.assertEqual(store.list()["drafts"], [])
        self.assertEqual(reopened.load_scene(saved["id"])["scene"], saved["scene"])
        raw, _ = reopened.export_bundle("project", reopened.catalog()["revision"])
        self.assertTrue(raw)

    def test_layered_objects_properties_and_asset_references_round_trip(self):
        path, _ = sprite_bundle(self.root / "actors")
        self.project.import_atlas(path, self.project.catalog()["revision"])
        self.payload["project_revision"] = self.project.catalog()["revision"]
        self.payload["scene_revision"] = self.project.load_scene(self.scene["id"])["revision"]
        self.payload["scene"] = {
            "width": 7,
            "height": 5,
            "grid": 8,
            "next_layer_id": 8,
            "next_object_id": 9,
            "layers": [
                {
                    "id": 4,
                    "name": "Ground",
                    "type": "tilelayer",
                    "visible": False,
                    "cells": self.payload["scene"]["cells"],
                },
                {
                    "id": 7,
                    "name": "Actors",
                    "type": "objectgroup",
                    "visible": True,
                    "objects": [
                        {"id": 3, "asset": "actors/idle", "x": 32, "y": 24, "origin": [8, 23]},
                        {
                            "id": 8,
                            "kind": "point",
                            "x": 8,
                            "y": 8,
                            "name": "Entry",
                            "class": "spawn",
                            "properties": [{"name": "enabled", "type": "bool", "value": True}],
                        },
                    ],
                },
            ],
        }
        self.checkpoint()
        restored = self.store.restore(self.payload["id"], self.payload["revision"])
        self.assertEqual(restored["scene"], self.payload["scene"])
        self.project.save_scene(
            restored["id"],
            restored["scene"],
            restored["revision"],
            self.payload["project_revision"],
        )
        self.assertEqual(self.project.load_scene(restored["id"])["scene"], self.payload["scene"])

    def test_interrupted_replace_keeps_last_complete_record(self):
        before = self.checkpoint()
        self.payload["scene"]["cells"][2][2] = "terrain/earth/0/0"
        with patch("pathlib.Path.replace", side_effect=OSError("interrupted before replace")):
            with self.assertRaises(OSError):
                self.store.write(self.payload)
        self.assertEqual(self.store.read(self.payload["id"])[1], before)
        self.assertEqual(len(list(self.store.path(self.payload["id"]).parent.iterdir())), 1)

    def test_two_tabs_and_stale_write_delete_restore_download_guards(self):
        old = self.checkpoint()
        second = {**self.payload, "id": str(uuid4()), "revision": None}
        self.store.write(second)
        self.payload["scene"]["cells"][2][2] = "terrain/earth/0/0"
        self.checkpoint()
        self.assertEqual(len(self.store.list()["drafts"]), 2)
        with self.assertRaises(Conflict):
            self.store.write({**self.payload, "revision": old, "name": "Stale write"})
        for method in (self.store.delete, self.store.restore, self.store.download):
            with self.assertRaises(Conflict):
                method(self.payload["id"], old)
        self.store.delete(self.payload["id"], self.payload["revision"])
        self.assertEqual(self.store.list()["drafts"][0]["id"], second["id"])

    def test_retry_after_lost_response_is_idempotent(self):
        request = copy.deepcopy(self.payload)
        expected = self.checkpoint()
        self.assertEqual(self.store.write(request)["revision"], expected)
        self.assertEqual(self.store.read(request["id"])[1], expected)

    def test_external_scene_project_and_asset_changes_preserve_draft(self):
        self.checkpoint()
        path = self.project.root / f"scenes/{self.scene['id']}.tmj"
        original = path.read_bytes()
        path.write_bytes(original + b"\n")
        with self.assertRaisesRegex(Conflict, "scene changed"):
            self.store.restore(self.payload["id"], self.payload["revision"])
        self.assertEqual(path.read_bytes(), original + b"\n")
        # Checkpoints continue even after their saved base becomes stale.
        self.payload["scene"]["cells"][2][2] = "terrain/earth/0/0"
        self.checkpoint()
        downloaded = self.store.download(self.payload["id"], self.payload["revision"])
        self.assertEqual(downloaded["scene"], self.payload["scene"])
        path.write_bytes(original)
        manifest = self.project.root / "forge.project.json"
        manifest_raw = manifest.read_bytes()
        manifest.write_bytes(manifest_raw + b"\n")
        with self.assertRaisesRegex(Conflict, "Project changed"):
            self.store.restore(self.payload["id"], self.payload["revision"])
        manifest.write_bytes(manifest_raw)
        image = self.project.root / "assets/terrain/atlas.png"
        image.write_bytes(image.read_bytes() + b"x")
        with self.assertRaisesRegex(Conflict, "asset changed"):
            self.store.restore(self.payload["id"], self.payload["revision"])
        self.assertEqual(len(self.store.list()["drafts"]), 1)

    def test_deleted_scene_invalid_content_and_project_identity(self):
        self.payload["scene"]["cells"][1][1] = "unknown/missing/0/0"
        self.checkpoint()
        with self.assertRaises(ValueError):
            self.store.restore(self.payload["id"], self.payload["revision"])
        self.assertEqual(
            self.store.download(self.payload["id"], self.payload["revision"])["scene"],
            self.payload["scene"],
        )
        self.project.delete_scene(
            self.scene["id"], self.scene["revision"], self.project.catalog()["revision"]
        )
        self.assertEqual(len(self.store.list()["drafts"]), 1)
        with self.assertRaises(Conflict):
            self.store.restore(self.payload["id"], self.payload["revision"])
        with self.assertRaisesRegex(ValueError, "another project"):
            self.store.write({**self.payload, "project_id": str(uuid4())})

    def test_limits_failed_write_and_damaged_record_preserve_last_checkpoint(self):
        before = self.checkpoint()
        self.payload["scene"]["cells"][2][2] = "terrain/earth/0/0"
        with patch("gbc_scene_forge.drafts.atomic_write", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.store.write(self.payload)
        self.assertEqual(self.store.read(self.payload["id"])[1], before)
        for constant, value in (("MAX_BYTES", 20), ("MAX_TOTAL", 20), ("MAX_DRAFTS", 1)):
            with (
                self.subTest(constant=constant),
                patch(f"gbc_scene_forge.drafts.{constant}", value),
            ):
                request = {**self.payload, "id": str(uuid4()), "revision": None}
                with self.assertRaises(ValueError):
                    self.store.write(request)
        damaged = self.store.path(str(uuid4()))
        damaged.write_text("{")
        # Unmanaged files do not hide valid checkpoints or get removed.
        (damaged.parent / "notes.json").write_text("{}")
        items = self.store.list()["drafts"]
        self.assertEqual(len(items), 2)
        self.assertTrue(any("error" in item for item in items))
        self.assertEqual(self.store.read(self.payload["id"])[1], before)

    def test_paths_and_symlinks(self):
        for bad in ("../outside", "", None, "a/b"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.store.write({**self.payload, "id": bad})
        outside = self.root / "outside"
        outside.mkdir()
        (self.project.root / ".forge/drafts").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.store.write(self.payload)
        self.assertEqual(list(outside.iterdir()), [])

    def test_api_token_host_guards_and_conflict_response(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.project.root, "secret"))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_port}/api/"

        def request(route, payload, token="secret", host=None):
            headers = {"Content-Type": "application/json", "X-Scene-Token": token}
            if host:
                headers["Host"] = host
            with urlopen(Request(base + route, json.dumps(payload).encode(), headers)) as response:
                return json.load(response)

        for route in (
            "checkpoint-draft",
            "list-drafts",
            "restore-draft",
            "download-draft",
            "delete-draft",
        ):
            for kwargs in ({"token": "wrong"}, {"host": "remote.example"}):
                with (
                    self.subTest(route=route, kwargs=kwargs),
                    self.assertRaises(HTTPError) as caught,
                ):
                    request(route, self.payload, **kwargs)
                self.assertEqual(caught.exception.code, 403)
        saved = request("checkpoint-draft", self.payload)
        self.assertEqual(len(request("list-drafts", {})["drafts"]), 1)
        guard = {"id": self.payload["id"], **saved}
        self.assertEqual(
            request("restore-draft", guard)["scene"]["cells"][1][1], "terrain/earth/0/0"
        )
        with self.assertRaises(HTTPError) as caught:
            request("delete-draft", {**guard, "revision": "stale"})
        self.assertEqual(caught.exception.code, 409)
        request("delete-draft", guard)
        self.assertEqual(request("list-drafts", {})["drafts"], [])
