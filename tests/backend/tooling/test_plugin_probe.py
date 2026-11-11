"""The experimental launcher cannot silently widen its selected project grant."""

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[3] / "examples/plugin_probe/entry.py"
spec = importlib.util.spec_from_file_location("plugin_probe_entry", SCRIPT)
entry = importlib.util.module_from_spec(spec)
with patch.object(sys, "path", list(sys.path)):
    spec.loader.exec_module(entry)


class PluginProbeSelectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.bundle = self.root / "plugin"
        self.bundle.mkdir()
        self.project_root = self.root / "projects café"
        self.project_root.mkdir()
        self.settings = self.root / "selection.json"
        self.settings.write_text(json.dumps({"project_root": str(self.project_root)}))
        self.patcher = patch.object(entry, "__file__", str(self.bundle / "runtime/entry.py"))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_explicit_external_selection_is_read_without_writes(self):
        before = self.settings.read_bytes()
        self.assertEqual(entry.selection(str(self.settings)), (self.settings, self.project_root))
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertEqual(list(self.project_root.iterdir()), [])

    def test_missing_relative_unavailable_or_bundled_selections_fail(self):
        for value in (None, "selection.json"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                entry.selection(value)
        internal = self.bundle / "selection.json"
        internal.write_text(self.settings.read_text())
        with self.assertRaisesRegex(ValueError, "outside"):
            entry.selection(str(internal))
        for root in (self.root / "missing", self.bundle):
            self.settings.write_text(json.dumps({"project_root": str(root)}))
            with self.subTest(root=root), self.assertRaises(ValueError):
                entry.selection(str(self.settings))

    def test_symlink_cannot_hide_a_project_root_inside_the_plugin(self):
        alias = self.root / "alias"
        alias.symlink_to(self.bundle, target_is_directory=True)
        self.settings.write_text(json.dumps({"project_root": str(alias)}))
        with self.assertRaisesRegex(ValueError, "outside"):
            entry.selection(str(self.settings))

    def test_arguments_cannot_override_the_project_root(self):
        for argument in ("--project-root=/tmp", "--project=/tmp", "--project-root", "/tmp"):
            with (
                self.subTest(argument=argument),
                patch.object(sys, "argv", ["forge", "browser", argument]),
                redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit) as caught,
            ):
                entry.main()
            self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
