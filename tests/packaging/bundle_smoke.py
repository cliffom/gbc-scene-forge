"""Exercise a relocated read-only executable using the official MCP SDK, without Forge imports.

The driver needs the SDK; the child gets an empty PATH and no developer runtime.
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
import threading
import time
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def snapshot(folder):
    return {
        str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in folder.rglob("*")
        if path.is_file()
    }


async def exercise(executable, root, env, output, version):
    params = StdioServerParameters(
        command=str(executable),
        args=["mcp", "--project-root", str(root)],
        env=env,
        cwd=str(executable.parent),
    )
    started = time.monotonic()
    async with stdio_client(params) as streams, ClientSession(*streams) as client:
        initialized = await client.initialize()
        startup = round(time.monotonic() - started, 3)
        require(initialized.serverInfo.version == version, "Server version differs from bundle")
        tools = await client.list_tools()
        require(any(tool.name == "create_artwork_sheet" for tool in tools.tools), "Missing tools")

        async def call(tool_name, **arguments):
            response = await client.call_tool(tool_name, arguments)
            require(not response.isError, f"{tool_name}: {response}")
            return response.structuredContent

        async def resource(item):
            content = (await client.read_resource(item["uri"])).contents[0]
            return (
                content.text.encode()
                if hasattr(content, "text")
                else base64.b64decode(content.blob)
            )

        created = await call("create_project", name="Bundle café", starter="empty")
        project = created["directory"]
        candidate = await call(
            "create_artwork_sheet",
            project=project,
            project_revision=created["revision"],
            atlas_id="grass",
            name="Grass",
            kind="tile",
            width=8,
            height=8,
            frames=[
                {
                    "id": "ground",
                    "name": "Ground",
                    "kind": "tile",
                    "x": 0,
                    "y": 0,
                    "width": 8,
                    "height": 8,
                    "origin": [0, 0],
                }
            ],
            sequences=[],
        )
        original = await call("review_artwork_candidate", project=project, candidate=candidate)
        candidate = await call(
            "edit_artwork_pixels",
            project=project,
            candidate=candidate,
            writes=[{"x": 0, "y": 0, "rgba": [12, 144, 56, 255]}],
        )
        stale = await client.call_tool(
            "commit_artwork",
            {"project": project, "candidate": candidate, "receipt": original["receipt"]},
        )
        require(
            stale.isError and stale.structuredContent["error"]["code"] == "conflict",
            "Stale save accepted",
        )
        review = await call("review_artwork_candidate", project=project, candidate=candidate)
        native = await resource(review["after"]["native_resource"])
        require(native.startswith(b"\x89PNG"), "No native artwork render")
        committed = await call(
            "commit_artwork", project=project, candidate=candidate, receipt=review["receipt"]
        )
        documents = await call(
            "list_artwork", project=project, project_revision=committed["project_revision"]
        )
        document = documents["documents"][0]
        reopened = await call(
            "open_artwork",
            project=project,
            project_revision=committed["project_revision"],
            target=document["target"],
            artwork_revision=document["artwork_revision"],
        )
        require(reopened["rgba"] == candidate["rgba"], "Reopened artwork differs")
        require(reopened["descriptor"] == candidate["descriptor"], "Reopened descriptor differs")
        scene = await call(
            "create_scene",
            project=project,
            project_revision=committed["project_revision"],
            name="Garden",
            width=2,
            height=2,
            grid=8,
        )
        model = scene["scene"]
        # Use the frame's declared id rather than assuming a native-sheet frame name.
        frame = candidate["descriptor"]["frames"][0]["id"]
        model["cells"][0][0] = f"grass/{frame}/0/0"
        saved = await call(
            "save_scene",
            project=project,
            project_revision=scene["project_revision"],
            scene_id=scene["id"],
            scene_revision=scene["revision"],
            scene=model,
        )
        loaded = await call("get_scene", project=project, scene_id=scene["id"])
        require(loaded["scene"] == saved["scene"], "Saved scene differs")
        rendered = await call(
            "review_artwork",
            project=project,
            project_revision=loaded["project_revision"],
            scene_id=scene["id"],
            scene_revision=loaded["revision"],
        )
        scene_png = await resource(rendered["overview_resource"])
        require(scene_png.startswith(b"\x89PNG"), "No scene render")
        exported = await call(
            "export_bundle",
            project=project,
            project_revision=loaded["project_revision"],
            scope="project",
        )
        payload = await resource(exported["resource"])
        (output / "project.zip").write_bytes(payload)
        (output / "artwork.png").write_bytes(native)
        (output / "scene.png").write_bytes(scene_png)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            require("forge.project.json" in archive.namelist(), "Missing portable project")
            require(f"scenes/{scene['id']}.tmj" in archive.namelist(), "Missing Tiled map")
            require(archive.read("assets/grass/atlas.png") == native, "Exported artwork differs")
            archive.extractall(root / "exported")
        project_revision = loaded["project_revision"]
    # Reconnect to the exported portable project through the explicit single-project mode.
    params.args = ["mcp", "--project", str(root / "exported")]
    async with stdio_client(params) as streams, ClientSession(*streams) as client:
        await client.initialize()
        reopened = await client.call_tool(
            "get_scene", {"project": "project", "scene_id": scene["id"]}
        )
        require(
            not reopened.isError and reopened.structuredContent["scene"] == saved["scene"],
            "Export cannot reopen",
        )
    params.args = ["mcp", "--project-root", str(root)]
    async with stdio_client(params) as streams, ClientSession(*streams) as client:
        await client.initialize()
        reopened = await client.call_tool("get_project", {"project": project})
        require(
            not reopened.isError and reopened.structuredContent["revision"] == project_revision,
            "Restart differs",
        )
    return {
        "initialize_seconds": startup,
        "tool_count": len(tools.tools),
        "project": project,
        "scene_id": scene["id"],
    }


def framing(executable, root, env):
    messages = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "bundle-framing", "version": "1"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    ]
    result = subprocess.run(
        [str(executable), "mcp", "--project-root", str(root)],
        input="".join(json.dumps(message) + "\n" for message in messages),
        capture_output=True,
        text=True,
        env=env,
        cwd=executable.parent,
        timeout=20,
        check=True,
    )
    replies = [json.loads(line) for line in result.stdout.splitlines()]
    require({reply.get("id") for reply in replies} >= {1, 2}, "Missing protocol replies")
    require(all(reply.get("jsonrpc") == "2.0" for reply in replies), "Non-protocol stdout")


def browser(executable, root, env, output, project, scene_id):
    process = subprocess.Popen(
        [str(executable), "browser", "--project-root", str(root), "--port", "0", "--no-browser"],
        cwd=executable.parent,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    lines = queue.Queue()
    log = []

    def collect():
        for line in process.stderr:
            log.append(line)
            lines.put(line)
        lines.put(None)

    reader = threading.Thread(target=collect, daemon=True)
    reader.start()
    try:
        while True:
            line = lines.get(timeout=20)
            require(line is not None, "Browser exited before ready: " + "".join(log))
            match = re.search(r"http://127\.0\.0\.1:\d+/", line)
            if match:
                url = match[0]
                break
        base = url + f"projects/{project}/"
        for path in (
            "",
            "project.js",
            "project.css",
            "branding/logo-64.png",
        ):
            with urlopen(base + path, timeout=5) as response:
                require(response.status == 200 and response.read(), "Missing asset: " + path)
        with urlopen(base + f"api/scene/{scene_id}", timeout=5) as response:
            require(json.load(response)["id"] == scene_id, "Browser scene differs")
        with urlopen(url + "api/project", timeout=5) as response:
            token = json.load(response)["token"]
        request = Request(
            url + "api/create-project",
            data=json.dumps({"name": "Bundled demo", "starter": "sample"}).encode(),
            headers={"Content-Type": "application/json", "X-Scene-Token": token},
        )
        try:
            with urlopen(request, timeout=5) as response:
                sample = json.load(response)["directory"]
        except HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        with urlopen(url + f"projects/{sample}/api/project", timeout=5) as response:
            require(len(json.load(response)["project"]["scenes"]) == 2, "Missing bundled demo")
        return {"assets_served": True, "sample_restored": True, "url": base}
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        reader.join(timeout=5)
        require(process.stdout.read() == "", "Browser diagnostics leaked to stdout")
        process.stdout.close()
        process.stderr.close()
        (output / "browser.log").write_text("".join(log))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New disposable directory")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    copied = output / "original location"
    shutil.copytree(args.bundle, copied, symlinks=True)
    bundle = output / "moved runtime café"
    copied.rename(bundle)
    executable = bundle / "forge"
    require(executable.stat().st_mode & 0o111, "Executable permission lost")
    manifest = json.loads((bundle / "bundle.json").read_text())
    root = output / "projects café"
    root.mkdir()
    empty = output / "empty PATH"
    empty.mkdir()
    env = {
        **os.environ,
        "PATH": str(empty),
        "PYTHONHOME": "/unavailable",
        "PYTHONPATH": "/unavailable",
    }
    modes = {}
    for path in [bundle, *bundle.rglob("*")]:
        if not path.is_symlink():
            modes[path] = path.stat().st_mode & 0o777
            path.chmod(modes[path] & ~0o222)
    before = snapshot(bundle)
    try:
        for option in ("--version", "--help"):
            result = subprocess.run(
                [str(executable), option],
                env=env,
                cwd=bundle,
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            require("Scene Forge" in result.stdout and not result.stderr, "Invalid help/version")
        for selection in ("relative", str(bundle), str(output)):
            result = subprocess.run(
                [str(executable), "mcp", "--project-root", selection],
                env=env,
                cwd=bundle,
                capture_output=True,
                text=True,
                timeout=10,
            )
            require(result.returncode == 2 and not result.stdout, "Unsafe selection accepted")
        framing(executable, root, env)
        result = asyncio.run(exercise(executable, root, env, output, manifest["version"]))
        result["browser"] = browser(
            executable, root, env, output, result["project"], result["scene_id"]
        )
        require(before == snapshot(bundle), "Read-only bundle changed")
        result.update(
            host=platform.platform(),
            version=manifest["version"],
            bundle_inputs=manifest["inputs"],
            readonly_unchanged=True,
            runtime_path_empty=True,
        )
        (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
    finally:
        for path, mode in modes.items():
            path.chmod(mode)


if __name__ == "__main__":
    main()
