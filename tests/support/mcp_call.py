"""One real SDK tool call for cross-process browser acceptance (arguments on stdin)."""

import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from project_busy import call_tool


async def main():
    parameters = StdioServerParameters(
        command=sys.executable,
        args=[
            "-m",
            "gbc_scene_forge.mcp_server",
            "--project",
            sys.argv[1],
        ],
        env=dict(os.environ),
    )
    arguments = json.load(sys.stdin)
    async with stdio_client(parameters) as (read, write), ClientSession(read, write) as client:
        await client.initialize()
        result = await call_tool(client, sys.argv[2], arguments)
        if result.isError:
            raise RuntimeError(result.content)
        print(json.dumps(result.structuredContent))


if __name__ == "__main__":
    asyncio.run(main())
