"""Optional local stdio MCP transport. The ordinary editor never imports the SDK."""

import argparse
import asyncio
import json
from pathlib import Path

from . import __version__
from .documents import Conflict
from .mcp_tools import TOOLS, Adapter


def create_server(adapter):
    from mcp import types
    from mcp.server.lowlevel import Server
    from mcp.server.lowlevel.helper_types import ReadResourceContents

    server = Server(
        "gbc-scene-forge",
        version=__version__,
        instructions="Local saved-project authoring. Inspect revisions before edits. Use dry_run and "
        "review_blockout to review candidates. Browser drafts and Undo are independent; stale saves "
        "conflict. Artifacts are immutable, session-scoped and may expire. No physics certification.",
    )

    @server.list_tools()
    async def list_tools():
        return [types.Tool(**tool) for tool in TOOLS]

    @server.call_tool()
    async def call_tool(name, arguments):
        # Synchronous operations intentionally serialize requests within this process;
        # durable file guards arbitrate other MCP/browser processes.
        try:
            result = adapter.call(name, arguments)
            content = [types.TextContent(type="text", text=json.dumps(result))]
            for key in ("overview_resource", "camera_resource", "resource"):
                if key in result:
                    content.append(types.ResourceLink(type="resource_link", **result[key]))
            return types.CallToolResult(content=content, structuredContent=result)
        except (ValueError, OSError, KeyError, TypeError, RecursionError) as error:
            result = {
                "error": {
                    "code": "conflict" if isinstance(error, Conflict) else "invalid_request",
                    "message": str(error),
                }
            }
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=json.dumps(result))],
                structuredContent=result,
                isError=True,
            )

    @server.list_resources()
    async def list_resources():
        return [
            types.Resource(uri=uri, name=uri.rsplit("/", 1)[-1], mimeType=mime)
            for uri, (_, mime) in adapter.artifacts.items()
        ]

    @server.read_resource()
    async def read_resource(uri):
        resource = adapter.read_artifact(str(uri))
        return [
            ReadResourceContents(
                content=resource.get("text")
                if "text" in resource
                else adapter.artifacts[str(uri)][0],
                mime_type=resource["mimeType"],
            )
        ]

    return server


async def run(adapter):
    from mcp.server.stdio import stdio_server

    server = create_server(adapter)
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main():
    parser = argparse.ArgumentParser(
        description="Expose declared Forge projects through local stdio MCP"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--project", type=Path, help="One existing project (tool project name: project)"
    )
    group.add_argument("--project-root", type=Path, help="Declared parent directory of projects")
    args = parser.parse_args()
    try:
        import mcp  # noqa: F401
    except ImportError:
        parser.error("Install MCP support with: pip install 'gbc-scene-forge[mcp]'")
    try:
        adapter = Adapter(
            args.project or args.project_root, single_project=args.project is not None
        )
        asyncio.run(run(adapter))
    except (ValueError, OSError) as error:
        parser.error(str(error))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
