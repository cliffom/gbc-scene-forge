"""Pure, bounded selected-placement replacement over exact saved scene snapshots."""

import copy

from gbc_scene_forge.artwork import editable
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled


def replace(candidate, scenes):
    """Return copied affected scenes; preserve every field except selected asset references."""
    selections = candidate.get("placements", [])
    if not selections:
        return {}
    editable.check_placements(selections)
    source, descriptor = candidate["source"], candidate["descriptor"]
    old = f"{source['atlas_id']}/{source['region']}"
    new = f"{descriptor['atlas_id']}/{descriptor['region']}"
    if descriptor["kind"] == "tile":
        old += f"/{source['cell'][0]}/{source['cell'][1]}"
        new += "/0/0"
    saved = {scene["id"]: scene for scene in scenes}
    result = {}
    for location in selections:
        scene_id = location["scene_id"]
        loaded = saved.get(scene_id)
        require(loaded is not None, "Selected scene no longer exists")
        if loaded["revision"] != location["scene_revision"]:
            raise Conflict(
                "Selected scene changed. Retain the variation and select placements again."
            )
        if scene_id not in result:
            result[scene_id] = copy.deepcopy(loaded["scene"])
        model = result[scene_id]
        layer = next(
            (layer for layer in tiled.scene_layers(model) if layer["id"] == location["layer_id"]),
            None,
        )
        require(layer is not None, "Selected layer no longer exists")
        if "object_id" in location:
            require(
                descriptor["kind"] == "sprite" and layer["type"] == "objectgroup",
                "Select sprite objects for a sprite variation",
            )
            item = next(
                (obj for obj in layer["objects"] if obj["id"] == location["object_id"]), None
            )
            require(
                item is not None and item.get("asset") == old, "Selected sprite differs from source"
            )
            item["asset"] = new
        else:
            require(
                descriptor["kind"] == "tile"
                and layer["type"] == "tilelayer"
                and model["grid"] == source["grid"],
                "Selected tiles must use the copied source grid",
            )
            x, y = location["x"], location["y"]
            require(x < model["width"] and y < model["height"], "Selected tile is outside scene")
            asset, flags = tiled.cell_parts(layer["cells"][y][x])
            require(asset == old, "Selected tile differs from source")
            layer["cells"][y][x] = new + (f"#{flags}" if flags else "")
    return result
