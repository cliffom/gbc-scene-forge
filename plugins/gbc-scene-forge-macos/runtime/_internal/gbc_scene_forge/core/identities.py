"""Portable project identities and author-provided names."""

from typing import cast
from uuid import UUID

from .validation import require


def name(value: object) -> str:
    require(
        isinstance(value, str) and 1 <= len(value.strip()) <= 100,
        "Name must contain 1..100 characters",
    )
    return cast(str, value).strip()


def identity(value: object) -> bool:
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False
