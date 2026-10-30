"""HTTP contract coverage for shared routing in direct and workspace modes."""

import io
import json
import tempfile
import unittest
from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from zipfile import ZipFile

from support.atlas_fixture import bundle

from gbc_scene_forge.adapters.http.common import STATIC
from gbc_scene_forge.adapters.http.server import make_handler, make_root_handler
from gbc_scene_forge.project.application import Project


class HttpRoutingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = Project.create(self.root / "world", "World")
        path, _ = bundle(self.root / "art")
        self.project.artwork.import_atlas(path, self.project.catalog()["revision"])

    @contextmanager
    def server(self, workspace=False, empty=False):
        root = self.root if workspace else self.root / ("empty" if empty else "world")
        handler = (make_root_handler if workspace else make_handler)(root, "secret")
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        worker = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        worker.start()
        try:
            yield server
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def request(self, server, route, data=None, *, method=None, headers=None):
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            connection.request(
                method or ("GET" if data is None else "POST"),
                route,
                body=None if data is None else json.dumps(data).encode(),
                headers={
                    "Content-Type": "application/json",
                    "X-Scene-Token": "secret",
                    **(headers or {}),
                },
            )
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_static_allowlist_contents_mime_and_response_security(self):
        # The expected list is independent of the implementation's registry.
        assets = {
            "/": ("project.html", "text/html"),
            "/project.js": ("project.js", "text/javascript"),
            "/project.js.map": ("project.js.map", "application/json"),
            "/project.css": ("project.css", "text/css"),
            "/style.css": ("style.css", "text/css"),
            "/branding/logo-64.png": ("branding/logo-64.png", "image/png"),
            "/branding/favicon-32.png": ("branding/favicon-32.png", "image/png"),
            "/branding/favicon-16.png": ("branding/favicon-16.png", "image/png"),
            "/apple-touch-icon.png": ("branding/apple-touch-icon.png", "image/png"),
            "/apple-touch-icon-precomposed.png": ("branding/apple-touch-icon.png", "image/png"),
        }
        for workspace in (False, True):
            with self.server(workspace) as server:
                for prefix in ("", "/projects/world") if workspace else ("",):
                    for route, (filename, mime) in assets.items():
                        with self.subTest(workspace=workspace, prefix=prefix, route=route):
                            status, headers, body = self.request(server, prefix + route + "?v=1")
                            self.assertEqual(status, 200)
                            self.assertEqual(body, STATIC.joinpath(filename).read_bytes())
                            charset = not workspace or bool(prefix)
                            expected = mime + (
                                "; charset=utf-8" if charset and mime != "image/png" else ""
                            )
                            self.assertEqual(headers["Content-Type"], expected)
                            self.assertEqual(int(headers["Content-Length"]), len(body))
                            self.assertEqual(headers["Cache-Control"], "no-store")
                            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                            self.assertIn(
                                "frame-ancestors 'none'", headers["Content-Security-Policy"]
                            )
                    for path in (
                        "/project.html",
                        "/branding/apple-touch-icon.png",
                        "/../pyproject.toml",
                        "/%2e%2e/pyproject.toml",
                        "/api/missing",
                    ):
                        self.assertEqual(self.request(server, prefix + path)[0], 404)
                    self.assertEqual(self.request(server, prefix + "/project.js", {})[0], 404)

    def test_project_routes_revisions_conflicts_assets_and_downloads(self):
        for workspace in (False, True):
            with self.server(workspace) as server:
                prefix = "/projects/world" if workspace else ""
                status, _, body = self.request(server, prefix + "/api/project")
                catalog = json.loads(body)
                self.assertEqual(status, 200)
                self.assertEqual(catalog["token"], "secret")
                self.assertEqual(catalog["project_path"], str(self.project.root))
                payload = {
                    "name": "First",
                    "width": 2,
                    "height": 2,
                    "grid": 8,
                    "project_revision": catalog["revision"],
                }
                status, _, body = self.request(server, prefix + "/api/create-scene", payload)
                self.assertEqual(status, 200)
                scene = json.loads(body)
                self.assertEqual(
                    self.request(server, prefix + "/api/create-scene", payload)[0], 409
                )
                self.assertEqual(
                    json.loads(self.request(server, prefix + "/api/scene/" + scene["id"])[2])[
                        "name"
                    ],
                    "First",
                )
                query = "?scene=" + scene["id"]
                revision = json.loads(self.request(server, prefix + "/api/revisions" + query)[2])
                snapshot = json.loads(self.request(server, prefix + "/api/snapshot" + query)[2])
                self.assertEqual(revision["scene_revision"], scene["revision"])
                self.assertEqual(snapshot["scene"]["id"], scene["id"])
                self.assertEqual(snapshot["token"], "secret")
                status, headers, body = self.request(server, prefix + "/assets/terrain/atlas.png")
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], "image/png")
                self.assertEqual(
                    body, (self.project.root / "assets/terrain/atlas.png").read_bytes()
                )
                status, headers, body = self.request(
                    server,
                    prefix + "/api/export",
                    {"scope": "project", "project_revision": revision["revision"]},
                )
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], "application/zip")
                self.assertTrue(headers["Content-Disposition"].startswith('attachment; filename="'))
                with ZipFile(io.BytesIO(body)) as archive:
                    self.assertTrue(archive.namelist())
                for method, route in (
                    ("GET", "/api/create-scene"),
                    ("POST", "/api/revisions"),
                    ("POST", "/api/missing"),
                ):
                    self.assertEqual(
                        self.request(
                            server, prefix + route, {} if method == "POST" else None, method=method
                        )[0],
                        404,
                    )

    def test_security_paths_and_request_limits_in_both_modes(self):
        for workspace in (False, True):
            with self.server(workspace) as server:
                prefixes = ("", "/projects/world") if workspace else ("",)
                for prefix in prefixes:
                    for route, data in (
                        ("/", None),
                        ("/api/project", None),
                        ("/api/create-project", {}),
                    ):
                        self.assertEqual(
                            self.request(
                                server, prefix + route, data, headers={"Host": "evil.example"}
                            )[0],
                            403,
                        )
                    self.assertEqual(
                        self.request(
                            server,
                            prefix + "/api/create-project",
                            {},
                            headers={"X-Scene-Token": "wrong"},
                        )[0],
                        403,
                    )
                    self.assertEqual(
                        self.request(
                            server,
                            prefix + "/api/create-project",
                            {},
                            headers={"Content-Type": "text/plain"},
                        )[0],
                        400,
                    )
                    limit = 8192 if workspace and not prefix else 8 * 1024 * 1024
                    self.assertEqual(
                        self.request(
                            server,
                            prefix + "/api/create-project",
                            {},
                            headers={"Content-Length": str(limit + 1)},
                        )[0],
                        400,
                    )
                    self.assertEqual(
                        self.request(server, prefix + "/api/create-project", [])[0], 400
                    )
                if workspace:
                    for path in (
                        "/projects/%2e%2e/api/project",
                        "/projects/world",
                        "/projects/missing/api/project",
                    ):
                        self.assertEqual(self.request(server, path)[0], 400)
                prefix = "/projects/world" if workspace else ""
                self.assertEqual(
                    self.request(server, prefix + "/api/revisions?scene=../../secret")[0], 400
                )

    def test_creation_and_unknown_routes_before_initialization(self):
        with self.server(empty=True) as server:
            self.assertIsNone(json.loads(self.request(server, "/api/project")[2])["project"])
            self.assertEqual(self.request(server, "/api/revisions")[0], 404)
            status, _, body = self.request(server, "/api/unknown", {})
            self.assertEqual(status, 400)
            self.assertEqual(json.loads(body)["error"], "Create a project first")
            self.assertEqual(self.request(server, "/api/create-project", {"name": "New"})[0], 200)
            self.assertEqual(self.request(server, "/api/unknown", {})[0], 404)
            self.assertEqual(self.request(server, "/api/create-project", {"name": "Again"})[0], 400)
        with self.server(workspace=True) as server:
            status, _, body = self.request(server, "/api/create-project", {"name": "Another"})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), {"directory": "another"})
            self.assertEqual(self.request(server, "/projects/another/api/project")[0], 200)
