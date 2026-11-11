"""Real SDK bootstrap, guarded first task, switch, resource revocation and reopen."""

import asyncio
import base64
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

from gbc_scene_forge.artwork import png


@unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP extra")
class PluginProtocolTests(unittest.TestCase):
    def test_first_task_and_later_conversation(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            (base / "bundle").mkdir()
            (base / "projects").mkdir()
            asyncio.run(self.exercise(base))

    async def exercise(self, base):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(
            command=sys.executable,
            args=["tests/support/serve_plugin_fixture.py", str(base)],
            env=dict(os.environ),
        )
        async with stdio_client(params) as streams, ClientSession(*streams) as client:
            await client.initialize()

            async def call(name, arguments=None):
                result = await client.call_tool(name, arguments or {})
                self.assertFalse(result.isError, result.content)
                return result.structuredContent

            advertised = {t.name for t in (await client.list_tools()).tools}
            self.assertLessEqual(len(advertised), 32)
            self.assertTrue(
                {"plugin_status", "plugin_choose_location", "plugin_reset_selection"} <= advertised
            )
            self.assertIsNone((await call("plugin_status"))["selection"])
            self.assertTrue((await client.call_tool("list_projects", {})).isError)
            await call("plugin_choose_location", {"mode": "root"})
            self.assertEqual(set((await call("capabilities"))["tools"]), advertised)
            self.assertTrue((await client.call_tool("delete_scene", {})).isError)
            self.assertEqual((await call("list_projects"))["projects"], [])
            await call("create_project", {"name": "Design"})
            catalog = await call("get_project", {"project": "design"})
            blank = await call(
                "create_artwork",
                {
                    "project": "design",
                    "project_revision": catalog["revision"],
                    "atlas_id": "first_tile",
                    "name": "First tile",
                    "kind": "tile",
                    "width": 8,
                    "height": 8,
                },
            )
            review = await call(
                "review_artwork_candidate", {"project": "design", "candidate": blank}
            )
            preview = review["after"]["native_resource"]["uri"]
            resource = await client.read_resource(preview)
            self.assertEqual(png.decode(base64.b64decode(resource.contents[0].blob))[2], bytes(256))
            refined = await call(
                "edit_artwork_pixels",
                {
                    "project": "design",
                    "candidate": blank,
                    "writes": [{"x": 1, "y": 1, "rgba": [255, 180, 60, 255]}],
                },
            )
            review = await call(
                "review_artwork_candidate", {"project": "design", "candidate": refined}
            )
            self.assertTrue(
                (
                    await client.call_tool(
                        "commit_artwork",
                        {
                            "project": "design",
                            "candidate": refined,
                            "receipt": (
                                await call(
                                    "review_artwork_candidate",
                                    {
                                        "project": "design",
                                        "candidate": blank,
                                    },
                                )
                            )["receipt"],
                        },
                    )
                ).isError
            )
            await call(
                "commit_artwork",
                {
                    "project": "design",
                    "candidate": refined,
                    "receipt": review["receipt"],
                },
            )
            catalog = await call("get_project", {"project": "design"})
            exported = await call(
                "export_bundle",
                {
                    "project": "design",
                    "project_revision": catalog["revision"],
                    "scope": "project",
                },
            )
            self.assertGreater(exported["resource"]["size"], 0)
            await call("plugin_choose_location", {"mode": "project"})
            self.assertEqual((await client.list_resources()).resources, [])
            self.assertEqual((await call("get_project", {"project": "project"})), catalog)
            self.assertTrue((await call("plugin_choose_location", {"mode": "root"}))["cancelled"])
        async with stdio_client(params) as streams, ClientSession(*streams) as client:
            await client.initialize()
            status = await client.call_tool("plugin_status", {})
            self.assertEqual(status.structuredContent["selection"]["mode"], "project")
            opened = await client.call_tool("get_project", {"project": "project"})
            self.assertEqual(opened.structuredContent, catalog)
            reset = await client.call_tool("plugin_reset_selection", {})
            self.assertFalse(reset.isError)
            self.assertIsNone(reset.structuredContent["selection"])
            self.assertTrue((base / "projects/design").is_dir())
