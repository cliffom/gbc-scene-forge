"""Manifest schema validation, with no reads or transport dependencies."""

from gbc_scene_forge.analysis import palette_budget
from gbc_scene_forge.artwork import atlas
from gbc_scene_forge.artwork import metadata as tile_metadata
from gbc_scene_forge.core.identities import identity, name
from gbc_scene_forge.core.validation import identifier, integer, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning import world
from gbc_scene_forge.scene_objects import definitions as object_definitions
from gbc_scene_forge.scene_objects import preview as preview_settings
from gbc_scene_forge.storage.paths import safe_path

MANIFEST = "forge.project.json"
SCHEMA_VERSION = 1


def check_version(document):
    require(
        isinstance(document, dict)
        and type(document.get("version")) is int
        and document["version"] == SCHEMA_VERSION,
        "Unsupported project version; this release supports manifest version 1",
    )


def check_stamp_slots(slots, scene):
    require(
        isinstance(slots, list)
        and len(slots) == len(tiled.scene_layers(scene))
        and all(integer(slot, 0, 127) for slot in slots),
        "Invalid stamp layer mapping",
    )

    previous = {}
    for layer, slot in zip(tiled.scene_layers(scene), slots):
        key = (layer["type"], layer["name"])
        require(slot > previous.get(key, -1), "Invalid stamp layer mapping order")
        previous[key] = slot


def validate(document, root):
    check_version(document)
    require(
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
            "stamps",
            "object_definitions",
            "world",
        },
        "Unsupported project manifest fields",
    )
    require(identity(document["id"]), "Invalid project identity")
    name(document["name"])
    palette_budget.check_profile(document.get("gbc_palette_profile"))
    require(
        isinstance(document["scenes"], list)
        and isinstance(document["atlases"], dict)
        and isinstance(document["files"], dict)
        and isinstance(document["preview"], dict),
        "Invalid project collections",
    )
    stamps = document.get("stamps", [])
    require(isinstance(stamps, list) and len(stamps) <= 128, "Use at most 128 stamps")
    stamp_ids = set()
    for stamp in stamps:
        require(
            isinstance(stamp, dict)
            and set(stamp) == {"id", "name", "scene", "slots"}
            and identity(stamp["id"])
            and stamp["id"] not in stamp_ids,
            "Invalid stamp identity",
        )
        stamp_ids.add(stamp["id"])
        name(stamp["name"])
        tiled.check_scene(stamp["scene"], document)
        check_stamp_slots(stamp["slots"], stamp["scene"])
    seen = set()
    for item in document["scenes"]:
        require(
            isinstance(item, dict)
            and set(item) == {"id", "name", "path"}
            and identity(item.get("id"))
            and item["id"] not in seen,
            "Invalid or duplicate scene identity",
        )
        seen.add(item["id"])
        name(item["name"])
        require(item["path"] == f"scenes/{item['id']}.tmj", "Invalid scene path")
        safe_path(root, item["path"])
    for atlas_id, entry in document["atlases"].items():
        require(
            identifier(atlas_id)
            and isinstance(entry, dict)
            and {"manifest", "tiles", "png"} <= set(entry)
            and not set(entry) - {"manifest", "tiles", "png", "metadata"}
            and isinstance(entry["manifest"], dict)
            and entry["manifest"].get("id") == atlas_id
            and entry["png"] == f"assets/{atlas_id}/atlas.png",
            "Invalid atlas entry",
        )
        mappings = entry["tiles"]
        require(
            isinstance(mappings, dict)
            and set(mappings) - {"sprites"} == {str(s) for s in atlas.GRIDS},
            "Invalid atlas tile mappings",
        )
        for mapping in mappings.values():
            require(
                isinstance(mapping, dict)
                and all(
                    isinstance(key, str) and key.startswith(atlas_id + "/") and type(local) is int
                    for key, local in mapping.items()
                )
                and sorted(mapping.values()) == list(range(len(mapping))),
                "Invalid tile identities",
            )
        tile_metadata.check_entry(entry)
    object_definitions.check_library(
        document.get("object_definitions", {"version": 1, "definitions": []}),
        tiled.sprite_regions(document),
    )
    world.check(document.get("world", world.empty()))
    if "sprite" in document["preview"]:
        preview_settings.validate(document["preview"]["sprite"], document)
    for path, revision in document["files"].items():
        require(
            isinstance(path, str)
            and path.startswith("assets/")
            and isinstance(revision, str)
            and len(revision) == 64,
            "Invalid project asset inventory",
        )
        safe_path(root, path)
    return document
