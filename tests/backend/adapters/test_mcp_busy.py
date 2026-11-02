"""Fixture retries must not mask stale revisions, validation failures or lost acknowledgments."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from support.project_busy import BUSY_ERROR, call_tool, retry_busy

from gbc_scene_forge.core.errors import Conflict, TransactionBusy


def result(error=None):
    return SimpleNamespace(isError=error is not None, structuredContent=error or {"saved": True})


class ToolBusyRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_retries_keep_identical_arguments_and_revision_fences(self):
        saved = result()
        client = SimpleNamespace(call_tool=AsyncMock(side_effect=[result(BUSY_ERROR), saved]))
        args = {"project_revision": "old-project", "scene_revision": "old-scene"}
        self.assertIs(await call_tool(client, "edit_scene", args, delay=0), saved)
        self.assertEqual(client.call_tool.await_count, 2)
        for call in client.call_tool.call_args_list:
            self.assertEqual(call.args, ("edit_scene", args))
        self.assertEqual(args, {"project_revision": "old-project", "scene_revision": "old-scene"})

    async def test_other_errors_and_revision_conflicts_are_not_retried(self):
        for error in (
            {"error": {"code": "conflict", "message": "Scene changed"}},
            {"error": {"code": "invalid_request", "message": "Invalid object"}},
            {"error": {"code": "conflict", "message": BUSY_ERROR["error"]["message"]}},
            None,
        ):
            with self.subTest(error=error):
                response = result(error)
                client = SimpleNamespace(call_tool=AsyncMock(return_value=response))
                self.assertIs(await call_tool(client, "edit_scene", {}, delay=0), response)
                self.assertEqual(client.call_tool.await_count, 1)

    async def test_busy_exhaustion_remains_an_error(self):
        response = result(BUSY_ERROR)
        client = SimpleNamespace(call_tool=AsyncMock(return_value=response))
        self.assertIs(await call_tool(client, "edit_scene", {}, attempts=3, delay=0), response)
        self.assertTrue(response.isError)
        self.assertEqual(client.call_tool.await_count, 3)

    async def test_conflict_after_busy_is_not_rebased_or_swallowed(self):
        conflict = result({"error": {"code": "conflict", "message": "Scene changed"}})
        client = SimpleNamespace(call_tool=AsyncMock(side_effect=[result(BUSY_ERROR), conflict]))
        self.assertIs(await call_tool(client, "edit_scene", {}, delay=0), conflict)
        self.assertEqual(client.call_tool.await_count, 2)

    async def test_transport_failure_is_not_replayed(self):
        client = SimpleNamespace(call_tool=AsyncMock(side_effect=OSError("Lost acknowledgment")))
        with self.assertRaisesRegex(OSError, "Lost acknowledgment"):
            await call_tool(client, "edit_scene", {}, delay=0)
        self.assertEqual(client.call_tool.await_count, 1)

    async def test_invalid_attempt_bound_is_rejected(self):
        client = SimpleNamespace(call_tool=AsyncMock())
        with self.assertRaises(ValueError):
            await call_tool(client, "edit_scene", {}, attempts=0)
        client.call_tool.assert_not_awaited()


class FixtureBusyRetryTests(unittest.TestCase):
    def test_busy_retry_is_bounded_and_preserves_result(self):
        operation = Mock(side_effect=[TransactionBusy("busy"), "saved"])
        self.assertEqual(retry_busy(operation, delay=0), "saved")
        self.assertEqual(operation.call_count, 2)
        operation = Mock(side_effect=TransactionBusy("busy"))
        with self.assertRaises(TransactionBusy):
            retry_busy(operation, attempts=3, delay=0)
        self.assertEqual(operation.call_count, 3)

    def test_non_busy_failure_is_not_retried(self):
        wrapped = Conflict("changed")
        wrapped.__cause__ = ValueError("not a lock failure")
        for error in (
            Conflict("changed"),
            Conflict(BUSY_ERROR["error"]["message"]),
            wrapped,
            ValueError("invalid"),
            OSError("unknown outcome"),
        ):
            operation = Mock(side_effect=error)
            with self.assertRaises(type(error)):
                retry_busy(operation, delay=0)
            self.assertEqual(operation.call_count, 1)

    def test_commit_busy_cause_is_retried_but_bounded(self):
        error = Conflict("busy")
        error.__cause__ = TransactionBusy("busy")
        operation = Mock(side_effect=[error, "saved"])
        self.assertEqual(retry_busy(operation, delay=0), "saved")
        self.assertEqual(operation.call_count, 2)
        operation = Mock(side_effect=error)
        with self.assertRaises(Conflict) as raised:
            retry_busy(operation, attempts=3, delay=0)
        self.assertIs(raised.exception, error)
        self.assertEqual(operation.call_count, 3)

    def test_revision_conflict_after_commit_busy_is_not_rebased(self):
        busy = Conflict("busy")
        busy.__cause__ = TransactionBusy("busy")
        stale = Conflict("Scene changed")
        operation = Mock(side_effect=[busy, stale])
        with self.assertRaises(Conflict) as raised:
            retry_busy(operation, delay=0)
        self.assertIs(raised.exception, stale)
        self.assertEqual(operation.call_count, 2)

    def test_invalid_attempt_bound_is_rejected(self):
        operation = Mock()
        with self.assertRaises(ValueError):
            retry_busy(operation, attempts=0)
        operation.assert_not_called()
