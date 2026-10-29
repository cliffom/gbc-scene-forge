"""Small saved-revision probes and coherent snapshots for a local browser."""

from collections import OrderedDict

from . import atlas
from .atlas import require
from .projects import MANIFEST, identity
from .transactions import digest, safe_path


class Updates:
    def __init__(self, project):
        self.project = project
        self.cache = OrderedDict()
        self.manifest_revision = None
        self.scenes = frozenset()

    def _revision(self, relative, limit):
        path = safe_path(self.project.root, relative)
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

    def revisions(self, scene_id=None):
        require(scene_id is None or identity(scene_id), "Invalid scene identity")
        # Cooperating writers cannot expose a partial multi-file transaction.
        # Unchanged probes only stat two files; no asset scans or scene decoding.
        with self.project.transactions.locked():
            revision = self._revision(MANIFEST, 8 * 1024 * 1024)
            if revision != self.manifest_revision:
                document = self.project.read()[0] if revision else {"scenes": []}
                self.scenes = frozenset(s["id"] for s in document["scenes"])
                self.manifest_revision = revision
            return {
                "revision": revision,
                "scene_revision": self._revision(f"scenes/{scene_id}.tmj", 4 * 1024 * 1024)
                if scene_id in self.scenes
                else None,
            }

    def snapshot(self, scene_id=None):
        require(scene_id is None or identity(scene_id), "Invalid scene identity")
        with self.project.transactions.locked():
            document, revision = self.project.read()
            for entry in document["atlases"].values():
                entry["tiles"].setdefault("sprites", atlas.sprite_mapping(entry))
            scene = (
                self.project._load_scene(scene_id, document)
                if any(s["id"] == scene_id for s in document["scenes"])
                else None
            )
            return {"project": document, "revision": revision, "scene": scene}
