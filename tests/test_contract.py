"""Exercise the reusable package with an unrelated, independently stored scene."""

import ast
import io
import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fixture_connector import FixtureConnector

from gbc_scene_forge.apply import ApplyManager
from gbc_scene_forge.contract import CheckStep, check_connector
from gbc_scene_forge.documents import Conflict, DraftStore, decode_document, encode_document
from gbc_scene_forge.server import make_handler


class ContractTests(unittest.TestCase):
    def test_unsupported_capabilities_are_rejected_by_the_service(self):
        class ReadOnlyConnector(FixtureConnector):
            def catalog(self):
                data = super().catalog()
                data["capabilities"]["apply"] = False
                return data

        connector = ReadOnlyConnector(self.root)
        handler = object.__new__(make_handler("token", connector))
        handler.server = SimpleNamespace(server_port=8777)
        handler.reply = Mock()
        handler.headers = {
            "Host": "127.0.0.1:8777",
            "Content-Type": "application/json",
            "X-Scene-Token": "token",
            "Content-Length": "2",
        }
        handler.path = "/api/apply"
        handler.rfile = io.BytesIO(b"{}")
        handler.do_POST()
        self.assertIn("does not support apply", handler.reply.call_args.args[0]["error"])

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.connector = FixtureConnector(self.root)
        self.scene = self.connector.load("workbench")["scene"]

    def test_envelope_roundtrip_preserves_extension_fields_and_legacy_identity(self):
        store = DraftStore(self.connector)
        legacy = dict(self.scene, extra={"future": [1, 2, 3]})
        legacy.pop("connector")
        store.root.mkdir(parents=True)
        path = store.path(legacy["id"])
        raw = json.dumps(legacy).encode()
        path.write_bytes(raw)
        loaded = store.load(legacy["id"])
        self.assertEqual(path.read_bytes(), raw)
        self.assertEqual(loaded["scene"]["extra"], legacy["extra"])
        result = store.save(loaded["scene"], legacy["id"], loaded["revision"])
        document = json.loads(path.read_text())
        self.assertEqual(document["version"], 2)
        self.assertEqual(document["target"], "workbench")
        self.assertEqual(result["id"], legacy["id"])
        self.assertEqual(decode_document(document, self.connector), loaded["scene"])
        with self.assertRaises(Conflict):
            store.save(loaded["scene"], legacy["id"], loaded["revision"])
        for key, value in (("version", 99), ("connector", "other-game"), ("surprise", True)):
            bad = dict(document)
            bad[key] = value
            with self.assertRaises(ValueError):
                decode_document(bad, self.connector)

    def test_contract_versions_and_connector_authoritative_comparison(self):
        self.connector.contract_version = 99
        with self.assertRaises(ValueError):
            check_connector(self.connector)
        self.connector.contract_version = 1
        modified = dict(self.scene, flag=True)
        self.assertEqual(modified["cells"], self.scene["cells"])
        self.assertTrue(self.connector.compare(modified)["differs"])

    def test_independent_apply_and_undo_use_declared_paths_and_keep_legacy_history(self):
        original = self.connector.path.read_bytes()
        manager = ApplyManager(self.connector)
        self.scene["cells"][2][2] = "solid"
        review = manager.prepare(self.scene)
        job = {"id": review["id"], "status": "running"}
        manager._run(manager.reviews[review["id"]], job)
        self.assertEqual(job["status"], "complete", job.get("error"))
        self.assertEqual((self.root / "compiled/room.bin").read_bytes()[16], 1)
        self.assertTrue((self.root / ".workshop/history").is_dir())
        restarted = ApplyManager(self.connector)
        restarted.undo(job["transaction"])
        self.assertEqual(self.connector.path.read_bytes(), original)
        self.assertFalse((self.root / "compiled/room.bin").exists())

    def test_undeclared_artifacts_failed_checks_and_stale_candidates_do_not_apply(self):
        manager = ApplyManager(self.connector)
        self.scene["cells"][2][2] = "solid"
        original = self.connector.path.read_bytes()
        review = manager.prepare(self.scene)
        candidate = manager.reviews[review["id"]]
        candidate["plan"] = replace(
            candidate["plan"],
            checks=(CheckStep("Fail fixture", (sys.executable, "-c", "raise SystemExit(7)")),),
        )
        job = {"id": review["id"], "status": "running"}
        manager._run(candidate, job)
        self.assertEqual(job["status"], "failed")
        self.assertIn("exit code 7", job["error"])
        self.assertEqual(self.connector.path.read_bytes(), original)
        review = manager.prepare(self.scene)
        candidate = manager.reviews[review["id"]]
        (candidate["stage"] / "levels/room.json").write_text("tampered")
        job = {"id": review["id"], "status": "running"}
        manager._run(candidate, job)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(self.connector.path.read_bytes(), original)

        class BadConnector(FixtureConnector):
            def prepare(self, *args):
                return replace(super().prepare(*args), outputs=("../escape",))

        with self.assertRaises(ValueError):
            ApplyManager(BadConnector(self.root)).prepare(self.scene)

    def test_editable_package_changes_invalidate_review_and_prevent_promotion(self):
        manager = ApplyManager(self.connector)
        self.scene["cells"][2][2] = "solid"
        original = self.connector.path.read_bytes()
        review = manager.prepare(self.scene)
        candidate = manager.reviews[review["id"]]
        with patch("gbc_scene_forge.apply.runtime_snapshot", return_value={"changed": "digest"}):
            with self.assertRaisesRegex(ValueError, "Editor package changed"):
                manager.start(review["id"], True)
            job = {"id": review["id"], "status": "running"}
            manager._run(candidate, job)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(self.connector.path.read_bytes(), original)

        review = manager.prepare(self.scene)
        candidate = manager.reviews[review["id"]]
        fingerprint = candidate["runtime"]
        with patch("gbc_scene_forge.apply.runtime_snapshot", side_effect=[fingerprint, {}]):
            job = {"id": review["id"], "status": "running"}
            manager._run(candidate, job)
        self.assertEqual(job["status"], "failed")
        self.assertIn("during verification", job["error"])
        self.assertEqual(self.connector.path.read_bytes(), original)

    def test_transport_works_with_independent_connector_and_envelopes(self):
        handler = object.__new__(make_handler("fixture-token", self.connector))
        handler.server = SimpleNamespace(server_port=8777)
        handler.reply = Mock()
        handler.headers = {
            "Host": "127.0.0.1:8777",
            "Content-Type": "application/json",
            "X-Scene-Token": "fixture-token",
        }
        handler.path = "/api/scene/workbench"
        handler.do_GET()
        self.assertEqual(
            handler.reply.call_args.args[0]["constraints"][0]["reason"], "Fixture anchor"
        )
        handler.path = "/api/import"
        body = json.dumps({"scene": encode_document(self.scene)}).encode()
        handler.headers["Content-Length"] = str(len(body))
        handler.rfile = io.BytesIO(body)
        handler.do_POST()
        self.assertEqual(handler.reply.call_args.args[0]["scene"], self.scene)

    def test_branding_is_served_without_exposing_other_package_files(self):
        handler = object.__new__(make_handler("fixture-token", self.connector))
        handler.server = SimpleNamespace(server_port=8777)
        handler.reply = Mock()
        handler.headers = {"Host": "127.0.0.1:8777"}
        for name, size in (("logo-64.png", 64), ("favicon-32.png", 32), ("favicon-16.png", 16)):
            with self.subTest(asset=name):
                handler.path = "/branding/" + name
                handler.do_GET()
                data, mime = handler.reply.call_args.args
                self.assertEqual(mime, "image/png")
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(int.from_bytes(data[16:20], "big"), size)
                self.assertEqual(int.from_bytes(data[20:24], "big"), size)
        for route in ("/branding/../server.py", "/branding/unknown.png"):
            handler.path = route
            handler.do_GET()
            self.assertEqual(handler.reply.call_args.kwargs["status"], 404)

    def test_core_has_no_game_imports_and_loads_in_isolation(self):
        import gbc_scene_forge

        source = Path(gbc_scene_forge.__file__).parent
        for path in source.glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text())):
                modules = (
                    [alias.name for alias in node.names]
                    if isinstance(node, ast.Import)
                    else [node.module or ""]
                    if isinstance(node, ast.ImportFrom)
                    else []
                )
                self.assertFalse(
                    any(module.startswith(("tools.", "gbc_atlas", "PIL")) for module in modules),
                    path,
                )
        code = (
            "import sys; sys.path[:0]="
            + repr([str(source.parent), str(Path(__file__).parent)])
            + "; from fixture_connector import FixtureConnector; from gbc_scene_forge.server import make_handler; import tempfile; from pathlib import Path; t=tempfile.TemporaryDirectory(); make_handler('token',FixtureConnector(Path(t.name))); assert not any(m.startswith('tools.') for m in sys.modules)"
        )
        subprocess.run([sys.executable, "-I", "-c", code], cwd=self.root, check=True)
