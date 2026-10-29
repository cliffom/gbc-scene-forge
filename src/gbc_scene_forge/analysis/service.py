"""Analysis use cases over guarded native project persistence."""

import copy

from gbc_scene_forge.analysis import diagnostics, palette_budget
from gbc_scene_forge.analysis import objects as object_report
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.records import NativeDocument
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning import world
from gbc_scene_forge.project.store import ProjectStore


class ReportService:
    """Application operations owned by the analysis domain."""

    def __init__(self, store: ProjectStore) -> None:
        self.store = store

    def diagnostics(
        self,
        revision: str,
        options: NativeDocument | None = None,
        scene_id: str | None = None,
        scene_revision: str | None = None,
        scene: NativeDocument | None = None,
    ) -> NativeDocument:
        """Report project diagnostics with coherent saved inputs and optional candidate."""
        return self._project_report(
            revision,
            scene_id,
            scene_revision,
            scene,
            lambda document, scenes: diagnostics.report(
                document, scenes, diagnostics.options(options, document)
            ),
        )

    def world(
        self,
        revision: str,
        scene_id: str | None = None,
        scene_revision: str | None = None,
        scene: NativeDocument | None = None,
    ) -> NativeDocument:
        """Report world layout and endpoint validity over guarded native scenes."""
        return self._project_report(revision, scene_id, scene_revision, scene, world.report)

    def _project_report(self, revision, scene_id, scene_revision, scene, report):
        with self.store.read_session() as session:
            document = self.store.current(revision)
            scenes = {s["id"]: session.scene(s["id"]) for s in document["scenes"]}
            guards = {s["id"]: s["revision"] for s in scenes.values()}
            if scene is not None:
                require(scene_id in scenes, "Choose a project scene")
                if guards[scene_id] != scene_revision:
                    raise Conflict("Scene changed on disk. Reopen it before inspecting the world.")
                tiled.check_scene(scene, document)
                scenes[scene_id] = {**scenes[scene_id], "scene": scene}
            result = report(document, scenes)
            self.store.current(revision)
            self.store.scene_guards(document, guards)
            return {**result, "project_revision": revision, "scene_revisions": guards}

    def objects(
        self, scene_id: str, revision: str, scene_revision: str, scene: NativeDocument | None = None
    ) -> NativeDocument:
        """Validate effective object definitions for a saved scene or candidate."""
        with self.store.read_session() as session:
            document = self.store.current(revision)
            current = session.scene(scene_id)
            if current["revision"] != scene_revision:
                raise Conflict("Scene changed on disk. Reopen it before validating.")
            candidate = current["scene"] if scene is None else scene
            tiled.check_scene(candidate, document)
            result = object_report.report(candidate, document, scene_id)
            self.store.current(revision)
            if session.scene(scene_id)["revision"] != scene_revision:
                raise Conflict("Scene changed while validating. Reopen it before validating.")
            return {**result, "project_revision": revision, "scene_revision": scene_revision}

    def palettes(
        self, scene_id: str, revision: str, scene_revision: str, scene: NativeDocument | None = None
    ) -> NativeDocument:
        """Check a frozen saved scene or unsaved canvas; never mutate authoring files."""
        with self.store.read_session() as session:
            document = self.store.current(revision)
            current = session.scene(scene_id)
            if current["revision"] != scene_revision:
                raise Conflict("Scene changed on disk. Reopen it before validating.")
            candidate = current["scene"] if scene is None else scene
            tiled.check_scene(candidate, document)
            result = palette_budget.report(
                candidate, document, document.get("gbc_palette_profile"), scene_id
            )
            # Detect noncooperating edits while analysis ran, just as export does.
            self.store.current(revision)
            if session.scene(scene_id)["revision"] != scene_revision:
                raise Conflict("Scene changed while validating. Reopen it before validating.")
            return {**result, "project_revision": revision, "scene_revision": scene_revision}

    def save_profile(self, value: NativeDocument | None, revision: str) -> NativeDocument:
        """Store or disable the optional GBC palette profile."""
        palette_budget.check_profile(value)
        document = self.store.current(revision)
        if value is None:
            document.pop("gbc_palette_profile", None)
        else:
            document["gbc_palette_profile"] = copy.deepcopy(value)
        self.store.commit(document, revision, {}, {}, "Save GBC palette profile")
        return self.store.catalog()
