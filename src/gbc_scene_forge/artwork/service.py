"""Artwork use cases over guarded native project persistence."""

import copy
import json

from gbc_scene_forge.artwork import atlas, png
from gbc_scene_forge.artwork import metadata as tile_metadata
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.records import NativeDocument
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import identifier, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.storage.files import digest
from gbc_scene_forge.storage.paths import safe_path


class ArtworkService:
    """Application operations owned by the artwork domain."""

    def __init__(self, store: ProjectStore) -> None:
        self.store = store

    def set_metadata(
        self, atlas_id: str, group: str, asset: str, value: NativeDocument, revision: str
    ) -> NativeDocument:
        """Save tile metadata and native tileset fields as one guarded operation."""
        document = self.store.current(revision)
        require(
            isinstance(atlas_id, str) and atlas_id in document["atlases"],
            "Choose an imported atlas",
        )
        entry = document["atlases"][atlas_id]
        entry["tiles"].setdefault("sprites", atlas.sprite_mapping(entry))
        width, height = tile_metadata.dimensions(entry, group, asset)
        tile_metadata.check_metadata(value, width, height)
        entry.setdefault("metadata", {}).setdefault(group, {})[asset] = copy.deepcopy(value)
        filename = "sprites" if group == "sprites" else f"grid-{group}"
        path = f"assets/{atlas_id}/{filename}.tsj"
        changes = {}
        if path in document["files"]:
            source = json.loads(safe_path(self.store.root, path).read_bytes())
        else:
            require(group == "sprites", "Missing tileset dependency. Restore it before editing.")
            width, _, pixels = png.decode(safe_path(self.store.root, entry["png"]).read_bytes())
            changes = atlas.build_sprites(entry, width, pixels)
            source = json.loads(changes[path])
        changes[path] = json_text(tile_metadata.decorate(entry, group, source)).encode()
        self.store.commit(document, revision, changes, {}, "Edit tile metadata")
        return self.store.catalog()

    def asset(self, path: str, revision: str | None = None) -> bytes:
        """Read a declared PNG only when its manifest revision and digest match."""
        with self.store.read_session() as session:
            document, current = session.document, session.revision
            if revision is not None and revision != current:
                raise Conflict("Project assets changed. Reload the project before continuing.")
            require(path in document["files"] and path.endswith(".png"), "Unknown image")
            data = safe_path(self.store.root, path).read_bytes()
            if digest(data) != document["files"][path]:
                raise Conflict("Project asset changed on disk. Restore it or reimport the atlas.")
            return data

    def import_atlas(self, path: str, revision: str, *, reimport: bool = False) -> NativeDocument:
        """Validate an explicit atlas path before preparing its guarded import."""
        return self._import_bundle(atlas.load_bundle(path), revision, reimport=reimport)

    def delete_atlas(
        self, atlas_id: str, revision: str, *, scene_guard: NativeDocument | None = None
    ) -> NativeDocument:
        """Delete unreferenced artwork while guarding every affected scene."""
        document = self.store.current(revision)
        require(
            identifier(atlas_id) and atlas_id in document["atlases"],
            "Choose an imported atlas",
        )
        prefix = atlas_id + "/"
        scenes = [self.store.load_scene(item["id"], document) for item in document["scenes"]]
        if scene_guard is not None:
            require(
                isinstance(scene_guard, dict) and set(scene_guard) == {"id", "revision"},
                "Expected the open scene's ID and revision",
            )
            current = next((item for item in scenes if item["id"] == scene_guard["id"]), None)
            if current is None or current["revision"] != scene_guard["revision"]:
                raise Conflict(
                    "The open scene changed on disk. Reopen it before deleting an atlas."
                )
        used = [
            item["name"]
            for item in scenes
            if any(
                cell.startswith(prefix)
                for layer in tiled.scene_layers(item["scene"])
                for row in layer.get("cells", [])
                for cell in row
            )
            or any(
                obj.get("asset", "").startswith(prefix)
                for layer in tiled.scene_layers(item["scene"])
                for obj in layer.get("objects", [])
            )
        ]
        used += [
            "definition " + d["name"]
            for d in document.get("object_definitions", {}).get("definitions", [])
            if d.get("asset", "").startswith(prefix)
        ]
        used += [
            "stamp " + stamp["name"]
            for stamp in document.get("stamps", [])
            if any(
                cell.startswith(prefix)
                for layer in tiled.scene_layers(stamp["scene"])
                for row in layer.get("cells", [])
                for cell in row
            )
            or any(
                obj.get("asset", "").startswith(prefix)
                for layer in tiled.scene_layers(stamp["scene"])
                for obj in layer.get("objects", [])
            )
        ]
        require(
            not used,
            "Atlas is used by saved scenes: "
            + ", ".join(used)
            + ". Remove its placements and save those scenes before deleting it.",
        )
        changes = {
            path: None for path in document["files"] if path.startswith(f"assets/{atlas_id}/")
        }
        del document["atlases"][atlas_id]
        expected = {}
        # Maps list shared tilesets even when empty. Rewrite GID ranges using the
        # old semantic snapshots so remaining assets keep their identities.
        for item in scenes:
            path = f"scenes/{item['id']}.tmj"
            changes[path] = json_text(tiled.encode(item["scene"], document)).encode()
            expected[path] = item["revision"]
        self.store.commit(document, revision, changes, expected, "Delete atlas")
        return {
            "deleted": atlas_id,
            "scene_revisions": {
                item["id"]: digest(changes[f"scenes/{item['id']}.tmj"]) for item in scenes
            },
            **self.store.catalog(),
        }

    def import_bundle(
        self, bundle: NativeDocument, revision: str, *, reimport: bool = False
    ) -> NativeDocument:
        """Validate an uploaded atlas bundle before preparing its guarded import."""
        return self._import_bundle(atlas.load_uploaded_bundle(bundle), revision, reimport=reimport)

    def _import_bundle(self, bundle, revision, *, reimport=False):
        manifest, image, width, pixels = bundle
        document = self.store.current(revision)
        atlas_id = manifest["id"]
        previous = document["atlases"].get(atlas_id)
        require(
            previous is None or reimport is True,
            "Atlas ID already exists. Choose explicit reimport to replace it.",
        )
        require(previous is not None or not reimport, "Reimport requires an existing atlas ID")
        report = {"atlas": atlas_id, "added": [], "changed": [], "removed": []}
        if previous:
            old_regions = {r["name"]: r for r in previous["manifest"]["regions"]}
            new_regions = {r["name"]: r for r in manifest["regions"]}
            report["removed"] = sorted(set(old_regions) - set(new_regions))
            incompatible = [
                key
                for key in old_regions.keys() & new_regions.keys()
                if any(
                    old_regions[key][field] != new_regions[key][field]
                    for field in ("width", "height", "kind")
                )
            ]
            require(
                not report["removed"] and not incompatible,
                f"Incompatible reimport: removed {report['removed']}; resized/kind changed {incompatible}",
            )
            report["added"] = sorted(set(new_regions) - set(old_regions))
            report["changed"] = sorted(
                key for key in old_regions if old_regions[key] != new_regions[key]
            )
            report["artwork_changed"] = digest(image) != document["files"][previous["png"]]
            report["metadata_changed"] = previous["manifest"] != manifest
        else:
            report["added"] = [r["name"] for r in manifest["regions"]]
        # Decode maps with the old tileset ranges before adding local IDs/atlases.
        scenes = [self.store.load_scene(item["id"], document) for item in document["scenes"]]
        entry, changes = atlas.build_assets(manifest, image, width, pixels, previous)
        document["atlases"][atlas_id] = copy.deepcopy(entry)
        expected = {}
        for loaded in scenes:
            path = f"scenes/{loaded['id']}.tmj"
            changes[path] = json_text(tiled.encode(loaded["scene"], document)).encode()
            expected[path] = loaded["revision"]
        self.store.commit(
            document, revision, changes, expected, "Reimport atlas" if previous else "Import atlas"
        )
        return report
