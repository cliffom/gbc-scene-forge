"""Cross-process revision probes, bounded idle work and coherent refresh APIs."""

import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from gbc_scene_forge.projects import MANIFEST, Project
from gbc_scene_forge.standalone import make_handler, make_root_handler
from gbc_scene_forge.updates import Updates


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.project = Project.create(self.folder / "world", "World", starter="blockout")
        self.scene = self.project.create_blockout_scene(
            "Plan", {}, self.project.catalog()["revision"]
        )
        self.updates = Updates(self.project)

    def test_idle_probes_do_not_read_or_decode_content(self):
        expected = self.updates.revisions(self.scene["id"])
        with patch.object(Path, "open", side_effect=AssertionError("Unexpected content read")):
            # Lock files use Path.open too; retain the real transaction lock in other tests.
            with patch.object(self.project.transactions, "locked"):
                for _ in range(100):
                    self.assertEqual(self.updates.revisions(self.scene["id"]), expected)
        self.assertEqual(len(self.updates.cache), 2)

    def test_detects_same_size_edits_and_missing_scene(self):
        scene_id = self.scene["id"]
        before = self.updates.revisions(scene_id)
        path = self.project.root / "scenes" / f"{scene_id}.tmj"
        content = path.read_bytes()
        changed = content.replace(b"0", b"1", 1)
        self.assertNotEqual(content, changed)
        self.assertEqual(len(content), len(changed))
        path.write_bytes(changed)
        after = self.updates.revisions(scene_id)
        self.assertEqual(before["revision"], after["revision"])
        self.assertNotEqual(before["scene_revision"], after["scene_revision"])
        path.unlink()
        self.assertIsNone(self.updates.revisions(scene_id)["scene_revision"])

    def test_snapshot_and_deletion_from_another_project_instance(self):
        writer = Project(self.project.root)
        before = self.updates.snapshot(self.scene["id"])
        self.assertEqual(before["scene"]["revision"], self.scene["revision"])
        writer.rename_scene(self.scene["id"], "Renamed", self.scene["revision"], before["revision"])
        after = self.updates.snapshot(self.scene["id"])
        self.assertEqual(after["project"]["scenes"][0]["name"], "Renamed")
        self.assertEqual(after["scene"]["name"], "Renamed")
        self.assertNotEqual(before["revision"], after["revision"])
        writer.delete_scene(self.scene["id"], self.scene["revision"], after["revision"])
        self.assertIsNone(self.updates.snapshot(self.scene["id"])["scene"])

    def test_unregistered_scene_files_are_not_probed(self):
        unknown = str(uuid4())
        path = self.project.root / "scenes" / f"{unknown}.tmj"
        path.write_bytes((self.project.root / "scenes" / f"{self.scene['id']}.tmj").read_bytes())
        self.assertIsNone(self.updates.revisions(unknown)["scene_revision"])
        self.assertIsNone(self.updates.snapshot(unknown)["scene"])
        self.assertNotIn(f"scenes/{unknown}.tmj", self.updates.cache)

    def test_rejects_paths_and_oversized_files(self):
        for invalid in ("../../secret", "not-a-scene", "", 42):
            with self.assertRaises(ValueError):
                self.updates.revisions(invalid)
            with self.assertRaises(ValueError):
                self.updates.snapshot(invalid)
        with (self.project.root / MANIFEST).open("wb") as stream:
            stream.truncate(8 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, "size limit"):
            self.updates.revisions()

    def test_snapshot_and_probe_obey_external_transaction_lock(self):
        writer = Project(self.project.root)
        with writer.transactions.locked():
            for work in (self.updates.revisions, self.updates.snapshot):
                with self.assertRaisesRegex(ValueError, "Another scene editor"):
                    work(self.scene["id"])

    def test_api_in_single_and_project_root_modes(self):
        for root_mode in (False, True):
            handler = (make_root_handler if root_mode else make_handler)(
                self.folder if root_mode else self.project.root, "secret"
            )
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                base = f"http://127.0.0.1:{server.server_port}" + (
                    "/projects/world" if root_mode else ""
                )
                for route in ("revisions", "snapshot"):
                    url = f"{base}/api/{route}?scene={self.scene['id']}"
                    with urlopen(url, timeout=5) as response:
                        result = json.load(response)
                    self.assertEqual(result["revision"], self.project.catalog()["revision"])
                    self.assertEqual(
                        result.get("scene_revision", result.get("scene", {}).get("revision")),
                        self.scene["revision"],
                    )
                    with self.assertRaises(HTTPError) as caught:
                        urlopen(Request(url, headers={"Host": "evil.example"}), timeout=5)
                    self.assertEqual(caught.exception.code, 403)
                with self.assertRaises(HTTPError) as caught:
                    urlopen(f"{base}/api/revisions?scene=../../secret", timeout=5)
                self.assertEqual(caught.exception.code, 400)
            finally:
                server.shutdown()
                server.server_close()
                worker.join()
