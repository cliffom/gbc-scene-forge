"""Durable multi-file transactions with revision guards and crash recovery."""

import json
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from gbc_scene_forge.core.errors import TransactionBusy
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.storage.files import atomic_write, digest, read_optional
from gbc_scene_forge.storage.paths import reject_symlinks, safe_path


class Transactions:
    def __init__(self, root, history):
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
                raise TransactionBusy(
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
            for name in set(changes) | set(expected):
                if digest(read_optional(safe_path(self.root, name))) != expected.get(name):
                    raise ValueError(
                        f"{name} changed since this operation was prepared. Reload before trying again."
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
