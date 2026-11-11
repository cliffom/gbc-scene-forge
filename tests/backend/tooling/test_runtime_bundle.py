"""Frozen launcher directory grants and protocol/diagnostic separation."""

import importlib.util
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge.adapters.plugin.selection import Selection

SCRIPT = Path(__file__).resolve().parents[3] / "runtime/entry.py"
spec = importlib.util.spec_from_file_location("runtime_entry", SCRIPT)
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class RuntimeLauncherTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        self.projects = self.root / "projects café"
        self.projects.mkdir()

    def test_external_selection_resolves_symlinks_and_requires_separate_directory(self):
        alias = self.root / "alias"
        alias.symlink_to(self.bundle, target_is_directory=True)
        for selection in ("relative", self.root / "missing", self.bundle, alias, self.root):
            with self.subTest(selection=selection), self.assertRaises((ValueError, OSError)):
                entry.external_directory(selection, self.bundle)
        self.assertEqual(entry.external_directory(self.projects, self.bundle), self.projects)

    def test_plugin_excludes_entire_installation_around_nested_executable(self):
        nested = self.bundle / "runtime"
        nested.mkdir()
        (self.bundle / "plugin.json").write_text("{}")
        self.assertEqual(entry.plugin_directory(nested), self.bundle)
        selection = Selection(
            entry.plugin_directory(nested),
            settings=self.root / "settings",
            cache=self.root / "cache",
        )
        scratch = self.bundle / "scratch"
        scratch.mkdir()
        with self.assertRaisesRegex(ValueError, "separate locations"):
            selection.prepare(scratch, "root")

    def test_browser_uses_selection_for_logs_and_stderr_for_diagnostics(self):
        def serve(root, port, **kwargs):
            self.assertEqual(Path.cwd(), self.projects)
            self.assertEqual(root, self.projects)
            self.assertEqual(port, 0)
            self.assertEqual(kwargs, {"single_project": False, "open_browser": False})
            print("Browser diagnostics")

        cwd = Path.cwd()
        self.addCleanup(os.chdir, cwd)
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(sys, "executable", str(self.bundle / "forge")),
            patch("gbc_scene_forge.adapters.http.server.serve", side_effect=serve),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            self.assertEqual(
                entry.main(["browser", "--project-root", str(self.projects), "--no-browser"]), 0
            )
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("Browser diagnostics", stderr.getvalue())

    def test_missing_selection_invalid_port_and_browser_options_in_mcp_fail_cleanly(self):
        for args in (
            ["mcp"],
            ["browser"],
            ["mcp", "--project-root", str(self.projects), "--port", "0"],
            ["browser", "--project-root", str(self.projects), "--port", "65536"],
            ["mcp", "--plugin", "--project-root", str(self.projects)],
        ):
            stdout = io.StringIO()
            with (
                self.subTest(args=args),
                redirect_stdout(stdout),
                redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit) as caught,
            ):
                entry.main(args)
            self.assertEqual(caught.exception.code, 2)
            self.assertEqual(stdout.getvalue(), "")

    def test_plugin_starts_without_selection_and_keeps_stdout_for_sdk(self):
        selection = Selection(
            self.bundle, settings=self.root / "settings", cache=self.root / "cache"
        )

        async def run(session):
            self.assertIsNone(session.call("plugin_status", {})["selection"])

        with (
            patch.object(sys, "executable", str(self.bundle / "forge")),
            patch("gbc_scene_forge.adapters.plugin.selection.Selection", return_value=selection),
            patch("gbc_scene_forge.adapters.mcp.server.run", side_effect=run),
            redirect_stdout(io.StringIO()) as stdout,
        ):
            self.assertEqual(entry.main(["mcp", "--plugin"]), 0)
        self.assertEqual(stdout.getvalue(), "")
        self.assertFalse(selection.settings.exists())

    def test_plugin_browser_requires_selection_and_uses_managed_handoff(self):
        selection = Selection(
            self.bundle, settings=self.root / "settings", cache=self.root / "cache"
        )
        cwd = Path.cwd()
        self.addCleanup(os.chdir, cwd)
        with (
            patch.object(sys, "executable", str(self.bundle / "forge")),
            patch("gbc_scene_forge.adapters.plugin.selection.Selection", return_value=selection),
        ):
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                entry.main(["browser", "--plugin"])
            self.assertEqual(caught.exception.code, 2)
            selection.save(selection.prepare(self.projects, "root"))
            from gbc_scene_forge.project.application import Project

            project = Project.create(self.projects / "design", "Design")
            with (
                patch("gbc_scene_forge.adapters.plugin.browser.BrowserManager.request") as request,
                redirect_stderr(io.StringIO()) as stderr,
                redirect_stdout(io.StringIO()) as stdout,
            ):
                request.return_value = {"url": "http://127.0.0.1:1234/"}
                self.assertEqual(
                    entry.main(["browser", "--plugin", "--project-name", "design", "--no-browser"]),
                    0,
                )
                self.assertEqual(request.call_args.args[0].root, project.root)
                self.assertIn("http://127.0.0.1:1234/", stderr.getvalue())
                self.assertEqual(stdout.getvalue(), "")
            record = selection.prepare(self.projects, "root")
            with (
                patch.object(selection, "load", side_effect=[record, record, None]),
                patch("gbc_scene_forge.adapters.plugin.browser.BrowserManager.request") as request,
                redirect_stderr(io.StringIO()) as stderr,
                self.assertRaises(SystemExit) as caught,
            ):
                entry.main(["browser", "--plugin", "--project-name", "design", "--no-browser"])
            self.assertEqual(caught.exception.code, 2)
            self.assertIn("another conversation", stderr.getvalue())
            request.assert_not_called()
