"""Per-user loopback browser ownership. Never signal a PID from a saved record."""

import hashlib
import http.client
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread
from urllib.parse import quote, urlparse

from gbc_scene_forge import __version__
from gbc_scene_forge.adapters.http.server import make_handler
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.validation import require

from .selection import Selection

IDLE_SECONDS = 30 * 60
START_SECONDS = 10


def publish(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(json.dumps(value).encode())
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


@contextmanager
def locked(path, *, wait=True):
    # The initial native runtime targets local macOS; Windows delivery is deferred.
    import fcntl

    require(not path.is_symlink(), "Browser lock must not be a symlink")
    with path.open("a+b") as stream:
        deadline = time.monotonic() + START_SECONDS
        while True:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(wait and time.monotonic() < deadline, "Browser launch busy; retry shortly")
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def load(path):
    require(not path.is_symlink(), "Browser record must not be a symlink")
    if not path.exists():
        return None
    require(path.stat().st_size <= 8192, "Invalid browser record; preserve it and clear the cache")
    try:
        record = json.loads(path.read_text())
        require(
            isinstance(record, dict)
            and record.get("schema_version") == 1
            and type(record.get("port")) is int
            and 0 < record["port"] <= 65535
            and isinstance(record.get("secret"), str)
            and len(record["secret"]) == 43
            and isinstance(record.get("instance"), str)
            and len(record["instance"]) == 32
            and isinstance(record.get("project"), dict)
            and isinstance(record.get("runtime"), dict)
            and set(record["runtime"]) == {"version", "bundle"}
            and all(isinstance(value, str) for value in record["runtime"].values()),
            "Invalid browser record; preserve it and clear the cache",
        )
        return record
    except (TypeError, KeyError, RecursionError, json.JSONDecodeError) as error:
        raise ValueError("Invalid browser record; preserve it and clear the cache") from error


def control(record, action="status"):
    """Use a fixed numeric loopback address, without proxies, redirects or URL input."""
    connection = http.client.HTTPConnection("127.0.0.1", record["port"], timeout=0.5)
    try:
        connection.request(
            "POST" if action == "stop" else "GET",
            "/__forge_browser/" + action,
            headers={"X-Forge-Browser": record["secret"]},
        )
        response = connection.getresponse()
        if response.status != 200:
            return None
        result = json.loads(response.read(8193))
        if result != {key: record[key] for key in ("instance", "project", "runtime")}:
            return None
        return result
    except (OSError, ValueError, KeyError, http.client.HTTPException):
        return None
    finally:
        connection.close()


class BrowserManager:
    def __init__(self, selection, *, command=None):
        self.selection = selection
        self.command = command or (
            [sys.executable, "browser-worker"]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-m", __name__]
        )
        self.runtime = {"version": __version__, "bundle": str(selection.bundle)}

    def paths(self, project):
        record = self.selection.prepare(project, "project")
        key = hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()
        self.selection.check_owned_paths()
        folder = self.selection.cache / "browsers"
        require(folder.resolve() == folder, "Browser cache must not be a symlink")
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        return record, folder / (key + ".json")

    def request(self, project, *, action="open", scene_id=None, instance=None):
        require(action in ("open", "status", "stop"), "Choose open, status or stop")
        project_record, path = self.paths(project.root)
        if scene_id is not None:
            require(action == "open", "scene_id is only used when opening a browser")
            project.scenes.load(scene_id)  # Only saved scene routes exist today.
        with locked(path.with_suffix(".launch.lock")):
            record = load(path)
            require(
                record is None or record.get("project") == project_record,
                "Browser record belongs to a different project; preserve it and clear the cache",
            )
            live = control(record) if record else None
            if action == "stop":
                require(
                    live and instance == record["instance"],
                    "Browser instance expired or changed. Inspect status before requesting stop.",
                )
                require(
                    control(record, "stop"), "Browser stopped or became unavailable; inspect status"
                )
                with locked(path.with_suffix(".owner.lock")):
                    pass  # Wait for admitted saves and socket closure before permitting restart.
                return {"stopped": True, "instance": instance}
            if action == "open" and not live:
                record = self.start(project_record, path)
                live = control(record)
            if live and action == "open":
                require(
                    record["runtime"] == self.runtime,
                    "A different runtime owns this browser. Explicitly stop that instance before reopening.",
                )
                require(control(record, "open"), "Browser expired during handoff; retry opening")
            url = f"http://127.0.0.1:{record['port']}/" if record else None
            if url and scene_id:
                url += "scenes/" + quote(scene_id, safe="")
            return {
                "running": bool(live),
                "url": url if live else None,
                "instance": record["instance"] if live else None,
                "project_path": str(project.root),
                "runtime": record["runtime"] if live else None,
                "idle_expiry_seconds": IDLE_SECONDS,
                "lifetime": "Browser survives chat closure; closes after 30 minutes without editor requests. "
                "Stop affects all tabs using this shared instance. Saved content, retained candidates "
                "and browser checkpoints have separate lifetimes. Session previews expire with MCP.",
                "artwork_navigation": "Open saved artwork from Documents; no artwork deep link exists.",
            }

    def start(self, project_record, path):
        log_path = path.with_suffix(".log")
        require(not log_path.is_symlink(), "Browser log must not be a symlink")
        # Bound diagnostics across repeated failed starts, without recording tool payloads.
        if log_path.exists() and log_path.stat().st_size > 1024 * 1024:
            log_path.unlink()
        descriptor = os.open(log_path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "ab") as log:
            child = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=log,
                cwd=self.selection.cache,
                start_new_session=True,
            )
        config = {
            "bundle": str(self.selection.bundle),
            "settings": str(self.selection.settings.parent),
            "cache": str(self.selection.cache),
            "project": project_record,
        }
        try:
            child.stdin.write(json.dumps(config).encode())
            child.stdin.close()
            deadline = time.monotonic() + START_SECONDS
            while time.monotonic() < deadline:
                record = load(path)
                if record and record["runtime"] == self.runtime and control(record):
                    # Reap our child while MCP remains alive; chat closure does not stop it.
                    Thread(target=child.wait, daemon=True).start()
                    print("Forge browser ready (loopback, selected project only).", file=sys.stderr)
                    return record
                require(
                    child.poll() is None,
                    "Browser could not start. Its saved port may be occupied; close the other listener "
                    f"and retry to preserve browser recovery. Diagnostics: {log_path}",
                )
                time.sleep(0.05)
            raise ValueError(f"Browser readiness timed out; retry. Diagnostics: {log_path}")
        except BaseException:
            # Only this newly created process handle, never a saved PID, can be signalled.
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=2)
            raise


