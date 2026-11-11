"""Installed runtime lifecycle acceptance, with synthetic selection and no Forge imports.

Use a new --output folder; HOME is isolated, never the user's plugin selection.
"""

import argparse
import hashlib
import json
import os
import platform
import queue
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class Client:
    def __init__(self, executable, arguments, env):
        self.process = subprocess.Popen(
            [str(executable), "mcp", *arguments],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            cwd=executable.parent,
        )
        self.replies = queue.Queue()
        self.errors = []
        self.next_id = 0

        def replies():
            for line in self.process.stdout:
                try:
                    self.replies.put(json.loads(line))
                except ValueError:
                    self.replies.put({"bad_stdout": line})

        def errors():
            self.errors.extend(self.process.stderr)

        self.readers = [threading.Thread(target=replies), threading.Thread(target=errors)]
        for reader in self.readers:
            reader.start()
        try:
            self.initialized = self.rpc(
                "initialize",
                {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "plugin-lifecycle-smoke", "version": "1"},
                },
            )
            self.process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
            self.process.stdin.flush()
        except BaseException:
            self.close(crash=True)
            raise

    def rpc(self, method, params, *, allow_error=False):
        self.next_id += 1
        self.process.stdin.write(
            json.dumps({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params})
            + "\n"
        )
        self.process.stdin.flush()
        while True:
            reply = self.replies.get(timeout=25)
            assert "bad_stdout" not in reply, reply
            assert reply.get("jsonrpc") == "2.0", reply
            if reply.get("id") == self.next_id:
                if allow_error and "error" in reply:
                    return {"error": reply["error"]}
                assert "error" not in reply, reply
                return reply["result"]

    def call(self, tool_name, **arguments):
        result = self.rpc("tools/call", {"name": tool_name, "arguments": arguments})
        assert not result.get("isError"), result
        return result["structuredContent"]

    def close(self, *, crash=False):
        if self.process.poll() is None:
            if crash:
                self.process.kill()
            else:
                self.process.stdin.close()
            self.process.wait(timeout=10)
        for reader in self.readers:
            reader.join(timeout=3)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()


def get(url):
    with urlopen(url, timeout=5) as response:
        return json.load(response)


def exercise(executable, output):
    home = output / "user home café"
    home.mkdir()
    root = output / "projects café"
    root.mkdir()
    env = {**os.environ, "HOME": str(home), "PATH": "/unavailable"}
    # This smoke targets the initial native macOS bundle. Other targets need OS-specific selection.
    settings = home / "Library/Application Support/Scene Forge"
    settings.mkdir(parents=True)
    info = root.stat()
    (settings / "selection.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "mode": "root",
                "path": str(root),
                "identity": [info.st_dev, info.st_ino],
            }
        )
    )
    clients = []
    opened = None
    last = None
    try:
        first = Client(executable, ["--plugin"], env)
        clients.append(first)
        names = {t["name"] for t in first.rpc("tools/list", {})["tools"]}
        assert "plugin_browser" in names and len(names) <= 32
        created = first.call("create_project", name="Design")
        candidate = first.call(
            "create_artwork",
            project="design",
            project_revision=created["revision"],
            atlas_id="tile",
            name="Unpublished tile",
            kind="tile",
            width=8,
            height=8,
            compact=True,
        )
        review = first.call("review_artwork_candidate", project="design", candidate=candidate)
        resource = review["after"]["native_resource"]["uri"]
        first.call(
            "commit_artwork", project="design", candidate=candidate, receipt=review["receipt"]
        )
        catalog = first.call("get_project", project="design")
        scene = first.call(
            "create_scene",
            project="design",
            project_revision=catalog["revision"],
            name="Garden",
            width=2,
            height=2,
            grid=8,
        )
        opened = first.call("plugin_browser", project="design", action="open", scene_id=scene["id"])
        origin = opened["url"].split("scenes/")[0]
        assert get(origin + "api/project")["project"]["id"] == created["project"]["id"]
        second = Client(executable, ["--plugin"], env)
        clients.append(second)
        shared = second.call("plugin_browser", project="design", action="open")
        assert shared["instance"] == opened["instance"] and shared["url"] == origin
        launcher = subprocess.run(
            [str(executable), "browser", "--plugin", "--project-name", "design", "--no-browser"],
            env=env,
            cwd=executable.parent,
            capture_output=True,
            text=True,
            timeout=15,
        )
        assert launcher.returncode == 0 and not launcher.stdout, launcher
        assert origin in launcher.stderr, launcher
        first.close(crash=True)
        assert get(origin + "api/scene/" + scene["id"])["id"] == scene["id"]
        second.close()
        last = Client(executable, ["--plugin"], env)
        clients.append(last)
        reopened = last.call("plugin_browser", project="design", action="open")
        assert reopened["instance"] == opened["instance"]
        expired = last.rpc("resources/read", {"uri": resource}, allow_error=True)
        assert expired.get("isError") or "expired" in json.dumps(expired).lower(), expired
        retained = last.call("list_artwork_candidates", project="design")
        assert candidate["handle"] in {c["handle"] for c in retained["candidates"]}
        assert (
            last.call("get_scene", project="design", scene_id=scene["id"])["scene"]
            == scene["scene"]
        )
        last.call("plugin_browser", project="design", action="stop", instance=opened["instance"])
        restarted = last.call("plugin_browser", project="design", action="open")
        assert restarted["url"] == origin and restarted["instance"] != opened["instance"]
        opened = restarted
        # A URL alone cannot authorize an editor mutation.
        try:
            with urlopen(
                Request(
                    origin + "api/create-scene",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                ),
                timeout=5,
            ):
                raise AssertionError("Mutation accepted without a token")
        except HTTPError as error:
            assert error.code == 403
        result = {
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "host": platform.platform(),
            "runtime_version": last.initialized["serverInfo"]["version"],
            "runtime_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
            "selection": "Synthetic root grant in an isolated HOME; no native dialog or Codex install",
            "runtime_path": "Empty; no developer executables available",
            "shared_across_sessions": True,
            "browser_launcher_reuses_instance": True,
            "abrupt_mcp_exit_browser_survives": True,
            "normal_mcp_exit_browser_survives": True,
            "restart_preserves_origin": True,
            "saved_scene_and_candidate_survive": True,
            "session_preview_expired": True,
            "tool_count": len(names),
        }
        (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        return result
    finally:
        try:
            if opened:
                active = next((c for c in reversed(clients) if c.process.poll() is None), None)
                if active is None:
                    active = Client(executable, ["--plugin"], env)
                    clients.append(active)
                status = active.call("plugin_browser", project="design", action="status")
                if status["running"]:
                    active.call(
                        "plugin_browser",
                        project="design",
                        action="stop",
                        instance=status["instance"],
                    )
        finally:
            for client in clients:
                client.close()
            (output / "stderr.log").write_text("".join(line for c in clients for line in c.errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    print(json.dumps(exercise(args.runtime.resolve(), args.output), indent=2))


if __name__ == "__main__":
    main()
