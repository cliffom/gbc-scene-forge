"""Project preferences only; never playback progress, paths or temporary positions."""

import copy
import math

from gbc_scene_forge.core.validation import require

ACTIONS = ("idle", "walk")
DIRECTIONS = ("down", "left", "right", "up")
SLOTS = {f"{action}:{direction}" for action in ACTIONS for direction in DIRECTIONS}


def defaults():
    return {
        "playback_speed": 1,
        "show_origin": True,
        "movement_speed": 48,
        "footprint": {"x": -4, "y": -4, "width": 8, "height": 8},
        "check_collisions": False,
        "mappings": {},
        "selections": {},
    }


def sequences(document):
    result = {}
    for atlas_id, entry in document["atlases"].items():
        regions = {r["name"]: r for r in entry["manifest"]["regions"]}
        names = {
            a["name"]
            for a in entry["manifest"].get("animations", [])
            if all(regions[f["region"]]["kind"] == "sprite" for f in a["frames"])
        }
        for region in regions.values():
            if region["kind"] == "sprite":
                result[f"{atlas_id}/{region['name']}"] = names
    return result


def finite(value, low, high):
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def validate(value, document):
    require(isinstance(value, dict) and set(value) == set(defaults()), "Invalid preview settings")
    require(
        type(value["playback_speed"]) in (int, float)
        and value["playback_speed"] in (0.25, 0.5, 1, 2, 4)
        and type(value["show_origin"]) is bool
        and type(value["check_collisions"]) is bool
        and finite(value["movement_speed"], 1, 512),
        "Invalid preview speeds or collision/origin preference",
    )
    footprint = value["footprint"]
    require(
        isinstance(footprint, dict)
        and set(footprint) == {"x", "y", "width", "height"}
        and all(finite(footprint[k], -4096, 4096) for k in ("x", "y"))
        and all(finite(footprint[k], 0, 4096) and footprint[k] > 0 for k in ("width", "height")),
        "Invalid preview collision footprint",
    )
    available = sequences(document)
    for collection in ("mappings", "selections"):
        entries = value[collection]
        require(isinstance(entries, dict), "Invalid preview asset settings")
        for asset, settings in entries.items():
            require(
                asset in available and isinstance(settings, dict), "Unknown preview sprite asset"
            )
            if collection == "mappings":
                require(
                    set(settings) <= SLOTS
                    and all(
                        isinstance(n, str) and n in available[asset] for n in settings.values()
                    ),
                    "Invalid preview sequence mapping",
                )
            else:
                require(
                    set(settings) == {"action", "direction", "sequence"}
                    and settings["action"] in ("manual", *ACTIONS)
                    and settings["direction"] in DIRECTIONS
                    and isinstance(settings["sequence"], str)
                    and (not settings["sequence"] or settings["sequence"] in available[asset]),
                    "Invalid preview selection",
                )
    return copy.deepcopy(value)


def prune(document):
    """Remove references made obsolete by atlas deletion or reimport."""
    settings = document["preview"].get("sprite")
    if settings is None:
        return
    available = sequences(document)
    for collection in ("mappings", "selections"):
        for asset in list(settings[collection]):
            if asset not in available:
                del settings[collection][asset]
                continue
            entry = settings[collection][asset]
            if collection == "mappings":
                settings[collection][asset] = {
                    slot: name for slot, name in entry.items() if name in available[asset]
                }
            elif entry["sequence"] not in available[asset]:
                entry["sequence"] = ""
