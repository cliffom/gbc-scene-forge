"""Project-local unsaved checkpoints, independent of committed scene transactions."""

import json
import re
from datetime import datetime, timezone
from uuid import UUID

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.storage.files import atomic_write, digest, read_optional
from gbc_scene_forge.storage.paths import safe_path

MAX_BYTES = 4 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_DRAFTS = 64


def uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


def revision(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


class Drafts:
    def __init__(self, store: ProjectStore):
        self.store = store
        self.root = store.root

    def path(self, draft_id):
        require(uuid(draft_id), "Invalid draft identity")
        return safe_path(self.root, f".forge/drafts/{draft_id}.json")

    def paths(self):
        directory = safe_path(self.root, ".forge/drafts")
        return sorted(self.path(p.stem) for p in directory.glob("*.json") if uuid(p.stem))

    def read(self, draft_id):
        path = self.path(draft_id)
        with path.open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "Draft exceeds 4 MiB")
        value = json.loads(raw)
        document, _ = self.store.read()
        require(
            isinstance(value, dict)
            and value.get("version") == 1
            and value.get("id") == draft_id
            and value.get("project_id") == document["id"]
            and uuid(value.get("scene_id"))
            and revision(value.get("scene_revision"))
            and revision(value.get("project_revision"))
            and isinstance(value.get("scene"), dict)
            and isinstance(value.get("updated"), str)
            and isinstance(value.get("name"), str),
            "Invalid draft record or project identity",
        )
        return value, digest(raw)

    def write(self, data):
        with self.store.transactions.locked():
            document, _ = self.store.read()
            require(data.get("project_id") == document["id"], "Draft belongs to another project")
            require(uuid(data.get("scene_id")), "Invalid scene identity")
            require(
                revision(data.get("scene_revision")) and revision(data.get("project_revision")),
                "Draft requires its original project and scene revisions",
            )
            require(isinstance(data.get("scene"), dict), "Expected a scene snapshot")
            require(
                isinstance(data.get("name"), str) and 1 <= len(data["name"]) <= 100,
                "Invalid scene name",
            )
            path = self.path(data.get("id"))
            before = digest(read_optional(path))
            # Preserve stale snapshots too: an external edit must not prevent recovery
            # of the author's last unsaved work. Validate against assets only on restore.
            value = {
                key: data[key]
                for key in (
                    "id",
                    "project_id",
                    "scene_id",
                    "name",
                    "scene_revision",
                    "project_revision",
                    "scene",
                )
            }
            if before != data.get("revision"):
                # A response can be lost after the atomic write. Retrying identical
                # content acknowledges it without replacing a newer checkpoint.
                existing = self.read(data["id"])[0] if before is not None else {}
                if all(existing.get(key) == item for key, item in value.items()):
                    return {"revision": before}
                raise Conflict("Draft changed. Its newer checkpoint was preserved.")
            value.update(version=1, updated=datetime.now(timezone.utc).isoformat())
            raw = record_bytes(value)
            require(len(raw) <= MAX_BYTES, "Draft exceeds 4 MiB; save or export your work")
            paths = self.paths()
            require(
                path in paths or len(paths) < MAX_DRAFTS, "Draft limit reached; discard old drafts"
            )
            total = sum(p.stat().st_size for p in paths if p != path)
            require(
                total + len(raw) <= MAX_TOTAL, "Draft storage exceeds 64 MiB; discard old drafts"
            )
            atomic_write(path, raw)
            return {"revision": digest(raw)}

    def restore(self, draft_id, expected):
        with self.store.read_session() as session:
            value, current = self.read(draft_id)
            if expected != current:
                raise Conflict("Draft changed. Refresh recovery before restoring it.")
            document = self.store.current(value["project_revision"])
            saved = session.scene(value["scene_id"])
            if saved["revision"] != value["scene_revision"]:
                raise Conflict("Saved scene changed. Download this draft to preserve its edits.")
            # Round-trip through the same validator as save without committing anything.
            scene = tiled.decode(tiled.encode(value["scene"], document), document)
            return {**saved, "scene": scene}

    def list(self):
        with self.store.transactions.locked():
            items = []
            for path in self.paths():
                try:
                    value, current = self.read(path.stem)
                    items.append(
                        {key: value[key] for key in ("id", "scene_id", "name", "updated")}
                        | {"revision": current}
                    )
                except (ValueError, OSError, KeyError, TypeError) as error:
                    # A damaged record must not hide the other recoverable drafts.
                    items.append({"id": path.stem, "error": str(error)})
            return {"drafts": sorted(items, key=lambda item: item.get("updated", ""), reverse=True)}

    def download(self, draft_id, expected):
        with self.store.read_session():
            value, current = self.read(draft_id)
            if current != expected:
                raise Conflict("Draft changed. Refresh recovery before downloading it.")
            return value

    def delete(self, draft_id, expected):
        with self.store.transactions.locked():
            path = self.path(draft_id)
            current = digest(read_optional(path))
            if current is not None and current != expected:
                raise Conflict("Draft changed. Its newer checkpoint was preserved.")
            atomic_write(path, None)
            return {"deleted": draft_id}
