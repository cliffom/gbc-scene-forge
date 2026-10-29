"""Run a real MCP SDK client against Forge; create, review, revise and export a plan.

Usage: python examples/mcp/opening_forest.py --root /tmp/forge-mcp --output /tmp/forge-review
The SDK is provided by the optional Forge [mcp] extra. No browser is automated.
"""

import argparse
import asyncio
import base64
import io
import json
import os
import sys
import zipfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def example(root, output):
    output.mkdir(parents=True, exist_ok=True)
    transcript = []
    params = StdioServerParameters(
        command=sys.executable,
        args=[
            "-m",
            "gbc_scene_forge.mcp_server",
            "--project-root",
            str(root),
        ],
        env=dict(os.environ),
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
        initialized = await client.initialize()
        transcript.append({"initialize": initialized.model_dump(mode="json", exclude_none=True)})

        async def call(tool_name, **arguments):
            result = await client.call_tool(tool_name, arguments)
            if result.isError:
                raise RuntimeError(result.content)
            value = result.structuredContent
            transcript.append({"tool": tool_name, "arguments": arguments, "result": value})
            return value

        async def download(resource, name):
            response = await client.read_resource(resource["uri"])
            content = response.contents[0]
            data = (
                content.text.encode()
                if hasattr(content, "text")
                else base64.b64decode(content.blob)
            )
            (output / name).write_bytes(data)
            return data

        await call("capabilities")
        await call("list_projects")
        project = await call("create_project", name="MCP forest", starter="blockout")
        directory = project["directory"]
        catalog = await call("get_project", project=directory)
        definitions = {
            next(f["default"] for f in d["fields"] if f["name"] == "blockout_role"): d["id"]
            for d in catalog["project"]["object_definitions"]["definitions"]
        }
        loaded = await call(
            "create_blockout_scene",
            project=directory,
            project_revision=catalog["revision"],
            name="Opening forest",
            options=dict(width=960, height=272, grid=8, camera_width=160, camera_height=136),
        )
        guards = dict(
            project=directory,
            project_revision=loaded["project_revision"],
            scene_id=loaded["id"],
            scene_revision=loaded["revision"],
        )
        data = json.loads(Path(__file__).with_name("opening-forest.json").read_text())
        operations = [dict(op="update", object_id=1, changes=dict(y=136))]
        for placement in data:
            role = placement.pop("role")
            operations.append(dict(op="place", definition_id=definitions[role], **placement))
        loaded = await call("edit_scene", **guards, operations=operations)
        guards["scene_revision"] = loaded["revision"]
        review = await call("review_blockout", **guards)
        await download(review["overview_resource"], "before.svg")
        identities = {
            item["name"]: item["id"]
            for layer in loaded["scene"]["layers"]
            for item in layer.get("objects", [])
        }
        candidate = await call(
            "edit_scene",
            **guards,
            dry_run=True,
            operations=[
                dict(op="update", object_id=identities["Vine landing"], changes=dict(width=72)),
                dict(op="update", object_id=identities["Forest patrol"], changes=dict(x=112)),
                dict(
                    op="update", object_id=identities["Short vine"], changes=dict(y=184, height=56)
                ),
            ],
        )
        review = await call("review_blockout", **guards, scene=candidate["scene"])
        assert review["snapshot_revision"] == candidate["changes"]["after_snapshot"]
        await download(review["overview_resource"], "after.svg")
        await download(review["camera_resource"], "camera.svg")
        saved = await call("save_scene", **guards, scene=candidate["scene"])
        guards["scene_revision"] = saved["revision"]
        reopened = await call("get_scene", project=directory, scene_id=saved["id"])
        assert reopened["scene"] == saved["scene"]
        camera_candidate = json.loads(json.dumps(saved["scene"]))
        camera_candidate["layers"][-1]["objects"][0]["x"] = 224
        second_view = await call("review_blockout", **guards, scene=camera_candidate)
        await download(second_view["camera_resource"], "camera-landing.svg")
        # Reviewing a second framing does not move the saved camera.
        unchanged = await call("get_scene", project=directory, scene_id=saved["id"])
        assert unchanged["revision"] == saved["revision"]
        report = await call(
            "diagnostics", project=directory, project_revision=guards["project_revision"]
        )
        (output / "diagnostics.json").write_text(json.dumps(report, indent=2) + "\n")
        exported = await call(
            "export_bundle",
            project=directory,
            project_revision=guards["project_revision"],
            scope="project",
        )
        payload = await download(exported["resource"], "forest.zip")
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            manifest = json.loads(archive.read("forge.project.json"))
            native = json.loads(archive.read(f"scenes/{saved['id']}.tmj"))
        assert manifest["object_definitions"] == catalog["project"]["object_definitions"]
        native_objects = {
            item["id"]: item for layer in native["layers"] for item in layer.get("objects", [])
        }
        authored = {
            item["id"]: item
            for layer in saved["scene"]["layers"]
            for item in layer.get("objects", [])
        }
        assert native_objects.keys() == authored.keys()
        for identity, item in authored.items():
            exported_item = native_objects[identity]
            for key in ("x", "y", "width", "height"):
                assert exported_item.get(key, 0) == item.get(key, 0)
            properties = {p["name"]: p["value"] for p in exported_item["properties"]}
            assert properties["forge:definition"] == item["definition"]
            assert "blockout_role" in properties
            for prop in item.get("properties", []):
                assert properties[prop["name"]] == prop["value"]
        (output / "changes.json").write_text(json.dumps(candidate["changes"], indent=2) + "\n")
        (output / "session.json").write_text(json.dumps(transcript, indent=2) + "\n")
        return {
            "project": str(root / directory),
            "scene_id": saved["id"],
            "output": str(output),
            "protocol": initialized.protocolVersion,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(example(args.root.absolute(), args.output.absolute()))))


if __name__ == "__main__":
    main()
