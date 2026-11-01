"""Native composition placement, matching the browser's occurrence-slot rules."""

import copy

from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.schema import check_stamp_slots


def place(scene, document, stamp_id, x, y):
    """Place one saved stamp on a private scene; never create layers or clip content."""
    require(isinstance(stamp_id, str) and 1 <= len(stamp_id) <= 100, "Invalid stamp identity")
    stamp = next((s for s in document.get("stamps", []) if s["id"] == stamp_id), None)
    require(stamp is not None, "Unknown stamp")
    source = stamp["scene"]
    tiled.check_scene(scene, document)
    tiled.check_scene(source, document)
    check_stamp_slots(stamp["slots"], source)
    require(source["grid"] == scene["grid"], "Paste needs the same grid size")
    require(
        integer(x, 0, scene["width"] - source["width"])
        and integer(y, 0, scene["height"] - source["height"]),
        "The entire composition must fit inside the scene; x/y are cell indices",
    )
    candidate = copy.deepcopy(scene)
    candidate["layers"] = tiled.scene_layers(candidate)
    candidate.pop("cells", None)
    candidate.pop("objects", None)
    candidate.setdefault("next_layer_id", max(v["id"] for v in candidate["layers"]) + 1)
    candidate.setdefault(
        "next_object_id",
        max((o["id"] for v in candidate["layers"] for o in v.get("objects", [])), default=0) + 1,
    )
    allocated, mappings = [], []
    tile_writes = 0
    for layer, slot in zip(tiled.scene_layers(source), stamp["slots"]):
        matches = [
            v
            for v in candidate["layers"]
            if v["type"] == layer["type"] and v["name"] == layer["name"]
        ]
        require(
            slot < len(matches) and matches[slot]["visible"],
            f"Show or create matching layer: {layer['name']} ({layer['type']}, {slot + 1})",
        )
        target = matches[slot]
        mapping = dict(source_layer_id=layer["id"], target_layer_id=target["id"], slot=slot)
        if layer["type"] == "tilelayer":
            for dy, row in enumerate(layer["cells"]):
                target["cells"][y + dy][x : x + source["width"]] = row
            count = source["width"] * source["height"]
            tile_writes += count
            mapping["tile_write_count"] = count
        else:
            require(
                len(target["objects"]) + len(layer["objects"]) <= 4096,
                "Use at most 4096 objects per layer",
            )
            mapping["object_ids"] = []
            for original in layer["objects"]:
                item = copy.deepcopy(original)
                item["id"] = candidate["next_object_id"]
                candidate["next_object_id"] += 1
                item["x"] += x * source["grid"]
                item["y"] += y * source["grid"]
                target["objects"].append(item)
                allocated.append(item["id"])
                mapping["object_ids"].append(
                    dict(source_id=original["id"], allocated_id=item["id"])
                )
        mappings.append(mapping)
    tiled.check_scene(candidate, document)
    return (
        candidate,
        allocated,
        {
            "placement": dict(
                stamp_id=stamp_id,
                stamp_name=stamp["name"],
                x=x,
                y=y,
                units="cells",
                width=source["width"],
                height=source["height"],
                tile_write_count=tile_writes,
                object_count=len(allocated),
                layer_mapping=mappings,
            )
        },
    )
