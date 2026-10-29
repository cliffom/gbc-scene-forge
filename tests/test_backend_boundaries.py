"""Public backend contracts: isolated imports, coherent reads and shared editing."""

import ast
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from atlas_fixture import bundle

from gbc_scene_forge.adapters.http.routes import ProjectAPI
from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.core.errors import Conflict, InvalidRequest, TransactionBusy
from gbc_scene_forge.project.application import Project


class BackendBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = Project.create(self.root / "world", "World", starter="blockout")
        self.loaded = self.project.planning.create_blockout(
            "Plan", {}, self.project.catalog()["revision"]
        )

    def test_sample_creation_requires_a_project_name_before_touching_storage(self):
        target = self.root / "new-sample"
        with self.assertRaises(InvalidRequest):
            ProjectAPI(target, None).post("/api/create-project", {"starter": "sample"})
        self.assertFalse(target.exists())

    def test_read_session_blocks_other_writers_and_expires(self):
        writer = Project(self.project.root)
        revision = self.project.catalog()["revision"]
        with self.project.store.read_session(revision) as session:
            saved = session.scene(self.loaded["id"])
            self.assertEqual(saved, self.loaded)
            with self.assertRaises(TransactionBusy):
                writer.scenes.save(saved["id"], saved["scene"], saved["revision"], revision)
            self.assertEqual(session.scene(saved["id"]), saved)
        for read in (lambda: session.scene(saved["id"]), session.catalog):
            with self.assertRaisesRegex(RuntimeError, "session has ended"):
                read()
        # An exception leaving a read scope must also release its filesystem lock.
        with self.assertRaisesRegex(RuntimeError, "consumer failed"):
            with self.project.store.read_session():
                raise RuntimeError("consumer failed")
        self.assertEqual(
            writer.scenes.save(saved["id"], saved["scene"], saved["revision"], revision)["scene"],
            saved["scene"],
        )

    def test_guarded_reads_reject_changed_manifest_and_assets(self):
        revision = self.project.catalog()["revision"]
        writer = Project(self.project.root)
        writer.scenes.rename(self.loaded["id"], "Changed", self.loaded["revision"], revision)
        with self.assertRaises(Conflict):
            with self.project.store.read_session(revision):
                self.fail("Stale manifest was admitted")
        path, _ = bundle(self.root / "art")
        self.project.artwork.import_atlas(path, self.project.catalog()["revision"])
        png = self.project.root / "assets/terrain/atlas.png"
        png.write_bytes(png.read_bytes() + b"tampered")
        with self.assertRaisesRegex(Conflict, "asset changed"):
            with self.project.store.read_session(
                self.project.catalog()["revision"], verify_assets=True
            ):
                self.fail("Changed asset was admitted")

    def test_http_and_mcp_share_native_candidate_and_save_contract(self):
        revision = self.project.catalog()["revision"]
        adapter = Adapter(self.project.root, single_project=True)
        arguments = {
            "project": "project",
            "project_revision": revision,
            "scene_id": self.loaded["id"],
            "scene_revision": self.loaded["revision"],
            "operations": [{"op": "update", "object_id": 1, "changes": {"x": 8}}],
            "dry_run": True,
        }
        with self.assertRaises(Conflict):
            adapter.call("edit_scene", {**arguments, "project_revision": None})
        preview = adapter.call("edit_scene", arguments)
        self.assertEqual(self.project.scenes.load(self.loaded["id"]), self.loaded)
        response = ProjectAPI(self.project.root, self.project).post(
            "/api/save-scene",
            {
                "id": self.loaded["id"],
                "scene": preview["scene"],
                "revision": self.loaded["revision"],
                "project_revision": revision,
            },
        )
        self.assertEqual(response.body["scene"], preview["scene"])
        self.assertEqual(response.body["project_revision"], revision)
        with self.assertRaises(Conflict):
            adapter.call("edit_scene", arguments)
        snapshot = adapter.call("get_scene", {"project": "project", "scene_id": self.loaded["id"]})
        self.assertEqual(snapshot["scene"], response.body["scene"])
        self.assertEqual(snapshot["revision"], response.body["revision"])
        self.assertEqual(snapshot["project_revision"], revision)

    def test_supported_imports_do_not_initialize_storage_network_legacy_or_sdk(self):
        code = """
import pathlib, socket, sys
from unittest.mock import patch
with patch.object(pathlib.Path, 'mkdir', side_effect=AssertionError('directory creation on import')), \
     patch.object(socket.socket, 'bind', side_effect=AssertionError('socket bind on import')), \
     patch.object(socket.socket, 'connect', side_effect=AssertionError('socket connect on import')):
    import gbc_scene_forge.adapters.cli
    import gbc_scene_forge.mcp_server
    import gbc_scene_forge.adapters.http.server
    import gbc_scene_forge.adapters.mcp.server
    import gbc_scene_forge.project.application
    import gbc_scene_forge.scenes.service
assert not any(n == 'mcp' or n.startswith('mcp.') for n in sys.modules)
assert not any(n.startswith('gbc_scene_forge.legacy') for n in sys.modules)
"""
        subprocess.run([sys.executable, "-c", code], cwd=self.root, check=True, timeout=10)

    def test_supported_import_graph_is_acyclic_and_domains_do_not_import_adapters(self):
        import gbc_scene_forge

        root = Path(gbc_scene_forge.__file__).parent
        modules = {}
        for path in root.rglob("*.py"):
            relative = path.relative_to(root).with_suffix("")
            if "legacy" in relative.parts:
                continue
            name = "gbc_scene_forge." + ".".join(relative.parts)
            name = name.removesuffix(".__init__")
            modules[name] = (path, ast.parse(path.read_text()))
        edges = {name: set() for name in modules}
        for name, (path, tree) in modules.items():
            package = name if path.name == "__init__.py" else name.rpartition(".")[0]
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    target = (
                        importlib.util.resolve_name("." * node.level + (node.module or ""), package)
                        if node.level
                        else node.module or ""
                    )
                    self.assertNotIn("gbc_scene_forge.legacy", target, str(path))
                    if name.split(".")[1] not in ("adapters", "__main__", "mcp_server"):
                        self.assertFalse(target.startswith("gbc_scene_forge.adapters"), str(path))
            # Runtime module initialization must remain acyclic. Local lifecycle
            # factory imports are also subject to the ownership checks above.
            for node in tree.body:
                if not isinstance(node, ast.ImportFrom):
                    continue
                target = (
                    importlib.util.resolve_name("." * node.level + (node.module or ""), package)
                    if node.level
                    else node.module or ""
                )
                if target in modules:
                    edges[name].add(target)
                edges[name].update(
                    f"{target}.{alias.name}"
                    for alias in node.names
                    if f"{target}.{alias.name}" in modules
                )
        visited = set()

        def visit(name, stack):
            self.assertNotIn(name, stack, " -> ".join([*stack, name]))
            if name in visited:
                return
            for child in edges[name]:
                visit(child, [*stack, name])
            visited.add(name)

        for name in edges:
            visit(name, [])
