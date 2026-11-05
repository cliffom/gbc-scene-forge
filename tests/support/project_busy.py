"""Bounded contention handling for fixtures that share a project with a live browser."""

import asyncio
import time

from gbc_scene_forge.core.errors import Conflict, TransactionBusy

BUSY_MESSAGE = "Another scene editor is applying changes. Try again when it finishes."
BUSY_ERROR = {"error": {"code": "invalid_request", "message": BUSY_MESSAGE}}
COMMIT_BUSY_ERROR = {"error": {"code": "conflict", "message": BUSY_MESSAGE}}
ARTWORK_BUSY_ERROR = {"error": {"code": "busy", "message": BUSY_MESSAGE}}


async def call_tool(client, name, arguments, *, attempts=20, delay=0.05):
    """Retry only explicit busy responses, preserving the original revision fences."""
    if attempts < 1:
        raise ValueError("Use at least one attempt")
    for attempt in range(attempts):
        result = await client.call_tool(name, arguments)
        # Artwork has an explicit busy code; older scene/commit responses wrap
        # TransactionBusy in invalid_request/Conflict. These exact responses mean
        # the lock was never acquired, so the original guarded call is safe to retry.
        if (
            not result.isError
            or result.structuredContent not in (BUSY_ERROR, COMMIT_BUSY_ERROR, ARTWORK_BUSY_ERROR)
            or attempt == attempts - 1
        ):
            return result
        await asyncio.sleep(delay)


def retry_busy(operation, *, attempts=20, delay=0.05):
    """Retry one fixture operation, never replay an entire partially completed setup."""
    if attempts < 1:
        raise ValueError("Use at least one attempt")
    for attempt in range(attempts):
        try:
            return operation()
        except (TransactionBusy, Conflict) as error:
            # ProjectStore.commit preserves its public Conflict contract while
            # chaining the lock failure. Only that explicit cause is retryable:
            # no lock was acquired and the revision fences remain unchanged.
            if isinstance(error, Conflict) and not isinstance(error.__cause__, TransactionBusy):
                raise
            if attempt == attempts - 1:
                raise
            time.sleep(delay)
