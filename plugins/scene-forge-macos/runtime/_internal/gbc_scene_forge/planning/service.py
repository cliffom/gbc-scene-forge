"""Planning use cases over guarded native project persistence."""

import copy
from uuid import uuid4

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.records import NativeDocument
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning import blockout, world
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.storage.files import digest


class PlanningService:
    """Application operations owned by the planning domain."""

    def __init__(self, store: ProjectStore) -> None:
        self.store = store

    def save_world(
        self, value: NativeDocument, revision: str, scene_revisions: dict[str, str]
    ) -> NativeDocument:
        """Commit world metadata only if every saved scene guard still matches."""
        document = self.store.current(revision)
        world.check(value)
        require(
            set(value["positions"]) <= {s["id"] for s in document["scenes"]},
            "World positions must refer to existing scenes",
        )
        guards = self.store.scene_guards(document, scene_revisions)
        document["world"] = copy.deepcopy(value)
        self.store.commit(document, revision, {}, guards, "Save world layout and connections")
        return self.store.catalog()

    def create_blockout(
        self, title: str, settings: NativeDocument, revision: str
    ) -> NativeDocument:
        """Create a native planning scene with typed blockout definitions."""
        document = self.store.current(revision)
        title = name(title)
        scene = blockout.new_scene(document, settings)
        scene_id = str(uuid4())
        path = f"scenes/{scene_id}.tmj"
        document["scenes"].append({"id": scene_id, "name": title, "path": path})
        encoded = json_text(tiled.encode(scene, document)).encode()
        self.store.commit(
            document, revision, {path: encoded}, {path: None}, "Create blockout scene"
        )
        return {"id": scene_id, "name": title, "revision": digest(encoded), "scene": scene}

    def review_blockout(
        self,
        scene_id: str,
        revision: str,
        scene_revision: str,
        scene: NativeDocument | None = None,
        camera_id: str | None = None,
    ) -> NativeDocument:
        """Render a candidate or saved blockout with guarded camera/revision intent."""
        with self.store.read_session() as session:
            document = self.store.current(revision)
            current = session.scene(scene_id)
            if current["revision"] != scene_revision:
                raise Conflict("Scene changed on disk. Reopen before reviewing the blockout.")
            candidate = current["scene"] if scene is None else scene
            result = blockout.review(candidate, document, camera_id)
            self.store.current(revision)
            if session.scene(scene_id)["revision"] != scene_revision:
                raise Conflict("Scene changed while reviewing the blockout.")
            return {
                **result,
                "scene_id": scene_id,
                "project_revision": revision,
                "scene_revision": scene_revision,
            }
