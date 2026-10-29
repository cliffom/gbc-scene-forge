"""Atomic external map intake coordinating artwork, scenes and guarded persistence."""

from uuid import uuid4

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import intake, tiled
from gbc_scene_forge.storage.files import digest


class IntakeService:
    def __init__(self, store):
        self.store = store

    def tiled(self, payload, revision, *, dry_run=True, confirmation=None):
        require(type(dry_run) is bool, "dry_run must be boolean")
        document = self.store.current(revision)
        fingerprint = digest(json_text({"payload": payload, "revision": revision}).encode())
        try:
            title, scene, entries, changes, dependencies = intake.prepare(payload, document)
        except (ValueError, KeyError, TypeError) as error:
            if not dry_run:
                raise ValueError(str(error)) from error
            return {
                "compatible": False,
                "errors": [str(error)],
                "dependencies": [],
                "dry_run": True,
            }
        report = {
            "compatible": True,
            "errors": [],
            "dependencies": dependencies,
            "assets": list(entries),
            "layers": len(scene["layers"]),
            "tiles": sum(len(e["manifest"]["regions"]) for e in entries.values()),
            "width": scene["width"],
            "height": scene["height"],
            "grid": scene["grid"],
            "confirmation": fingerprint,
            "dry_run": dry_run,
            "notes": [
                "New project-owned artwork and scene; source files stay unchanged.",
                "GBC palette requirements are unverified for generic PNG artwork.",
            ],
        }
        if dry_run:
            return report
        if confirmation != fingerprint:
            raise Conflict("Import inputs changed. Run preflight again before importing.")
        # Existing maps reference numeric ranges: decode before adding the new artwork.
        scenes = [self.store.load_scene(item["id"], document) for item in document["scenes"]]
        document["atlases"].update(entries)
        expected = {}
        for loaded in scenes:
            path = f"scenes/{loaded['id']}.tmj"
            changes[path] = json_text(tiled.encode(loaded["scene"], document)).encode()
            expected[path] = loaded["revision"]
        scene_id = str(uuid4())
        path = f"scenes/{scene_id}.tmj"
        changes[path] = json_text(tiled.encode(scene, document)).encode()
        expected[path] = None
        document["scenes"].append({"id": scene_id, "name": title, "path": path})
        self.store.commit(document, revision, changes, expected, "Import Tiled map")
        return {**report, "imported": scene_id}
