"""Standalone transport: one explicitly declared project workspace per server."""

import json
import secrets
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .atlas import require
from .documents import Conflict
from .projects import Project
from .server import STATIC, LocalHandler
from .transactions import Transactions


def make_handler(root, token):
    root = Path(root).absolute()
    if root.is_dir() and (root / ".forge/history").exists():
        Transactions(root, ".forge/history").recover()
    if not (root / "forge.project.json").exists():
        Project.prepare_creation(root)
    project = Project(root) if (root / "forge.project.json").exists() else None

    class Handler(LocalHandler):
        def do_GET(self):
            if not self.trusted_host():
                self.reply({"error": "Local host required"}, status=403)
                return
            route = unquote(urlparse(self.path).path)
            try:
                if route == "/api/project":
                    self.reply(
                        dict(project.catalog() if project else {"project": None}, token=token)
                    )
                elif route.startswith("/api/scene/") and project:
                    self.reply(project.load_scene(route.removeprefix("/api/scene/")))
                elif route.startswith("/assets/") and project:
                    revision = parse_qs(urlparse(self.path).query).get("revision", [None])[0]
                    self.reply(project.asset(route[1:], revision), "image/png")
                elif route in (
                    "/branding/logo-64.png",
                    "/branding/favicon-32.png",
                    "/branding/favicon-16.png",
                ):
                    self.reply((STATIC / route[1:]).read_bytes(), "image/png")
                elif route in ("/", "/project.js", "/project.js.map", "/project.css", "/style.css"):
                    file = "project.html" if route == "/" else route[1:]
                    mime = {
                        "html": "text/html",
                        "js": "text/javascript",
                        "map": "application/json",
                        "css": "text/css",
                    }[file.rsplit(".", 1)[1]]
                    self.reply((STATIC / file).read_bytes(), mime + "; charset=utf-8")
                else:
                    self.reply({"error": "Not found"}, status=404)
            except Conflict as error:
                self.reply({"error": str(error)}, status=409)
            except (ValueError, OSError, KeyError, TypeError) as error:
                self.reply({"error": str(error)}, status=400)

        def do_POST(self):
            nonlocal project
            if not self.trusted_host() or not secrets.compare_digest(
                self.headers.get("X-Scene-Token", ""), token
            ):
                self.reply({"error": "Local editor token required"}, status=403)
                return
            try:
                require(
                    self.headers.get("Content-Type") == "application/json", "Use application/json"
                )
                length = int(self.headers.get("Content-Length", "0"))
                require(0 < length <= 8 * 1024 * 1024, "Request must be within 8 MiB")
                data = json.loads(self.rfile.read(length))
                require(isinstance(data, dict), "Expected a JSON object")
                route = urlparse(self.path).path
                if route == "/api/create-project":
                    require(project is None, "A project is already open")
                    project = Project.create(root, data.get("name"))
                    self.reply(project.catalog())
                    return
                require(project is not None, "Create a project first")
                if route == "/api/create-scene":
                    self.reply(
                        project.create_scene(
                            data.get("name"),
                            data.get("width"),
                            data.get("height"),
                            data.get("grid"),
                            data.get("project_revision"),
                        )
                    )
                elif route == "/api/save-scene":
                    self.reply(
                        project.save_scene(
                            data.get("id"),
                            data.get("scene"),
                            data.get("revision"),
                            data.get("project_revision"),
                        )
                    )
                elif route == "/api/export":
                    payload, filename = project.export_bundle(
                        data.get("scope"),
                        data.get("project_revision"),
                        data.get("scene_id"),
                        data.get("scene"),
                        data.get("scene_revision"),
                    )
                    self.reply(payload, "application/zip", filename=filename)
                elif route == "/api/save-preview-settings":
                    self.reply(
                        project.save_preview_settings(
                            data.get("settings"), data.get("project_revision")
                        )
                    )
                elif route == "/api/save-tile-metadata":
                    self.reply(
                        project.save_tile_metadata(
                            data.get("atlas"),
                            data.get("group"),
                            data.get("asset"),
                            data.get("metadata"),
                            data.get("project_revision"),
                        )
                    )
                elif route == "/api/delete-scene":
                    self.reply(
                        project.delete_scene(
                            data.get("id"), data.get("revision"), data.get("project_revision")
                        )
                    )
                elif route == "/api/delete-atlas":
                    self.reply(
                        project.delete_atlas(
                            data.get("id"),
                            data.get("project_revision"),
                            scene_guard=data.get("scene"),
                        )
                    )
                elif route == "/api/import-atlas":
                    require(
                        ("path" in data) != ("bundle" in data),
                        "Choose an atlas folder or manifest path",
                    )
                    if "bundle" in data:
                        self.reply(
                            project.import_bundle(
                                data["bundle"],
                                data.get("project_revision"),
                                reimport=data.get("reimport", False),
                            )
                        )
                    else:
                        require(isinstance(data.get("path"), str), "Choose an atlas manifest path")
                        self.reply(
                            project.import_atlas(
                                data["path"],
                                data.get("project_revision"),
                                reimport=data.get("reimport", False),
                            )
                        )
                else:
                    self.reply({"error": "Not found"}, status=404)
            except Conflict as error:
                self.reply({"error": str(error)}, status=409)
            except (ValueError, OSError, KeyError, TypeError) as error:
                self.reply({"error": str(error)}, status=400)

    return Handler


def serve(root, port=8765):
    token = secrets.token_urlsafe(32)
    with ThreadingHTTPServer(("127.0.0.1", port), make_handler(root, token)) as server:
        print(f"Scene Forge: http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
