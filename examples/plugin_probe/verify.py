"""Install a probe with Codex in disposable state, then exercise its installed runtime.

This verifies SDK transport and HTTP content, not a model turn or client image UI.
"""

import argparse
import asyncio
import base64
import hashlib
import io
import json
import os
import platform
import queue
import re
import shutil
import subprocess
import tarfile
import threading
import time
import zipfile
from pathlib import Path
from urllib.request import urlopen

from client import probe
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

PLUGIN = "forge-authoring-probe"


def files(root):
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob("*")
        if p.is_file()
    }


async def exercise(plugin, output, environment):
    config = json.loads((plugin / "mcp.json").read_text())["mcpServers"]["forge"]
    command = str(plugin / config["command"])
    env = {**environment, **config["env"]}
    assert Path(command).is_relative_to(plugin)
    started = time.monotonic()
    params = StdioServerParameters(command=command, args=config["args"], env=env, cwd=str(plugin))
    result = {
        "calls": [],
        "model_image_inspection": "not exercised",
        "client_image_display": "not exercised",
        "apng_playback": "not exercised",
    }
    async with stdio_client(params) as streams, ClientSession(*streams) as client:
        initialized = await client.initialize()
        result["initialize_seconds"] = round(time.monotonic() - started, 3)
        result["server"] = initialized.serverInfo.model_dump()
        result["tool_count"] = len((await client.list_tools()).tools)

        async def call(tool_name, **arguments):
            response = await client.call_tool(tool_name, arguments)
            if response.isError:
                raise RuntimeError(f"{tool_name}: {response.structuredContent}")
            result["calls"].append(tool_name)
            return response

        async def resource(item, filename):
            contents = (await client.read_resource(item["uri"])).contents[0]
            payload = (
                contents.text.encode()
                if hasattr(contents, "text")
                else base64.b64decode(contents.blob)
            )
            (output / filename).write_bytes(payload)
            return payload

        created = (
            await call("create_project", name="Probe " + output.name, starter="empty")
        ).structuredContent
        project = created["directory"]
        revision = created["revision"]
        frames = [
            {
                "id": key,
                "name": key,
                "kind": "sprite",
                "x": x,
                "y": 0,
                "width": 8,
                "height": 8,
                "origin": [0, 0],
            }
            for key, x in (("idle", 0), ("glow", 8))
        ]
        sequences = [
            {
                "id": "blink",
                "name": "Blink",
                "loop": True,
                "frames": [
                    {"frame_id": "idle", "duration_ms": 120},
                    {"frame_id": "glow", "duration_ms": 240},
                ],
            }
        ]
        candidate = (
            await call(
                "create_artwork_sheet",
                project=project,
                project_revision=revision,
                atlas_id="lantern",
                name="Lantern",
                kind="sprite",
                width=16,
                height=8,
                frames=frames,
                sequences=sequences,
            )
        ).structuredContent
        writes = [
            {"x": x + offset, "y": y, "rgba": color}
            for offset, color in ((0, [244, 176, 64, 255]), (8, [120, 224, 240, 255]))
            for y in range(1, 7)
            for x in range(2, 6)
        ]
        original_review = (
            await call("review_artwork_candidate", project=project, candidate=candidate)
        ).structuredContent
        candidate = (
            await call("edit_artwork_pixels", project=project, candidate=candidate, writes=writes)
        ).structuredContent
        stale = await client.call_tool(
            "commit_artwork",
            {"project": project, "candidate": candidate, "receipt": original_review["receipt"]},
        )
        assert stale.isError and stale.structuredContent["error"]["code"] == "conflict"
        review_response = await call(
            "review_artwork_candidate", project=project, candidate=candidate
        )
        review = review_response.structuredContent
        assert any(c.type == "image" and c.mimeType == "image/png" for c in review_response.content)
        native = await resource(review["after"]["native_resource"], "native.png")
        assert native.startswith(b"\x89PNG")
        for item in review["resources"]:
            if "enlarged" in item["name"]:
                await resource(item, "enlarged.png")
                break
        contact = (
            await call(
                "inspect_artwork_candidate",
                project=project,
                candidate=candidate,
                rectangles=[
                    {"x": 0, "y": 0, "width": 8, "height": 8},
                    {"x": 8, "y": 0, "width": 8, "height": 8},
                ],
                scale=8,
                format="png",
            )
        ).structuredContent
        await resource(contact["resource"], "frames.png")
        animation = (
            await call(
                "review_artwork_animation",
                project=project,
                candidate=candidate,
                sequence_id="blink",
                scale=4,
            )
        ).structuredContent
        apng = await resource(animation["animation_resource"], "animation.apng")
        assert b"acTL" in apng
        committed = (
            await call(
                "commit_artwork", project=project, candidate=candidate, receipt=review["receipt"]
            )
        ).structuredContent
        inventory = (
            await call(
                "list_artwork", project=project, project_revision=committed["project_revision"]
            )
        ).structuredContent
        document = inventory["documents"][0]
        reopened = (
            await call(
                "open_artwork",
                project=project,
                project_revision=committed["project_revision"],
                target=document["target"],
                artwork_revision=document["artwork_revision"],
            )
        ).structuredContent
        assert reopened["rgba"] == candidate["rgba"]
        assert reopened["descriptor"] == candidate["descriptor"]
        scene = (
            await call(
                "create_scene",
                project=project,
                project_revision=committed["project_revision"],
                name="Workshop",
                width=4,
                height=4,
                grid=8,
            )
        ).structuredContent
        scene_id = scene["id"]
        model = scene["scene"]
        model["objects"] = [
            {
                "id": 1,
                "asset": "lantern/idle",
                "x": 8,
                "y": 8,
                "origin": [0, 0],
                "name": "Lantern",
                "class": "prop",
                "properties": [],
            }
        ]
        model["next_object_id"] = 2
        await call(
            "save_scene",
            project=project,
            project_revision=scene["project_revision"],
            scene_id=scene_id,
            scene_revision=scene["revision"],
            scene=model,
        )
        catalog = (await call("get_project", project=project)).structuredContent
        export = (
            await call(
                "export_bundle",
                project=project,
                project_revision=catalog["revision"],
                scope="project",
            )
        ).structuredContent
        data = await resource(export["resource"], "project.zip")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            assert "forge.project.json" in archive.namelist()
            assert f"scenes/{scene_id}.tmj" in archive.namelist()
            assert archive.read("assets/lantern/atlas.png") == native
        settings = json.loads(Path(config["env"]["FORGE_PLUGIN_PROBE_SETTINGS"]).read_text())
        root = Path(settings["project_root"])
        result.update(
            project=project,
            scene_id=scene_id,
            project_revision=catalog["revision"],
            stale_receipt_rejected=True,
            saved_rgba_and_descriptor_match=True,
        )
        (output / "candidate.json").write_text(json.dumps(candidate, indent=2) + "\n")
    # A fresh SDK connection must rediscover saved content; session previews are not reused.
    async with stdio_client(params) as streams, ClientSession(*streams) as client:
        await client.initialize()
        read = await client.call_tool("get_project", {"project": project})
        assert not read.isError and read.structuredContent["revision"] == result["project_revision"]
    result["restart_saved_read"] = True
    result["browser"] = browser(command, env, plugin, project, scene_id, output, root)
    return result


