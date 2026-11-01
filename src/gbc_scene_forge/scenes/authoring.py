"""Bounded native scene edits shared by local authoring adapters."""

import copy
import hashlib
import json

from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning import blockout

MAX_OPERATIONS = 128
MAX_INPUT = 4 * 1024 * 1024
MAX_TILE_EDITS = 4096


def snapshot(scene):
    return hashlib.sha256(
        json.dumps(scene, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def bounded(value):
    require(
        len(json.dumps(value, allow_nan=False).encode()) <= MAX_INPUT,
        "Authoring input exceeds 4 MiB",
    )


def changes(before, after):
    def objects(scene):
        return {
            item["id"]: {"layer_id": layer["id"], **item}
            for layer in tiled.scene_layers(scene)
            for item in layer.get("objects", [])
        }

    old, new = objects(before), objects(after)
    changed = [key for key in sorted(old.keys() | new.keys()) if old.get(key) != new.get(key)]
    old_layers, new_layers = tiled.scene_layers(before), tiled.scene_layers(after)
    old_order, new_order = [v["id"] for v in old_layers], [v["id"] for v in new_layers]

    def metadata(layers):
        return {
            layer["id"]: {
                **{key: layer[key] for key in ("name", "type", "visible")},
                "index": index,
            }
            for index, layer in enumerate(layers)
        }

    old_metadata, new_metadata = metadata(old_layers), metadata(new_layers)
    tile_changes = []
    tile_count = 0
    for identity in sorted(set(old_order) | set(new_order)):
        previous = next((v for v in old_layers if v["id"] == identity), {})
        current = next((v for v in new_layers if v["id"] == identity), {})
        if "cells" not in previous and "cells" not in current:
            continue
        old_cells, new_cells = previous.get("cells", []), current.get("cells", [])
        if old_cells == new_cells:
            continue
        for y in range(max(len(old_cells), len(new_cells))):
            old_row = old_cells[y] if y < len(old_cells) else []
            new_row = new_cells[y] if y < len(new_cells) else []
            if old_row == new_row:
                continue
            for x in range(max(len(old_row), len(new_row))):
                prior = old_row[x] if x < len(old_row) else tiled.EMPTY
                value = new_row[x] if x < len(new_row) else tiled.EMPTY
                if prior != value:
                    tile_count += 1
                    if len(tile_changes) < MAX_OPERATIONS:
                        tile_changes.append(
                            dict(layer_id=identity, x=x, y=y, before=prior, after=value)
                        )
    return {
        "before_snapshot": snapshot(before),
        "after_snapshot": snapshot(after),
        "object_changes": [
            {"id": key, "before": old.get(key), "after": new.get(key)}
            for key in changed[:MAX_OPERATIONS]
        ],
        "object_change_count": len(changed),
        "object_changes_truncated": len(changed) > MAX_OPERATIONS,
        "tile_changes": tile_changes,
        "tile_change_count": tile_count,
        "tile_changes_truncated": tile_count > MAX_OPERATIONS,
        "before_layer_order": old_order,
        "after_layer_order": new_order,
        "layer_changes": [
            {
                "id": identity,
                "before": old_metadata.get(identity),
                "after": new_metadata.get(identity),
            }
            for identity in sorted(old_metadata.keys() | new_metadata.keys())
            if old_metadata.get(identity) != new_metadata.get(identity)
        ],
        "changed_layer_ids": [
            layer_id
            for layer_id in sorted(
                {layer["id"] for layer in tiled.scene_layers(before) + tiled.scene_layers(after)}
            )
            if (old_order.index(layer_id) if layer_id in old_order else None)
            != (new_order.index(layer_id) if layer_id in new_order else None)
            or next((v for v in tiled.scene_layers(before) if v["id"] == layer_id), None)
            != next((v for v in tiled.scene_layers(after) if v["id"] == layer_id), None)
        ],
    }


def edit(scene, document, operations):
    """Apply all operations to a copy; validation failure leaves the source untouched."""
    bounded(operations)
    require(
        isinstance(operations, list) and 1 <= len(operations) <= MAX_OPERATIONS,
        "Use 1..128 operations per atomic scene edit",
    )
    tiled.check_scene(scene, document)
    candidate = copy.deepcopy(scene)
    if "layers" not in candidate:
        candidate["layers"] = tiled.scene_layers(candidate)
        candidate.pop("cells", None)
        candidate.pop("objects", None)
    candidate.setdefault("next_layer_id", max(v["id"] for v in candidate["layers"]) + 1)
    candidate.setdefault(
        "next_object_id",
        max((v["id"] for layer in candidate["layers"] for v in layer.get("objects", [])), default=0)
        + 1,
    )
    allocated = []
    tile_edits = 0
    for operation in operations:
        require(isinstance(operation, dict), "Expected an edit operation")
        action = operation.get("op")
        if action in ("paint_tiles", "erase_tiles"):
            tile_edits += edit_tiles(candidate, document, operation)
            require(tile_edits <= MAX_TILE_EDITS, "Use at most 4096 tile edits per atomic batch")
        elif action in ("create_layer", "update_layer", "move_layer", "delete_layer"):
            edit_layer(candidate, operation)
        elif action == "place":
            require(
                {"op", "definition_id", "x", "y"} <= set(operation)
                and not set(operation)
                - {
                    "op",
                    "definition_id",
                    "x",
                    "y",
                    "width",
                    "height",
                    "name",
                    "properties",
                    "layer_id",
                },
                "Invalid place operation",
            )
            candidate, identity = blockout.place(
                candidate, document, **{k: v for k, v in operation.items() if k != "op"}
            )
            allocated.append(identity)
        elif action in ("update", "delete", "duplicate"):
            allowed = {"op", "object_id", "changes"} if action != "delete" else {"op", "object_id"}
            require(set(operation) <= allowed and "object_id" in operation, "Invalid object edit")
            identity = operation["object_id"]
            require(integer(identity, 1, 2147483646), "Invalid object ID")
            found = next(
                (
                    (layer, item)
                    for layer in candidate["layers"]
                    for item in layer.get("objects", [])
                    if item["id"] == identity
                ),
                None,
            )
            require(found is not None, "Choose an existing object ID")
            layer, item = found
            if action == "delete":
                layer["objects"].remove(item)
            else:
                patch = operation.get("changes", {})
                require(
                    isinstance(patch, dict)
                    and set(patch)
                    <= {"x", "y", "width", "height", "name", "class", "properties", "origin"},
                    "Update supports geometry, labels, typed properties and sprite origin",
                )
                if action == "duplicate":
                    item = copy.deepcopy(item)
                    item["id"] = candidate["next_object_id"]
                    candidate["next_object_id"] += 1
                    layer["objects"].append(item)
                    allocated.append(item["id"])
                item.update(copy.deepcopy(patch))
        else:
            raise ValueError("Unsupported edit operation; inspect the edit_scene schema")
        tiled.check_scene(candidate, document)
    return candidate, allocated


def find_layer(scene, identity):
    require(integer(identity, 1, 2147483646), "Invalid layer ID")
    found = next((v for v in scene["layers"] if v["id"] == identity), None)
    require(found is not None, "Choose an existing layer ID")
    return found


def edit_tiles(scene, document, operation):
    """Direct cell writes, without terrain inference or clipping."""
    require(set(operation) == {"op", "layer_id", "cells"}, "Invalid tile edit")
    layer = find_layer(scene, operation["layer_id"])
    require(layer["type"] == "tilelayer", "Choose a tile layer")
    cells = operation["cells"]
    require(isinstance(cells, list) and 1 <= len(cells) <= MAX_TILE_EDITS, "Use 1..4096 cells")
    fields = {"x", "y", "tile"} if operation["op"] == "paint_tiles" else {"x", "y"}
    valid = {tiled.EMPTY}
    for _, source, mapping in tiled.tilesets(document, scene["grid"]):
        if not source.endswith("/sprites.tsj"):
            valid.update(mapping)
    for cell in cells:
        require(isinstance(cell, dict) and set(cell) == fields, "Invalid tile cell edit")
        require(
            integer(cell["x"], 0, scene["width"] - 1)
            and integer(cell["y"], 0, scene["height"] - 1),
            "Tile coordinates must be in-bounds cell indices",
        )
        value = cell.get("tile", tiled.EMPTY)
        require(isinstance(value, str), "Tile reference must be a string")
        asset, flags = tiled.cell_parts(value)
        require(asset in valid and (not flags or bool(asset)), "Unknown tile asset reference")
        layer["cells"][cell["y"]][cell["x"]] = value
    return len(cells)


def edit_layer(scene, operation):
    """Edit native layer structure while retaining identities and allocation counters."""
    action = operation["op"]
    layers = scene["layers"]
    if action == "create_layer":
        require(
            {"op", "name", "type"} <= set(operation)
            and set(operation) <= {"op", "name", "type", "visible", "index"},
            "Invalid layer creation",
        )
        require(operation["type"] in ("tilelayer", "objectgroup"), "Unsupported layer type")
        require(len(layers) < 128, "Use at most 128 layers")
        index = operation.get("index", len(layers))
        require(integer(index, 0, len(layers)), "Invalid layer insertion index")
        layer = dict(
            id=scene["next_layer_id"],
            name=operation["name"],
            type=operation["type"],
            visible=operation.get("visible", True),
        )
        if layer["type"] == "tilelayer":
            layer["cells"] = [[tiled.EMPTY] * scene["width"] for _ in range(scene["height"])]
        else:
            layer["objects"] = []
        layers.insert(index, layer)
        scene["next_layer_id"] += 1
        return
    required = {
        "update_layer": {"op", "layer_id", "changes"},
        "move_layer": {"op", "layer_id", "index"},
        "delete_layer": {"op", "layer_id"},
    }
    require(set(operation) == required[action], "Invalid layer edit")
    layer = find_layer(scene, operation["layer_id"])
    if action == "update_layer":
        patch = operation["changes"]
        require(
            isinstance(patch, dict) and bool(patch) and set(patch) <= {"name", "visible"},
            "Layer updates support name and visibility",
        )
        layer.update(copy.deepcopy(patch))
    elif action == "move_layer":
        require(integer(operation["index"], 0, len(layers) - 1), "Invalid layer destination index")
        layers.remove(layer)
        layers.insert(operation["index"], layer)
    else:
        require(len(layers) > 1, "Keep at least one layer")
        layers.remove(layer)
