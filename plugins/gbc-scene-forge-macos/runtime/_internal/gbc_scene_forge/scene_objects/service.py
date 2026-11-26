"""Scene objects use cases over guarded native project persistence."""

import copy
from uuid import uuid4

from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.records import NativeDocument
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.schema import check_stamp_slots
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.scene_objects import definitions as object_definitions
from gbc_scene_forge.scene_objects import preview as preview_settings
from gbc_scene_forge.storage.files import digest


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

    def delete_definition(
        self, definition_id: str, revision: str, *, dry_run: bool = False
    ) -> NativeDocument:
        """Remove a library definition without discarding retained instance overrides."""
        require(type(dry_run) is bool, "dry_run must be a boolean")
        with self.store.read_session(revision, verify_assets=True) as session:
            document = session.document
            scenes = {s["id"]: session.scene(s["id"]) for s in document["scenes"]}
        library = document.get("object_definitions", {"version": 1, "definitions": []})
        require(
            any(d["id"] == definition_id for d in library["definitions"]),
            "Unknown object definition",
        )

        def references(scene):
            return [
                {"layer_id": layer["id"], "object_id": item["id"]}
                for layer in tiled.scene_layers(scene)
                for item in layer.get("objects", [])
                if item.get("definition") == definition_id
            ]

        consequences = {
            "scene_references": [
                {"scene_id": key, "name": loaded["name"], "revision": loaded["revision"], **ref}
                for key, loaded in scenes.items()
                for ref in references(loaded["scene"])
            ],
            "stamp_references": [
                {"stamp_id": stamp["id"], "name": stamp["name"], **ref}
                for stamp in document.get("stamps", [])
                for ref in references(stamp["scene"])
            ],
            "behavior": "Instances and stamps retain definition IDs and explicit overrides. "
            "Inherited defaults cease to resolve; references report missing-definition.",
        }
        guards = self.store.scene_guards(document, {k: s["revision"] for k, s in scenes.items()})
        self.store.current(revision)
        if dry_run:
            return {
                "definition_id": definition_id,
                "revision": revision,
                "dry_run": True,
                "consequences": consequences,
            }
        library["definitions"] = [d for d in library["definitions"] if d["id"] != definition_id]
        document["object_definitions"] = library
        self.store.commit(document, revision, {}, guards, "Delete object definition")
        return {
            "deleted_definition_id": definition_id,
            "consequences": consequences,
            "project": document,
            "revision": digest(json_text(document).encode()),
        }

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

    def delete_stamp(
        self, stamp_id: str, revision: str, *, dry_run: bool = False
    ) -> NativeDocument:
        """Delete a reusable composition without changing existing placements."""
        require(type(dry_run) is bool, "dry_run must be a boolean")
        document = self.store.current(revision)
        stamps = document.get("stamps", [])
        require(any(s["id"] == stamp_id for s in stamps), "Unknown stamp")
        consequences = {
            "behavior": "Existing placements remain intact; only the saved stamp is removed."
        }
        if dry_run:
            return {
                "stamp_id": stamp_id,
                "revision": revision,
                "dry_run": True,
                "consequences": consequences,
            }
        document["stamps"] = [s for s in stamps if s["id"] != stamp_id]
        self.store.commit(document, revision, {}, {}, "Delete reusable stamp")
        return {
            "deleted_stamp_id": stamp_id,
            "consequences": consequences,
            "project": document,
            "revision": digest(json_text(document).encode()),
        }

    def save_preview(self, value: NativeDocument, revision: str) -> NativeDocument:
        """Persist validated project preview preferences independently of scene edits."""
        document = self.store.current(revision)
        document["preview"]["sprite"] = preview_settings.validate(value, document)
        self.store.commit(document, revision, {}, {}, "Save sprite preview settings")
        return self.store.catalog()
