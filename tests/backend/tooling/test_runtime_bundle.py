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
