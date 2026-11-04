"""Owned, revision-guarded artwork checkpoints, separate from scene history."""

import json
from datetime import datetime, timezone

from gbc_scene_forge.artwork import dimensions, editable, sheets
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.identities import identity
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.storage.files import atomic_write, digest, read_optional
from gbc_scene_forge.storage.paths import safe_path

MAX_BYTES = dimensions.MAX_DRAFT_BYTES
MAX_DRAFTS = 64
MAX_TOTAL = 128 * 1024 * 1024  # Room for a recovered copy while retaining its original.


class ArtworkDrafts:
    def __init__(self, documents):
        self.documents = documents
        self.store = documents.store

    def path(self, draft_id):
        require(identity(draft_id), "Invalid artwork draft identity")
        return safe_path(self.store.root, f".forge/artwork-drafts/{draft_id}.json")

    def paths(self):
        directory = safe_path(self.store.root, ".forge/artwork-drafts")
        return sorted(self.path(p.stem) for p in directory.glob("*.json") if identity(p.stem))

    def validate(self, value, project_id):
        require(
            isinstance(value, dict)
            and set(value)
            == {"version", "id", "project_id", "owner", "original", "candidate", "name", "updated"}
            and type(value["version"]) is int
            and value["version"] == 1
            and identity(value["id"])
            and identity(value["owner"])
            and value["project_id"] == project_id
            and isinstance(value["name"], str)
            and 1 <= len(value["name"]) <= 100
            and isinstance(value["updated"], str),
            "Invalid artwork draft record",
        )
        original, candidate = value["original"], value["candidate"]
        editable.check_candidate(original)
        editable.check_candidate(candidate)
        require(original["project_id"] == project_id, "Draft belongs to another project")
        excluded = {"rgba", "layer_rgba", "revision", "descriptor"}
        original_flat = {k: v for k, v in original["descriptor"].items() if k != "layers"}
        candidate_flat = {k: v for k, v in candidate["descriptor"].items() if k != "layers"}
        if original_flat["version"] != 2 or candidate_flat["version"] != 2:
            require(
                original_flat == candidate_flat, "Draft geometry and identity must remain unchanged"
            )
        if original["descriptor"]["version"] == candidate["descriptor"]["version"] == 2:
            sheets.compatible(original_flat, candidate_flat)
        require(
            {k: v for k, v in original.items() if k not in excluded}
            == {k: v for k, v in candidate.items() if k not in excluded},
            "Artwork draft must retain its original identity, metadata and saved base",
        )

    def read(self, draft_id):
        with self.path(draft_id).open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "Artwork draft exceeds 49 MiB")
        value = json.loads(raw)
        document, _ = self.store.read()
        self.validate(value, document["id"])
        require(value["id"] == draft_id, "Draft identity differs from filename")
        return value, digest(raw)

    def write(self, data):
        with self.store.transactions.locked():
            document, _ = self.store.read()
            value = {
                k: data.get(k)
                for k in ("id", "project_id", "owner", "original", "candidate", "name")
            }
            value.update(version=1, updated=datetime.now(timezone.utc).isoformat())
            self.validate(value, document["id"])
            path = self.path(value["id"])
            current = digest(read_optional(path))
            if current is not None:
                previous, _ = self.read(value["id"])
                if previous["owner"] != value["owner"]:
                    raise Conflict("Another writer owns this draft. Recover a copy instead.")
                require(
                    previous["original"] == value["original"],
                    "Cannot change a draft's original base",
                )
            if current != data.get("revision"):
                raise Conflict("Artwork draft changed. Retain work and refresh recovery.")
            raw = record_bytes(value)
            require(len(raw) <= MAX_BYTES, "Artwork draft exceeds 49 MiB")
            paths = self.paths()
            require(path in paths or len(paths) < MAX_DRAFTS, "Artwork draft limit reached")
            require(
                sum(p.stat().st_size for p in paths if p != path) + len(raw) <= MAX_TOTAL,
                "Artwork draft storage exceeds 128 MiB",
            )
            # Stale bases remain checkpointable: recovery must never overwrite a later save.
            atomic_write(path, raw)
            return {"revision": digest(raw)}

    def list(self):
        with self.store.transactions.locked():
            result = []
            for path in self.paths():
                try:
                    value, revision = self.read(path.stem)
                    result.append(
                        {k: value[k] for k in ("id", "owner", "name", "updated")}
                        | {"revision": revision}
                    )
                except (ValueError, OSError, KeyError, TypeError) as error:
                    result.append({"id": path.stem, "error": str(error)})
            return {"drafts": result}

    def download(self, draft_id, revision):
        with self.store.read_session():
            value, current = self.read(draft_id)
            if revision != current:
                raise Conflict("Artwork draft changed. Refresh recovery.")
            return value

    def restore(self, draft_id, revision):
        value = self.download(draft_id, revision)
        candidate = value["candidate"]
        with self.store.read_session(candidate["project_revision"], verify_assets=True) as session:
            self.documents.validate_base(value["original"], session.document)
            self.documents.validate_base(candidate, session.document)
            self.documents.placement_scenes(candidate, session)
        # The browser recovers into a fresh record/owner. The original remains available.
        return value

    def delete(self, draft_id, revision, owner):
        with self.store.transactions.locked():
            path = self.path(draft_id)
            current = digest(read_optional(path))
            if current is not None:
                value, _ = self.read(draft_id)
                if current != revision or value["owner"] != owner:
                    raise Conflict("Artwork draft changed or belongs to another owner.")
            atomic_write(path, None)
            return {"deleted": draft_id}
