"""Install/update/rollback the repository plugin in isolated native client state.

Synthetic grants and a synthetic second plugin version exercise delivery, not a
new-user study. No model credentials or user client configuration are read.
"""

import argparse
import hashlib
import json
import os
import queue
import shutil
import subprocess
import tarfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from plugin_lifecycle_smoke import Client

SELECTOR = "scene-forge@scene-forge-repository"


def files(root):
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob("*")
        if p.is_file()
    }


class NativeClient:
    def __init__(self, codex, env, cwd):
        command = [codex]
        command += ["app-server", "--stdio"]
        self.log = (cwd / "native-client.log").open("a")
        self.process = subprocess.Popen(
            command,
            env=env,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.log,
            text=True,
        )
        self.messages = queue.Queue()
        self.serial = 0

        def capture():
            for line in self.process.stdout:
                self.messages.put(json.loads(line))

        self.reader = threading.Thread(target=capture, daemon=True)
        self.reader.start()
        self.rpc(
            "initialize",
            {
                "clientInfo": {"name": "forge-delivery", "version": "1"},
                "capabilities": {"experimentalApi": True},
            },
        )
        self.process.stdin.write('{"method":"initialized"}\n')
        self.process.stdin.flush()
        self.thread = self.rpc("thread/start", {"cwd": str(cwd), "ephemeral": True})["thread"]["id"]

    def rpc(self, method, params, *, allow_error=False):
        self.serial += 1
        self.process.stdin.write(
            json.dumps({"id": self.serial, "method": method, "params": params}) + "\n"
        )
        self.process.stdin.flush()
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            reply = self.messages.get(timeout=max(0.01, deadline - time.monotonic()))
            if reply.get("id") == self.serial:
                if allow_error and "error" in reply:
                    return {"error": reply["error"]}
                assert "error" not in reply, reply
                return reply["result"]
            assert not ("id" in reply and "method" in reply), reply
        raise RuntimeError(f"Native client timed out: {method}")

    def servers(self):
        result = self.rpc("mcpServerStatus/list", {"threadId": self.thread})
        return [s for s in result["data"] if "forge" in s["name"]]

    def status(self, *, allow_error=False):
        servers = self.servers()
        assert len(servers) == 1 and "plugin_status" in servers[0]["tools"], servers
        result = self.rpc(
            "mcpServer/tool/call",
            {
                "threadId": self.thread,
                "server": servers[0]["name"],
                "tool": "plugin_status",
                "arguments": {},
            },
        )
        if allow_error:
            return result
        assert not result.get("isError"), result
        return result["structuredContent"]

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=5)
        self.reader.join(timeout=3)
        self.process.stdout.close()
        self.log.close()


