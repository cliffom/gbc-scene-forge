"""Small saved-revision probes and coherent snapshots for a local browser."""

from collections import OrderedDict

from gbc_scene_forge.core.identities import identity
from gbc_scene_forge.core.records import ProjectSnapshot, RevisionProbe
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.storage.files import digest
from gbc_scene_forge.storage.paths import safe_path


class Updates:
    def __init__(self, store: ProjectStore) -> None:
        self.store = store
        self.cache: OrderedDict[str, tuple[tuple[int, int, int, int, int], str]] = OrderedDict()
        self.manifest_revision: str | None = None
        self.scenes: frozenset[str] = frozenset()

    def _revision(self, relative: str, limit: int) -> str | None:
        path = safe_path(self.store.root, relative)
        try:
            stat = path.stat()
        except FileNotFoundError:
            self.cache.pop(relative, None)
            return None
        require(stat.st_size <= limit, "Project file exceeds the refresh size limit")
        signature = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        previous = self.cache.get(relative)
        if previous is not None and previous[0] == signature:
            self.cache.move_to_end(relative)
            return previous[1]
        with path.open("rb") as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, "Project file exceeds the refresh size limit")
        revision = digest(data)
        self.cache[relative] = (signature, revision)
        self.cache.move_to_end(relative)
        while len(self.cache) > 32:
            self.cache.popitem(last=False)
        return revision

    def revisions(self, scene_id: str | None = None) -> RevisionProbe:
        require(scene_id is None or identity(scene_id), "Invalid scene identity")
        # Cooperating writers cannot expose a partial multi-file transaction.
        # Unchanged probes only stat two files; no asset scans or scene decoding.
        with self.store.transactions.locked():
            revision = self._revision(MANIFEST, 8 * 1024 * 1024)
            if revision != self.manifest_revision:
                document = self.store.read()[0] if revision else {"scenes": []}
                self.scenes = frozenset(s["id"] for s in document["scenes"])
                self.manifest_revision = revision
            return {
                "revision": revision,
                "scene_revision": self._revision(f"scenes/{scene_id}.tmj", 4 * 1024 * 1024)
                if scene_id is not None and scene_id in self.scenes
                else None,
            }

    def snapshot(self, scene_id: str | None = None) -> ProjectSnapshot:
        require(scene_id is None or identity(scene_id), "Invalid scene identity")
        with self.store.read_session() as session:
            document = session.document
            scene = (
                session.scene(scene_id)
                if scene_id is not None and any(s["id"] == scene_id for s in document["scenes"])
                else None
            )
            return {**session.catalog(), "scene": scene}