def browser(command, env, plugin, project, scene_id, output, root):
    lines = queue.Queue()
    with (output / "browser.log").open("w") as log:
        process = subprocess.Popen(
            [command, "browser", "--port", "0", "--no-browser"],
            cwd=plugin,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        def capture():
            for line in process.stdout:
                log.write(line)
                log.flush()
                lines.put(line)

        reader = threading.Thread(target=capture, daemon=True)
        reader.start()
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                line = lines.get(timeout=max(0.01, deadline - time.monotonic()))
                match = re.search(r"http://127\.0\.0\.1:\d+/", line)
                if match:
                    base = match[0] + f"projects/{project}/"
                    break
            else:
                raise RuntimeError("Bundled browser did not become ready")
            for path in ("", "project.js", "project.css", "branding/logo-64.png"):
                with urlopen(base + path, timeout=5) as response:
                    assert response.status == 200 and response.read()
            with urlopen(base + "api/project", timeout=5) as response:
                catalog = json.load(response)
            with urlopen(base + f"api/scene/{scene_id}", timeout=5) as response:
                saved = json.load(response)
            assert saved["id"] == scene_id
            with urlopen(
                base + "assets/lantern/atlas.png?revision=" + catalog["revision"], timeout=5
            ) as response:
                assert response.read() == (root / project / "assets/lantern/atlas.png").read_bytes()
            return {
                "url": base,
                "scene_id": saved["id"],
                "assets_served": True,
                "interactive_browser_review": "not exercised",
            }
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            reader.join(timeout=5)
            process.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New disposable directory")
    parser.add_argument("--codex", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    relocated = output / "moved source café"
    relocated.mkdir()
    with tarfile.open(args.archive) as archive:
        archive.extractall(relocated, filter="data")
    marketplace = next(relocated.iterdir())
    name = json.loads((marketplace / ".agents/plugins/marketplace.json").read_text())["name"]
    client_state = output / "client state"
    client_state.mkdir()
    # Redirect only child test processes; never read or rewrite the user's Codex settings/auth.
    env = {**os.environ, "CODEX_HOME": str(client_state)}
    codex = str(args.codex.resolve(strict=True))
    version = subprocess.check_output([codex, "--version"], env=env, text=True).strip()
    for command in (
        [codex, "plugin", "marketplace", "add", str(marketplace), "--json"],
        [codex, "plugin", "add", f"{PLUGIN}@{name}", "--json"],
    ):
        completed = subprocess.run(command, env=env, capture_output=True, text=True, timeout=60)
        with (output / "install.log").open("a") as log:
            log.write(completed.stdout + completed.stderr)
        completed.check_returncode()
    installed = list((client_state / "plugins/cache").rglob("plugin.json"))
    assert len(installed) == 1, installed
    plugin = installed[0].parent
    assert (plugin / "bin/forge").stat().st_mode & 0o111
    # Move the source away: installed execution must use the client's cache copy.
    shutil.move(marketplace, output / "source unavailable")
    for item in plugin.rglob("*"):
        if not item.is_symlink():
            item.chmod(item.stat().st_mode & ~0o222)
    plugin.chmod(0o555)
    before = files(plugin)
    empty_path = output / "empty PATH"
    empty_path.mkdir()
    env["PATH"] = str(empty_path)
    env["PYTHONPATH"] = "/intentionally/unavailable"
    env["PYTHONHOME"] = "/intentionally/unavailable"
    result = asyncio.run(exercise(plugin, output, env))
    shutil.move(output / "source unavailable", marketplace)
    (output / "sdk-report.json").write_text(json.dumps(result, indent=2) + "\n")
    result["codex_runtime"] = probe(
        codex,
        env,
        output,
        result["project"],
        json.loads((output / "candidate.json").read_text()),
        output,
    )
    config = json.loads((plugin / "mcp.json").read_text())["mcpServers"]["forge"]
    settings = json.loads(Path(config["env"]["FORGE_PLUGIN_PROBE_SETTINGS"]).read_text())
    with zipfile.ZipFile(output / "client-project.zip") as exported:
        assert (
            exported.read("assets/lantern/atlas.png")
            == (
                Path(settings["project_root"]) / result["project"] / "assets/lantern/atlas.png"
            ).read_bytes()
        )
    result["final_browser"] = browser(
        str(plugin / config["command"]),
        {**env, **config["env"]},
        plugin,
        result["project"],
        result["scene_id"],
        output,
        Path(settings["project_root"]),
    )
    assert before == files(plugin), "Installed bundle changed during execution"
    result.update(
        client=version,
        os=platform.platform(),
        architecture=platform.machine(),
        installed_plugin=str(plugin),
        readonly_bundle_unchanged=True,
        runtime_path_has_no_python_or_node=True,
    )
    (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
