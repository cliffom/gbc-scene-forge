"""Plugin bootstrap grants, persistence and project isolation without a GUI/SDK."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge.adapters.mcp.tools import TOOLS
from gbc_scene_forge.adapters.plugin.selection import Selection, choose_directory, locations
from gbc_scene_forge.adapters.plugin.session import PluginSession
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import MANIFEST


class PluginSelectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.bundle = self.base / "plugin cache"
        self.bundle.mkdir()
        self.root = self.base / "projects café"
        self.root.mkdir()
        self.selection = Selection(
            self.bundle, settings=self.base / "settings", cache=self.base / "cache"
        )

    def session(self, path=None):
        return PluginSession(self.selection, chooser=lambda mode: path)

    def snapshot(self, root):
        return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}

    def test_bounded_profile_keeps_setup_and_first_task_callable(self):
        session = self.session(self.root)
        names = {tool["name"] for tool in session.tool_definitions}
        # Reproduce the client registry boundary observed in a native model turn.
        exposed = set(sorted(names)[:32])
        self.assertEqual(exposed, names)
        self.assertTrue(
            {
                "plugin_status",
                "plugin_choose_location",
                "plugin_reset_selection",
                "list_projects",
                "create_project",
                "get_project",
                "create_artwork",
                "edit_artwork_pixels",
                "review_artwork_candidate",
                "commit_artwork",
                "create_scene",
                "review_blockout",
                "export_bundle",
            }
            <= exposed
        )
        self.assertIn("delete_scene", {tool["name"] for tool in TOOLS})
        with self.assertRaisesRegex(ValueError, "bounded plugin profile"):
            session.call("delete_scene", {})
        session.call("plugin_choose_location", {"mode": "root"})
        capabilities = session.call("capabilities", {})
        self.assertEqual(set(capabilities["tools"]), names)
        self.assertIn("delete_scene", capabilities["unavailable_tools"])
        with self.assertRaisesRegex(ValueError, "bounded plugin profile"):
            session.call("delete_scene", {})

    def test_clean_first_use_has_no_grant_and_creates_nothing(self):
        session = self.session()
        self.assertIsNone(session.call("plugin_status", {})["selection"])
        for tool, args in (("list_projects", {}), ("create_project", {"name": "Unexpected"})):
            with self.assertRaisesRegex(ValueError, "No available project grant"):
                session.call(tool, args)
        self.assertFalse(self.selection.settings.parent.exists())
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertTrue(session.call("plugin_choose_location", {"mode": "root"})["cancelled"])
        self.assertFalse(self.selection.settings.exists())

    def test_choose_create_reopen_single_project_and_switch(self):
        session = self.session(self.root)
        result = session.call("plugin_choose_location", {"mode": "root"})
        self.assertEqual(result["selection"]["path"], str(self.root))
        self.assertEqual(session.call("list_projects", {})["projects"], [])
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(self.selection.settings.stat().st_mode & 0o777, 0o600)
        created = session.call("create_project", {"name": "My design"})
        project = self.root / created["directory"]
        before = self.snapshot(project)
        reopened = self.session()
        self.assertEqual(reopened.call("list_projects", {})["projects"][0]["name"], "My design")
        session.chooser = lambda mode: project
        session.call("plugin_choose_location", {"mode": "project"})
        self.assertEqual(self.snapshot(project), before)
        self.assertEqual(session.call("list_projects", {})["projects"][0]["directory"], "project")
        with self.assertRaises(ValueError):
            session.call("create_project", {"name": "Escape"})
        for value in ("../my-design", str(project), "my-design"):
            with self.assertRaises(ValueError):
                session.call("get_project", {"project": value})
        # Other running conversations lose their old grant instead of silently adopting this one.
        self.assertIsNone(reopened.call("plugin_status", {})["selection"])
        self.assertIn("another conversation", reopened.error)
        self.assertEqual(self.session().record["mode"], "project")

    def test_discovery_invalid_content_and_denied_access_have_no_project_writes(self):
        Project.create(self.root / "good", "Good")
        bad = self.root / "bad"
        bad.mkdir()
        (bad / MANIFEST).write_text("invalid")
        before = self.snapshot(self.root)
        session = self.session(self.root)
        session.call("plugin_choose_location", {"mode": "root"})
        listing = session.call("list_projects", {})
        self.assertEqual(len(listing["projects"]), 1)
        self.assertEqual(listing["unavailable"][0]["directory"], "bad")
        session.chooser = lambda mode: bad
        with self.assertRaises(ValueError):
            session.call("plugin_choose_location", {"mode": "project"})
        with patch("gbc_scene_forge.adapters.plugin.selection.os.access", return_value=False):
            with self.assertRaisesRegex(ValueError, "read-only or access was denied"):
                session.call("plugin_choose_location", {"mode": "root"})
        self.assertEqual(self.snapshot(self.root), before)

    def test_single_project_discovery_does_not_create_history_lock(self):
        project = Project.create(self.root / "design", "Design")
        lock = project.root / ".forge/history/.lock"
        lock.unlink(missing_ok=True)
        before = self.snapshot(project.root)
        session = self.session(project.root)
        session.call("plugin_choose_location", {"mode": "project"})
        self.assertEqual(session.call("list_projects", {})["projects"][0]["name"], "Design")
        self.assertEqual(self.snapshot(project.root), before)
        self.assertFalse(lock.exists())

    def test_cancel_failed_persistence_and_invalid_arguments_preserve_old_grant(self):
        session = self.session(self.root)
        session.call("plugin_choose_location", {"mode": "root"})
        original = self.selection.settings.read_bytes()
        session.chooser = lambda mode: None
        self.assertTrue(session.call("plugin_choose_location", {"mode": "project"})["cancelled"])
        self.assertEqual(self.selection.settings.read_bytes(), original)
        other = self.base / "other"
        other.mkdir()
        session.chooser = lambda mode: other
        with patch.object(self.selection, "save", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                session.call("plugin_choose_location", {"mode": "root"})
        self.assertEqual(session.record["path"], str(self.root))
        for args in ({"mode": "root", "path": str(other)}, {"mode": "unknown"}, {}):
            with self.assertRaises(ValueError):
                session.call("plugin_choose_location", args)
        with self.assertRaises(ValueError):
            session.call("plugin_reset_selection", {"path": str(other)})

    def test_containment_and_symlink_escape_are_rejected(self):
        for path in (self.base, self.bundle, self.bundle / "child", self.selection.settings.parent):
            path.mkdir(exist_ok=True, parents=True)
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.selection.prepare(path, "root")
        session = self.session(self.root)
        session.call("plugin_choose_location", {"mode": "root"})
        outside = self.base / "outside"
        Project.create(outside, "Outside")
        (self.root / "escape").symlink_to(outside, target_is_directory=True)
        self.assertEqual(session.call("list_projects", {})["projects"], [])
        for directory in ("escape", "../outside", str(outside)):
            with self.assertRaises(ValueError):
                session.call("get_project", {"project": directory})

    def test_unavailable_moved_replaced_and_symlinked_grants_fail_closed(self):
        session = self.session(self.root)
        session.call("plugin_choose_location", {"mode": "root"})
        moved = self.root.with_name("moved")
        self.root.rename(moved)
        self.assertIsNone(self.session().record)
        self.assertFalse(self.root.exists())
        self.root.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "No available project grant"):
            session.call("create_project", {"name": "No"})
        self.assertEqual(list(moved.iterdir()), [])
        self.root.unlink()
        self.root.mkdir()
        self.assertIn("replaced", self.session().error)

    def test_switch_and_reset_clear_artifacts_without_deleting_projects(self):
        project = Project.create(self.root / "design", "Design")
        session = self.session(self.root)
        session.call("plugin_choose_location", {"mode": "root"})
        artifact = session.adapter.artifact(b"png", "image/png", "review.png")
        session.chooser = lambda mode: project.root
        session.call("plugin_choose_location", {"mode": "project"})
        with self.assertRaises(ValueError):
            session.read_artifact(artifact["uri"])
        before = self.snapshot(self.root)
        session.call("plugin_reset_selection", {})
        self.assertEqual(session.artifacts, {})
        self.assertFalse(self.selection.settings.exists())
        self.assertEqual(self.snapshot(self.root), before)
        self.assertIsNone(self.session().record)

    def test_invalid_settings_are_actionable_and_resettable(self):
        self.selection.settings.parent.mkdir()
        for data in ("invalid json", "{}", json.dumps({"schema_version": 9})):
            self.selection.settings.write_text(data)
            session = self.session()
            self.assertIsNone(session.record)
            self.assertTrue(session.call("plugin_status", {})["error"])
        session.call("plugin_reset_selection", {})
        self.assertIsNone(self.session().error)

    def test_settings_parent_cannot_be_redirected_into_a_project(self):
        session = self.session(self.root)
        session.call("plugin_choose_location", {"mode": "root"})
        self.selection.settings.parent.rename(self.base / "old settings")
        self.selection.settings.parent.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.selection.save(session.record)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.selection.reset()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_preexisting_settings_symlink_cannot_claim_or_reset_a_user_file(self):
        redirect = self.base / "redirect"
        redirect.symlink_to(self.root, target_is_directory=True)
        user_file = self.root / "selection.json"
        user_file.write_text("User content")
        with self.assertRaisesRegex(ValueError, "symlink"):
            Selection(self.bundle, settings=redirect, cache=self.base / "cache")
        self.assertEqual(user_file.read_text(), "User content")

    def test_failed_atomic_publication_preserves_previous_selection_and_cleans_temporary(self):
        record = self.selection.prepare(self.root, "root")
        self.selection.save(record)
        before = self.selection.settings.read_bytes()
        other = self.base / "other"
        other.mkdir()
        with patch.object(Path, "replace", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                self.selection.save(self.selection.prepare(other, "root"))
        self.assertEqual(self.selection.settings.read_bytes(), before)
        self.assertEqual(list(self.selection.settings.parent.iterdir()), [self.selection.settings])


class NativeChooserTests(unittest.TestCase):
    def test_native_selection_cancellation_permission_failure_and_timeout(self):
        with patch("platform.system", return_value="Darwin"):
            for code, stdout, stderr in (
                (0, "/Users/example/art café/\n", ""),
                (1, "", "User canceled. (-128)"),
                (1, "", "Not authorized. (-1743)"),
            ):
                with patch(
                    "subprocess.run",
                    return_value=subprocess.CompletedProcess([], code, stdout, stderr),
                ) as run:
                    if code and "-128" not in stderr:
                        with self.assertRaisesRegex(ValueError, "Privacy & Security"):
                            choose_directory("root")
                    else:
                        self.assertEqual(
                            choose_directory("root"), Path(stdout.strip()) if code == 0 else None
                        )
                    self.assertEqual(run.call_args.args[0][0], "/usr/bin/osascript")
                    self.assertNotIn("shell", run.call_args.kwargs)
            with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("chooser", 55)):
                with self.assertRaisesRegex(ValueError, "timed out"):
                    choose_directory("project")
        with patch("platform.system", return_value="Linux"):
            with self.assertRaisesRegex(ValueError, "explicit --project"):
                choose_directory("root")

    def test_settings_locations_do_not_depend_on_plugin_or_working_directory(self):
        for system in ("Darwin", "Windows", "Linux"):
            with (
                patch("platform.system", return_value=system),
                patch.dict(os.environ, {}, clear=True),
            ):
                settings, cache = locations()
                self.assertTrue(settings.is_absolute())
                self.assertTrue(cache.is_absolute())
                self.assertNotEqual(settings, cache)
