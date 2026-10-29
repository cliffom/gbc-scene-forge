"""First-save originals preserve game content independently of editable drafts."""

import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.legacy.apply import ApplyManager
from gbc_scene_forge.legacy.documents import DraftStore
from gbc_scene_forge.legacy.server import make_handler
from legacy.fixture_connector import FixtureConnector


class OriginalTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.connector = FixtureConnector(self.root)
        self.store = DraftStore(self.connector)
        self.current = self.connector.load("workbench")["scene"]

    def test_first_save_captures_game_and_survives_apply_delete_restart_and_restore(self):
        edited = dict(self.current, flag=True)
        saved = self.store.save(edited)
        path = self.store.original_path("workbench")
        original_bytes = path.read_bytes()
        self.assertEqual(self.store.load_original("workbench")["scene"], self.current)
        self.assertFalse(self.store.load_original("workbench")["scene"]["flag"])
        manager = ApplyManager(self.connector)
        review = manager.prepare(edited)
        job = {"id": review["id"], "status": "running"}
        manager._run(manager.reviews[review["id"]], job)
        self.assertEqual(job["status"], "complete", job.get("error"))
        self.store.save(dict(edited, name="Later draft"))
        self.assertEqual(path.read_bytes(), original_bytes)
        self.store.delete(self.store.list())
        self.assertFalse(self.store.list())
        self.assertFalse(self.store.path(saved["id"]).exists())
        restarted = DraftStore(FixtureConnector(self.root))
        original = restarted.load_original("workbench")
        self.assertTrue(original["original"])
        self.assertIsNone(original["revision"])
        self.assertFalse(original["scene"]["flag"])
        self.assertEqual(
            original["scene"]["source_digest"], self.connector.source_revision("workbench")
        )
        self.assertTrue(self.connector.validate(original["scene"])["valid"])
        self.assertEqual(path.read_bytes(), original_bytes)
        restore = manager.prepare(original["scene"])
        restore_job = {"id": restore["id"], "status": "running"}
        manager._run(manager.reviews[restore["id"]], restore_job)
        self.assertEqual(restore_job["status"], "complete", restore_job.get("error"))
        self.assertFalse(json.loads(self.connector.path.read_text())["flag"])
        self.assertEqual(path.read_bytes(), original_bytes)
        manager.undo(restore_job["transaction"])
        self.assertTrue(json.loads(self.connector.path.read_text())["flag"])
        self.assertEqual(path.read_bytes(), original_bytes)

    def test_first_template_save_preserves_the_live_scene_instead_of_template(self):
        game = json.loads(self.connector.path.read_text())
        game["flag"] = True
        game["cells"][1][1] = "solid"
        self.connector.path.write_text(json.dumps(game))
        template = self.connector.load("workbench", template=True)["scene"]
        template["flag"] = False
        self.store.save(template)
        original = self.store.load_original("workbench")["scene"]
        self.assertTrue(original["flag"])
        self.assertEqual(original["cells"][1][1], "solid")
        self.assertEqual(
            self.store.load(self.store.list()[0]["id"])["scene"]["cells"][1][1], "blank"
        )

    def test_snapshot_failure_and_save_conflict_do_not_write_a_draft(self):
        with self.assertRaises(Conflict):
            self.store.save(self.current, revision="wrong", explicit_id=True)
        self.assertFalse(self.store.has_original("workbench"))
        with patch("gbc_scene_forge.legacy.documents.os.link", side_effect=OSError("disk failure")):
            with self.assertRaisesRegex(OSError, "disk failure"):
                self.store.save(self.current)
        self.assertFalse(self.store.list())
        self.assertFalse(self.store.has_original("workbench"))
        self.assertEqual(list((self.store.root / ".originals").iterdir()), [])

    def test_snapshot_paths_reject_symlinks_and_preserve_corrupt_existing_original(self):
        path = self.store.original_path("workbench")
        path.parent.parent.mkdir(parents=True)
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        path.parent.symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.store.save(self.current)
        path.parent.unlink()
        path.parent.mkdir()
        path.write_text("corrupt original")
        self.store.save(self.current)
        self.assertEqual(path.read_text(), "corrupt original")
        with self.assertRaises(ValueError):
            self.store.load_original("workbench")
        with self.assertRaises(ValueError):
            self.store.original_path("../outside")

    def test_existing_original_is_not_replaced_when_another_writer_wins(self):
        path = self.store.original_path("workbench")
        competing = b"existing snapshot from another writer"

        def publish(temporary, destination):
            destination.write_bytes(competing)
            raise FileExistsError()

        with patch("gbc_scene_forge.legacy.documents.os.link", side_effect=publish):
            self.store.save(self.current)
        self.assertEqual(path.read_bytes(), competing)

    def test_http_availability_and_loading_keep_original_read_only(self):
        handler = object.__new__(make_handler("token", self.connector))
        handler.server = SimpleNamespace(server_port=8777)
        handler.headers = {"Host": "127.0.0.1:8777"}
        handler.reply = Mock()
        handler.path = "/api/originals"
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.args[0], [])
        self.store.save(dict(self.current, flag=True))
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.args[0], ["workbench"])
        handler.path = "/api/original/workbench"
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.args[0]["scene"], self.current)
        self.assertTrue(handler.reply.call_args.args[0]["original"])
        handler.path = "/api/original/unknown"
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.kwargs["status"], 400)
        handler.path = "/api/original/workbench"
        handler.headers.update(
            {"Content-Type": "application/json", "X-Scene-Token": "token", "Content-Length": "2"}
        )
        handler.rfile = io.BytesIO(b"{}")
        handler.do_POST()
        self.assertEqual(handler.reply.call_args.kwargs["status"], 404)
