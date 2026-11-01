"""Bounded contention handling for fixtures that share a project with a live browser."""

import asyncio
import time

from gbc_scene_forge.core.errors import TransactionBusy

BUSY_MESSAGE = "Another scene editor is applying changes. Try again when it finishes."
BUSY_ERROR = {"error": {"code": "invalid_request", "message": BUSY_MESSAGE}}


async def call_tool(client, name, arguments, *, attempts=20, delay=0.05):
    """Retry only explicit busy responses, preserving the original revision fences."""
    if attempts < 1:
        raise ValueError("Use at least one attempt")
    for attempt in range(attempts):
        result = await client.call_tool(name, arguments)
        if not result.isError or result.structuredContent != BUSY_ERROR or attempt == attempts - 1:
            return result
        await asyncio.sleep(delay)


def retry_busy(operation, *, attempts=20, delay=0.05):
    """Retry one fixture operation, never replay an entire partially completed setup."""
    if attempts < 1:
        raise ValueError("Use at least one attempt")
    for attempt in range(attempts):
        try:
            return operation()
        except TransactionBusy:
            if attempt == attempts - 1:
                raise
            time.sleep(delay)
