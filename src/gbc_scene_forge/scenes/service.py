"""Scenes use cases over guarded native project persistence."""

import json
from uuid import uuid4

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.records import NativeDocument
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning import blockout, world
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.scenes import authoring, rendering
from gbc_scene_forge.scenes.dimensions import check_dimensions
from gbc_scene_forge.storage.files import digest, read_optional
from gbc_scene_forge.storage.paths import safe_path


class SceneService:
    """Application operations owned by the scenes domain."""

    def __init__(self, store: ProjectStore) -> None:
        self.store = store

    def create(
        self, title: str, width: int, height: int, grid: int, revision: str
    ) -> NativeDocument:
        """Create a saved blank scene against the expected project revision."""
        document = self.store.current(revision)
        title = name(title)
        check_dimensions(width, height, grid)
        scene = {
            "width": width,
            "height": height,
            "grid": grid,
            "cells": [[tiled.EMPTY] * width for _ in range(height)],
        }
        encoded = json_text(tiled.encode(scene, document)).encode()
        scene_id = str(uuid4())
        path = f"scenes/{scene_id}.tmj"
        document["scenes"].append({"id": scene_id, "name": title, "path": path})
        self.store.commit(document, revision, {path: encoded}, {path: None}, "Create scene")
        return {
            "id": scene_id,
            "name": title,
            "revision": digest(encoded),
            "scene": tiled.decode(json.loads(encoded), document),
        }

    def save(
        self,
        scene_id: str,
        scene: NativeDocument,
        revision: str,
        project_revision: str,
        *,
        confirm_broken_links: bool = False,
    ) -> NativeDocument:
        """Commit canonical scene bytes with manifest, map and link-removal guards."""
        document = self.store.current(project_revision)
        current = self.store.load_scene(scene_id, document)
        if current["revision"] != revision:
            raise Conflict("Scene changed on disk. Reopen it before saving.")
        tiled.check_scene(scene, document)
        broken = world.removed_links(
            document.get("world", world.empty()), scene_id, current["scene"], scene
        )
        require(
            not broken or confirm_broken_links is True,
            "Saving removes linked objects. Confirm broken connections before saving.",
        )
        path = f"scenes/{scene_id}.tmj"
        encoded = json_text(tiled.encode(scene, document)).encode()
        self.store.commit(
            document, project_revision, {path: encoded}, {path: revision}, "Save scene"
        )
        # A later external edit must not become the revision acknowledged by this
        # save: the browser keeps its submitted canvas and undo history.
        return {
            "id": scene_id,
            "name": current["name"],
            "revision": digest(encoded),
            "project_revision": digest(json_text(document).encode()),
            "scene": tiled.decode(json.loads(encoded), document),
        }

    def rename(
        self, scene_id: str, title: str, revision: str, project_revision: str
    ) -> NativeDocument:
        """Rename a scene without replacing its identity or saved contents."""
        document = self.store.current(project_revision)
        current = self.store.load_scene(scene_id, document)
        if current["revision"] != revision:
            raise Conflict("Scene changed on disk. Reopen it before renaming.")
        entry = next(item for item in document["scenes"] if item["id"] == scene_id)
        entry["name"] = name(title)
        self.store.commit(document, project_revision, {}, {entry["path"]: revision}, "Rename scene")
        return self.store.catalog()

    def duplicate(
        self,
        scene_id: str,
        title: str,
        revision: str,
        project_revision: str,
        scene: NativeDocument | None = None,
    ) -> NativeDocument:
        """Copy a guarded saved scene or validated candidate to a new identity."""
        document = self.store.current(project_revision)
        current = self.store.load_scene(scene_id, document)
        if current["revision"] != revision:
            raise Conflict("Scene changed on disk. Reopen it before duplicating.")
        title = name(title)
        candidate = current["scene"] if scene is None else scene
        encoded = json_text(tiled.encode(candidate, document)).encode()
        new_id = str(uuid4())
        path = f"scenes/{new_id}.tmj"
        source = next(item["path"] for item in document["scenes"] if item["id"] == scene_id)
        document["scenes"].append({"id": new_id, "name": title, "path": path})
        self.store.commit(
            document,
            project_revision,
            {path: encoded},
            {path: None, source: revision},
            "Duplicate scene",
        )
        return {"duplicated": new_id, **self.store.catalog()}

    def delete(
        self,
        scene_id: str,
        revision: str,
        project_revision: str,
        *,
        confirm_broken_links: bool = False,
    ) -> NativeDocument:
        """Remove a scene atomically, retaining broken world links only when confirmed."""
        document = self.store.current(project_revision)
        entry = next((item for item in document["scenes"] if item["id"] == scene_id), None)
        require(entry is not None, "Choose a project scene")
        path = entry["path"]
        current = digest(read_optional(safe_path(self.store.root, path)))
        if not isinstance(revision, str) or current != revision:
            raise Conflict("Scene changed on disk. Reopen the delete dialog before trying again.")
        require(
            not world.references(document.get("world", world.empty()), scene_id)
            or confirm_broken_links is True,
            "Deleting this scene breaks connections. Confirm before deleting.",
        )
        if "world" in document:
            document["world"]["positions"].pop(scene_id, None)
        document["scenes"] = [item for item in document["scenes"] if item["id"] != scene_id]
        self.store.commit(
            document, project_revision, {path: None}, {path: revision}, "Delete scene"
        )
        return {"deleted": scene_id, **self.store.catalog()}

    def load(self, scene_id: str) -> NativeDocument:
        """Load the saved scene with its coherent project revision."""
        with self.store.read_session() as session:
            return session.scene(scene_id)

    def edit(
        self,
        scene_id: str,
        project_revision: str,
        scene_revision: str,
        *,
        operations: list[NativeDocument] | None = None,
        scene: NativeDocument | None = None,
        dry_run: bool = False,
    ) -> NativeDocument:
        """Prepare a canonical candidate and optionally save it through native guards."""
        # Required mutation guards must be checked even for a dry run; None is
        # reserved for unguarded read sessions, not a wildcard expected revision.
        self.store.current(project_revision)
        with self.store.read_session(project_revision) as session:
            document = session.document
            loaded = session.scene(scene_id)
        if loaded["revision"] != scene_revision:
            raise Conflict("Scene changed on disk. Inspect again before editing.")
        candidate, allocated = (
            authoring.edit(loaded["scene"], document, operations)
            if operations is not None
            else (scene, [])
        )
        tiled.check_scene(candidate, document)
        candidate = tiled.decode(tiled.encode(candidate, document), document)
        with self.store.read_session(project_revision, verify_assets=True) as session:
            if session.scene(scene_id)["revision"] != loaded["revision"]:
                raise Conflict("Scene changed while preparing edits. Inspect again.")
        summary = authoring.changes(loaded["scene"], candidate)
        require(type(dry_run) is bool, "dry_run must be boolean")
        result = (
            {**loaded, "scene": candidate}
            if dry_run
            else self.save(scene_id, candidate, scene_revision, project_revision)
        )
        return {
            **result,
            "project_revision": result.get("project_revision", project_revision),
            "dry_run": dry_run,
            "allocated_object_ids": allocated,
            "changes": summary,
        }

    def review_artwork(self, scene_id, revision, scene_revision, *, camera_id=None, overview=None):
        """Render only exact saved artwork, under one verified read session."""
        self.store.current(revision)
        with self.store.read_session(revision, verify_assets=True) as session:
            loaded = session.scene(scene_id)
            if loaded["revision"] != scene_revision:
                raise Conflict("Scene changed on disk. Reopen before reviewing artwork.")
            scene, document = loaded["scene"], session.document
            camera = blockout.select_camera(scene, document, camera_id)
            camera_view = rendering.viewport({k: camera[k] for k in ("x", "y", "width", "height")})
            width, height = scene["width"] * scene["grid"], scene["height"] * scene["grid"]
            overview = rendering.viewport(
                overview
                if overview is not None
                else dict(
                    x=0,
                    y=0,
                    width=min(width, rendering.MAX_DIMENSION),
                    height=min(height, rendering.MAX_DIMENSION),
                )
            )
            require(
                overview["x"] < width and overview["y"] < height,
                "Overview origin must be inside the scene",
            )

            def read_image(path):
                data = safe_path(self.store.root, path).read_bytes()
                if digest(data) != document["files"][path]:
                    raise Conflict("Project artwork changed while reviewing.")
                return data

            result = dict(
                scene_id=scene_id,
                project_revision=revision,
                scene_revision=scene_revision,
                snapshot_revision=authoring.snapshot(scene),
                includes_artwork=True,
                includes_planning_overlays=False,
                units="pixels",
                scale=1,
                width=width,
                height=height,
                camera=camera,
                overview=overview,
                overview_complete=(
                    overview["x"] == overview["y"] == 0
                    and overview["width"] >= width
                    and overview["height"] >= height
                ),
                camera_png=rendering.render(scene, document, read_image, camera_view),
                overview_png=rendering.render(scene, document, read_image, overview),
            )
            self.store.current(revision)
            if session.scene(scene_id)["revision"] != scene_revision:
                raise Conflict("Scene changed while reviewing artwork.")
            return result
