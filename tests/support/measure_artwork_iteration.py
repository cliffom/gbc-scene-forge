"""Equivalent exact-patch and structured MCP tasks; observational, not a speed test.

Run with the optional SDK interpreter. Each case owns a fresh process/project.
Byte counts are serialized UTF-8 JSON-RPC messages, including duplicated text and
structured results, inline base64 and explicit resource reads; exclude initialize.
"""

import asyncio
import base64
import hashlib
import json
import os
import platform
import random
import resource
import subprocess
import sys
import tempfile
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from gbc_scene_forge import __version__
from gbc_scene_forge.artwork import editable, layers, png
from gbc_scene_forge.artwork.candidates import ArtworkCandidates
from gbc_scene_forge.artwork.drafts import ArtworkDrafts
from gbc_scene_forge.project.application import Project


class WireStream:
    """Count the actual SDK JSON-RPC messages, using its stdio serializer/newline."""

    def __init__(self, stream):
        self.stream, self.bytes = stream, 0

    def count(self, value):
        if not isinstance(value, Exception):
            self.bytes += (
                len(value.message.model_dump_json(by_alias=True, exclude_none=True).encode()) + 1
            )

    async def send(self, value):
        self.count(value)
        await self.stream.send(value)

    def __aiter__(self):
        return self

    async def __anext__(self):
        value = await self.stream.__anext__()
        self.count(value)
        return value

    async def __aenter__(self):
        await self.stream.__aenter__()
        return self

    async def __aexit__(self, *args):
        await self.stream.__aexit__(*args)


async def protocol(route, width, height):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    with tempfile.TemporaryDirectory(prefix="forge-iteration-") as temporary:
        project = Project.create(Path(temporary) / "project", "Measured")
        raw = bytearray(random.Random(189).randbytes(width * height * 4))
        raw[::4] = bytes([11]) * (width * height)
        original_png = png.encode(width, height, bytes(raw))
        expected = bytearray(raw)
        for i in range(0, len(raw), 4):
            if expected[i : i + 4] == raw[:4]:
                expected[i : i + 4] = bytes([71, 72, 73, 0])
        # A visible deterministic block with an isolated copied effect.
        for y in range(8):
            for x in range(8):
                expected[(y * width + x) * 4 : (y * width + x + 1) * 4] = bytes([255, 40, 20, 128])
                expected[((y + 8) * width + x + 8) * 4 : ((y + 8) * width + x + 9) * 4] = bytes(
                    [255, 40, 20, 128]
                )
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.mcp_server", "--project", str(project.root)],
            env=dict(os.environ),
        )
        measurements = []
        async with stdio_client(params) as streams:
            incoming, outgoing = (WireStream(stream) for stream in streams)
            result = await session_measurement(
                ClientSession(incoming, outgoing),
                incoming,
                outgoing,
                route,
                width,
                height,
                project,
                raw,
                original_png,
                expected,
                measurements,
            )
        result["server_peak_rss_bytes"] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * (
            1 if sys.platform == "darwin" else 1024
        )
        return result


