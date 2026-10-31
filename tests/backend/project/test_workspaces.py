"""Project-root discovery, schema safety, HTTP isolation, and launcher behavior."""

import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from gbc_scene_forge.__main__ import main
from gbc_scene_forge.adapters.http.server import make_handler, make_root_handler
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.project.workspaces import ProjectRoot, slug
from gbc_scene_forge.storage import transactions


class ProjectRootTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "projects"
        self.workspace = ProjectRoot(self.root)

    def test_named_projects_are_portable_and_discovered_without_a_registry(self):
        self.assertEqual(self.workspace.create("Hello World"), "hello-world")
        self.assertEqual(self.workspace.create("Café Garden"), "cafe-garden")
        projects = self.workspace.catalog()["projects"]
        self.assertEqual([p["name"] for p in projects], ["Café Garden", "Hello World"])
        original = Project(self.root / "hello-world").catalog()["project"]
        self.assertEqual(original["version"], 1)
        (self.root / "hello-world").rename(self.root / "moved world")
        moved = Project(self.workspace.path("moved world")).catalog()["project"]
        self.assertEqual(moved, original)
        self.assertEqual(len(list(self.root.iterdir())), 2)

    def test_idle_catalog_uses_signatures_and_revalidates_changed_manifests(self):
        self.workspace.create("World")
        expected = self.workspace.catalog()
        with patch.object(Project, "read", side_effect=AssertionError("Idle read")):
            for _ in range(20):
                self.assertEqual(self.workspace.catalog(), expected)
        manifest = self.root / "world" / MANIFEST
        original = manifest.read_bytes()
        manifest.write_text("invalid")
        invalid = self.workspace.catalog()
        self.assertEqual(invalid["projects"], [])
        self.assertEqual(invalid["unavailable"][0]["directory"], "world")
        with patch.object(Project, "read", side_effect=AssertionError("Idle invalid read")):
            self.assertEqual(self.workspace.catalog(), invalid)
        manifest.write_bytes(original)
        self.assertEqual(self.workspace.catalog(), expected)

    def test_slug_validation_and_collisions_preserve_existing_contents(self):
        self.assertEqual(slug("  Hello, WORLD!  "), "hello-world")
        for title in ("", "...", "你好", "../outside", "a/b", "a\\b", None):
            with self.subTest(title=title), self.assertRaises(ValueError):
                self.workspace.create(title)
        self.workspace.create("Hello World")
        before = (self.root / "hello-world" / MANIFEST).read_bytes()
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.workspace.create("HELLO--world")
        self.assertEqual((self.root / "hello-world" / MANIFEST).read_bytes(), before)
        (self.root / "empty").mkdir()
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.workspace.create("Empty")

    def test_discovery_skips_unrelated_and_symlinked_directories_reports_invalid(self):
        (self.root / "notes").mkdir()
        outside = self.root.parent / "outside"
        Project.create(outside, "Outside")
        (self.root / "shortcut").symlink_to(outside, target_is_directory=True)
        invalid = self.root / "broken"
        invalid.mkdir()
        (invalid / MANIFEST).write_text("not json")
        future = self.root / "future"
        future.mkdir()
        (future / MANIFEST).write_text('{"version": 99}')
        before = sorted(str(p.relative_to(self.root)) for p in self.root.rglob("*"))
        catalog = self.workspace.catalog()
        self.assertEqual(catalog["projects"], [])
        self.assertEqual([p["directory"] for p in catalog["unavailable"]], ["broken", "future"])
        self.assertIn("version", catalog["unavailable"][1]["error"])
        self.assertEqual(
            sorted(str(p.relative_to(self.root)) for p in self.root.rglob("*")), before
        )
        for directory in ("../outside", "/tmp", ".", "..", "a/b", "a\\b", "shortcut"):
            with self.subTest(directory=directory), self.assertRaises(ValueError):
                self.workspace.path(directory)

    def test_future_schema_is_rejected_before_recovery_writes(self):
        project = Project.create(self.root / "future", "Future")
        manifest = project.root / MANIFEST
        document = json.loads(manifest.read_bytes())
        document["version"] = 2
        manifest.write_text(json.dumps(document))
        before = {str(p): p.read_bytes() for p in project.root.rglob("*") if p.is_file()}
        with patch("gbc_scene_forge.storage.transactions.Transactions.recover") as recover:
            for open_project in (
                lambda: Project(project.root),
                lambda: make_handler(project.root, "t"),
            ):
                with self.assertRaisesRegex(ValueError, "Unsupported project version"):
                    open_project()
            recover.assert_not_called()
        self.assertEqual(
            {str(p): p.read_bytes() for p in project.root.rglob("*") if p.is_file()}, before
        )

    def test_interrupted_named_creation_can_be_retried_without_claiming_other_folders(self):
        manifest = self.root / "hello-world" / MANIFEST
        original = transactions.atomic_write

        def fail_install(path, data):
            if path == manifest:
                raise OSError("process exited")
            original(path, data)

        with (
            patch.object(transactions, "atomic_write", side_effect=fail_install),
            patch.object(
                transactions.Transactions, "_restore", side_effect=OSError("process exited")
            ),
        ):
            with self.assertRaises(OSError):
                self.workspace.create("Hello World")
        self.assertFalse(manifest.exists())
        self.assertEqual(ProjectRoot(self.root).create("Hello World"), "hello-world")
        self.assertEqual(Project(manifest.parent).read()[0]["name"], "Hello World")
        unrelated = self.root / "unrelated" / ".forge"
        unrelated.mkdir(parents=True)
        (unrelated / "keep.txt").write_text("Keep me")
        with self.assertRaises(ValueError):
            self.workspace.create("Unrelated")
        self.assertEqual((unrelated / "keep.txt").read_text(), "Keep me")

    def test_sample_creation_is_named_isolated_and_never_overwrites(self):
        from gbc_scene_forge.project.sample import template_path

        source = template_path()
        before = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
        self.workspace.create("My first scene", starter="sample")
        self.workspace.create("Another sample", starter="sample")
        project = Project(self.root / "my-first-scene")
        other = Project(self.root / "another-sample")
        document = project.catalog()["project"]
        self.assertEqual(document["name"], "My first scene")
        self.assertNotEqual(document["id"], other.catalog()["project"]["id"])
        self.assertEqual(len(document["scenes"]), 2)
        scene = project.scenes.load(document["scenes"][0]["id"])
        scene["scene"]["layers"][0]["cells"][0][0] = "sample/path/0/0"
        project.scenes.save(
            scene["id"], scene["scene"], scene["revision"], project.catalog()["revision"]
        )
        self.assertNotEqual(project.scenes.load(scene["id"]), other.scenes.load(scene["id"]))
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.workspace.create("My first scene", starter="sample")
        for starter in ("unknown", None, True, {}):
            with self.subTest(starter=starter), self.assertRaises(ValueError):
                self.workspace.create("Invalid", starter=starter)
        self.assertFalse((self.root / "invalid").exists())
        self.assertEqual(
            {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()},
            before,
        )

    def test_a_project_is_not_silently_treated_as_a_root(self):
        self.workspace.create("Existing")
        with self.assertRaisesRegex(ValueError, "--project"):
            ProjectRoot(self.root / "existing")

    def test_launcher_defaults_and_explicit_modes(self):
        cases = [
            ([], Path(".forge_project"), False),
            (["--project-root", "worlds"], Path("worlds"), False),
            (["worlds"], Path("worlds"), False),
            (["--project", "old-world"], Path("old-world"), True),
        ]
        for args, root, single in cases:
            with (
                self.subTest(args=args),
                patch("sys.argv", ["forge", *args]),
                patch("gbc_scene_forge.adapters.cli.serve") as serve,
            ):
                main()
                serve.assert_called_once_with(root, 8765, single_project=single, open_browser=True)
        with (
            patch("sys.argv", ["forge", "--no-browser", "--port", "0"]),
            patch("gbc_scene_forge.adapters.cli.serve") as serve,
        ):
            main()
            serve.assert_called_once_with(
                Path(".forge_project"), 0, single_project=False, open_browser=False
            )
        for port in ("-1", "65536"):
            with patch("sys.argv", ["forge", "--port", port]), self.assertRaises(SystemExit):
                main()
        with patch("sys.argv", ["forge", "worlds", "--project", "old"]):
            with self.assertRaises(SystemExit):
                main()


