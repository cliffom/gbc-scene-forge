"""Fail closed on incomplete updates and incompatible installed plugin combinations."""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge import __version__
from gbc_scene_forge.adapters.plugin import distribution
from gbc_scene_forge.adapters.plugin.selection import Selection
from gbc_scene_forge.adapters.plugin.session import PluginSession
from gbc_scene_forge.project.application import Project

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("package_plugin", REPO / "runtime/package_plugin.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PluginDistributionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        (self.bundle / "forge").write_text("synthetic binary")
        (self.bundle / "bundle.json").write_text(
            json.dumps({"version": __version__, "target": "macos-arm64"})
        )
        self.addCleanup(patch.stopall)
        patch.object(distribution.platform, "system", return_value="Darwin").start()
        patch.object(distribution.platform, "machine", return_value="arm64").start()
        patch.object(distribution.platform, "mac_ver", return_value=("27.0.1", (), "")).start()
        patch.object(
            packager.subprocess,
            "check_output",
            return_value=json.dumps({"runtime_version": __version__}),
        ).start()

    def package(self, output="output"):
        destination, archive = packager.package(self.bundle, self.root / output)
        return destination / "plugins/scene-forge", archive

    def test_complete_relocated_archive_and_stable_discovery(self):
        plugin, archive = self.package()
        installed = distribution.verify(plugin)
        self.assertEqual(installed["runtime_version"], __version__)
        self.assertEqual(installed["plugin"], "scene-forge")
        self.assertTrue((plugin / "skills/forge-start/SKILL.md").is_file())
        self.assertEqual(
            json.loads((plugin / "mcp.json").read_text())["mcpServers"]["forge"]["args"],
            ["mcp", "--plugin"],
        )
        extracted = self.root / "extracted café"
        shutil.unpack_archive(archive, extracted, filter="data")
        moved = next(extracted.iterdir()) / "plugins/scene-forge"
        self.assertEqual(distribution.verify(moved), installed)
        # Skills and their local references must travel together, without checkout access.
        self.assertTrue(
            {"forge-start", "forge-artwork", "forge-animation", "forge-scenes"}
            <= {p.name for p in (moved / "skills").iterdir()}
        )
        for source in (REPO / "plugin/skills").rglob("*"):
            if source.is_file():
                packaged = moved / "skills" / source.relative_to(REPO / "plugin/skills")
                self.assertEqual(packaged.read_bytes(), source.read_bytes())
        self.assertTrue((moved / "bin/forge").stat().st_mode & 0o100)
        with self.assertRaisesRegex(ValueError, "never replace"):
            self.package()

    def test_interrupted_packaging_does_not_publish_or_change_previous_version(self):
        plugin, _ = self.package()
        before = distribution.inventory(plugin)
        with patch.object(packager.shutil, "copytree", side_effect=OSError("interrupted")):
            with self.assertRaisesRegex(OSError, "interrupted"):
                self.package("interrupted")
        self.assertEqual(list((self.root / "interrupted").iterdir()), [])
        self.assertEqual(distribution.inventory(plugin), before)

    def test_missing_modified_permissions_and_external_link_reject_without_settings_writes(self):
        plugin, _ = self.package()
        selection = Selection(plugin, settings=self.root / "settings", cache=self.root / "cache")
        skill = plugin / "skills/forge-start/SKILL.md"
        original = skill.read_bytes()
        skill.write_bytes(original + b"mixed update")
        with self.assertRaisesRegex(ValueError, "changed plugin"):
            PluginSession(selection)
        self.assertFalse(selection.settings.parent.exists())
        skill.write_bytes(original)
        (plugin / "bin/forge").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            distribution.verify(plugin)
        (plugin / "bin/forge").chmod(0o755)
        (plugin / "external").symlink_to(self.bundle / "forge")
        with self.assertRaisesRegex(ValueError, "external symlink"):
            distribution.verify(plugin)
        (plugin / "external").unlink()
        (plugin / "install.json").unlink()
        with self.assertRaisesRegex(ValueError, "Restore the complete"):
            distribution.verify(plugin)
        (plugin / "plugin.json").unlink()
        with self.assertRaisesRegex(ValueError, "Restore the complete"):
            distribution.verify(plugin)

    def test_external_installation_receipt_is_rejected(self):
        plugin, _ = self.package()
        receipt = plugin / "install.json"
        external = self.root / "external-receipt.json"
        receipt.rename(external)
        receipt.symlink_to(external)
        with self.assertRaisesRegex(ValueError, "receipt must not be a symlink"):
            distribution.verify(plugin)

    def test_runtime_format_and_host_incompatibility_rejected(self):
        plugin, _ = self.package()
        path = plugin / "compatibility.json"
        original = json.loads(path.read_text())
        for key, value in (
            ("runtime_version", "future"),
            ("project_format", 2),
            ("selection_format", 2),
            ("target", "linux-x64"),
        ):
            path.write_text(json.dumps({**original, key: value}))
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "Incompatible"):
                distribution.verify(plugin)
        path.write_text(json.dumps(original))
        with patch.object(distribution.platform, "machine", return_value="x86_64"):
            with self.assertRaisesRegex(ValueError, "Apple Silicon"):
                distribution.verify(plugin)
        with patch.object(distribution.platform, "mac_ver", return_value=("26.0", (), "")):
            with self.assertRaisesRegex(ValueError, "27.0"):
                distribution.verify(plugin)

    def test_live_session_detects_cache_replacement_before_setup_mutation(self):
        plugin, _ = self.package()
        selection = Selection(plugin, settings=self.root / "settings", cache=self.root / "cache")
        session = PluginSession(selection, chooser=lambda _: self.root)
        (plugin / "mcp.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "changed plugin"):
            session.call("plugin_choose_location", {"mode": "root"})
        self.assertFalse(selection.settings.parent.exists())

    def test_unchanged_session_and_browser_calls_do_not_rehash_installation(self):
        plugin, _ = self.package()
        project = Project.create(self.root / "projects/design", "Design")
        selection = Selection(plugin, settings=self.root / "settings", cache=self.root / "cache")
        selection.save(selection.prepare(project.root, "project"))
        session = PluginSession(selection)
        with patch.object(distribution, "inventory", side_effect=AssertionError("Rehashed")):
            for _ in range(3):
                self.assertEqual(
                    session.call("plugin_status", {})["installation"], session.installation
                )
                self.assertTrue(session.call("list_projects", {})["projects"])
                self.assertFalse(
                    session.call("plugin_browser", {"project": "project", "action": "status"})[
                        "running"
                    ]
                )
        # A new session still validates all bytes even with another session alive.
        with patch.object(distribution, "inventory", wraps=distribution.inventory) as inventory:
            PluginSession(selection)
            self.assertGreater(inventory.call_count, 0)

    def test_guard_invalidates_for_content_receipt_links_modes_and_tree_changes(self):
        def rewrite_preserving_mtime(plugin):
            path = plugin / "runtime/forge"
            info = path.stat()
            path.write_bytes(b"X" + path.read_bytes()[1:])
            os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns))

        def replace_file(plugin):
            path = plugin / "runtime/forge"
            replacement = plugin / "replacement"
            replacement.write_text("corrupt replacement")
            replacement.replace(path)

        def replace_link(plugin):
            path = plugin / "runtime/forge"
            path.unlink()
            path.symlink_to(self.bundle / "forge")

        for index, mutate in enumerate(
            (
                rewrite_preserving_mtime,
                replace_file,
                replace_link,
                lambda p: (p / "bin/forge").chmod(0o644),
                lambda p: (p / "install.json").write_text("{}"),
                lambda p: (p / "skills/forge-start/SKILL.md").unlink(),
                lambda p: (p / "skills/added").write_text("mixed installation"),
                lambda p: shutil.rmtree(p),
            )
        ):
            with self.subTest(mutate=index):
                plugin, _ = self.package(f"mutation-{index}")
                guard = distribution.InstallationGuard(plugin)
                mutate(plugin)
                with self.assertRaises(ValueError):
                    guard.check()

    def test_metadata_only_changes_revalidate_once_and_keep_pinned_identity(self):
        plugin, _ = self.package()
        guard = distribution.InstallationGuard(plugin)
        path = plugin / "runtime/forge"
        info = path.stat()
        os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
        with patch.object(distribution, "inventory", wraps=distribution.inventory) as inventory:
            guard.check()
            self.assertEqual(inventory.call_count, 1)
            guard.check()
            self.assertEqual(inventory.call_count, 1)
        self.assertEqual(guard.identity, distribution.verify(plugin))

    def test_guard_rejects_replaced_build_with_a_valid_receipt(self):
        plugin, _ = self.package()
        guard = distribution.InstallationGuard(plugin)
        (plugin / "runtime/forge").write_text("a different complete build")
        receipt_path = plugin / "install.json"
        receipt = json.loads(receipt_path.read_text())
        receipt["files"] = distribution.inventory(plugin)
        receipt["build_id"] = distribution.build_id(receipt["files"])
        receipt_path.write_text(json.dumps(receipt))
        self.assertNotEqual(distribution.verify(plugin), guard.identity)
        with self.assertRaisesRegex(ValueError, "installation changed"):
            guard.check()

    def test_changes_during_verification_are_never_cached_as_valid(self):
        plugin, _ = self.package()
        original_inventory = distribution.inventory

        def interrupted_inventory(root):
            result = original_inventory(root)
            (root / "runtime/forge").write_text("changed after hashing")
            return result

        with patch.object(distribution, "inventory", side_effect=interrupted_inventory):
            with self.assertRaisesRegex(ValueError, "installation changed"):
                distribution.InstallationGuard(plugin)

    def test_removed_installation_during_startup_does_not_become_standalone(self):
        plugin, _ = self.package()
        original_verify = distribution.verify

        def removed_installation(root):
            shutil.rmtree(root)
            return original_verify(root)

        with patch.object(distribution, "verify", side_effect=removed_installation):
            with self.assertRaisesRegex(ValueError, "installation changed"):
                distribution.InstallationGuard(plugin)

    def test_standalone_guards_do_not_scan_or_hash_the_runtime(self):
        guard = distribution.InstallationGuard(self.bundle)  # Standalone roots remain unguarded.
        self.assertIsNone(guard.identity)
        with patch.object(
            distribution, "metadata", side_effect=AssertionError("Scanned standalone")
        ):
            guard.check()

    def test_packaging_refuses_metadata_binary_mismatch(self):
        with patch.object(
            packager.subprocess,
            "check_output",
            return_value=json.dumps({"runtime_version": "future"}),
        ):
            with self.assertRaisesRegex(ValueError, "executable"):
                self.package()

    def test_launcher_reports_incomplete_install_without_stdout(self):
        plugin = self.root / "unpacked plugin"
        shutil.copytree(REPO / "plugin", plugin)
        result = subprocess.run(
            ["/bin/sh", plugin / "bin/forge", "mcp", "--plugin"], capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertTrue(
            "incomplete installation" in result.stderr
            or "matching platform bundle" in result.stderr
        )
