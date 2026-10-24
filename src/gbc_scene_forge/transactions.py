"""Durable, conflict-checked source/ROM transactions and recovery for scene apply."""

import hashlib
import json
import os
import re
import stat
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .paths import reject_symlinks


def record_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def read_optional(path):
    return path.read_bytes() if path.exists() else None


def safe_path(root, name):
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError("Transaction path must stay inside the project")
    target = root / relative
    reject_symlinks(target, root)
    return target


def atomic_write(path, data):
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


class Transactions:
    def __init__(self, root, history="assets/scenes/history"):
        self.root = root
        self.history = root / history

    @contextmanager
    def locked(self):
        # macOS and Linux development hosts share a non-blocking filesystem lock.
        import fcntl

        reject_symlinks(self.history, self.root)
        self.history.mkdir(parents=True, exist_ok=True)
        with safe_path(self.root, str(self.history.relative_to(self.root) / ".lock")).open(
            "a"
        ) as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ValueError(
                    "Another scene editor is applying changes. Try again when it finishes."
                ) from error
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def record_path(self, transaction_id):
        if not isinstance(transaction_id, str) or not re.fullmatch(r"[0-9a-f]{32}", transaction_id):
            raise ValueError("Invalid apply transaction")
        return safe_path(
            self.root,
            str(self.history.relative_to(self.root) / transaction_id / "transaction.json"),
        )

    def records(self):
        reject_symlinks(self.history, self.root)
        records = []
        for path in self.history.glob("*/transaction.json"):
            path = self.record_path(path.parent.name)
            records.append(json.loads(path.read_text()))
        return sorted(records, key=lambda r: r["created"])

    def latest(self):
        return next((r for r in reversed(self.records()) if r["status"] == "applied"), None)

    def _restore(self, record, *, interrupted=False):
        base = self.record_path(record["id"]).parent
        # Validate every file and backup before restoring any of them.
        for name, hashes in record["files"].items():
            current = digest(read_optional(safe_path(self.root, name)))
            permitted = (hashes["before"], hashes["after"]) if interrupted else (hashes["after"],)
            if current not in permitted:
                raise ValueError(
                    f"Cannot undo: {name} changed after this apply. Your later edit was preserved."
                )
            if hashes["before"] is not None:
                old = safe_path(base, "before/" + name).read_bytes()
                if digest(old) != hashes["before"]:
                    raise ValueError(f"Rollback backup does not match {name}")
        record["status"] = "restoring"
        atomic_write(base / "transaction.json", record_bytes(record))
        for name, hashes in record["files"].items():
            old = (
                safe_path(base, "before/" + name).read_bytes()
                if hashes["before"] is not None
                else None
            )
            atomic_write(safe_path(self.root, name), old)
        record["status"] = "recovered" if interrupted else "undone"
        atomic_write(base / "transaction.json", record_bytes(record))

    def recover(self):
        with self.locked():
            for record in self.records():
                if record["status"] in ("applying", "restoring"):
                    self._restore(record, interrupted=True)

    def apply(self, changes, expected, label, *, review_id=None):
        with self.locked():
            for name in changes:
                if digest(read_optional(safe_path(self.root, name))) != expected.get(name):
                    raise ValueError(
                        f"{name} changed since review. Review the current game before applying."
                    )
            transaction_id = uuid4().hex
            record_path = self.record_path(transaction_id)
            base = record_path.parent
            record = {
                "id": transaction_id,
                "label": label,
                "created": datetime.now(timezone.utc).isoformat(),
                "status": "applying",
                "files": {},
                "review_id": review_id,
            }
            for name, data in changes.items():
                old = read_optional(safe_path(self.root, name))
                record["files"][name] = {"before": digest(old), "after": digest(data)}
                if old is not None:
                    atomic_write(safe_path(base, "before/" + name), old)
                atomic_write(safe_path(base, "after/" + name), data)
            atomic_write(record_path, record_bytes(record))
            try:
                for name, data in changes.items():
                    atomic_write(safe_path(self.root, name), data)
                record["status"] = "applied"
                atomic_write(record_path, record_bytes(record))
            except BaseException:
                self._restore(record, interrupted=True)
                raise
            return record

    def undo(self, transaction_id):
        with self.locked():
            record = self.latest()
            if record is None or record["id"] != transaction_id:
                raise ValueError(
                    "This is no longer the latest applied scene. Refresh before undoing."
                )
            self._restore(record)
            return record
