"""Exercise the installed Codex app-server's MCP connection without a model turn."""

import base64
import io
import json
import queue
import subprocess
import threading
import time
import zipfile


def probe(codex, env, cwd, project, candidate, output):
    messages = queue.Queue()
    with (output / "client.log").open("w") as log:
        process = subprocess.Popen(
            [codex, "app-server", "--stdio"],
            env=env,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=log,
            text=True,
            bufsize=1,
        )

        def capture():
            for line in process.stdout:
                messages.put(json.loads(line))

        reader = threading.Thread(target=capture, daemon=True)
        reader.start()
        serial = 0

        def rpc(method, params):
            nonlocal serial
            serial += 1
            process.stdin.write(
                json.dumps({"id": serial, "method": method, "params": params}) + "\n"
            )
            process.stdin.flush()
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                item = messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if item.get("id") == serial:
                    if "error" in item:
                        raise RuntimeError(f"{method}: {item['error']}")
                    return item["result"]
                if "id" in item and "method" in item:
                    raise RuntimeError(f"Unexpected client approval request: {item['method']}")
            raise RuntimeError(f"Client timeout: {method}")

        try:
            info = rpc(
                "initialize",
                {
                    "clientInfo": {"name": "forge-probe", "version": "0.1"},
                    "capabilities": {"experimentalApi": True},
                },
            )
            process.stdin.write('{"method":"initialized"}\n')
            process.stdin.flush()
            listing = rpc("plugin/list", {"cwds": [str(cwd)], "marketplaceKinds": ["local"]})
            (output / "client-plugins.json").write_text(json.dumps(listing, indent=2) + "\n")
            for marketplace in listing["marketplaces"]:
                detail = rpc(
                    "plugin/read",
                    {"pluginName": "forge-authoring-probe", "marketplacePath": marketplace["path"]},
                )
                (output / "client-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
            thread = rpc("thread/start", {"cwd": str(cwd), "ephemeral": True})
            (output / "client-thread.json").write_text(json.dumps(thread, indent=2) + "\n")
            thread_id = thread["thread"]["id"]
            status = rpc("mcpServerStatus/list", {"threadId": thread_id})
            (output / "client-status.json").write_text(json.dumps(status, indent=2) + "\n")
            servers = [item for item in status["data"] if "forge" in item["name"]]
            if len(servers) != 1:
                raise RuntimeError(f"Expected one installed Forge server: {status}")
            server = servers[0]
            if not server["tools"]:
                raise RuntimeError(f"No installed Forge tools: {server}")

            def tool(name, **arguments):
                response = rpc(
                    "mcpServer/tool/call",
                    {
                        "threadId": thread_id,
                        "server": server["name"],
                        "tool": name,
                        "arguments": {"project": project, **arguments},
                    },
                )
                if response.get("isError"):
                    raise RuntimeError(f"Client {name}: {response}")
                return response

            read = tool("get_project")["structuredContent"]
            inventory = tool("list_artwork", project_revision=read["revision"])["structuredContent"]
            document = inventory["documents"][0]
            opened = tool(
                "open_artwork",
                project_revision=read["revision"],
                artwork_revision=document["artwork_revision"],
                target=document["target"],
            )["structuredContent"]
            assert opened["rgba"] == candidate["rgba"]
            edited = tool(
                "edit_artwork_pixels",
                candidate=opened,
                writes=[{"x": 3, "y": 3, "rgba": [255, 240, 160, 255]}],
            )["structuredContent"]
            preview = tool("review_artwork_candidate", candidate=edited)
            images = [item for item in preview["content"] if item["type"] == "image"]
            assert images, "The client did not receive inline review images"
            for index, image in enumerate(images):
                (output / f"client-preview-{index}.png").write_bytes(
                    base64.b64decode(image["data"])
                )
            committed = tool(
                "commit_artwork", candidate=edited, receipt=preview["structuredContent"]["receipt"]
            )["structuredContent"]
            final_read = tool("get_project")["structuredContent"]
            assert final_read["revision"] == committed["project_revision"]
            inventory = tool("list_artwork", project_revision=final_read["revision"])[
                "structuredContent"
            ]
            document = inventory["documents"][0]
            reopened = tool(
                "open_artwork",
                project_revision=final_read["revision"],
                artwork_revision=document["artwork_revision"],
                target=document["target"],
            )["structuredContent"]
            assert reopened["rgba"] == edited["rgba"]
            assert reopened["descriptor"] == edited["descriptor"]

            def resource(uri):
                content = rpc(
                    "mcpServer/resource/read",
                    {"threadId": thread_id, "server": server["name"], "uri": uri},
                )["contents"][0]
                return base64.b64decode(content["blob"])

            native = resource(preview["structuredContent"]["after"]["native_resource"]["uri"])
            export = tool(
                "export_bundle", project_revision=final_read["revision"], scope="project"
            )["structuredContent"]
            data = resource(export["resource"]["uri"])
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                assert archive.read("assets/lantern/atlas.png") == native
            (output / "client-project.zip").write_bytes(data)
            (output / "client-candidate.json").write_text(json.dumps(edited, indent=2) + "\n")
            (output / "client-preview.json").write_text(json.dumps(preview, indent=2) + "\n")
            return {
                "client": info,
                "server": server["name"],
                "tool_count": len(server["tools"]),
                "saved_project_revision": read["revision"],
                "committed": committed,
                "inline_png_count": len(images),
                "reopened_exact_candidate": True,
                "export_matches_reviewed_png": True,
                "preview_response_file": "client-preview.json",
                "model_turn": False,
                "user_visible_image_review": "not exercised",
            }
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
            reader.join(timeout=5)
            process.stdout.close()
