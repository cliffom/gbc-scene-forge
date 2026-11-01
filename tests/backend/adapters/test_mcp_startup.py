"""Only explicit contention before a session may delay single-project MCP startup."""

import asyncio
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge.adapters.mcp import server
from gbc_scene_forge.core.errors import Conflict, TransactionBusy
from gbc_scene_forge.project.application import Project


class StartupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Project.create(Path(temporary.name) / "plan", "Plan", starter="blockout")

    def test_held_lock_release_opens_same_declared_project_without_writes(self):
        before = self.project.catalog()
        records = self.project.transactions.records()
        with ExitStack() as held:
            held.enter_context(self.project.transactions.locked())
            with patch.object(server.time, "sleep", side_effect=lambda _: held.close()) as sleep:
                adapter = server.open_adapter(self.project.root, single_project=True)
        sleep.assert_called_once_with(server.STARTUP_DELAY)
        self.assertEqual(adapter.call("list_projects", {})["projects"][0]["directory"], "project")
        self.assertEqual(adapter.call("get_project", {"project": "project"}), before)
        self.assertEqual(self.project.transactions.records(), records)
        for name in (str(self.project.root), "plan", "../plan"):
            with self.assertRaises(ValueError):
                adapter.call("get_project", {"project": name})
        with self.assertRaises(ValueError):
            adapter.call("create_project", {"name": "Escape"})

    def test_held_lock_exhaustion_is_bounded_and_never_starts_transport(self):
        with (
            self.project.transactions.locked(),
            patch.object(server.time, "sleep") as sleep,
            patch.object(server, "Adapter", wraps=server.Adapter) as opening,
        ):
            with self.assertRaisesRegex(TransactionBusy, "21 attempts.*no tool was submitted"):
                server.open_adapter(self.project.root, single_project=True)
        self.assertEqual(opening.call_count, 21)
        self.assertEqual(sleep.call_count, 20)
        self.assertAlmostEqual(sum(call.args[0] for call in sleep.call_args_list), 2)

    def test_non_busy_errors_and_workspace_open_are_not_retried(self):
        for error in (Conflict("changed"), ValueError("invalid"), OSError("transport failure")):
            for busy_first in (False, True):
                failures = [TransactionBusy("busy"), error] if busy_first else [error]
                with (
                    self.subTest(error=error, busy_first=busy_first),
                    patch.object(server, "Adapter", side_effect=failures) as opening,
                    patch.object(server.time, "sleep") as sleep,
                ):
                    with self.assertRaises(type(error)):
                        server.open_adapter(self.project.root, single_project=True)
                    self.assertEqual(opening.call_count, len(failures))
                    self.assertEqual(sleep.call_count, int(busy_first))
        with patch.object(server, "Adapter", side_effect=TransactionBusy("busy")) as opening:
            with self.assertRaises(TransactionBusy):
                server.open_adapter(self.project.root)
            opening.assert_called_once()

    def test_post_startup_tool_contention_and_stale_revision_are_not_replayed(self):
        adapter = server.open_adapter(self.project.root, single_project=True)
        revision = self.project.catalog()["revision"]
        arguments = dict(
            project="project", project_revision=revision, name="Once", width=4, height=4, grid=8
        )
        before = len(self.project.transactions.records())
        with self.project.transactions.locked(), self.assertRaises(TransactionBusy):
            adapter.call("create_scene", arguments)
        adapter.call("create_scene", arguments)
        with self.assertRaises(Conflict):
            adapter.call("create_scene", arguments)
        self.assertEqual(len(self.project.transactions.records()), before + 1)
        self.assertEqual(len(self.project.catalog()["project"]["scenes"]), 1)


@unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP extra for SDK startup")
class StartupProtocolTests(unittest.TestCase):
    setUp = StartupTests.setUp

    def test_real_sdk_exhaustion_and_invalid_project_fail_clearly(self):
        for path, held, message in (
            (self.project.root, True, "project remained busy after 21 attempts"),
            (self.project.root / "missing", False, "Project directory does not exist"),
        ):
            with self.subTest(path=path), ExitStack() as stack:
                if held:
                    stack.enter_context(self.project.transactions.locked())
                result = subprocess.run(
                    [sys.executable, "-m", "gbc_scene_forge.mcp_server", "--project", str(path)],
                    input='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
                    text=True,
                    capture_output=True,
                    timeout=15,
                    env=dict(os.environ),
                )
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertIn(message, result.stderr)
                self.assertEqual(server.STARTUP_BUSY_MESSAGE in result.stderr, held)

    def test_real_sdk_releases_observed_lock_then_saves_once_and_reports_conflict(self):
        asyncio.run(self.session())

    async def session(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        # An independent holder releases only after observing the server's first busy attempt.
        holder = subprocess.Popen(
            [sys.executable, "tests/support/hold_project_lock.py", str(self.project.root)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        def cleanup():
            if holder.poll() is None:
                holder.kill()
            holder.communicate()

        self.addCleanup(cleanup)
        self.assertEqual(holder.stdout.readline().strip(), "locked")
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "gbc_scene_forge.mcp_server", "--project", str(self.project.root)],
            env=dict(os.environ),
        )
        with tempfile.TemporaryFile(mode="w+") as errors:

            async def release():
                for _ in range(200):
                    if server.STARTUP_BUSY_MESSAGE in os.pread(errors.fileno(), 65536, 0).decode():
                        holder.communicate("release\n", timeout=5)
                        return
                    await asyncio.sleep(0.01)
                self.fail("Server did not report startup contention")

            releasing = asyncio.create_task(release())
            try:
                async with stdio_client(params, errlog=errors) as streams:
                    async with ClientSession(*streams) as client:
                        await client.initialize()
                        await releasing
                        listing = await client.call_tool("list_projects", {})
                        self.assertEqual(
                            listing.structuredContent["projects"][0]["directory"], "project"
                        )
                        revision = listing.structuredContent["projects"][0]["revision"]
                        args = dict(
                            project="project",
                            project_revision=revision,
                            name="Once",
                            width=4,
                            height=4,
                            grid=8,
                        )
                        before = len(self.project.transactions.records())
                        saved = await client.call_tool("create_scene", args)
                        self.assertFalse(saved.isError, saved.content)
                        stale = await client.call_tool("create_scene", args)
                        self.assertTrue(stale.isError)
                        self.assertEqual(stale.structuredContent["error"]["code"], "conflict")
                        self.assertEqual(len(self.project.transactions.records()), before + 1)
                        self.assertEqual(len(self.project.catalog()["project"]["scenes"]), 1)
            finally:
                releasing.cancel()
                await asyncio.gather(releasing, return_exceptions=True)