def worker(config):
    selection = Selection(config["bundle"], settings=config["settings"], cache=config["cache"])
    project = selection.validate(config["project"])
    manager = BrowserManager(selection)
    project_record, path = manager.paths(project)
    with locked(path.with_suffix(".owner.lock"), wait=False):
        previous = load(path)
        require(not previous or not control(previous), "An existing browser owns this project")
        token = secrets.token_urlsafe(32)
        record = {
            "schema_version": 1,
            "project": project_record,
            "runtime": manager.runtime,
            "secret": secrets.token_urlsafe(32),
            "instance": secrets.token_hex(16),
        }
        identity = {key: record[key] for key in ("instance", "project", "runtime")}

        def prepare_request():
            try:
                selection.validate(project_record)
            except (ValueError, OSError) as error:
                raise Conflict("Project location changed; choose it again") from error

        base_handler = make_handler(project, token, prepare_request=prepare_request)

        class Handler(base_handler):
            def log_request(self, *args):
                pass  # Scoped lifecycle diagnostics do not log project URLs/content.

            def log_message(self, *args):
                pass

            def dispatch(self, method):
                route = urlparse(self.path).path
                if route.startswith("/__forge_browser/"):
                    if not self.trusted_host() or not secrets.compare_digest(
                        self.headers.get("X-Forge-Browser", ""), record["secret"]
                    ):
                        self.reply({"error": "Browser ownership required"}, status=403)
                    elif (method, route) == ("GET", "/__forge_browser/status"):
                        self.reply(identity)
                    elif (method, route) == ("GET", "/__forge_browser/open"):
                        self.server.last_editor_request = time.monotonic()
                        self.reply(identity)
                    elif (method, route) == ("POST", "/__forge_browser/stop"):
                        self.server.stopping = True
                        self.reply(identity)
                    else:
                        self.reply({"error": "Not found"}, status=404)
                    return
                self.server.last_editor_request = time.monotonic()
                getattr(super(), "do_" + method)()

            def do_GET(self):
                self.dispatch("GET")

            def do_POST(self):
                self.dispatch("POST")

        class Server(ThreadingHTTPServer):
            def __init__(self, *args):
                self.active = 0
                self.active_lock = Lock()
                super().__init__(*args)

            def process_request(self, request, address):
                with self.active_lock:
                    self.active += 1
                try:
                    super().process_request(request, address)
                except BaseException:
                    with self.active_lock:
                        self.active -= 1
                    raise

            def process_request_thread(self, request, address):
                try:
                    request.settimeout(10)
                    super().process_request_thread(request, address)
                finally:
                    with self.active_lock:
                        self.active -= 1

            def handle_error(self, request, address):
                print("Forge browser request interrupted; retry or reopen.", file=sys.stderr)

        # Retain the origin on restart: checkpoints may be browser-origin scoped.
        port = previous["port"] if previous else 0
        with Server(("127.0.0.1", port), Handler) as server:
            server.timeout = 0.25
            server.stopping = False
            server.last_editor_request = time.monotonic()
            record["port"] = server.server_port
            publish(path, record)
            print("Forge browser started (loopback); idle expiry 30 minutes.", file=sys.stderr)
            while (
                not server.stopping and time.monotonic() - server.last_editor_request < IDLE_SECONDS
            ):
                server.handle_request()
            # Cooperative stop/expiry lets admitted saves finish; crashes use the durable journal.
            while server.active:
                time.sleep(0.05)
            print("Forge browser stopped (explicit request or idle expiry).", file=sys.stderr)
        # Keep the address for restart. The next launch verifies liveness, never a PID.


def worker_main():
    try:
        config = json.loads(sys.stdin.buffer.read(16385))
        worker(config)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"Forge browser worker: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(worker_main())
