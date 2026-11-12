"""Line-oriented native installed-plugin driver for browser handoff acceptance.

No Forge imports, credentials, model turns or real user configuration. Selection
is a synthetic grant in a disposable macOS HOME; each client owns a fresh thread.
"""

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path

from plugin_distribution_smoke import SELECTOR, NativeClient


class Handoff:
    def __init__(self, archive, codex, output):
        self.output = output
        self.codex = str(codex)
        self.clients = {}
        self.browsers = {}
        self.home = output / "user home café"
        self.state = output / "client state"
        self.projects = output / "projects café"
        for folder in (self.home, self.state, self.projects):
            folder.mkdir()
        self.env = {**os.environ, "HOME": str(self.home), "CODEX_HOME": str(self.state)}
        source = output / "repository café"
        source.mkdir()
        with tarfile.open(archive) as stream:
            stream.extractall(source, filter="data")
        self.repository = next(source.iterdir())
        self.cli("marketplace", "add", str(self.repository))
        self.cli("add", SELECTOR)
        self.settings = self.home / "Library/Application Support/Scene Forge/selection.json"
        self.settings.parent.mkdir(parents=True)
        self.select(self.projects)
        # Both the installed MCP runtime and its browser children lack developer tools.
        self.env.update(PATH="/unavailable", PYTHONHOME="/unavailable", PYTHONPATH="/unavailable")
        self.fresh("first")
        status = self.call("first", "plugin_status", {})["structuredContent"]
        runtime = self.repository / "plugins/scene-forge/runtime"
        bundle = json.loads((runtime / "bundle.json").read_text())
        self.provenance = {
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "host": platform.platform(),
            "driver_python": platform.python_version(),
            "codex": subprocess.check_output([self.codex, "--version"], text=True).strip(),
            "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "installation": status["installation"],
            "runtime_sha256": hashlib.sha256((runtime / "forge").read_bytes()).hexdigest(),
            "runtime_wheel_sha256": bundle["wheel_sha256"],
            "initial_thread": self.clients["first"].thread,
            "selection": "Synthetic root grant in isolated HOME; no native dialog",
            "selection_record": status["selection"],
            "method": "Native app-server tool calls and Playwright gestures; no model turns",
        }

    def cli(self, *arguments):
        result = subprocess.run(
            [self.codex, "plugin", *arguments, "--json"],
            env=self.env,
            text=True,
            capture_output=True,
            timeout=55,
        )
        with (self.output / "installation.log").open("a") as log:
            log.write(result.stdout + result.stderr)
        result.check_returncode()

    def select(self, path):
        info = path.stat()
        self.settings.write_text(
            json.dumps(
                dict(
                    schema_version=1,
                    mode="root",
                    path=str(path),
                    identity=[info.st_dev, info.st_ino],
                )
            )
        )

    def fresh(self, name):
        if name in self.clients:
            self.clients.pop(name).close()
        self.clients[name] = NativeClient(self.codex, self.env, self.output)
        return {"thread": self.clients[name].thread}

    def call(self, client, tool, arguments):
        native = self.clients[client]
        servers = native.servers()
        assert len(servers) == 1 and tool in servers[0]["tools"], servers
        print(f"handoff: {client} {tool}", file=sys.stderr, flush=True)
        busy = [
            {
                "error": {
                    "code": code,
                    "message": "Another scene editor is applying changes. "
                    "Try again when it finishes.",
                }
            }
            for code in ("invalid_request", "conflict", "busy")
        ]
        for attempt in range(20):
            result = native.rpc(
                "mcpServer/tool/call",
                dict(
                    threadId=native.thread,
                    server=servers[0]["name"],
                    tool=tool,
                    arguments=arguments,
                ),
            )
            if not result.get("isError") or result.get("structuredContent") not in busy:
                break
            if attempt == 19:
                raise RuntimeError(f"Project stayed busy: {tool}")
            time.sleep(0.05)
        if tool == "plugin_browser" and not result.get("isError"):
            project = arguments["project"]
            if arguments["action"] == "open":
                self.browsers[project] = result["structuredContent"]
            elif arguments["action"] == "stop":
                self.browsers.pop(project, None)
        return result

    def dispatch(self, command):
        action = command["action"]
        if action == "resource":
            native = self.clients[command["client"]]
            return native.rpc(
                "mcpServer/resource/read",
                dict(
                    threadId=native.thread, server=native.servers()[0]["name"], uri=command["uri"]
                ),
                allow_error=True,
            )
        if action == "call":
            return self.call(command["client"], command["tool"], command.get("arguments", {}))
        if action == "fresh":
            return self.fresh(command["client"])
        if action == "close":
            self.clients.pop(command["client"]).close()
            return {}
        if action == "selection":
            alternate = self.output / "other projects"
            alternate.mkdir(exist_ok=True)
            self.select(alternate if command["alternate"] else self.projects)
            return {}
        raise ValueError(f"Unknown action: {action}")

    def close(self):
        try:
            # Selection changes deliberately revoke old clients. Reconnect to the
            # original scope before stopping only browser instances this test owns.
            if self.browsers:
                self.select(self.projects)
                self.fresh("cleanup")
                for project, browser in list(self.browsers.items()):
                    result = self.call(
                        "cleanup",
                        "plugin_browser",
                        dict(project=project, action="stop", instance=browser["instance"]),
                    )
                    assert not result.get("isError"), result
        finally:
            for native in self.clients.values():
                native.close()
            self.cli("remove", SELECTOR)
            self.cli("marketplace", "remove", "scene-forge-repository")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    handoff = Handoff(args.archive.resolve(strict=True), args.codex.resolve(strict=True), output)
    try:
        print(json.dumps(handoff.provenance), flush=True)
        for line in sys.stdin:
            print(json.dumps(handoff.dispatch(json.loads(line))), flush=True)
    finally:
        handoff.close()


if __name__ == "__main__":
    main()
