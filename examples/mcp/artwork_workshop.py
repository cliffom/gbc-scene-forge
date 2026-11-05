"""Repeatable SDK artwork workshop: seed, inspect, hand-edit, then revise explicitly.

Run with the optional MCP extra. --root owns projects; --output retains state,
PNGs and transcripts. To revise, supply --asset and a JSON --writes list.
Add --variation FRESH_ID --object ID to vary one placed static sprite.
The caller supplies artistic decisions; this script does not invoke a model.
"""

import argparse
import asyncio
import base64
import copy
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def pattern(rows, palette):
    return [
        {"x": x, "y": y, "rgba": palette[key]}
        for y, row in enumerate(rows)
        for x, key in enumerate(row)
    ]


def layers(model):
    if "layers" not in model:
        model["layers"] = [
            {
                "id": 1,
                "name": "Ground",
                "type": "tilelayer",
                "visible": True,
                "cells": model.pop("cells"),
            }
        ]
        model.pop("objects", None)
        model["next_layer_id"] = 2
    return model["layers"]


async def call_tool(client, tool, arguments):
    """Allow brief browser contention during read-only review; never replay saved writes."""
    for attempt in range(20):
        response = await client.call_tool(tool, arguments)
        error = (response.structuredContent or {}).get("error", {})
        if (
            tool != "review_artwork_candidate"
            or not response.isError
            or error.get("code") != "busy"
            or attempt == 19
        ):
            return response
        await asyncio.sleep(0.05)


