"""Read-only static-scene palette requirements using gbc-atlas manifest v1."""

from gbc_scene_forge.analysis import target_budget
from gbc_scene_forge.analysis.artwork_usage import frame_closure
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats.tiled import scene_layers

POLICY = {
    "layers": "all, including hidden layers and objects",
    "tiles": "BG/window pool; all 8x8 cells inside each placed grid tile",
    "sprites": "OBJ pool; all 8x16 pairs inside each placed sprite region",
    "animations": "transitive closure of sequences containing a placed region; corresponding tile offsets",
    "residency": "static; no palette streaming or mid-frame changes",
    "equivalence": "ordered RGB5; BG entries 0..3, OBJ entries 1..3; no index remapping",
}


def check_profile(value):
    if value is None:
        return
    require(
        isinstance(value, dict)
        and set(value)
        == (
            {"version", "bg_reserved", "obj_reserved"}
            if value.get("version") == 1
            else {"version", "bg_reserved", "obj_reserved", "hardware"}
        )
        and type(value["version"]) is int
        and value["version"] in (1, 2),
        "Use GBC profile version 1 (palettes) or 2 (hardware estimates)",
    )
    require(
        all(
            value[key] is None or integer(value[key], 0, 8)
            for key in ("bg_reserved", "obj_reserved")
        ),
        "Reserve 0..8 palette slots per pool, or leave unknown",
    )

    if value["version"] == 2:
        target_budget.check_profile(value["hardware"])


def report(scene, project, profile, scene_id):
    check_profile(profile)
    result = {
        "version": 1,
        "scene_id": scene_id,
        "profile": profile,
        "policy": dict(POLICY),
        "status": "disabled" if profile is None else "pass",
        "pools": {},
        "errors": [],
        "warnings": [],
    }
    if profile is None:
        result["warnings"].append("Enable the GBC palette profile before running preflight.")
        return result
    groups = {"BG": {}, "OBJ": {}}
    missing = []
    resolved = {}
    closures = {}

    def contribute(asset, location, pool):
        asset = asset.rsplit("#", 1)[0]
        cached = resolved.get((pool, asset))
        if cached is not None:
            for key, source in cached:
                groups[pool].setdefault(key, []).append({**location, **source})
            return
        try:
            atlas_id, region_name, *offset = asset.split("/")
            entry = project["atlases"][atlas_id]
            manifest = entry["manifest"]
            regions = {r["name"]: r for r in manifest["regions"]}
            columns = max(r["x"] + r["width"] for r in regions.values()) // 8
            require(manifest["version"] == 1 and columns > 0, "Missing manifest v1 dimensions")
            size = scene["grid"] if pool == "BG" else None
            ox, oy = (int(offset[0]) * size, int(offset[1]) * size) if size else (0, 0)
            contributions = []
            closure_key = (atlas_id, region_name)
            if closure_key not in closures:
                closures[closure_key] = frame_closure(manifest, region_name)
            for frame, sequence in closures[closure_key].items():
                region = regions[frame]
                require(
                    region["kind"] == ("tile" if pool == "BG" else "sprite"), "Wrong region kind"
                )
                width, height = (size, size) if size else (region["width"], region["height"])
                require(
                    ox + width <= region["width"] and oy + height <= region["height"],
                    "Frame does not contain the placed tile offset",
                )
                local_cells = {}
                for y in range(region["y"] + oy, region["y"] + oy + height, 8):
                    for x in range(region["x"] + ox, region["x"] + ox + width, 8):
                        cell = (y // 8) * columns + x // 8
                        local = manifest["cell_palettes"][cell]
                        require(
                            integer(local, 0, len(manifest["palettes"]) - 1),
                            "Missing palette assignment",
                        )
                        local_cells.setdefault(local, []).append(cell)
                for local, cells in sorted(local_cells.items()):
                    colors = manifest["palettes"][local]
                    require(
                        isinstance(colors, list)
                        and len(colors) == 4
                        and all(
                            isinstance(c, list)
                            and len(c) == 3
                            and all(integer(v, 0, 31) for v in c)
                            for c in colors
                        ),
                        "Missing ordered RGB5 palette",
                    )
                    key = tuple(tuple(color) for color in (colors if pool == "BG" else colors[1:]))
                    contributions.append(
                        (
                            key,
                            {
                                "atlas": atlas_id,
                                "asset": asset,
                                "region": frame,
                                "animation": sequence,
                                "local_palette": local,
                                "source_cells": cells,
                            },
                        )
                    )
            for key, source in contributions:
                groups[pool].setdefault(key, []).append({**location, **source})
            resolved[pool, asset] = contributions
        except (KeyError, TypeError, ValueError, IndexError) as error:
            missing.append({**location, "asset": asset, "reason": str(error)})

    for layer in scene_layers(scene):
        base = {"scene_id": scene_id, "layer_id": layer["id"], "layer_name": layer["name"]}
        if layer["type"] == "tilelayer":
            for y, row in enumerate(layer["cells"]):
                for x, asset in enumerate(row):
                    if asset:
                        contribute(asset, {**base, "x": x, "y": y, "object_id": None}, "BG")
        else:
            for obj in layer["objects"]:
                if obj.get("kind", "sprite") == "sprite":
                    contribute(
                        obj["asset"],
                        {**base, "x": obj["x"], "y": obj["y"], "object_id": obj["id"]},
                        "OBJ",
                    )
    for pool in ("BG", "OBJ"):
        reserved = profile["bg_reserved" if pool == "BG" else "obj_reserved"]
        required = len(groups[pool])
        available = None if reserved is None else 8 - reserved
        over = required > (8 if available is None else available)
        result["pools"][pool] = {
            "limit": 8,
            "reserved": reserved,
            "available": available,
            "required": required,
            "status": "fail" if over else "unverified" if reserved is None or missing else "pass",
            "palettes": [
                {"entries": key, "contributors": sources}
                for key, sources in sorted(groups[pool].items())
            ],
        }
        if over:
            result["errors"].append(
                f"{pool}: {required} palettes required; {available if available is not None else 'at most 8'} available."
            )
        if reserved is None:
            result["warnings"].append(
                f"{pool} runtime reservations are unknown; enter an explicit budget, including zero if appropriate."
            )
    result["unverified_contributors"] = missing
    if missing:
        result["warnings"].append(
            "Some placements lack usable palette metadata; their requirements are unverified."
        )
    result["warnings"].append(
        "Palette checks only. A consuming build must verify UI/effects/dynamic actors, allocation, VRAM, OAM and timing."
    )
    result["status"] = (
        "fail"
        if result["errors"]
        else "unverified"
        if missing or any(profile[key] is None for key in ("bg_reserved", "obj_reserved"))
        else "pass"
    )
    if profile["version"] == 2:
        hardware = target_budget.report(scene, project, profile["hardware"], scene_id)
        result["hardware"] = hardware
        result["warnings"].extend(hardware["warnings"])
        if result["status"] != "fail":
            result["status"] = "unverified"
    return result
