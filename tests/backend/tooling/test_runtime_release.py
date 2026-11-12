"""Release archive integrity, extraction and target-boundary regressions."""

import argparse
import hashlib
import importlib.util
import io
import json
import subprocess
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


provenance = load("provenance")
with patch.dict(sys.modules, {"package_plugin": load("package_plugin"), "provenance": provenance}):
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


class ReleaseProvenanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "checkout"
        self.repo.mkdir()
        self.git("init", "-q")
        self.source = self.repo / "source.py"
        self.source.write_text("original source\n")
        self.commit()

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
            cwd=self.repo,
            stderr=subprocess.PIPE,
        )

    def commit(self):
        self.git("add", "source.py")
        self.git("commit", "-qm", "Test source")

    def prepare(self, build_checkout=None):
        output = self.root / "candidate"
        archive = self.root / "candidate.tar.gz"
        archive.write_bytes(b"synthetic archive; native acceptance is mocked")
        bundle = {"config": {}, "os_libraries": [], "wheel_sha256": "a" * 64}
        if build_checkout is not None:
            bundle["build_checkout"] = build_checkout
            bundle["wheel_source_revision"] = None

        def accepted(*args):
            runtime = output / "relocated repository café/plugins/scene-forge/runtime"
            notices = runtime / "notices/python-packages"
            notices.mkdir(parents=True)
            (notices / "inventory.json").write_text("{}")
            (runtime / "bundle.json").write_text(json.dumps(bundle))
            (output / "archive-check.json").write_text("{}")
            return {"installation": {}, "native_client": "not run"}

        with (
            patch.object(release, "REPO", self.repo),
            patch.object(release, "package", return_value=(None, archive)),
            patch.object(release, "check_archive", side_effect=accepted),
        ):
            release.prepare(
                argparse.Namespace(
                    revision=provenance.checkout(self.repo)["revision"],
                    bundle=self.root / "runtime",
                    output=output,
                    python=Path(sys.executable),
                    codex=None,
                )
            )
        return json.loads((output / "release.json").read_text())

    def test_old_runtime_keeps_its_build_checkout_after_packaging_source_changes(self):
        build_checkout = provenance.checkout(self.repo)
        self.source.write_text("new committed source\n")
        self.commit()
        self.source.write_text("new dirty source\n")
        diff = self.git("diff", "--binary", "HEAD")
        report = self.prepare(build_checkout)
        self.assertEqual(report["schema_version"], 2)
        self.assertEqual(report["runtime_build_checkout"], build_checkout)
        self.assertEqual(report["runtime"]["build_checkout"], build_checkout)
        self.assertFalse(report["runtime_build_checkout"]["tracked_source_dirty"])
        packaging = report["packaging_checkout"]
        self.assertNotEqual(packaging["revision"], build_checkout["revision"])
        self.assertTrue(packaging["tracked_source_dirty"])
        self.assertEqual(packaging["tracked_source_diff_sha256"], hashlib.sha256(diff).hexdigest())
        self.assertIsNone(report["wheel_source_revision"])
        self.assertNotIn("source_revision", report)
        self.assertNotIn("tracked_source_dirty", report)

    def test_legacy_bundle_provenance_stays_unknown_in_a_clean_packaging_checkout(self):
        report = self.prepare()
        self.assertFalse(report["packaging_checkout"]["tracked_source_dirty"])
        self.assertIsNone(report["runtime_build_checkout"])
        self.assertIsNone(report["wheel_source_revision"])
        self.assertNotIn("source_revision", report)

    def test_exported_source_tree_has_unknown_checkout_provenance(self):
        exported = self.root / "exported"
        exported.mkdir()
        self.assertIsNone(provenance.checkout(exported))

    def test_nested_export_does_not_inherit_ancestor_checkout_provenance(self):
        (self.repo / ".git/info/exclude").write_text("build/\n")
        exported = self.repo / "build/exported"
        exported.mkdir(parents=True)
        (exported / "source.py").write_text("unrelated exported source\n")
        self.assertEqual(self.git("status", "--porcelain"), b"")
        self.assertFalse(provenance.checkout(self.repo)["tracked_source_dirty"])
        self.assertIsNone(provenance.checkout(exported))

    def test_symlink_to_checkout_preserves_provenance(self):
        alias = self.root / "alias"
        alias.symlink_to(self.repo, target_is_directory=True)
        self.assertEqual(provenance.checkout(alias), provenance.checkout(self.repo))


if __name__ == "__main__":
    unittest.main()