def exercise(archive, codex, output):
    home = output / "user home café"
    state = output / "client state"
    home.mkdir()
    state.mkdir()
    env = {**os.environ, "HOME": str(home), "CODEX_HOME": str(state)}
    # Keep runtime paths isolated while allowing the native client executable itself.
    runtime_env = {
        **env,
        "PATH": "/unavailable",
        "PYTHONHOME": "/unavailable",
        "PYTHONPATH": "/unavailable",
    }

    def cli(*arguments):
        result = subprocess.run(
            [codex, "plugin", *arguments, "--json"],
            env=env,
            capture_output=True,
            text=True,
            timeout=55,
        )
        with (output / "installation.log").open("a") as log:
            log.write(result.stdout + result.stderr)
        result.check_returncode()
        return json.loads(result.stdout)

    source = output / "repository source café"
    source.mkdir()
    with tarfile.open(archive) as stream:
        stream.extractall(source, filter="data")
    original = next(source.iterdir())
    original_plugin = original / "plugins/scene-forge"
    version = json.loads((original_plugin / "plugin.json").read_text())["version"]
    cli("marketplace", "add", str(original))
    cli("add", SELECTOR)
    installed = state / "plugins/cache/scene-forge-repository/scene-forge" / version
    assert (installed / "runtime/forge").exists(), list(
        (state / "plugins/cache").rglob("plugin.json")
    )
    initial_files = files(installed)
    # All normal launch tests run with no Python/Node/developer tools on PATH.
    identity = json.loads(
        subprocess.check_output([installed / "bin/forge", "--identity"], env=runtime_env, text=True)
    )["installation"]
    settings = home / "Library/Application Support/Scene Forge"
    settings.mkdir(parents=True)
    projects = output / "projects café"
    projects.mkdir()
    info = projects.stat()
    (settings / "selection.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "mode": "root",
                "path": str(projects),
                "identity": [info.st_dev, info.st_ino],
            }
        )
    )
    deliberate = home / "browser profile/workspace-layout.json"
    deliberate.parent.mkdir()
    deliberate.write_text('{"inspector":"collapsed"}')
    clients = []
    browser = None
    current = None
    try:
        direct = Client(installed / "bin/forge", ["--plugin"], runtime_env)
        clients.append(direct)
        created = direct.call("create_project", name="Delivery")
        candidate = direct.call(
            "create_artwork",
            project="delivery",
            project_revision=created["revision"],
            atlas_id="tile",
            name="Unpublished tile",
            kind="tile",
            width=8,
            height=8,
            compact=True,
        )
        browser = direct.call("plugin_browser", project="delivery", action="open")
        assert direct.call("list_artwork_candidates", project="delivery")
        owned = {
            "projects": files(projects),
            "settings": files(settings),
            "layout": deliberate.read_bytes().decode(),
        }
        native = NativeClient(codex, runtime_env, output)
        clients.append(native)
        status = native.status()
        assert status["installation"] == identity, status
        details = native.rpc(
            "plugin/read",
            {
                "pluginName": "scene-forge",
                "marketplacePath": str(original / ".agents/plugins/marketplace.json"),
            },
        )
        (output / "plugin-detail.json").write_text(json.dumps(details, indent=2) + "\n")
        assert {
            "scene-forge:forge-start",
            "scene-forge:forge-artwork",
            "scene-forge:forge-animation",
        } <= {skill["name"] for skill in details["plugin"]["skills"]}
        assert "forge" in details["plugin"]["mcpServers"]
        # A partial new source is rejected by the installed runtime before selection access.
        broken = output / "interrupted copy"
        shutil.copytree(installed, broken, symlinks=True)
        (broken / "install.json").unlink()
        rejected = subprocess.run(
            [broken / "bin/forge", "mcp", "--plugin"],
            env=runtime_env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert rejected.returncode == 2 and not rejected.stdout, rejected
        assert files(installed) == initial_files
        # A second plugin release with identical Forge version but distinct content identity.
        update = output / "synthetic updated source"
        shutil.copytree(original, update, symlinks=True)
        updated_plugin = update / "plugins/scene-forge"
        manifest_path = updated_plugin / "plugin.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["version"] = "0.1.0-alpha.2"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        receipt_path = updated_plugin / "install.json"
        receipt = json.loads(receipt_path.read_text())
        receipt["plugin_version"] = manifest["version"]
        receipt["files"]["plugin.json"]["sha256"] = hashlib.sha256(
            manifest_path.read_bytes()
        ).hexdigest()
        receipt["build_id"] = hashlib.sha256(
            json.dumps(receipt["files"], sort_keys=True).encode()
        ).hexdigest()
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        cli("marketplace", "remove", "scene-forge-repository")
        cli("marketplace", "add", str(update))
        cli("add", SELECTOR)
        current = NativeClient(codex, runtime_env, output)
        clients.append(current)
        assert current.status()["installation"]["plugin_version"] == "0.1.0-alpha.2"
        # This client removes the previous cache even for a distinct plugin version.
        assert not installed.exists()
        stale = native.status(allow_error=True)
        assert stale.get("isError") and "installation changed" in str(stale), stale
        from urllib.error import HTTPError
        from urllib.request import urlopen

        try:
            urlopen(browser["url"] + "api/project", timeout=5)
        except HTTPError as error:
            assert error.code == 409 and "installation changed" in error.read().decode()
        else:
            raise AssertionError("Old browser served project data after its cache was removed")
        updated_cache = installed.parent / "0.1.0-alpha.2"
        second = Client(updated_cache / "bin/forge", ["--plugin"], runtime_env)
        clients.append(second)
        mismatch = second.rpc(
            "tools/call",
            {"name": "plugin_browser", "arguments": {"project": "delivery", "action": "open"}},
        )
        assert mismatch.get("isError") and "different runtime" in str(mismatch), mismatch
        second.call(
            "plugin_browser", project="delivery", action="stop", instance=browser["instance"]
        )
        reopened = second.call("plugin_browser", project="delivery", action="open")
        assert reopened["url"] == browser["url"]
        browser = reopened
        second.call(
            "plugin_browser", project="delivery", action="stop", instance=reopened["instance"]
        )
        browser = None
        # This client's plugin loader reads persisted enabled state, rather than
        # the generic -c override. Modify only this test's isolated configuration.
        config_path = state / "config.toml"
        previous_config = config_path.read_text()
        assert previous_config.count("enabled = true") == 1
        config_path.write_text(previous_config.replace("enabled = true", "enabled = false"))
        try:
            disabled = NativeClient(codex, runtime_env, output)
            clients.append(disabled)
            assert disabled.servers() == []
        finally:
            config_path.write_text(previous_config)
        # Rollback reselects the previous complete repository, without a format migration.
        cli("marketplace", "remove", "scene-forge-repository")
        cli("marketplace", "add", str(original))
        cli("add", SELECTOR)
        rollback = NativeClient(codex, runtime_env, output)
        clients.append(rollback)
        assert rollback.status()["installation"] == identity
        # Fresh rollback uses the original complete build and preserved candidate inventory.
        assert direct.call("list_artwork_candidates", project="delivery")
        for client in clients:
            client.close()
        clients.clear()
        cli("remove", SELECTOR)
        assert not installed.parent.exists(), "Uninstall left the plugin cache behind"
        removed = NativeClient(codex, runtime_env, output)
        try:
            assert removed.servers() == []
        finally:
            removed.close()
        cli("marketplace", "remove", "scene-forge-repository")
        assert owned == {
            "projects": files(projects),
            "settings": files(settings),
            "layout": deliberate.read_bytes().decode(),
        }
        return {
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "codex": subprocess.check_output([codex, "--version"], env=env, text=True).strip(),
            "identity": identity,
            "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "installed_cache": "Previous cache removed on update; old session rejected calls",
            "native_status": True,
            "interrupted_copy_rejected": True,
            "update": True,
            "cross_build_browser_reuse_rejected": True,
            "browser_origin_preserved_across_update": True,
            "rollback": True,
            "disable": True,
            "uninstall": True,
            "projects_candidates_settings_layout_preserved": True,
            "candidate_handle": candidate,
            "limits": "Synthetic selection/version/layout; no model turn, real browser storage, "
            "human usability, Git-hosted source, signed download or clean-OS test.",
        }
    finally:
        if browser:
            try:
                # Restore only this test's old cache so its own browser can be stopped.
                if not installed.exists():
                    shutil.copytree(original_plugin, installed, symlinks=True)
                direct.call(
                    "plugin_browser",
                    project="delivery",
                    action="stop",
                    instance=browser["instance"],
                )
            except Exception:
                pass
        for client in clients:
            client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    result = exercise(
        args.archive.resolve(strict=True), str(args.codex.resolve(strict=True)), output
    )
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
