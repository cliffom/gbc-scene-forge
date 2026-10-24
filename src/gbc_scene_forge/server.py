"""Local HTTP transport for an explicitly injected scene connector."""

import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .apply import ApplyManager
from .contract import check_connector
from .documents import Conflict, DraftStore, decode_document, encode_document, json_text

STATIC = Path(__file__).parent / "static"
MAX_BODY = 1024 * 1024


def make_handler(token, connector):
    check_connector(connector)
    manager = ApplyManager(connector)
    store = DraftStore(connector)
    profiles = connector.catalog()["profiles"]
    imported_sources = {target: connector.source_revision(target) for target in profiles}
    synchronized = set()

    def refresh():
        connector.refresh()
        imported_sources.update({target: connector.source_revision(target) for target in profiles})

    def synchronize():
        with manager.lock:
            for job in manager.jobs.values():
                if job["status"] == "complete" and job["id"] not in synchronized:
                    refresh()
                    synchronized.add(job["id"])

    def require_current(target):
        if target not in profiles:
            raise ValueError("Choose a supported scene")
        if connector.source_revision(target) != imported_sources[target]:
            raise ValueError(
                "Project sources changed. Save/download your draft, then restart the editor and reimport."
            )

    class Handler(BaseHTTPRequestHandler):
        def reply(self, body, content_type="application/json", status=200, filename=None):
            if not isinstance(body, bytes):
                body = json_text(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
            )
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(body)

        def trusted_host(self):
            return self.headers.get("Host") in (
                f"127.0.0.1:{self.server.server_port}",
                f"localhost:{self.server.server_port}",
            )

        def do_GET(self):
            if not self.trusted_host():
                self.reply({"error": "Local host required"}, status=403)
                return
            route = urlparse(self.path).path
            try:
                synchronize()
                if route == "/api/catalog":
                    for profile in profiles:
                        require_current(profile)
                    self.reply(dict(connector.catalog(), token=token))
                elif route == "/api/drafts":
                    self.reply(store.list())
                elif route == "/api/originals":
                    self.reply([target for target in profiles if store.has_original(target)])
                elif route.startswith("/api/original/"):
                    target = route.rsplit("/", 1)[1]
                    require_current(target)
                    self.reply(store.load_original(target))
                elif route.startswith("/api/draft/"):
                    self.reply(store.load(route.rsplit("/", 1)[1]))
                elif route.startswith("/api/scene/"):
                    profile = route.rsplit("/", 1)[1]
                    require_current(profile)
                    self.reply(connector.load(profile))
                elif route.startswith("/api/apply-status/"):
                    with manager.lock:
                        job = manager.status(route.rsplit("/", 1)[1])
                        if job["status"] == "complete":
                            if job["id"] not in synchronized:
                                refresh()
                                synchronized.add(job["id"])
                            self.reply(dict(job, **connector.load(job["profile"])))
                        else:
                            self.reply(job)
                elif route == "/api/last-apply":
                    latest = manager.store.latest()
                    self.reply(
                        {"transaction": latest["id"], "label": latest["label"]} if latest else {}
                    )
                elif route == "/api/apply-active":
                    self.reply(manager.active())
                elif route.startswith("/art/"):
                    self.reply(connector.asset(route[5:]), "image/png")
                elif route in (
                    "/",
                    "/app.js",
                    "/model.mjs",
                    "/progress.mjs",
                    "/api.mjs",
                    "/decode.mjs",
                    "/dom.mjs",
                    "/style.css",
                ):
                    name = "index.html" if route == "/" else route[1:]
                    mime = (
                        "text/html"
                        if name.endswith("html")
                        else "text/css"
                        if name.endswith("css")
                        else "text/javascript"
                    )
                    self.reply((STATIC / name).read_bytes(), mime + "; charset=utf-8")
                else:
                    self.reply({"error": "Not found"}, status=404)
            except (ValueError, OSError) as error:
                self.reply({"error": str(error)}, status=400)

        def do_POST(self):
            if not self.trusted_host() or not secrets.compare_digest(
                self.headers.get("X-Scene-Token", ""), token
            ):
                self.reply({"error": "Local editor token required"}, status=403)
                return
            try:
                synchronize()
                if self.headers.get("Content-Type") != "application/json":
                    raise ValueError("Use application/json")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    raise ValueError("Request must be between 1 byte and 1 MiB")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("Expected a JSON object")
                route = urlparse(self.path).path
                capability = {
                    "/api/new": "templates",
                    "/api/export": "export",
                    "/api/apply-review": "apply",
                    "/api/apply": "apply",
                    "/api/undo-apply": "apply",
                }.get(route)
                if capability and not connector.catalog()["capabilities"].get(capability):
                    raise ValueError(f"This connector does not support {capability}")
                scene = decode_document(data["scene"], connector) if "scene" in data else None
                if route == "/api/new":
                    require_current(data.get("profile"))
                elif route in ("/api/preview", "/api/validate", "/api/export", "/api/apply-review"):
                    connector.check_shape(scene)
                    require_current(scene["profile"])
                if route == "/api/new":
                    self.reply(connector.load(data.get("profile"), template=True))
                elif route == "/api/save":
                    with manager.lock:
                        if not store.has_original(scene["profile"]):
                            require_current(scene["profile"])
                        self.reply(store.save(scene, data.get("saved_id"), data.get("revision")))
                elif route == "/api/delete-drafts":
                    self.reply(store.delete(data.get("drafts")))
                elif route == "/api/import":
                    self.reply(dict(connector.load(scene["profile"]), scene=scene, revision=None))
                elif route == "/api/document":
                    self.reply(encode_document(scene))
                elif route == "/api/compare":
                    self.reply(connector.compare(scene))
                elif route == "/api/validate":
                    self.reply(connector.validate(scene))
                elif route == "/api/preview":
                    connector.check_shape(scene)
                    self.reply(
                        connector.preview(
                            scene,
                            data.get("light"),
                            data.get("state"),
                            data.get("frame", 0),
                        )
                    )
                elif route == "/api/export":
                    connector.check_shape(scene)
                    self.reply(
                        connector.export(scene), "application/zip", filename=scene["id"] + ".zip"
                    )
                elif route == "/api/apply-review":
                    with manager.lock:
                        self.reply(manager.prepare(scene))
                elif route == "/api/apply":
                    self.reply(manager.start(data.get("review"), data.get("approved")))
                elif route == "/api/apply-dismiss":
                    manager.dismiss(data.get("job"))
                    self.reply({"dismissed": True})
                elif route == "/api/undo-apply":
                    with manager.lock:
                        record = manager.undo(data.get("transaction"))
                        refresh()
                        profile = data.get("profile")
                        if profile not in profiles:
                            profile = next(iter(profiles))
                        self.reply(dict(connector.load(profile), transaction=record["id"]))
                else:
                    self.reply({"error": "Not found"}, status=404)
            except Conflict as error:
                self.reply({"error": str(error)}, status=409)
            except (ValueError, OSError, KeyError, TypeError) as error:
                self.reply({"error": str(error)}, status=400)

    Handler.apply_manager = manager
    return Handler


def serve(connector, port=8765):
    token = secrets.token_urlsafe(32)
    with ThreadingHTTPServer(("127.0.0.1", port), make_handler(token, connector)) as server:
        print(f"Scene editor: http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.RequestHandlerClass.apply_manager.close()
