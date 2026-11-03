"""Recoverable immutable candidate handles, scoped to one declared project root."""

import json

from gbc_scene_forge.artwork import editable
from gbc_scene_forge.core.identities import identity
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.storage.files import atomic_write
from gbc_scene_forge.storage.paths import safe_path

MAX_COUNT = 256
MAX_TOTAL = 64 * 1024 * 1024


class ArtworkCandidates:
    """Restart-safe copies keyed by content and optional browser-session owner.

    Owners isolate automatic browser cleanup; every copy shares the project quota
    and remains discoverable for explicit export/release after a client exits.
    """

    def __init__(self, documents):
        self.store = documents.store

    def path(self, revision, owner=None):
        require(editable.revision(revision), "Expected a candidate content revision")
        require(owner is None or identity(owner), "Expected a candidate owner UUID")
        prefix = f"{owner}-" if owner is not None else ""
        return safe_path(self.store.root, f".forge/artwork-candidates/{prefix}{revision}.json")

    @staticmethod
    def _identity(path):
        if editable.revision(path.stem):
            return path.stem, None
        owner, _, revision = path.stem.rpartition("-")
        if identity(owner) and editable.revision(revision):
            return revision, owner
        return None

    def paths(self):
        directory = safe_path(self.store.root, ".forge/artwork-candidates")
        return sorted(
            self.path(*key)
            for p in directory.glob("*.json")
            if (key := self._identity(p)) is not None
        )

    @staticmethod
    def handle(candidate, owner=None):
        return {
            "handle": candidate["revision"],
            **{k: candidate[k] for k in ("project_id", "project_revision", "revision")},
            **({"owner": owner} if owner is not None else {}),
        }

    def retain(self, candidate, *, owner=None):
        editable.check_candidate(candidate)
        with self.store.transactions.locked():
            document, _ = self.store.read()
            require(
                candidate["project_id"] == document["id"], "Candidate belongs to another project"
            )
            raw = record_bytes(candidate)
            path = self.path(candidate["revision"], owner)
            if path.exists():
                require(
                    path.read_bytes() == raw, "Candidate sidecar differs; export work for recovery"
                )
            else:
                paths = self.paths()
                require(
                    len(paths) < MAX_COUNT,
                    "Candidate limit reached; export and release old handles",
                )
                require(
                    sum(p.stat().st_size for p in paths) + len(raw) <= MAX_TOTAL,
                    "Candidate storage exceeds 64 MiB; export and release old handles",
                )
                atomic_write(path, raw)
        return self.handle(candidate, owner)

    def resolve(self, handle):
        require(
            isinstance(handle, dict)
            and set(handle)
            in (
                {"handle", "project_id", "project_revision", "revision"},
                {"handle", "project_id", "project_revision", "revision", "owner"},
            )
            and ("owner" not in handle or identity(handle["owner"])),
            "Expected a complete immutable candidate handle",
        )
        with self.store.read_session() as session:
            require(
                handle["project_id"] == session.document["id"], "Handle belongs to another project"
            )
            path = self.path(handle["handle"], handle.get("owner"))
            require(
                path.exists(), "Candidate handle unavailable; restore its exported full envelope"
            )
            with path.open("rb") as stream:
                raw = stream.read(editable.MAX_CANDIDATE + 1)
            require(len(raw) <= editable.MAX_CANDIDATE, "Candidate sidecar exceeds limit")
            candidate = json.loads(raw)
            editable.check_candidate(candidate)
            require(
                self.handle(candidate, handle.get("owner")) == handle,
                "Candidate handle identity differs from content",
            )
            return candidate

    def list(self):
        # Listing recovers handle identities even after a client/server restart.
        with self.store.read_session() as session:
            result = []
            for path in self.paths():
                revision, owner = self._identity(path)
                try:
                    with path.open("rb") as stream:
                        raw = stream.read(editable.MAX_CANDIDATE + 1)
                    require(len(raw) <= editable.MAX_CANDIDATE, "Oversize candidate")
                    candidate = json.loads(raw)
                    editable.check_candidate(candidate)
                    require(
                        candidate["project_id"] == session.document["id"]
                        and candidate["revision"] == revision,
                        "Candidate identity differs",
                    )
                    result.append(
                        {**self.handle(candidate, owner), "name": candidate["descriptor"]["name"]}
                    )
                except (ValueError, KeyError, TypeError, OSError) as error:
                    result.append(
                        {
                            "handle": revision,
                            **({"owner": owner} if owner is not None else {}),
                            "error": str(error),
                        }
                    )
            return {
                "candidates": result,
                "max_count": MAX_COUNT,
                "max_bytes": MAX_TOTAL,
                "expiration": None,
            }

    def release(self, handle):
        candidate = self.resolve(handle)
        with self.store.transactions.locked():
            path = self.path(candidate["revision"], handle.get("owner"))
            if path.exists():
                require(
                    path.read_bytes() == record_bytes(candidate), "Candidate changed before release"
                )
                atomic_write(path, None)
            return {"released": handle["handle"]}
