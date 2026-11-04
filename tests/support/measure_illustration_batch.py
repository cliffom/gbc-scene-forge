"""Identical edits over official SDK stdio: full envelopes, compact steps, compact batch.

Run with optional MCP SDK: python tests/support/measure_illustration_batch.py
Actual serialized JSON-RPC bytes include text+structured duplication; initialize,
base creation, final recovery export and storage inspection are excluded. Reported
latency includes tool dispatch, validation, processing and sidecar I/O. It is not
a CPU profile. Three fresh project/process repetitions per route and size.
"""

import asyncio
import json
import os
import platform
import statistics
import sys
import tempfile
from pathlib import Path
from time import perf_counter
from uuid import UUID

from measure_artwork_iteration import WireStream

from gbc_scene_forge.artwork import layers
from gbc_scene_forge.project.application import Project


async def measure(route, size):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    with tempfile.TemporaryDirectory(prefix="forge-batch-") as temporary:
        project = Project.create(Path(temporary) / "project", "Measured")
        base, ink = layers.item("Base"), layers.item("Ink")
        base["id"], ink["id"] = str(UUID(int=1)), str(UUID(int=2))
        operations = [
            dict(op="layers", layers=[base, ink]),
            dict(op="pixels", layer_id=ink["id"], writes=[dict(x=1, y=1, rgba=[9, 8, 7, 0])]),
            dict(
                op="raster",
                layer_id=ink["id"],
                operations=[
                    dict(
                        op="rectangle",
                        rectangle=dict(x=2, y=2, width=16, height=16),
                        rgba=[80, 120, 240, 128],
                        filled=True,
                    )
                ],
            ),
            dict(op="layers", layers=[base, {**ink, "locked": True}]),
        ]
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.mcp_server", "--project", str(project.root)],
            env=dict(os.environ),
        )
        async with stdio_client(params) as streams:
            incoming, outgoing = (WireStream(stream) for stream in streams)
            async with ClientSession(incoming, outgoing) as client:
                await client.initialize()

                async def call(tool_name, **args):
                    response = await client.call_tool(tool_name, dict(project="project", **args))
                    if response.isError:
                        raise RuntimeError(response.content)
                    return response.structuredContent

                candidate = await call(
                    "create_artwork",
                    atlas_id="picture",
                    name="Picture",
                    width=size,
                    height=size,
                    kind="sprite",
                    project_revision=project.catalog()["revision"],
                )
                if route != "full":
                    candidate = await call("retain_artwork_candidate", candidate=candidate)
                before = await call("list_artwork_candidates")
                sent, received, start = outgoing.bytes, incoming.bytes, perf_counter()
                if route == "batch":
                    candidate = await call(
                        "edit_artwork_batch", candidate=candidate, operations=operations
                    )
                    calls = 1
                else:
                    mapping = {
                        "layers": "edit_artwork_layers",
                        "pixels": "edit_artwork_pixels",
                        "raster": "edit_artwork_raster",
                    }
                    for op in operations:
                        args = {k: v for k, v in op.items() if k != "op"}
                        candidate = await call(mapping[op["op"]], candidate=candidate, **args)
                    calls = len(operations)
                latency = (perf_counter() - start) * 1000
                measured = dict(
                    route=route,
                    size=size,
                    calls=calls,
                    request_bytes=outgoing.bytes - sent,
                    response_bytes=incoming.bytes - received,
                    milliseconds=round(latency, 2),
                )
                after = await call("list_artwork_candidates")
                measured.update(
                    retained_records=after["used_count"] - before["used_count"],
                    retained_bytes=after["used_bytes"] - before["used_bytes"],
                )
                full = await call("export_artwork_candidate", candidate=candidate)
                # Saved document/project UUIDs differ across disposable cases; pixels and layer contract do not.
                content = {
                    "rgba": full["rgba"],
                    "layer_rgba": full["layer_rgba"],
                    "layers": full["descriptor"]["layers"],
                }
                return measured, content


async def main():
    samples, expected = [], {}
    for size in (64, 256):
        for route in ("full", "compact", "batch"):
            for _ in range(3):
                sample, content = await measure(route, size)
                if size in expected:
                    assert content == expected[size]
                expected[size] = content
                samples.append(sample)
    aggregates = []
    for size in (64, 256):
        for route in ("full", "compact", "batch"):
            group = [s for s in samples if s["size"] == size and s["route"] == route]
            aggregates.append(
                {
                    "size": size,
                    "route": route,
                    **{
                        key: statistics.median(s[key] for s in group)
                        for key in (
                            "calls",
                            "request_bytes",
                            "response_bytes",
                            "milliseconds",
                            "retained_records",
                            "retained_bytes",
                        )
                    },
                }
            )
    print(
        json.dumps(
            dict(
                environment=dict(python=sys.version.split()[0], platform=platform.platform()),
                samples=samples,
                medians=aggregates,
                exact_sources_equal=True,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
