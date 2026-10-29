"""Validated project persistence and lock-scoped saved-read contracts."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from gbc_scene_forge.artwork import atlas, png
from gbc_scene_forge.core.errors import Conflict, InvalidRequest
from gbc_scene_forge.core.records import NativeDocument, ProjectCatalog, SceneRecord
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.scene_objects import preview as preview_settings
from gbc_scene_forge.storage.files import digest, read_optional
from gbc_scene_forge.storage.paths import safe_path
from gbc_scene_forge.storage.transactions import Transactions

from .schema import MANIFEST, validate


@dataclass
class ReadSession:
    """Manifest and map reads sharing the owning store's already-held lock."""

    store: "ProjectStore"
    document: NativeDocument
    revision: str

    _active: bool = field(default=True, init=False, repr=False)

    def catalog(self) -> ProjectCatalog:
        """Expose the saved inventory, including non-mutating legacy sprite mappings."""
        if not self._active:
            raise RuntimeError("The saved-read session has ended")
        for entry in self.document["atlases"].values():
            entry["tiles"].setdefault("sprites", atlas.sprite_mapping(entry))
        return {"project": self.document, "revision": self.revision}

    def scene(self, scene_id: str) -> SceneRecord:
        """Read within the session lifetime; a retained session cannot bypass locking."""
        if not self._active:
            raise RuntimeError("The saved-read session has ended")
        return self.store._load_scene(scene_id, self.document)


class ProjectStore:
    """Native project persistence; commit guards are authoritative at the journal."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).absolute()
        self.transactions = Transactions(self.root, ".forge/history")

    def read(self) -> tuple[NativeDocument, str]:
        data = safe_path(self.root, MANIFEST).read_bytes()
        require(len(data) <= 8 * 1024 * 1024, "Project manifest exceeds 8 MiB")
        return cast(NativeDocument, validate(json.loads(data), self.root)), digest(data)

    @contextmanager
    def read_session(
        self, expected_revision: str | None = None, *, verify_assets: bool = False
    ) -> Iterator[ReadSession]:
        """Hold one lock across manifest and scene reads; never nest locking calls."""
        with self.transactions.locked():
            document, revision = self.read()
            if expected_revision is not None and expected_revision != revision:
                raise Conflict("Project changed on disk. Reopen it before saving or importing.")
            if verify_assets:
                self.current(revision)
            session = ReadSession(self, document, revision)
            try:
                yield session
            finally:
                session._active = False

    def load_scene(self, scene_id: str, document: NativeDocument | None = None) -> SceneRecord:
        """Read a native map under the lock, optionally for a guarded candidate."""
        with self.read_session() as session:
            return (
                self._load_scene(scene_id, document)
                if document is not None
                else session.scene(scene_id)
            )

    def current(self, revision: str) -> NativeDocument:
        """Check provisional mutation inputs; commit still guards every file.

        This method does not acquire a lock. Use a read session for coherent
        multi-file reads, and commit prepared mutations through the journal.
        """
        document, current = self.read()
        if revision != current:
            raise Conflict("Project changed on disk. Reopen it before saving or importing.")
        for path, expected in document["files"].items():
            if digest(read_optional(safe_path(self.root, path))) != expected:
                raise Conflict(
                    f"Project asset changed on disk: {path}. Restore it before continuing."
                )
        return document

    def commit(
        self,
        document: NativeDocument,
        revision: str,
        changes: dict[str, bytes | None],
        expected: dict[str, str | None],
        label: str,
    ) -> None:
        expected = {**document["files"], **expected, MANIFEST: revision}
        self.prepare_commit(document, changes)
        for path in changes:
            if path.startswith("assets/"):
                expected.setdefault(path, None)
        try:
            self.transactions.apply(changes, expected, label)
        except ValueError as error:
            raise Conflict(str(error)) from error

    def prepare_commit(self, document: NativeDocument, changes: dict[str, bytes | None]) -> None:
        """Materialize candidate bytes and enforce persistence limits without writing.

        Both preflight and commit use this preparation; transaction guards are
        still authoritative when the prepared candidate is actually committed.
        Mutates only the supplied document/change set and reads declared assets.
        """
        preview_settings.prune(document)
        # Materialize sprite tilesets for previously imported projects on an explicit
        # mutation, guarded and committed together with that operation's other files.
        for atlas_id, entry in document["atlases"].items():
            if (
                atlas.sprite_mapping(entry)
                and f"assets/{atlas_id}/sprites.tsj" not in document["files"]
            ):
                path = entry["png"]
                image = changes.get(path)
                if image is None:
                    image = safe_path(self.root, path).read_bytes()
                width, _, pixels = png.decode(image)
                for path, data in atlas.build_sprites(entry, width, pixels).items():
                    changes.setdefault(path, data)
        for path, data in changes.items():
            if path.startswith("scenes/") and data is not None:
                require(
                    len(data) <= 4 * 1024 * 1024,
                    "Scene exceeds 4 MiB. Reduce layers, objects or property text.",
                )
            if path.startswith("assets/"):
                if data is None:
                    document["files"].pop(path, None)
                else:
                    document["files"][path] = digest(data)
        manifest_bytes = json_text(document).encode()
        changes[MANIFEST] = manifest_bytes
        require(len(manifest_bytes) <= 8 * 1024 * 1024, "Project manifest exceeds 8 MiB")

    def catalog(self) -> ProjectCatalog:
        """Read the UI/native inventory and its exact saved manifest revision."""
        with self.read_session() as session:
            return session.catalog()

    def scene_guards(self, document: NativeDocument, revisions: dict[str, str]) -> dict[str, str]:
        require(
            isinstance(revisions, dict) and set(revisions) == {s["id"] for s in document["scenes"]},
            "World edits require revisions for every saved scene; reopen the world view",
        )
        guards = {}
        for entry in document["scenes"]:
            expected = revisions[entry["id"]]
            if digest(read_optional(safe_path(self.root, entry["path"]))) != expected:
                raise Conflict("Scene changed on disk. Reopen the world view before saving.")
            guards[entry["path"]] = expected
        return guards

    def _load_scene(self, scene_id: str, document: NativeDocument | None = None) -> SceneRecord:
        if document is None:
            document, _ = self.read()
        entry = next((s for s in document["scenes"] if s["id"] == scene_id), None)
        if entry is None:
            raise InvalidRequest("Choose a project scene")
        data = safe_path(self.root, entry["path"]).read_bytes()
        require(len(data) <= 4 * 1024 * 1024, "Scene exceeds 4 MiB")
        return {
            "id": scene_id,
            "name": entry["name"],
            "revision": digest(data),
            "scene": tiled.decode(json.loads(data), document),
        }