class ProjectRootHttpTests(unittest.TestCase):
    def test_concurrent_scoped_reads_initialize_recovery_once(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            project = Project.create(root / "world", "World")
            server = ThreadingHTTPServer(("127.0.0.1", 0), make_root_handler(root, "secret"))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/projects/world"

                def read(index):
                    route = ("/", "/api/project", "/style.css")[index % 3]
                    with urlopen(url + route, timeout=5) as response:
                        self.assertEqual(response.status, 200)
                        return response.read()

                recover = transactions.Transactions.recover
                with patch.object(transactions.Transactions, "recover", autospec=True) as recovery:
                    recovery.side_effect = recover
                    with ThreadPoolExecutor(max_workers=4) as pool:
                        results = list(pool.map(read, range(40)))
                    self.assertTrue(all(results))
                    recovery.assert_called_once()
                    # Static pages do not rerun recovery while a writer holds the lock.
                    with project.transactions.locked():
                        read(0)
                    recovery.assert_called_once()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_scoped_requests_tokens_conflicts_and_multiple_tabs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "projects"
            server = ThreadingHTTPServer(("127.0.0.1", 0), make_root_handler(root, "secret"))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}"

                def request(path, body=None, token="secret", host=None):
                    headers = {"Content-Type": "application/json", "X-Scene-Token": token}
                    if host:
                        headers["Host"] = host
                    with urlopen(
                        Request(
                            url + path,
                            data=None if body is None else json.dumps(body).encode(),
                            headers=headers,
                        ),
                        timeout=5,
                    ) as response:
                        return json.load(response)

                for kwargs in ({"token": "bad"}, {"host": "remote.example"}):
                    with self.assertRaises(HTTPError) as error:
                        request("/api/create-project", {"name": "Hello World"}, **kwargs)
                    self.assertEqual(error.exception.code, 403)
                for title in ("Hello World", "Another World"):
                    request("/api/create-project", {"name": title})
                request("/api/create-project", {"name": "Starter", "starter": "sample"})
                starter = request("/projects/starter/api/project")["project"]
                self.assertEqual(starter["name"], "Starter")
                self.assertEqual(len(starter["scenes"]), 2)
                with self.assertRaises(HTTPError) as error:
                    request("/api/create-project", {"name": "Invalid", "starter": "bad"})
                self.assertEqual(error.exception.code, 400)
                first = "/projects/hello-world/api/"
                second = "/projects/another-world/api/"
                a = request(first + "project")
                b = request(second + "project")
                payload = {
                    "name": "Village",
                    "width": 2,
                    "height": 2,
                    "grid": 8,
                    "project_revision": a["revision"],
                }
                for path, kwargs, status in (
                    (second + "create-scene", {}, 409),
                    (first + "create-scene", {"token": "bad"}, 403),
                ):
                    with self.assertRaises(HTTPError) as error:
                        request(path, payload, **kwargs)
                    self.assertEqual(error.exception.code, status)
                scene = request(first + "create-scene", payload)
                self.assertEqual(request(second + "project"), b)
                self.assertEqual(request(first + "scene/" + scene["id"])["name"], "Village")
                with self.assertRaises(HTTPError):
                    request(second + "scene/" + scene["id"])
                self.assertEqual(len(request("/api/project")["projects"]), 3)
                self.assertEqual(request("/api/project")["project_root"], str(root))
                self.assertEqual(
                    request(first + "project")["project_path"], str(root / "hello-world")
                )
                with self.assertRaises(HTTPError):
                    request("/projects/%2e%2e/api/project")
                # A request from the first tab remains scoped after another tab opens B.
                current = request(first + "project")
                request(
                    first + "create-scene",
                    {**payload, "name": "Forest", "project_revision": current["revision"]},
                )
                self.assertEqual(len(request(first + "project")["project"]["scenes"]), 2)
                self.assertEqual(request(second + "project"), b)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
