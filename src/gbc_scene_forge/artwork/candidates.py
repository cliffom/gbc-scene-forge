"""Recoverable immutable candidate handles, scoped to one declared project root."""

import json

from gbc_scene_forge.artwork import editable
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.storage.files import atomic_write
from gbc_scene_forge.storage.paths import safe_path

MAX_COUNT = 256
MAX_TOTAL = 64 * 1024 * 1024


class ArtworkCandidates:
    """Local sidecars survive restarts; only explicit release removes a candidate."""

    def __init__(self, documents):
        self.store = documents.store

    def path(self, revision):
        require(editable.revision(revision), "Expected a candidate content revision")
        return safe_path(self.store.root, f".forge/artwork-candidates/{revision}.json")

    def paths(self):
        directory = safe_path(self.store.root, ".forge/artwork-candidates")
        return sorted(
            self.path(p.stem) for p in directory.glob("*.json") if editable.revision(p.stem)
        )

    @staticmethod
    def handle(candidate):
        return {
            "handle": candidate["revision"],
            **{k: candidate[k] for k in ("project_id", "project_revision", "revision")},
        }

    def retain(self, candidate):
        editable.check_candidate(candidate)
        with self.store.transactions.locked():
            document, _ = self.store.read()
            require(
                candidate["project_id"] == document["id"], "Candidate belongs to another project"
            )
            raw = record_bytes(candidate)
            path = self.path(candidate["revision"])
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
        return self.handle(candidate)

    def resolve(self, handle):
        require(
            isinstance(handle, dict)
            and set(handle) == {"handle", "project_id", "project_revision", "revision"},
            "Expected a complete immutable candidate handle",
        )
        with self.store.read_session() as session:
            require(
                handle["project_id"] == session.document["id"], "Handle belongs to another project"
            )
            path = self.path(handle["handle"])
            require(
                path.exists(), "Candidate handle unavailable; restore its exported full envelope"
            )
            with path.open("rb") as stream:
                raw = stream.read(editable.MAX_CANDIDATE + 1)
            require(len(raw) <= editable.MAX_CANDIDATE, "Candidate sidecar exceeds limit")
            candidate = json.loads(raw)
            editable.check_candidate(candidate)
            require(
                self.handle(candidate) == handle, "Candidate handle identity differs from content"
            )
            return candidate

    def list(self):
        # Listing recovers handle identities even after a client/server restart.
        with self.store.read_session() as session:
            result = []
            for path in self.paths():
                try:
                    with path.open("rb") as stream:
                        raw = stream.read(editable.MAX_CANDIDATE + 1)
                    require(len(raw) <= editable.MAX_CANDIDATE, "Oversize candidate")
                    candidate = json.loads(raw)
                    editable.check_candidate(candidate)
                    require(
                        candidate["project_id"] == session.document["id"]
                        and candidate["revision"] == path.stem,
                        "Candidate identity differs",
                    )
                    result.append(
                        {**self.handle(candidate), "name": candidate["descriptor"]["name"]}
                    )
                except (ValueError, KeyError, TypeError, OSError) as error:
                    result.append({"handle": path.stem, "error": str(error)})
            return {
                "candidates": result,
                "max_count": MAX_COUNT,
                "max_bytes": MAX_TOTAL,
                "expiration": None,
            }

    def release(self, handle):
        candidate = self.resolve(handle)
        with self.store.transactions.locked():
            path = self.path(candidate["revision"])
            if path.exists():
                require(
                    path.read_bytes() == record_bytes(candidate), "Candidate changed before release"
                )
                atomic_write(path, None)
            return {"released": handle["handle"]}
