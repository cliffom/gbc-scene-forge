"""Loopback transport for a project root or a directly opened project."""

import errno
import json
import logging
import secrets
import traceback
import webbrowser
from http.server import ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path
from threading import Lock, Thread
from urllib.parse import parse_qs, unquote, urlparse

from .atlas import require
from .console import ServerConsole
from .documents import Conflict
from .drafts import Drafts
from .projects import Project, name
from .server import STATIC, LocalHandler
from .updates import Updates
from .workspaces import ProjectRoot

TOUCH_ICONS = ("/apple-touch-icon.png", "/apple-touch-icon-precomposed.png")


class StandaloneHandler(LocalHandler):
    def log_request(self, code="-", size="-"):
        console = getattr(self.server, "console", None)
        if console is None:
            return super().log_request(code, size)
        headers = getattr(self, "headers", {})
        console.request(
            self.client_address[0], headers.get("User-Agent", ""), self.requestline, code
        )

    def log_message(self, format, *args):
        console = getattr(self.server, "console", None)
        if console is None:
            return super().log_message(format, *args)
        # send_error logs a diagnostic before log_request records the failed
        # response. Only the response increments the HTTP failure count.
        console.error(format % args, count_failure=False)


class StandaloneServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        self.console.error(
            f"Unhandled request error from {client_address[0]}: {traceback.format_exc()}"
        )

    def service_actions(self):
        # Runs even without traffic, so stale clients disappear while the server is idle.
        self.console.expire()


