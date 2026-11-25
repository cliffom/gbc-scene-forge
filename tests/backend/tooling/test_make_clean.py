"""Build cleanup removes read-only bundles without changing shared file modes."""

import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

MAKEFILE = Path(__file__).resolve().parents[3] / "Makefile"


@unittest.skipUnless(os.name == "posix" and shutil.which("make"), "Requires POSIX Make")
class MakeCleanTests(unittest.TestCase):
    def test_removes_read_only_bundle_without_changing_hard_link_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout = root / "checkout"
            bundle = checkout / "build" / "runtime bundle" / "nested"
            bundle.mkdir(parents=True)
            cached_file = root / "cache-entry"
            cached_file.write_text("Shared cache content")
            cached_file.chmod(0o400)
            (bundle / "shared-file").hardlink_to(cached_file)
            for directory in (bundle, bundle.parent, bundle.parent.parent):
                directory.chmod(0o500)

            subprocess.run(["make", "-f", str(MAKEFILE), "clean"], cwd=checkout, check=True)

            self.assertFalse((checkout / "build").exists())
            self.assertEqual(stat.S_IMODE(cached_file.stat().st_mode), 0o400)
            self.assertEqual(cached_file.read_text(), "Shared cache content")
