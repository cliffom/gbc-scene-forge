"""Recoverable immutable candidate handles, scoped to one declared project root."""

import base64
import io
import json
import zipfile

from gbc_scene_forge.artwork import editable
from gbc_scene_forge.core.identities import identity
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.storage.files import atomic_write, digest
from gbc_scene_forge.storage.paths import safe_path

MAX_COUNT = 256
MAX_TOTAL = 64 * 1024 * 1024


class ArtworkCandidates:
    """Restart-safe copies keyed by content and optional browser-session owner.

    Owners isolate automatic browser cleanup; every copy shares the project quota
    and remains discoverable for explicit export/release after a client exits.
    """

    def __init__(self, documents):
        self.documents = documents
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
                used = sum(p.stat().st_size for p in paths)
                advice = (
                    f"Retained {len(paths)}/{MAX_COUNT} records, {used}/{MAX_TOTAL} bytes; "
                    f"remaining {max(0, MAX_TOTAL - used)} bytes; requested {len(raw)} bytes. "
                    "Use list_artwork_candidates, then archive_artwork_candidates with release=true "
                    "or export_artwork_candidate before explicit release. No drafts were evicted."
                )
                require(
                    len(paths) < MAX_COUNT,
                    "Candidate limit reached; " + advice,
                )
                require(
                    used + len(raw) <= MAX_TOTAL,
                    "Candidate storage exceeds 64 MiB; " + advice,
                )
                atomic_write(path, raw)
        return self.handle(candidate, owner)

    def resolve(self, handle):
        with self.store.read_session() as session:
            return self._resolve(handle, session)

    def _resolve(self, handle, session):
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
        require(handle["project_id"] == session.document["id"], "Handle belongs to another project")
        path = self.path(handle["handle"], handle.get("owner"))
        require(path.exists(), "Candidate handle unavailable; restore its exported full envelope")
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
            return self._list(session)

    def _list(self, session):
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
                    {
                        **self.handle(candidate, owner),
                        "name": candidate["descriptor"]["name"],
                        "document_id": candidate["descriptor"]["id"],
                        "atlas_id": candidate["descriptor"]["atlas_id"],
                        "bytes": path.stat().st_size,
                        "stale_project_base": candidate["project_revision"] != session.revision,
                        "saved_content": self.saved_content(candidate, session),
                    }
                )
            except (ValueError, KeyError, TypeError, OSError) as error:
                result.append(
                    {
                        "handle": revision,
                        **({"owner": owner} if owner is not None else {}),
                        "error": str(error),
                        "bytes": path.stat().st_size,
                    }
                )
        used = sum(item["bytes"] for item in result)
        archives = safe_path(self.store.root, ".forge/artwork-archives")
        return {
            "candidates": result,
            "max_count": MAX_COUNT,
            "max_bytes": MAX_TOTAL,
            "expiration": None,
            "used_count": len(result),
            "used_bytes": used,
            "remaining_count": max(0, MAX_COUNT - len(result)),
            "remaining_bytes": max(0, MAX_TOTAL - used),
            "archives": [
                {"archive": p.stem, "bytes": self.archive_path(p.stem).stat().st_size}
                for p in sorted(archives.glob("*.zip"))
                if editable.revision(p.stem)
            ],
        }

    def saved_content(self, candidate, session):
        """Current exact native content evidence, never inferred from composite alone."""
        d = candidate["descriptor"]
        entry = session.document["atlases"].get(d["atlas_id"])
        result = {
            "matches": False,
            "project_revision": session.revision,
            "document_id": d["id"],
            "candidate_revision": candidate["revision"],
            "basis": "current descriptor, metadata, composite and every exact layer source",
        }
        if not entry or entry.get("editable", {}).get("id") != d["id"]:
            return result
        try:
            saved = self.documents._descriptor(session.document, entry)
            result["artwork_revision"] = editable.artwork_revision(entry, session.document["files"])
            result["matches"] = (
                saved == d
                and entry.get("metadata", {}) == candidate["metadata"]
                and editable.decode_image(d, self.documents._asset(session.document, entry["png"]))
                == base64.b64decode(candidate["rgba"])
                and all(
                    editable.decode_image(
                        d,
                        self.documents._asset(
                            session.document, f"assets/{d['atlas_id']}/layers/{key}.png"
                        ),
                    )
                    == base64.b64decode(raw)
                    for key, raw in candidate.get("layer_rgba", {}).items()
                )
            )
        except (ValueError, KeyError, OSError) as error:
            result["error"] = str(error)
        return result

    def archive_plan(self):
        """Content identities establish grouping, never chronology or branch ancestry."""
        with self.store.read_session() as session:
            return self._archive_plan(session)

    def _archive_plan(self, session):
        inventory = self._list(session)
        groups = {}
        errors = []
        for item in inventory["candidates"]:
            if "error" in item:
                errors.append(item)
                continue
            key = (item.get("owner"), item["document_id"], item["atlas_id"])
            group = groups.setdefault(
                key,
                {
                    "owner": item.get("owner"),
                    "document_id": item["document_id"],
                    "atlas_id": item["atlas_id"],
                    "candidates": [],
                    "ordering": "indeterminate: content hashes do not establish ancestry or age",
                },
            )
            matched = item["saved_content"]["matches"]
            group["candidates"].append(
                {
                    "candidate": {
                        k: item[k]
                        for k in ("handle", "project_id", "project_revision", "revision", "owner")
                        if k in item
                    },
                    "name": item["name"],
                    "bytes": item["bytes"],
                    "estimated_reclaimable_bytes": item["bytes"],
                    "saved_content": item["saved_content"],
                    "stale_project_base": item["stale_project_base"],
                    "recommendation": "archive_saved_match" if matched else "retain_or_review",
                    "reason": "Exact current saved native content match"
                    if matched
                    else "No proven saved match; may be an unpublished branch. "
                    "Stale base does not establish disposability",
                }
            )
        for group in groups.values():
            entries = group["candidates"]
            if len(entries) > 1:
                for entry in entries:
                    if not entry["saved_content"]["matches"]:
                        entry["reason"] += (
                            "; other retained revisions exist for this owner/document, "
                            "but supersession is only a possibility requiring manual review"
                        )
            group["estimated_reclaimable_bytes"] = sum(e["bytes"] for e in entries)
            group["recommended_reclaimable_bytes"] = sum(
                e["bytes"] for e in entries if e["saved_content"]["matches"]
            )
        result = {
            "version": 1,
            "project_id": session.document["id"],
            "project_revision": session.revision,
            "groups": list(groups.values()),
            "unavailable": errors,
            "used_count": inventory["used_count"],
            "used_bytes": inventory["used_bytes"],
            "remaining_count": inventory["remaining_count"],
            "remaining_bytes": inventory["remaining_bytes"],
            "estimated_reclaimable_bytes": sum(
                g["estimated_reclaimable_bytes"] for g in groups.values()
            ),
            "recommended_reclaimable_bytes": sum(
                g["recommended_reclaimable_bytes"] for g in groups.values()
            ),
            "estimate_basis": "Retained JSON bytes released after durable archive; "
            "excludes archive disk usage. Nothing is selected automatically",
        }
        return {**result, "revision": digest(record_bytes(result))}

    def archive_path(self, revision):
        require(editable.revision(revision), "Expected archive digest")
        return safe_path(self.store.root, f".forge/artwork-archives/{revision}.zip")

    def archive(self, handles, *, release=False, plan=None):
        """Revalidate evidence and identities under one lock before durable export."""
        require(type(release) is bool, "release must be boolean")
        require(isinstance(handles, list) and 1 <= len(handles) <= 32, "Select 1..32 handles")
        with self.store.read_session() as session:
            if plan is not None:
                require(
                    plan == self._archive_plan(session),
                    "Archive plan is stale; generate a new plan",
                )
                selected = [
                    entry["candidate"] for group in plan["groups"] for entry in group["candidates"]
                ]
                require(
                    isinstance(handles, list) and all(h in selected for h in handles),
                    "Selected handle is not in archive plan",
                )
            entries = []
            total = 0
            for handle in handles:
                candidate = self._resolve(handle, session)
                raw = record_bytes(candidate)
                total += len(raw)
                require(total <= MAX_TOTAL, "Archive input exceeds 64 MiB; split selection")
                filename = self.path(candidate["revision"], handle.get("owner")).name
                require(filename not in [e[0] for e in entries], "Duplicate archive handle")
                entries.append((filename, raw, handle))
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for filename, raw, _ in sorted(entries):
                    archive.writestr(
                        zipfile.ZipInfo(filename), raw, compress_type=zipfile.ZIP_DEFLATED
                    )
            data = output.getvalue()
            archive_id = digest(data)
            path = self.archive_path(archive_id)
            atomic_write(path, data)
            require(path.read_bytes() == data, "Archive verification failed; candidates retained")
        results = []
        for _, _, handle in entries:
            result = {"candidate": handle, "released": False}
            if release:
                try:
                    self.release(handle)
                    result["released"] = True
                except (ValueError, OSError) as error:
                    result["error"] = str(error)
            results.append(result)
        return {
            "archive": archive_id,
            "bytes": len(data),
            "sha256": archive_id,
            "path": f".forge/artwork-archives/{archive_id}.zip",
            "results": results,
            "recovery": "Read archive chunks; each JSON is an unchanged full candidate envelope. "
            "Restore through retain_artwork_candidate; bases are never rebased.",
        }

    def read_archive(self, revision, offset=0):
        from gbc_scene_forge.core.validation import integer

        path = self.archive_path(revision)
        require(path.exists(), "Archive unavailable")
        size = path.stat().st_size
        require(
            size <= MAX_TOTAL + 1024 * 1024 and integer(offset, 0, size),
            "Invalid archive size or byte offset",
        )
        with path.open("rb") as stream:
            stream.seek(offset)
            raw = stream.read(1024 * 1024)
        end = offset + len(raw)
        return {
            "archive": revision,
            "sha256": revision,
            "bytes": size,
            "offset": offset,
            "data": base64.b64encode(raw).decode(),
            "next_offset": end if end < size else None,
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
