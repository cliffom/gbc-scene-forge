"""Release archive integrity, extraction and target-boundary regressions."""

import importlib.util
import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[3]


def load(name):
    spec = importlib.util.spec_from_file_location(name, REPO / f"runtime/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with patch.dict(sys.modules, {"package_plugin": load("package_plugin")}):
    release = load("release")


class ReleaseArchiveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / "candidate.tar.gz"

    def archive_with(self, name, data=b"candidate"):
        with tarfile.open(self.archive, "w:gz") as stream:
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            stream.addfile(entry, io.BytesIO(data))

    def test_digest_checked_before_extraction(self):
        self.archive_with("repository/file")
        destination = self.root / "extracted"
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            release.extract(self.archive, "0" * 64, destination)
        self.assertFalse(destination.exists())

    def test_traversal_rejected_without_writing_outside_destination(self):
        self.archive_with("../escaped")
        with self.assertRaises(tarfile.FilterError):
            release.extract(self.archive, release.digest(self.archive), self.root / "extracted")
        self.assertFalse((self.root / "escaped").exists())

    def test_external_symlinks_rejected(self):
        with tarfile.open(self.archive, "w:gz") as stream:
            link = tarfile.TarInfo("repository/external")
            link.type = tarfile.SYMTYPE
            link.linkname = "/tmp/forge-external"
            stream.addfile(link)
        with self.assertRaises(tarfile.FilterError):
            release.extract(self.archive, release.digest(self.archive), self.root / "extracted")

    def test_modes_and_internal_symlinks_survive_extraction(self):
        source = self.root / "repository café"
        source.mkdir()
        executable = source / "forge"
        executable.write_bytes(b"candidate")
        executable.chmod(0o755)
        (source / "alias").symlink_to("forge")
        with tarfile.open(self.archive, "w:gz") as stream:
            stream.add(source, arcname=source.name)
        extracted = release.extract(
            self.archive, release.digest(self.archive), self.root / "new path café"
        )
        self.assertEqual((extracted / "forge").stat().st_mode & 0o777, 0o755)
        self.assertTrue((extracted / "alias").is_symlink())
        self.assertEqual((extracted / "alias").read_bytes(), b"candidate")

    def test_native_discovery_includes_extensionless_files_but_not_aliases(self):
        (self.root / "Python").write_bytes(b"\xcf\xfa\xed\xfepayload")
        (self.root / "ordinary.so").write_bytes(b"not Mach-O")
        (self.root / "alias").symlink_to("Python")
        self.assertEqual(release.native_files(self.root), [self.root / "Python"])


if __name__ == "__main__":
    unittest.main()
