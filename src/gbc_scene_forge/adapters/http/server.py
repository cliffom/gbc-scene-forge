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

from gbc_scene_forge.adapters.console import ServerConsole
from gbc_scene_forge.adapters.http.common import LocalHandler
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.workspaces import ProjectRoot

from .routes import PROJECT_ROUTES, ProjectAPI
from .static import static_response

WORKSPACE_ROUTES = {
    ("GET", "/api/project"): "_catalog",
    ("POST", "/api/create-project"): "_create_project",
}


class StandaloneHandler(LocalHandler):
    def respond(self, response):
        self.reply(
            response.body,
            response.content_type,
            status=response.status,
            filename=response.filename,
        )

    def serve_static(self, route, *, charset):
        response = static_response(route, charset=charset)
        if response is None:
            return False
        self.respond(response)
        return True

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
    api = ProjectAPI(root, project)
    request_lock = Lock()

    class Handler(StandaloneHandler):
        def do_GET(self):
            # Queue direct-project requests too: background reports must not make
            # a cooperating editor's save contend with the filesystem lock.
            with request_lock:
                Handler._get(self)

        def _get(self):
            project = api.project
            if not self.trusted_host():
                self.reply({"error": "Local host required"}, status=403)
                return
            route = unquote(urlparse(self.path).path)
            try:
                if ("GET", route) in PROJECT_ROUTES:
                    self.respond(api.get(route, parse_qs(urlparse(self.path).query), token))
                elif route.startswith("/api/scene/") and project:
                    self.reply(project.scenes.load(route.removeprefix("/api/scene/")))
                elif route.startswith("/assets/") and project:
                    revision = parse_qs(urlparse(self.path).query).get("revision", [None])[0]
                    self.reply(project.artwork.asset(route[1:], revision), "image/png")
                elif self.serve_static(route, charset=True):
                    pass
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
                result = api.post(route, data)
                self.respond(result)
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
                elif handler_name := WORKSPACE_ROUTES.get((method.removeprefix("do_"), route)):
                    getattr(Handler, handler_name)(self)
                elif method == "do_GET" and self.serve_static(route, charset=False):
                    pass
                else:
                    self.reply({"error": "Not found"}, status=404)
            except Conflict as error:
                self.reply({"error": str(error)}, status=409)
            except (ValueError, OSError, KeyError, TypeError) as error:
                self.reply({"error": str(error)}, status=400)

        def _catalog(self):
            self.reply(dict(workspace.catalog(), token=token))

        def _create_project(self):
            require(
                self.headers.get("Content-Type") == "application/json",
                "Use application/json",
            )
            length = int(self.headers.get("Content-Length", "0"))
            require(0 < length <= 8192, "Project request must be within 8 KiB")
            data = json.loads(self.rfile.read(length))
            require(isinstance(data, dict), "Expected a JSON object")
            directory = workspace.create(data.get("name"), starter=data.get("starter", "empty"))
            self.reply({"directory": directory})

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