async def session_measurement(
    client,
    incoming,
    outgoing,
    route,
    width,
    height,
    project,
    raw,
    original_png,
    expected,
    measurements,
):
    async with client:
        await client.initialize()

        async def request(method, arguments):
            sent, received = outgoing.bytes, incoming.bytes
            start = perf_counter()
            if method == "tools/call":
                result = await client.call_tool(arguments["name"], arguments["arguments"])
                if result.isError:
                    raise RuntimeError(result.content)
            else:
                result = await client.read_resource(arguments["uri"])
            measurements.append(
                dict(
                    method=method,
                    tool=arguments.get("name"),
                    request_bytes=outgoing.bytes - sent,
                    response_bytes=incoming.bytes - received,
                    milliseconds=round((perf_counter() - start) * 1000, 2),
                )
            )
            return result

        async def tool(tool_name, **args):
            return (
                await request(
                    "tools/call",
                    dict(name=tool_name, arguments=dict(project="project", **args)),
                )
            ).structuredContent

        revision = project.catalog()["revision"]
        if route == "structured":
            candidate = await tool(
                "import_artwork_png",
                project_revision=revision,
                atlas_id="picture",
                name="Picture",
                png=base64.b64encode(original_png).decode(),
                compact=True,
            )
        else:
            candidate = await tool(
                "create_artwork",
                project_revision=revision,
                atlas_id="picture",
                name="Picture",
                kind="sprite",
                width=width,
                height=height,
                compact=True,
            )
            for y in range(0, height, 65536 // width):
                h = min(65536 // width, height - y)
                candidate = await tool(
                    "edit_artwork_pixels",
                    candidate=candidate,
                    patch=dict(
                        rectangle=dict(x=0, y=y, width=width, height=h),
                        rgba=base64.b64encode(raw[y * width * 4 : (y + h) * width * 4]).decode(),
                    ),
                )
        if route == "structured":
            candidate = await tool(
                "edit_artwork_raster",
                candidate=candidate,
                operations=[
                    dict(op="replace", **{"from": list(raw[:4])}, rgba=[71, 72, 73, 0]),
                    dict(
                        op="rectangle",
                        rectangle=dict(x=0, y=0, width=8, height=8),
                        rgba=[255, 40, 20, 128],
                        filled=True,
                    ),
                    dict(op="copy", rectangle=dict(x=0, y=0, width=8, height=8), to=[8, 8]),
                ],
            )
        else:
            # Identical result via bounded exact patches, with client orchestration.
            for y in range(0, height, 65536 // width):
                h = min(65536 // width, height - y)
                candidate = await tool(
                    "edit_artwork_pixels",
                    candidate=candidate,
                    patch=dict(
                        rectangle=dict(x=0, y=y, width=width, height=h),
                        rgba=base64.b64encode(
                            expected[y * width * 4 : (y + h) * width * 4]
                        ).decode(),
                    ),
                )
        report = await tool("review_artwork_candidate", candidate=candidate)
        for item in report["resources"]:
            await request("resources/read", dict(uri=item["uri"]))
        ack = await tool("commit_artwork", candidate=candidate, receipt=report["receipt"])
        reopened = await tool(
            "open_artwork",
            project_revision=ack["project_revision"],
            artwork_revision=ack["artwork_revision"],
            target=dict(
                document_id=project.catalog()["project"]["atlases"]["picture"]["editable"]["id"],
                atlas_id="picture",
                region="artwork",
            ),
        )
        assert editable.check_candidate(reopened) == bytes(expected)
    return dict(
        route=route,
        width=width,
        height=height,
        input_png_sha256=hashlib.sha256(original_png).hexdigest(),
        output_rgba_sha256=hashlib.sha256(expected).hexdigest(),
        input_png_bytes=len(original_png),
        calls=len(measurements),
        tool_calls=sum(m["method"] == "tools/call" for m in measurements),
        request_bytes=sum(m["request_bytes"] for m in measurements),
        response_bytes=sum(m["response_bytes"] for m in measurements),
        milliseconds=round(sum(m["milliseconds"] for m in measurements), 2),
        measurements=measurements,
    )


def layered(width, height):
    with tempfile.TemporaryDirectory(prefix="forge-layers-") as temporary:
        project = Project.create(Path(temporary) / "project", "Layers")
        art = project.artwork.documents
        candidate = art.create(
            "picture", "Picture", "sprite", width, height, project.catalog()["revision"]
        )
        candidate = editable.seal(
            {
                **{k: v for k, v in candidate.items() if k != "revision"},
                "rgba": base64.b64encode(random.Random(189).randbytes(width * height * 4)).decode(),
            }
        )
        timings = {}

        def timed(name, work):
            start = perf_counter()
            result = work()
            timings[name] = round((perf_counter() - start) * 1000, 2)
            return result

        candidate = timed(
            "three_layers_ms",
            lambda: layers.edit(
                candidate, [layers.item("Base"), layers.item("Effect"), layers.item("Hidden")]
            ),
        )
        handle = timed("retain_ms", lambda: ArtworkCandidates(art).retain(candidate))
        owner = str(uuid4())
        draft_id = str(uuid4())
        drafts = ArtworkDrafts(art)
        ack = timed(
            "checkpoint_ms",
            lambda: drafts.write(
                dict(
                    id=draft_id,
                    owner=owner,
                    project_id=candidate["project_id"],
                    name="Layers",
                    revision=None,
                    original=candidate,
                    candidate=candidate,
                )
            ),
        )
        restored = timed("restore_ms", lambda: drafts.restore(draft_id, ack["revision"]))
        assert restored["candidate"] == candidate
        return dict(
            width=width,
            height=height,
            layers=3,
            aggregate_rgba_bytes=width * height * 4 * 4,
            candidate_bytes=len(editable.canonical_bytes(candidate)),
            handle_bytes=len(json.dumps(handle).encode()),
            draft_bytes=sum(p.stat().st_size for p in (project.root / ".forge").rglob("*.json")),
            **timings,
            process_peak_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            * (1 if sys.platform == "darwin" else 1024),
        )


if __name__ == "__main__":
    if len(sys.argv) > 1:
        kind, w, h = sys.argv[1:]
        w, h = int(w), int(h)
        print(json.dumps(layered(w, h) if kind == "layers" else asyncio.run(protocol(kind, w, h))))
    else:
        cases = []
        for kind, w, h in [
            (kind, w, h) for w, h in [(128, 128), (375, 525)] for kind in ("patch", "structured")
        ] + [("layers", 256, 256), ("layers", 768, 1024)]:
            result = subprocess.run(
                [sys.executable, __file__, kind, str(w), str(h)],
                check=True,
                capture_output=True,
                text=True,
            )
            cases.append(json.loads(result.stdout))
        print(
            json.dumps(
                dict(
                    version=__version__,
                    python=platform.python_version(),
                    platform=platform.platform(),
                    cases=cases,
                ),
                indent=2,
            )
        )