def make_handler(root, token):
    root = Path(root).absolute()
    if (root / "forge.project.json").exists():
        Project.recover(root)
    if not (root / "forge.project.json").exists():
        Project.prepare_creation(root)
    project = Project(root, recover=False) if (root / "forge.project.json").exists() else None
    updates = Updates(project) if project else None
    request_lock = Lock()

    class Handler(StandaloneHandler):
        def do_GET(self):
            # Queue direct-project requests too: background reports must not make
            # a cooperating editor's save contend with the filesystem lock.
            with request_lock:
                Handler._get(self)

        def _get(self):
            if not self.trusted_host():
                self.reply({"error": "Local host required"}, status=403)
                return
            route = unquote(urlparse(self.path).path)
            try:
                if route == "/api/project":
                    self.reply(
                        dict(
                            project.catalog() if project else {"project": None},
                            token=token,
                            project_path=str(root),
                        )
                    )
                elif route in ("/api/revisions", "/api/snapshot") and updates:
                    scene_id = parse_qs(urlparse(self.path).query).get("scene", [None])[0]
                    if route == "/api/revisions":
                        self.reply(updates.revisions(scene_id))
                    else:
                        self.reply(
                            dict(updates.snapshot(scene_id), token=token, project_path=str(root))
                        )
                elif route.startswith("/api/scene/") and project:
                    self.reply(project.load_scene(route.removeprefix("/api/scene/")))
                elif route.startswith("/assets/") and project:
                    revision = parse_qs(urlparse(self.path).query).get("revision", [None])[0]
                    self.reply(project.asset(route[1:], revision), "image/png")
                elif route in TOUCH_ICONS:
                    self.reply((STATIC / "branding/apple-touch-icon.png").read_bytes(), "image/png")
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
            with request_lock:
                Handler._post(self)

        def _post(self):
            nonlocal project, updates
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
                    starter = data.get("starter", "empty")
                    require(
                        starter in ("empty", "sample", "blockout"),
                        "Choose an empty, sample or blockout project",
                    )
                    if starter == "sample":
                        from .sample import prepare

                        project = prepare(root, title=name(data.get("name")))
                    else:
                        project = Project.create(root, data.get("name"), starter=starter)
                    updates = Updates(project)
                    self.reply(project.catalog())
                    return
                require(project is not None, "Create a project first")
                if route == "/api/create-blockout-scene":
                    self.reply(
                        project.create_blockout_scene(
                            data.get("name"), data.get("options"), data.get("project_revision")
                        )
                    )
                elif route == "/api/blockout-review":
                    self.reply(
                        project.blockout_review(
                            data.get("scene_id"),
                            data.get("project_revision"),
                            data.get("scene_revision"),
                            data.get("scene"),
                            data.get("camera_id"),
                        )
                    )
                elif route == "/api/create-scene":
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
                            confirm_broken_links=data.get("confirm_broken_links", False),
                        )
                    )
                elif route == "/api/checkpoint-draft":
                    self.reply(Drafts(project).write(data))
                elif route == "/api/list-drafts":
                    self.reply(Drafts(project).list())
                elif route == "/api/restore-draft":
                    self.reply(Drafts(project).restore(data.get("id"), data.get("revision")))
                elif route == "/api/download-draft":
                    self.reply(Drafts(project).download(data.get("id"), data.get("revision")))
                elif route == "/api/delete-draft":
                    self.reply(Drafts(project).delete(data.get("id"), data.get("revision")))
                elif route == "/api/export":
                    payload, filename = project.export_bundle(
                        data.get("scope"),
                        data.get("project_revision"),
                        data.get("scene_id"),
                        data.get("scene"),
                        data.get("scene_revision"),
                    )
                    self.reply(payload, "application/zip", filename=filename)
                elif route in ("/api/palette-report", "/api/palette-preflight"):
                    report = project.palette_report(
                        data.get("scene_id"),
                        data.get("project_revision"),
                        data.get("scene_revision"),
                        data.get("scene"),
                    )
                    self.reply(
                        report,
                        status=422
                        if route.endswith("preflight") and report["status"] != "pass"
                        else 200,
                    )
                elif route == "/api/diagnostics-report":
                    self.reply(
                        project.diagnostics_report(
                            data.get("project_revision"),
                            data.get("options"),
                            data.get("scene_id"),
                            data.get("scene_revision"),
                            data.get("scene"),
                        )
                    )
                elif route == "/api/world-report":
                    self.reply(
                        project.world_report(
                            data.get("project_revision"),
                            data.get("scene_id"),
                            data.get("scene_revision"),
                            data.get("scene"),
                        )
                    )
                elif route == "/api/save-world":
                    self.reply(
                        project.save_world(
                            data.get("world"),
                            data.get("project_revision"),
                            data.get("scene_revisions"),
                        )
                    )
                elif route == "/api/save-object-definition":
                    self.reply(
                        project.save_object_definition(
                            data.get("definition"), data.get("project_revision")
                        )
                    )
                elif route == "/api/delete-object-definition":
                    self.reply(
                        project.delete_object_definition(
                            data.get("id"), data.get("project_revision")
                        )
                    )
                elif route == "/api/object-report":
                    self.reply(
                        project.object_report(
                            data.get("scene_id"),
                            data.get("project_revision"),
                            data.get("scene_revision"),
                            data.get("scene"),
                        )
                    )
                elif route == "/api/save-stamp":
                    self.reply(
                        project.save_stamp(
                            data.get("name"),
                            data.get("scene"),
                            data.get("slots"),
                            data.get("project_revision"),
                        )
                    )
                elif route == "/api/delete-stamp":
                    self.reply(project.delete_stamp(data.get("id"), data.get("project_revision")))
                elif route == "/api/save-palette-profile":
                    self.reply(
                        project.save_palette_profile(
                            data.get("profile"), data.get("project_revision")
                        )
                    )
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
                elif route == "/api/rename-scene":
                    self.reply(
                        project.rename_scene(
                            data.get("id"),
                            data.get("name"),
                            data.get("revision"),
                            data.get("project_revision"),
                        )
                    )
                elif route == "/api/duplicate-scene":
                    self.reply(
                        project.duplicate_scene(
                            data.get("id"),
                            data.get("name"),
                            data.get("revision"),
                            data.get("project_revision"),
                            data.get("scene"),
                        )
                    )
                elif route == "/api/delete-scene":
                    self.reply(
                        project.delete_scene(
                            data.get("id"),
                            data.get("revision"),
                            data.get("project_revision"),
                            confirm_broken_links=data.get("confirm_broken_links", False),
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


def make_root_handler(root, token):
    workspace = ProjectRoot(root)
    handlers = {}
    initialization_lock = Lock()

    class Handler(StandaloneHandler):
        def dispatch(self, method):
            if not self.trusted_host():
                self.reply({"error": "Local host required"}, status=403)
                return
            if method == "do_POST" and not secrets.compare_digest(
                self.headers.get("X-Scene-Token", ""), token
            ):
                self.reply({"error": "Local editor token required"}, status=403)
                return
            route = unquote(urlparse(self.path).path)
            try:
                if route.startswith("/projects/"):
                    parts = route.split("/", 3)
                    require(len(parts) == 4, "Project URLs must end with a slash")
                    project_path = workspace.path(parts[2])
                    with initialization_lock:
                        cached = handlers.get(project_path)
                        if cached is None:
                            require(
                                (project_path / "forge.project.json").is_file(), "Project not found"
                            )
                            handler = make_handler(project_path, token)
                            cached = (handler, Lock())
                            handlers[project_path] = cached
                        handler, request_lock = cached
                    original = self.path
                    self.path = "/" + parts[3]
                    query = urlparse(original).query
                    if query:
                        self.path += "?" + query
                    try:
                        # Project reads also take nonblocking filesystem locks. Queue
                        # local requests so tabs do not contend with one another.
                        with request_lock:
                            getattr(handler, method)(self)
                    finally:
                        self.path = original
                elif route == "/api/project" and method == "do_GET":
                    self.reply(dict(workspace.catalog(), token=token))
                elif route == "/api/create-project" and method == "do_POST":
                    require(
                        self.headers.get("Content-Type") == "application/json",
                        "Use application/json",
                    )
                    length = int(self.headers.get("Content-Length", "0"))
                    require(0 < length <= 8192, "Project request must be within 8 KiB")
                    data = json.loads(self.rfile.read(length))
                    require(isinstance(data, dict), "Expected a JSON object")
                    directory = workspace.create(
                        data.get("name"), starter=data.get("starter", "empty")
                    )
                    self.reply({"directory": directory})
                elif method == "do_GET" and route in TOUCH_ICONS:
                    self.reply((STATIC / "branding/apple-touch-icon.png").read_bytes(), "image/png")
                elif method == "do_GET" and route in (
                    "/",
                    "/project.js",
                    "/project.js.map",
                    "/project.css",
                    "/style.css",
                    "/branding/logo-64.png",
                    "/branding/favicon-32.png",
                    "/branding/favicon-16.png",
                ):
                    file = "project.html" if route == "/" else route[1:]
                    mime = {
                        "html": "text/html",
                        "js": "text/javascript",
                        "map": "application/json",
                        "css": "text/css",
                        "png": "image/png",
                    }[file.rsplit(".", 1)[1]]
                    self.reply((STATIC / file).read_bytes(), mime)
                else:
                    self.reply({"error": "Not found"}, status=404)
            except Conflict as error:
                self.reply({"error": str(error)}, status=409)
            except (ValueError, OSError, KeyError, TypeError) as error:
                self.reply({"error": str(error)}, status=400)

        def do_GET(self):
            self.dispatch("do_GET")

        def do_POST(self):
            self.dispatch("do_POST")

    return Handler


def open_editor(url):
    """Browser launch failure must not stop an otherwise usable local server."""
    try:
        opened = webbrowser.open(url)
    except (webbrowser.Error, OSError):
        opened = False
    if not opened:
        print(f"Browser could not be opened. Open {url} manually in your browser.", flush=True)


def serve(root, port=8765, *, single_project=False, open_browser=False):
    token = secrets.token_urlsafe(32)
    handler = (make_handler if single_project else make_root_handler)(root, token)
    try:
        server = StandaloneServer(("127.0.0.1", port), handler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            raise ValueError(
                f"Port {port} is already in use. Stop the other server or choose --port 8777 "
                "(or --port 0 for an available port)."
            ) from error
        raise
    with server:
        log_path = Path.cwd() / ".forge-logs" / f"server-{server.server_port}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log = RotatingFileHandler(log_path, maxBytes=1024 * 1024, backupCount=3, encoding="utf-8")
        log.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger = logging.Logger("gbc_scene_forge.activity", level=logging.INFO)
        logger.addHandler(log)
        server.console = ServerConsole(logger=logger, log_path=log_path)
        try:
            server.console.start(server.server_port, project_root=Path(root).absolute())
            if open_browser:
                Thread(
                    target=open_editor,
                    args=(f"http://127.0.0.1:{server.server_port}/",),
                    daemon=True,
                ).start()
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.console.stop()
            log.close()
