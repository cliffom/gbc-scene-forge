"""Canonical JSON bytes used by project files and recovery records."""

import json
from typing import Any


def json_text(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def record_bytes(value: Any) -> bytes:
    return json_text(value).encode()
