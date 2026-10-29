"""Bounded native scene edits shared by local authoring adapters."""

import copy
import hashlib
import json

from . import blockout, tiled
from .atlas import integer, require

MAX_OPERATIONS = 128
MAX_INPUT = 4 * 1024 * 1024


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
    return {
        "before_snapshot": snapshot(before),
        "after_snapshot": snapshot(after),
        "object_changes": [
            {"id": key, "before": old.get(key), "after": new.get(key)}
            for key in changed[:MAX_OPERATIONS]
        ],
        "object_change_count": len(changed),
        "object_changes_truncated": len(changed) > MAX_OPERATIONS,
        "changed_layer_ids": [
            layer_id
            for layer_id in sorted(
                {layer["id"] for layer in tiled.scene_layers(before) + tiled.scene_layers(after)}
            )
            if next((v for v in tiled.scene_layers(before) if v["id"] == layer_id), None)
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
    require("layers" in candidate, "Use save_scene to edit a legacy flat scene")
    allocated = []
    for operation in operations:
        require(isinstance(operation, dict), "Expected an edit operation")
        action = operation.get("op")
        if action == "place":
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
            raise ValueError("Unsupported edit operation; use place, update, duplicate or delete")
        tiled.check_scene(candidate, document)
    return candidate, allocated
