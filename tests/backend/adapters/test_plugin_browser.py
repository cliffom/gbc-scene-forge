"""Real loopback workers: sharing, crash recovery, ownership and fixed origins."""

import json
import socket
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from gbc_scene_forge.adapters.plugin.browser import BrowserManager, control, load, publish
from gbc_scene_forge.adapters.plugin.selection import Selection
from gbc_scene_forge.adapters.plugin.session import PluginSession
from gbc_scene_forge.project.application import Project


class PluginBrowserTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        (self.base / "bundle").mkdir()
        self.selection = Selection(
            self.base / "bundle", settings=self.base / "settings", cache=self.base / "cache"
        )
        self.project = Project.create(self.base / "projects café/design", "Design")
        self.manager = BrowserManager(self.selection)
        self.children = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        # Only process objects created by this test, never a PID read from disk.
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=5)

    def spawn(self, *args, **kwargs):
        child = self.real_popen(*args, **kwargs)
        self.children.append(child)
        return child

    def run(self, result=None):
        self.real_popen = subprocess.Popen
        with patch("gbc_scene_forge.adapters.plugin.browser.subprocess.Popen", self.spawn):
            return super().run(result)

    def read(self, url, *, headers=None, data=None):
        with urlopen(Request(url, headers=headers or {}, data=data), timeout=3) as response:
            return response.read()

    def stop(self, opened):
        return self.manager.request(self.project, action="stop", instance=opened["instance"])

    def test_concurrent_launch_reuses_verified_project_and_scene_route(self):
        scene = self.project.scenes.create("Garden", 2, 2, 8, self.project.catalog()["revision"])
        with ThreadPoolExecutor(2) as pool:
            first, second = list(pool.map(lambda _: self.manager.request(self.project), range(2)))
        self.assertEqual(first["url"], second["url"])
        self.assertEqual(first["instance"], second["instance"])
        self.assertEqual(len(self.children), 1)
        linked = self.manager.request(self.project, scene_id=scene["id"])
        self.assertEqual(linked["url"], first["url"] + "scenes/" + scene["id"])
        self.assertIn(b"<!doctype html>", self.read(linked["url"]).lower())
        saved = json.loads(self.read(first["url"] + "api/project"))
        self.assertEqual(saved["project"]["id"], self.project.catalog()["project"]["id"])
        _, path = self.manager.paths(self.project.root)
        record = load(path)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(record["port"], int(first["url"].split(":")[-1].strip("/")))
        # Neither an untrusted Host nor knowledge of the URL authorizes shutdown/mutation.
        for route, headers, data in (
            ("__forge_browser/stop", {}, b""),
            ("__forge_browser/status", {"Host": "evil.example"}, None),
            ("api/create-scene", {"Content-Type": "application/json"}, b"{}"),
        ):
            with self.assertRaises(HTTPError) as caught:
                self.read(first["url"] + route, headers=headers, data=data)
            self.assertEqual(caught.exception.code, 403)
        self.assertIsNone(control({**record, "secret": "x" * 43}))
        with self.assertRaisesRegex(ValueError, "expired or changed"):
            self.manager.request(self.project, action="stop", instance="old-instance")
        self.assertTrue(self.manager.request(self.project, action="status")["running"])
        with self.assertRaises(ValueError):
            self.manager.request(self.project, scene_id="../escape")
        self.stop(first)
        self.assertFalse(self.manager.request(self.project, action="status")["running"])
        restarted = self.manager.request(self.project)
        self.assertEqual(restarted["url"], first["url"])
        self.assertNotEqual(restarted["instance"], first["instance"])
        self.stop(restarted)

    def test_worker_crash_stale_record_and_occupied_port_preserve_origin(self):
        opened = self.manager.request(self.project)
        self.children[-1].kill()
        self.children[-1].wait(timeout=5)
        _, path = self.manager.paths(self.project.root)
        record = load(path)
        self.assertFalse(self.manager.request(self.project, action="status")["running"])
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", record["port"]))
            listener.listen()
            # A different listener must not be killed or accepted as Forge.
            with self.assertRaisesRegex(ValueError, "saved port may be occupied"):
                self.manager.request(self.project)
            self.assertEqual(load(path), record)
            self.assertEqual(listener.getsockname()[1], record["port"])
        restarted = self.manager.request(self.project)
        self.assertEqual(restarted["url"], opened["url"])
        self.stop(restarted)

    def test_switch_reset_runtime_change_and_path_replacement_never_retarget_server(self):
        self.selection.save(self.selection.prepare(self.project.root, "project"))
        session = PluginSession(self.selection)
        opened = session.call("plugin_browser", {"project": "project", "action": "open"})
        session.call("plugin_reset_selection", {})
        with self.assertRaisesRegex(ValueError, "No available project grant"):
            session.call("plugin_browser", {"project": "project", "action": "open"})
        self.assertTrue(self.manager.request(self.project, action="status")["running"])
        other = BrowserManager(self.selection)
        other.runtime = {"version": "future", "bundle": "another-installation"}
        with self.assertRaisesRegex(ValueError, "different runtime"):
            other.request(self.project)
        self.assertEqual(
            other.request(self.project, action="status")["instance"], opened["instance"]
        )
        self.project.root.rename(self.base / "moved")
        with self.assertRaises(HTTPError) as caught:
            self.read(opened["url"] + "api/project")
        self.assertEqual(caught.exception.code, 409)
        (self.base / "moved").rename(self.project.root)
        self.stop(opened)

    def test_idle_expiry_releases_worker_without_erasing_record(self):
        # Accelerate only the worker's clock policy, without waiting thirty minutes.
        self.manager.command = [
            sys.executable,
            "-c",
            "from gbc_scene_forge.adapters.plugin import browser; "
            "browser.IDLE_SECONDS = 1; raise SystemExit(browser.worker_main())",
        ]
        opened = self.manager.request(self.project)
        self.children[-1].wait(timeout=5)
        status = self.manager.request(self.project, action="status")
        self.assertFalse(status["running"])
        _, path = self.manager.paths(self.project.root)
        self.assertIsNotNone(load(path))
        self.assertIsNotNone(opened["url"])

    def test_invalid_and_symlinked_records_fail_without_launch(self):
        _, path = self.manager.paths(self.project.root)
        for record in ({}, {"schema_version": 1, "port": "8765"}):
            publish(path, record)
            with self.assertRaisesRegex(ValueError, "Invalid browser record"):
                self.manager.request(self.project)
        path.unlink()
        innocent = self.base / "user-file"
        innocent.write_text("User content")
        path.symlink_to(innocent)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.manager.request(self.project)
        self.assertEqual(innocent.read_text(), "User content")
        self.assertEqual(self.children, [])

    def test_killed_save_recovers_existing_journal_before_browser_handoff(self):
        scene = self.project.scenes.create("Garden", 2, 2, 8, self.project.catalog()["revision"])
        source = self.project.root / "scenes" / (scene["id"] + ".tmj")
        before = source.read_bytes()
        script = """
import os, sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.storage import transactions
project = Project(Path(sys.argv[1]))
scene = project.scenes.load(sys.argv[2])
original = transactions.atomic_write
def interrupt(path, data):
    original(path, data)
    if path == project.root / 'scenes' / (scene['id'] + '.tmj'):
        os._exit(73)  # Abrupt loss after publication: skip Python rollback/finally.
transactions.atomic_write = interrupt
changed = {**scene['scene'], 'width': 3, 'cells': [[''] * 3 for _ in range(2)]}
project.scenes.save(scene['id'], changed, scene['revision'], project.catalog()['revision'])
"""
        result = subprocess.run(
            [sys.executable, "-c", script, str(self.project.root), scene["id"]],
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assertNotEqual(source.read_bytes(), before)
        self.selection.save(self.selection.prepare(self.project.root, "project"))
        session = PluginSession(self.selection)
        opened = session.call("plugin_browser", {"project": "project", "action": "open"})
        self.assertEqual(source.read_bytes(), before)
        loaded = json.loads(self.read(opened["url"] + "api/scene/" + scene["id"]))
        self.assertEqual(loaded["scene"], scene["scene"])
        self.assertIn("recovered", {r["status"] for r in self.project.transactions.records()})
        self.stop(opened)
