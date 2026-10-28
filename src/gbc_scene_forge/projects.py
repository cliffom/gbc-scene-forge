"""Portable standalone project lifecycle and conflict-aware multi-file operations."""

import copy
import json
from pathlib import Path
from uuid import UUID, uuid4

from . import atlas, exporting, palette_budget, png, preview_settings, tile_metadata, tiled
from .documents import Conflict, json_text
from .transactions import Transactions, digest, read_optional, safe_path

MANIFEST = "forge.project.json"
SCHEMA_VERSION = 1


def name(value):
    atlas.require(
        isinstance(value, str) and 1 <= len(value.strip()) <= 100,
        "Name must contain 1..100 characters",
    )
    return value.strip()


def identity(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


class Project:
    def __init__(self, root, *, recover=True):
        self.root = Path(root).absolute()
        safe_path(self.root, MANIFEST)
        atlas.require(self.root.is_dir(), "Project directory does not exist")
        self.transactions = Transactions(self.root, ".forge/history")
        if recover:
            self.recover(self.root)
        self.read()

    @classmethod
    def recover(cls, root):
        """Recover pending writes, including creation that may remove the manifest."""
        root = Path(root).absolute()
        # Refuse unknown schemas before recovery can write any files.
        manifest = safe_path(root, MANIFEST)
        if manifest.exists():
            with manifest.open("rb") as stream:
                data = stream.read(8 * 1024 * 1024 + 1)
            atlas.require(len(data) <= 8 * 1024 * 1024, "Project manifest exceeds 8 MiB")
            cls.check_version(json.loads(data))
        Transactions(root, ".forge/history").recover()

    @staticmethod
    def check_version(document):
        atlas.require(
            isinstance(document, dict)
            and type(document.get("version")) is int
            and document["version"] == SCHEMA_VERSION,
            "Unsupported project version; this release supports manifest version 1",
        )

    @classmethod
    def prepare_creation(cls, root):
        """Accept empty folders or recover a journal from interrupted first creation."""
        root = Path(root).absolute()
        if not root.exists():
            return
        safe_path(root, MANIFEST)
        if root.is_dir() and not any(root.iterdir()):
            return
        if root.is_dir() and {item.name for item in root.iterdir()} == {".forge"}:
            store = Transactions(root, ".forge/history")
            records = store.records()
            if records and all(
                record.get("label") == "Create project"
                and set(record.get("files", {})) == {MANIFEST}
                and record.get("status") in ("applying", "restoring", "recovered")
                for record in records
            ):
                store.recover()
                return
        raise ValueError("Create a project in a new or empty directory")

    @classmethod
    def create(cls, root, title):
        root = Path(root).absolute()
        title = name(title)
        # Creation only claims empty folders or its own recoverable creation journal.
        cls.prepare_creation(root)
        atlas.require(not (root / MANIFEST).exists(), "A project already exists in this directory")
        root.mkdir(parents=True, exist_ok=True)
        safe_path(root, MANIFEST)
        document = {
            "version": SCHEMA_VERSION,
            "id": str(uuid4()),
            "name": title,
            "scenes": [],
            "atlases": {},
            "files": {},
            "preview": {"zoom": 3, "grid": True},
        }
        Transactions(root, ".forge/history").apply(
            {MANIFEST: json_text(document).encode()}, {MANIFEST: None}, "Create project"
        )
        return cls(root)

    def read(self):
        data = safe_path(self.root, MANIFEST).read_bytes()
        atlas.require(len(data) <= 8 * 1024 * 1024, "Project manifest exceeds 8 MiB")
        document = json.loads(data)
        self.check_version(document)
        atlas.require(
            isinstance(document, dict)
            and {"version", "id", "name", "scenes", "atlases", "files", "preview"} <= set(document)
            and not set(document)
            - {
                "version",
                "id",
                "name",
                "scenes",
                "atlases",
                "files",
                "preview",
                "gbc_palette_profile",
            },
            "Unsupported project manifest fields",
        )
        atlas.require(identity(document["id"]), "Invalid project identity")
        name(document["name"])
        palette_budget.check_profile(document.get("gbc_palette_profile"))
        atlas.require(
            isinstance(document["scenes"], list)
            and isinstance(document["atlases"], dict)
            and isinstance(document["files"], dict)
            and isinstance(document["preview"], dict),
            "Invalid project collections",
        )
        seen = set()
        for item in document["scenes"]:
            atlas.require(
                isinstance(item, dict)
                and set(item) == {"id", "name", "path"}
                and identity(item.get("id"))
                and item["id"] not in seen,
                "Invalid or duplicate scene identity",
            )
            seen.add(item["id"])
            name(item["name"])
            atlas.require(item["path"] == f"scenes/{item['id']}.tmj", "Invalid scene path")
            safe_path(self.root, item["path"])
        for atlas_id, entry in document["atlases"].items():
            atlas.require(
                atlas.identifier(atlas_id)
                and isinstance(entry, dict)
                and {"manifest", "tiles", "png"} <= set(entry)
                and not set(entry) - {"manifest", "tiles", "png", "metadata"}
                and isinstance(entry["manifest"], dict)
                and entry["manifest"].get("id") == atlas_id
                and entry["png"] == f"assets/{atlas_id}/atlas.png",
                "Invalid atlas entry",
            )
            mappings = entry["tiles"]
            atlas.require(
                isinstance(mappings, dict)
                and set(mappings) - {"sprites"} == {str(s) for s in atlas.GRIDS},
                "Invalid atlas tile mappings",
            )
            for mapping in mappings.values():
                atlas.require(
                    isinstance(mapping, dict)
                    and all(
                        isinstance(key, str)
                        and key.startswith(atlas_id + "/")
                        and type(local) is int
                        for key, local in mapping.items()
                    )
                    and sorted(mapping.values()) == list(range(len(mapping))),
                    "Invalid tile identities",
                )
            tile_metadata.check_entry(entry)
        if "sprite" in document["preview"]:
            preview_settings.validate(document["preview"]["sprite"], document)
        for path, revision in document["files"].items():
            atlas.require(
                isinstance(path, str)
                and path.startswith("assets/")
                and isinstance(revision, str)
                and len(revision) == 64,
                "Invalid project asset inventory",
            )
            safe_path(self.root, path)
        return document, digest(data)

    def _current(self, revision):
        document, current = self.read()
        if revision != current:
            raise Conflict("Project changed on disk. Reopen it before saving or importing.")
        for path, expected in document["files"].items():
            if digest(read_optional(safe_path(self.root, path))) != expected:
                raise Conflict(
                    f"Project asset changed on disk: {path}. Restore it before continuing."
                )
        return document

    def _commit(self, document, revision, changes, expected, label):
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
        expected = {**document["files"], **expected, MANIFEST: revision}
        for path, data in changes.items():
            if path.startswith("scenes/") and data is not None:
                atlas.require(
                    len(data) <= 4 * 1024 * 1024,
                    "Scene exceeds 4 MiB. Reduce layers, objects or property text.",
                )
            if path.startswith("assets/"):
                expected.setdefault(path, None)
                if data is None:
                    document["files"].pop(path, None)
                else:
                    document["files"][path] = digest(data)
        changes[MANIFEST] = json_text(document).encode()
        atlas.require(len(changes[MANIFEST]) <= 8 * 1024 * 1024, "Project manifest exceeds 8 MiB")
        try:
            self.transactions.apply(changes, expected, label)
        except ValueError as error:
            raise Conflict(str(error)) from error

    def catalog(self):
        with self.transactions.locked():
            document, revision = self.read()
        for entry in document["atlases"].values():
            entry["tiles"].setdefault("sprites", atlas.sprite_mapping(entry))
        return {"project": document, "revision": revision}

    def export_bundle(self, scope, revision, scene_id=None, scene=None, scene_revision=None):
        return exporting.export_bundle(self, scope, revision, scene_id, scene, scene_revision)

    def save_preview_settings(self, value, revision):
        document = self._current(revision)
        document["preview"]["sprite"] = preview_settings.validate(value, document)
        self._commit(document, revision, {}, {}, "Save sprite preview settings")
        return self.catalog()

    def save_palette_profile(self, value, revision):
        palette_budget.check_profile(value)
        document = self._current(revision)
        if value is None:
            document.pop("gbc_palette_profile", None)
        else:
            document["gbc_palette_profile"] = copy.deepcopy(value)
        self._commit(document, revision, {}, {}, "Save GBC palette profile")
        return self.catalog()

    def palette_report(self, scene_id, revision, scene_revision, scene=None):
        """Check a frozen saved scene or unsaved canvas; never mutate authoring files."""
        with self.transactions.locked():
            document = self._current(revision)
            current = self._load_scene(scene_id, document)
            if current["revision"] != scene_revision:
                raise Conflict("Scene changed on disk. Reopen it before validating.")
            candidate = current["scene"] if scene is None else scene
            tiled.check_scene(candidate, document)
            result = palette_budget.report(
                candidate, document, document.get("gbc_palette_profile"), scene_id
            )
            # Detect noncooperating edits while analysis ran, just as export does.
            self._current(revision)
            if self._load_scene(scene_id, document)["revision"] != scene_revision:
                raise Conflict("Scene changed while validating. Reopen it before validating.")
            return {**result, "project_revision": revision, "scene_revision": scene_revision}

    def save_tile_metadata(self, atlas_id, group, asset, value, revision):
        document = self._current(revision)
        atlas.require(
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
            source = json.loads(safe_path(self.root, path).read_bytes())
        else:
            atlas.require(
                group == "sprites", "Missing tileset dependency. Restore it before editing."
            )
            width, _, pixels = png.decode(safe_path(self.root, entry["png"]).read_bytes())
            changes = atlas.build_sprites(entry, width, pixels)
            source = json.loads(changes[path])
        changes[path] = json_text(tile_metadata.decorate(entry, group, source)).encode()
        self._commit(document, revision, changes, {}, "Edit tile metadata")
        return self.catalog()

    def load_scene(self, scene_id, document=None):
        # Atlas origins and native maps must come from the same committed state.
        # A concurrent import can rewrite map coordinates before the manifest.
        with self.transactions.locked():
            return self._load_scene(scene_id, document)

    def _load_scene(self, scene_id, document=None):
        if document is None:
            document, _ = self.read()
        entry = next((s for s in document["scenes"] if s["id"] == scene_id), None)
        atlas.require(entry is not None, "Choose a project scene")
        data = safe_path(self.root, entry["path"]).read_bytes()
        atlas.require(len(data) <= 4 * 1024 * 1024, "Scene exceeds 4 MiB")
        return {
            "id": scene_id,
            "name": entry["name"],
            "revision": digest(data),
            "scene": tiled.decode(json.loads(data), document),
        }

    def asset(self, path, revision=None):
        with self.transactions.locked():
            document, current = self.read()
            if revision is not None and revision != current:
                raise Conflict("Project assets changed. Reload the project before continuing.")
            atlas.require(path in document["files"] and path.endswith(".png"), "Unknown image")
            data = safe_path(self.root, path).read_bytes()
            if digest(data) != document["files"][path]:
                raise Conflict("Project asset changed on disk. Restore it or reimport the atlas.")
            return data

    def create_scene(self, title, width, height, grid, revision):
        document = self._current(revision)
        title = name(title)
        atlas.require(
            atlas.integer(width, 1, 256) and atlas.integer(height, 1, 256),
            "Scene dimensions must be within 1..256",
        )
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
        self._commit(document, revision, {path: encoded}, {path: None}, "Create scene")
        return {
            "id": scene_id,
            "name": title,
            "revision": digest(encoded),
            "scene": tiled.decode(json.loads(encoded), document),
        }

    def save_scene(self, scene_id, scene, revision, project_revision):
        document = self._current(project_revision)
        current = self.load_scene(scene_id, document)
        if current["revision"] != revision:
            raise Conflict("Scene changed on disk. Reopen it before saving.")
        path = f"scenes/{scene_id}.tmj"
        encoded = json_text(tiled.encode(scene, document)).encode()
        self._commit(document, project_revision, {path: encoded}, {path: revision}, "Save scene")
        # A later external edit must not become the revision acknowledged by this
        # save: the browser keeps its submitted canvas and undo history.
        return {
            "id": scene_id,
            "name": current["name"],
            "revision": digest(encoded),
            "scene": tiled.decode(json.loads(encoded), document),
        }

    def delete_scene(self, scene_id, revision, project_revision):
        document = self._current(project_revision)
        entry = next((item for item in document["scenes"] if item["id"] == scene_id), None)
        atlas.require(entry is not None, "Choose a project scene")
        path = entry["path"]
        current = digest(read_optional(safe_path(self.root, path)))
        if not isinstance(revision, str) or current != revision:
            raise Conflict("Scene changed on disk. Reopen the delete dialog before trying again.")
        document["scenes"] = [item for item in document["scenes"] if item["id"] != scene_id]
        self._commit(document, project_revision, {path: None}, {path: revision}, "Delete scene")
        return {"deleted": scene_id, **self.catalog()}

    def import_atlas(self, path, revision, *, reimport=False):
        return self._import_bundle(atlas.load_bundle(path), revision, reimport=reimport)

    def delete_atlas(self, atlas_id, revision, *, scene_guard=None):
        document = self._current(revision)
        atlas.require(
            atlas.identifier(atlas_id) and atlas_id in document["atlases"],
            "Choose an imported atlas",
        )
        prefix = atlas_id + "/"
        scenes = [self.load_scene(item["id"], document) for item in document["scenes"]]
        if scene_guard is not None:
            atlas.require(
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
        atlas.require(
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
        self._commit(document, revision, changes, expected, "Delete atlas")
        return {
            "deleted": atlas_id,
            "scene_revisions": {
                item["id"]: digest(changes[f"scenes/{item['id']}.tmj"]) for item in scenes
            },
            **self.catalog(),
        }

    def import_bundle(self, bundle, revision, *, reimport=False):
        return self._import_bundle(atlas.load_uploaded_bundle(bundle), revision, reimport=reimport)

    def _import_bundle(self, bundle, revision, *, reimport=False):
        manifest, image, width, pixels = bundle
        document = self._current(revision)
        atlas_id = manifest["id"]
        previous = document["atlases"].get(atlas_id)
        atlas.require(
            previous is None or reimport is True,
            "Atlas ID already exists. Choose explicit reimport to replace it.",
        )
        atlas.require(
            previous is not None or not reimport, "Reimport requires an existing atlas ID"
        )
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
            atlas.require(
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
        scenes = [self.load_scene(item["id"], document) for item in document["scenes"]]
        entry, changes = atlas.build_assets(manifest, image, width, pixels, previous)
        document["atlases"][atlas_id] = copy.deepcopy(entry)
        expected = {}
        for loaded in scenes:
            path = f"scenes/{loaded['id']}.tmj"
            changes[path] = json_text(tiled.encode(loaded["scene"], document)).encode()
            expected[path] = loaded["revision"]
        self._commit(
            document, revision, changes, expected, "Reimport atlas" if previous else "Import atlas"
        )
        return report