async def workshop(args):
    args.output.mkdir(parents=True, exist_ok=True)
    state_path = args.output / "workshop.json"
    transcript = []
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "gbc_scene_forge.mcp_server", "--project-root", str(args.root)],
        env=dict(os.environ),
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
        await client.initialize()

        async def call(tool, **arguments):
            response = await call_tool(client, tool, arguments)
            if response.isError:
                raise RuntimeError(response.content)
            transcript.append(
                {"tool": tool, "arguments": arguments, "result": response.structuredContent}
            )
            return response.structuredContent

        async def capture(report, stem):
            for group in ("before", "after", "scene"):
                for key, resource in (report.get(group) or {}).items():
                    if key.endswith("_resource"):
                        response = await client.read_resource(resource["uri"])
                        content = response.contents[0]
                        (args.output / f"{stem}-{group}-{key}.png").write_bytes(
                            base64.b64decode(content.blob)
                        )

        if args.asset:
            state = json.loads(state_path.read_text())
        else:
            created = await call("create_project", name="Artwork workshop", starter="empty")
            state = {"directory": created["directory"]}
        project = state["directory"]

        async def guard():
            catalog = await call("get_project", project=project)
            return {"project": project, "project_revision": catalog["revision"]}

        if not args.asset:
            loaded = await call(
                "create_scene",
                **await guard(),
                name="Moss and lanterns",
                width=12,
                height=10,
                grid=8,
            )
            state["scene_id"] = loaded["id"]
            state_path.write_text(json.dumps(state, indent=2) + "\n")
            art = [
                (
                    "moss",
                    "tile",
                    8,
                    8,
                    [0, 0],
                    [
                        "aabaaaab",
                        "abaaaaba",
                        "aaacaaaa",
                        "baaaabaa",
                        "aaaabaaa",
                        "acaaaaba",
                        "aaaabaaa",
                        "baaaaaca",
                    ],
                    {"a": [47, 76, 52, 255], "b": [82, 117, 65, 255], "c": [131, 151, 77, 255]},
                ),
                (
                    "lantern",
                    "sprite",
                    16,
                    16,
                    [8, 14],
                    [
                        "................",
                        "......dddd......",
                        ".....d....d.....",
                        ".....d....d.....",
                        "....dddddddd....",
                        "....dggggggd....",
                        "....dgffffgd....",
                        "....dgffffgd....",
                        "....dgffffgd....",
                        "....dggffggd....",
                        "....dggggggd....",
                        "....dddddddd....",
                        "......dddd......",
                        "......dddd......",
                        "................",
                        "................",
                    ],
                    {
                        ".": [0, 0, 0, 0],
                        "d": [48, 37, 34, 255],
                        "g": [173, 101, 43, 255],
                        "f": [245, 194, 86, 255],
                    },
                ),
            ]
            for atlas_id, kind, width, height, origin, rows, palette in art:
                candidate = await call(
                    "create_artwork",
                    **await guard(),
                    atlas_id=atlas_id,
                    name=atlas_id.title(),
                    kind=kind,
                    width=width,
                    height=height,
                    origin=origin,
                )
                candidate = await call(
                    "edit_artwork_pixels",
                    project=project,
                    candidate=candidate,
                    writes=pattern(rows, palette),
                )
                loaded = await call("get_scene", project=project, scene_id=state["scene_id"])
                model = copy.deepcopy(loaded["scene"])
                ordered = layers(model)
                if kind == "tile":
                    ordered[0]["cells"] = [["moss/artwork/0/0"] * 12 for _ in range(10)]
                else:
                    ordered.append(
                        {
                            "id": 2,
                            "name": "Lanterns",
                            "type": "objectgroup",
                            "visible": True,
                            "objects": [
                                {
                                    "id": i,
                                    "asset": "lantern/artwork",
                                    "x": x,
                                    "y": 48,
                                    "name": f"Lantern {i}",
                                    "properties": [],
                                }
                                for i, x in ((1, 32), (2, 64))
                            ],
                        }
                    )
                    model["next_layer_id"], model["next_object_id"] = 3, 3
                report = await call(
                    "review_artwork_candidate",
                    project=project,
                    candidate=candidate,
                    scene={
                        "scene_id": loaded["id"],
                        "scene_revision": loaded["revision"],
                        "scene": model,
                        "viewport": {"x": 0, "y": 0, "width": 96, "height": 80},
                    },
                )
                await capture(report, atlas_id)
                committed = await call(
                    "commit_artwork",
                    project=project,
                    candidate=candidate,
                    receipt=report["receipt"],
                )
                # The model still derives from the reviewed scene. Only our own
                # artwork commit may advance its guards, including map re-encoding.
                await call(
                    "save_scene",
                    project=project,
                    project_revision=committed["project_revision"],
                    scene_id=loaded["id"],
                    scene_revision=committed["scene_revisions"].get(
                        loaded["id"], loaded["revision"]
                    ),
                    scene=model,
                )
        else:
            inventory = await call("list_artwork", **await guard())
            item = next(d for d in inventory["documents"] if d["target"]["atlas_id"] == args.asset)
            loaded = await call("get_scene", project=project, scene_id=state["scene_id"])
            if args.variation:
                candidate = await call(
                    "duplicate_artwork",
                    **await guard(),
                    atlas_id=args.variation,
                    name=args.variation.replace("_", " "),
                    source={
                        "atlas_id": args.asset,
                        "region": item["target"]["region"],
                        "artwork_revision": item["artwork_revision"],
                        "grid": None,
                        "cell": None,
                    },
                    placements=[
                        {
                            "scene_id": loaded["id"],
                            "scene_revision": loaded["revision"],
                            "layer_id": 2,
                            "object_id": args.object,
                        }
                    ],
                )
            else:
                candidate = await call(
                    "open_artwork",
                    **await guard(),
                    target=item["target"],
                    artwork_revision=item["artwork_revision"],
                )
            await call("read_artwork_pixels", project=project, candidate=candidate)
            candidate = await call(
                "edit_artwork_pixels",
                project=project,
                candidate=candidate,
                writes=json.loads(args.writes.read_text()),
            )
            report = await call(
                "review_artwork_candidate",
                project=project,
                candidate=candidate,
                scene={
                    "scene_id": loaded["id"],
                    "scene_revision": loaded["revision"],
                    "scene": None,
                    "viewport": {"x": 0, "y": 0, "width": 96, "height": 80},
                },
            )
            await capture(report, args.variation or args.asset + "-revised")
            await call(
                "commit_artwork", project=project, candidate=candidate, receipt=report["receipt"]
            )
        (
            args.output
            / (
                (args.variation or args.asset) + "-session.json"
                if args.asset
                else "seed-session.json"
            )
        ).write_text(json.dumps(transcript, indent=2) + "\n")
        return {"project": str(args.root / project), "scene_id": state["scene_id"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset")
    parser.add_argument("--writes", type=Path)
    parser.add_argument("--variation")
    parser.add_argument("--object", type=int, default=1)
    args = parser.parse_args()
    if args.asset and not args.writes:
        parser.error("--asset requires an explicit --writes JSON file")
    if args.variation and not args.asset:
        parser.error("--variation requires --asset and --writes")
    args.root, args.output = args.root.absolute(), args.output.absolute()
    print(json.dumps(asyncio.run(workshop(args))))


if __name__ == "__main__":
    main()
