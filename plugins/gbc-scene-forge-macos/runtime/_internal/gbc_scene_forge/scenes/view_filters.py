"""Portable display classification, independent of authored visibility/runtime inclusion."""

import copy

from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning.blockout import values

CATEGORIES = ("tiles", "sprites", "geometry", "gameplay", "guides")


def filters(value=None):
    require(
        value is None
        or (
            isinstance(value, dict)
            and not set(value) - set(CATEGORIES)
            and all(type(v) is bool for v in value.values())
        ),
        "View filters must contain boolean tiles, sprites, geometry, gameplay or guides",
    )
    return {key: (value or {}).get(key, True) for key in CATEGORIES}


def category(item, project):
    if item.get("kind", "sprite") == "sprite":
        return "sprites"
    props = values(item, project)
    if props.get("forge_view") in ("geometry", "gameplay", "guides"):
        return props["forge_view"]
    role = props.get("blockout_role")
    if role in ("camera", "note", "section"):
        return "guides"
    if role in ("patrol", "approach", "arena", "detour"):
        return "gameplay"
    return "geometry" if item["kind"] == "rectangle" else "gameplay"


def filtered(scene, project, choices):
    """Return a rendering copy; never change authored objects or visibility."""
    result = copy.deepcopy(scene)
    result["layers"] = copy.deepcopy(tiled.scene_layers(scene))
    for layer in result["layers"]:
        if layer["type"] == "tilelayer":
            layer["visible"] = layer["visible"] and choices["tiles"]
        else:
            layer["objects"] = [o for o in layer["objects"] if choices[category(o, project)]]
    return result
