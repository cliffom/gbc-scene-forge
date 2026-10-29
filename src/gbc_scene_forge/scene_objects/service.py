"""Scene objects use cases over guarded native project persistence."""

import copy
from uuid import uuid4

from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.records import NativeDocument
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.schema import check_stamp_slots
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.scene_objects import definitions as object_definitions
from gbc_scene_forge.scene_objects import preview as preview_settings


class ObjectService:
    """Application operations owned by the scene_objects domain."""

    def __init__(self, store: ProjectStore) -> None:
        self.store = store

    def save_definition(self, definition: NativeDocument, revision: str) -> NativeDocument:
        """Validate and store a shared object definition against the manifest revision."""
        document = self.store.current(revision)
        library = document.setdefault("object_definitions", {"version": 1, "definitions": []})
        require(isinstance(definition, dict), "Expected an object definition")
        candidate = copy.deepcopy(definition)
        if candidate.get("id") is None:
            candidate["id"] = str(uuid4())
        else:
            require(
                any(d["id"] == candidate["id"] for d in library["definitions"]),
                "Unknown definition; create a new one without an ID",
            )
        library["definitions"] = [d for d in library["definitions"] if d["id"] != candidate["id"]]
        library["definitions"].append(candidate)
        object_definitions.check_library(library, tiled.sprite_regions(document))
        self.store.commit(document, revision, {}, {}, "Save object definition")
        return {"definition_id": candidate["id"], **self.store.catalog()}

    def delete_definition(self, definition_id: str, revision: str) -> NativeDocument:
        """Remove a library definition without discarding retained instance overrides."""
        document = self.store.current(revision)
        library = document.get("object_definitions", {"version": 1, "definitions": []})
        require(
            any(d["id"] == definition_id for d in library["definitions"]),
            "Unknown object definition",
        )
        library["definitions"] = [d for d in library["definitions"] if d["id"] != definition_id]
        document["object_definitions"] = library
        self.store.commit(document, revision, {}, {}, "Delete object definition")
        return self.store.catalog()

    def save_stamp(
        self, title: str, scene: NativeDocument, slots: list[int], revision: str
    ) -> NativeDocument:
        """Store a validated reusable composition and its layer occurrence slots."""
        document = self.store.current(revision)
        title = name(title)
        tiled.check_scene(scene, document)
        check_stamp_slots(slots, scene)
        stamps = document.setdefault("stamps", [])
        require(len(stamps) < 128, "Use at most 128 stamps")
        stored = copy.deepcopy(scene)
        stored["layers"] = copy.deepcopy(tiled.scene_layers(scene))
        stored.pop("cells", None)
        stored.pop("objects", None)
        stored.setdefault("next_layer_id", max(layer["id"] for layer in stored["layers"]) + 1)
        stamps.append({"id": str(uuid4()), "name": title, "scene": stored, "slots": list(slots)})
        self.store.commit(document, revision, {}, {}, "Save reusable stamp")
        return self.store.catalog()

    def delete_stamp(self, stamp_id: str, revision: str) -> NativeDocument:
        """Delete a reusable composition without changing existing placements."""
        document = self.store.current(revision)
        stamps = document.get("stamps", [])
        require(any(s["id"] == stamp_id for s in stamps), "Unknown stamp")
        document["stamps"] = [s for s in stamps if s["id"] != stamp_id]
        self.store.commit(document, revision, {}, {}, "Delete reusable stamp")
        return self.store.catalog()

    def save_preview(self, value: NativeDocument, revision: str) -> NativeDocument:
        """Persist validated project preview preferences independently of scene edits."""
        document = self.store.current(revision)
        document["preview"]["sprite"] = preview_settings.validate(value, document)
        self.store.commit(document, revision, {}, {}, "Save sprite preview settings")
        return self.store.catalog()
