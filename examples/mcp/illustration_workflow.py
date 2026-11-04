"""Disposable static illustration workflow through the official MCP stdio SDK.

Run: python examples/mcp/illustration_workflow.py --output /tmp/forge-illustration
Creates a fresh project under output, writes portable artwork/review/recovery files,
and verifies exact saved layers. The literal motif is a technical fixture, not an
art-quality evaluation. No external image editor or automatic commit retry is used.
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

from gbc_scene_forge.artwork import layers, png
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.storage.files import digest


async def run(output):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    output.mkdir(parents=True, exist_ok=True)
    project = Project.create(output / "project", "Night illustration")
    ground, stars = layers.item("Sky"), layers.item("Stars")
    raw = bytearray()
    for y in range(16):
        for x in range(16):
            raw.extend([16 + (y // 4) * 3, 24 + (y // 4) * 4, 56 + (y // 4) * 5, 255])
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "gbc_scene_forge.mcp_server", "--project", str(project.root)],
        env=dict(os.environ),
    )
    calls = []
    async with stdio_client(parameters) as streams, ClientSession(*streams) as client:
        await client.initialize()

        async def call(tool_name, **args):
            result = await client.call_tool(tool_name, dict(project="project", **args))
            if result.isError:
                raise RuntimeError(result.content)
            calls.append(tool_name)
            return result.structuredContent

        async def resource(item, filename):
            response = await client.read_resource(item["uri"])
            content = response.contents[0]
            data = (
                content.text.encode()
                if hasattr(content, "text")
                else base64.b64decode(content.blob)
            )
            (output / filename).write_bytes(data)
            return data

        candidate = await call(
            "import_artwork_layers",
            atlas_id="intake",
            name="Original sky",
            width=16,
            height=16,
            project_revision=project.catalog()["revision"],
            compact=True,
            layers=[
                dict(
                    layer=ground,
                    png=base64.b64encode(png.encode(16, 16, raw)).decode(),
                    offset=[0, 0],
                ),
                dict(
                    layer=stars,
                    png=base64.b64encode(png.encode(1, 1, bytes(4))).decode(),
                    offset=[0, 0],
                ),
            ],
        )
        prepared = await call(
            "prepare_artwork_document",
            candidate=candidate,
            atlas_id="night",
            name="Night",
            width=32,
            height=32,
            mode="nearest",
            anchor="top-left",
        )
        converted = await call("convert_artwork_palette", candidate=prepared["candidate"], budget=4)
        candidate = await call(
            "edit_artwork_batch",
            candidate=converted["candidate"],
            operations=[
                dict(
                    op="pixels",
                    layer_id=stars["id"],
                    writes=[
                        dict(x=x, y=y, rgba=[240, 224, 160, 255])
                        for x, y in ((4, 5), (11, 8), (24, 4), (19, 13), (28, 12))
                    ],
                ),
                dict(
                    op="raster",
                    layer_id=stars["id"],
                    operations=[
                        dict(op="line", **{"from": [4, 4]}, to=[4, 6], rgba=[240, 224, 160, 255]),
                        dict(op="line", **{"from": [3, 5]}, to=[5, 5], rgba=[240, 224, 160, 255]),
                        dict(
                            op="ellipse",
                            rectangle=dict(x=21, y=18, width=8, height=8),
                            rgba=[224, 200, 136, 255],
                            filled=True,
                        ),
                    ],
                ),
                dict(op="layers", layers=[ground, {**stars, "locked": True}]),
            ],
        )
        report = await call(
            "inspect_artwork_candidate",
            candidate=candidate,
            rectangles=[dict(x=0, y=0, width=32, height=32), dict(x=0, y=0, width=16, height=16)],
            scale=8,
            changed_overlay=True,
        )
        await resource(report["resource"], "contact.svg")
        exported = await call("export_artwork_bundle", candidate=candidate)
        data = await resource(exported["resource"], "artwork.zip")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            full = json.loads(archive.read("candidate.json"))
            (output / "composite.png").write_bytes(archive.read("composite.png"))
        # The scripted fixture publishes deterministically; interactive clients inspect review first.
        ack = await call("commit_artwork", candidate=candidate, receipt=report["receipt"])
        opened = await call(
            "open_artwork",
            target=dict(document_id=full["document_id"], atlas_id="night", region="artwork"),
            project_revision=ack["project_revision"],
            artwork_revision=ack["artwork_revision"],
        )
        assert opened["layer_rgba"] == full["layer_rgba"]
        assert opened["descriptor"] == full["descriptor"]
        assert opened["rgba"] == full["rgba"]
        listed = await call("list_artwork_candidates")
        selected = [
            {k: i[k] for k in ("handle", "project_id", "project_revision", "revision")}
            for i in listed["candidates"]
        ]
        archived = await call("archive_artwork_candidates", candidates=selected, release=True)
        assert all(item["released"] for item in archived["results"])
        archive_data, offset = bytearray(), 0
        while True:
            chunk = await call("read_artwork_archive", archive=archived["archive"], offset=offset)
            archive_data.extend(base64.b64decode(chunk["data"]))
            if chunk["next_offset"] is None:
                break
            offset = chunk["next_offset"]
        assert digest(archive_data) == archived["sha256"]
        (output / "recovery.zip").write_bytes(archive_data)
        final = await call("list_artwork_candidates")
        assert final["used_count"] == 0
        result = dict(
            calls=calls,
            preparation=prepared["report"],
            conversion=converted["report"],
            inspection={k: v for k, v in report.items() if k not in {"resource", "resources"}},
            committed=ack,
            archive=archived,
            final_storage=final,
            fidelity="Exact descriptor, composite and every layer verified after reopen",
            limits="Synthetic static fixture; no artistic judgment or human usability claim",
        )
        (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
        print(
            json.dumps(
                {
                    "calls": len(calls),
                    "retained_after_archive": final["used_count"],
                    "output": str(output),
                },
                indent=2,
            )
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    asyncio.run(run(parser.parse_args().output.resolve()))


if __name__ == "__main__":
    main()
