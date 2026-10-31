"""Byte revisions and atomic filesystem replacement."""

import hashlib
import os
import stat
import tempfile
from pathlib import Path
from typing import overload


@overload
def digest(data: bytes) -> str: ...


@overload
def digest(data: None) -> None: ...


def digest(data: bytes | None) -> str | None:
    return hashlib.sha256(data).hexdigest() if data is not None else None


def read_optional(path: Path) -> bytes | None:
    return path.read_bytes() if path.exists() else None


def atomic_write(path: Path, data: bytes | None) -> None:
    if data is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def file_signature(path: Path) -> tuple[int, int, int, int, int] | None:
    """Cheap invalidation identity, including atomic replacements and same-size edits."""
    try:
        value = path.stat()
    except FileNotFoundError:
        return None
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
