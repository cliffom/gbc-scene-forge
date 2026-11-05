"""Official-SDK selected cleanup, review, guarded save and exact source recovery.

Run with the optional MCP extra: python examples/mcp/pixel_cleanup.py --output /tmp/cleanup
Uses the repository's original MIT synthetic motif, not external generated artwork.
Output must name a fresh directory. Candidate selection here is an explicit technical
fixture expectation, not autonomous artistic judgment.
"""

import argparse
import asyncio
import base64
import json
import os
import runpy
import sys
from pathlib import Path

from gbc_scene_forge.artwork import layers, png
from gbc_scene_forge.project.application import Project


async def run(output):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    output.mkdir(parents=True, exist_ok=False)
    project = Project.create(output / "project", "Pixel cleanup")
    fixture_path = Path(__file__).resolve().parents[2] / "tests/support/cleanup_fixture.py"
    spec, raw = runpy.run_path(str(fixture_path))["fixture"]()
    source, protected = layers.item("Motif"), {**layers.item("Protected"), "locked": True}
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "gbc_scene_forge.mcp_server", "--project", str(project.root)],
        env=dict(os.environ),
    )
    async with stdio_client(parameters) as streams, ClientSession(*streams) as client:
        await client.initialize()

        async def call(tool_name, **args):
            result = await client.call_tool(tool_name, dict(project="project", **args))
            if result.isError:
                raise RuntimeError(result.content)
            if tool_name == "preview_artwork_cleanup":
                assert sum(c.type == "image" for c in result.content) == 2
            return result.structuredContent

        before = await call(
            "import_artwork_layers",
            atlas_id="motif",
            name="Motif",
            width=16,
            height=16,
            project_revision=project.catalog()["revision"],
            compact=True,
            layers=[
                dict(
                    layer=source,
                    png=base64.b64encode(png.encode(16, 16, raw)).decode(),
                    offset=[0, 0],
                ),
                dict(
                    layer=protected,
                    png=base64.b64encode(png.encode(1, 1, bytes(4))).decode(),
                    offset=[0, 0],
                ),
            ],
        )
        old_review = await call("review_artwork_candidate", candidate=before)
        analysis = await call(
            "analyze_artwork_cleanup",
            candidate=before,
            layer_id=source["id"],
            profile=spec["protected_profile"],
        )
        # Caller explicitly chooses the two known synthetic noise pixels, preserving the glint.
        selected = [
            f["id"]
            for f in analysis["findings"]
            if f["pixels"][0] in spec["expected_protected_changes"]
        ]
        preview = await call(
            "preview_artwork_cleanup",
            candidate=before,
            proposal=analysis["proposal"],
            selected=selected,
        )
        for name in ("before", "after", "changes"):
            response = await client.read_resource(preview[name + "_resource"]["uri"])
            (output / (name + ".png")).write_bytes(base64.b64decode(response.contents[0].blob))
        validation = await call(
            "validate_artwork_cleanup",
            candidate=preview["candidate"],
            before_candidate=before,
            proposal=analysis["proposal"],
        )
        assert validation["passed"]
        stale = await client.call_tool(
            "commit_artwork",
            dict(project="project", candidate=preview["candidate"], receipt=old_review["receipt"]),
        )
        assert stale.isError and stale.structuredContent["error"]["code"] == "conflict"
        full = await call("export_artwork_candidate", candidate=preview["candidate"])
        (output / "candidate.json").write_text(json.dumps(full, indent=2) + "\n")
        review = await call("review_artwork_candidate", candidate=preview["candidate"])
        saved = await call(
            "commit_artwork", candidate=preview["candidate"], receipt=review["receipt"]
        )
        reopened = await call(
            "open_artwork",
            target=dict(document_id=full["document_id"], atlas_id="motif", region="artwork"),
            project_revision=saved["project_revision"],
            artwork_revision=saved["artwork_revision"],
        )
        exact = reopened["rgba"] == full["rgba"] and reopened["layer_rgba"] == full["layer_rgba"]
        assert exact
        report = dict(
            analysis=analysis,
            changed_pixels=preview["changed_pixels"],
            changes=preview["changes"],
            validation=validation,
            reopened_exact_sources=exact,
            stale_receipt_rejected=True,
            limits="Synthetic opaque layered motif; artistic quality and general generated-art cleanup unproven.",
        )
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    asyncio.run(run(parser.parse_args().output))
