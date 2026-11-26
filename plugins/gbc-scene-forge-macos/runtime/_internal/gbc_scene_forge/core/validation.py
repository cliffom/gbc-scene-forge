"""Shared scalar validation, independent of an artwork format."""

import re

from .errors import InvalidRequest


def require(condition: object, message: str) -> None:
    if not condition:
        raise InvalidRequest(message)


def integer(value: object, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def identifier(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value) is not None
