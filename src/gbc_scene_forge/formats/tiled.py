"""Strict ordered Tiled layers and native-size sprite objects with semantic references."""

from pathlib import PurePosixPath

from gbc_scene_forge.artwork.model import GRIDS, sprite_mapping
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.scene_objects.model import check_object, decode_object, encode_object
from gbc_scene_forge.scenes.dimensions import check_dimensions

EMPTY = ""


def cell_parts(cell):
    """Semantic asset plus orthogonal transform suffix; reserved outside atlas IDs."""
    if isinstance(cell, str) and len(cell) > 2 and cell[-2] == "#" and cell[-1] in "1234567":
        return cell[:-2], int(cell[-1])
    return cell, 0


def cell_gid(cell, gids):
    asset, flags = cell_parts(cell)
    return gids[asset] | ((flags & 1) << 31) | ((flags & 2) << 29) | ((flags & 4) << 27)


def gid_cell(gid, gids):
    flags = ((gid >> 31) & 1) | ((gid >> 29) & 2) | ((gid >> 27) & 4)
    return gids[gid & 0x0FFFFFFF] + (f"#{flags}" if flags else "")


def sprite_regions(project):
    return {
        f"{atlas_id}/{region['name']}": region
        for atlas_id, atlas in project["atlases"].items()
        for region in atlas["manifest"]["regions"]
        if region["kind"] == "sprite"
    }


def tilesets(project, size):
    first, result = 1, []
    # Append sprite sets after tile sets so adding sprite support doesn't change
    # any existing ground-only map's GID ranges.
    for sprites in (False, True):
        for atlas_id, atlas in sorted(project["atlases"].items()):
            mapping = sprite_mapping(atlas) if sprites else atlas["tiles"][str(size)]
            if mapping:
                filename = "sprites" if sprites else f"grid-{size}"
                result.append((first, f"../assets/{atlas_id}/{filename}.tsj", mapping))
                first += len(mapping)
    return result


def _check_flat(scene, project):
    require(
        isinstance(scene, dict)
        and {"width", "height", "grid", "cells"} <= set(scene)
        and not set(scene) - {"width", "height", "grid", "cells", "objects", "next_object_id"},
        "Unsupported scene fields",
    )
    check_dimensions(scene["width"], scene["height"], scene["grid"])
    require(
        type(scene["grid"]) is int and scene["grid"] in GRIDS, "Choose an 8, 16 or 32 pixel grid"
    )
    sprites = sprite_regions(project)
    valid = {EMPTY}
    for _, source, mapping in tilesets(project, scene["grid"]):
        if not source.endswith("/sprites.tsj"):
            valid.update(mapping)
    cells = scene["cells"]
    require(
        isinstance(cells, list)
        and len(cells) == scene["height"]
        and all(
            isinstance(row, list)
            and len(row) == scene["width"]
            and all(
                isinstance(cell, str)
                and cell_parts(cell)[0] in valid
                and (not cell_parts(cell)[1] or bool(cell_parts(cell)[0]))
                for cell in row
            )
            for row in cells
        ),
        "Invalid scene cells or unknown asset reference",
    )
    objects = scene.get("objects", [])
    require(isinstance(objects, list) and len(objects) <= 4096, "Invalid objects")
    seen = set()
    for item in objects:
        check_object(item, scene["width"] * scene["grid"], scene["height"] * scene["grid"], sprites)
        require(item["id"] not in seen, "Duplicate object ID")
        seen.add(item["id"])
    require(
        integer(
            scene.get("next_object_id", max(seen, default=0) + 1),
            max(seen, default=0) + 1,
            2147483647,
        ),
        "Invalid next object ID",
    )


def _encode_flat(scene, project):
    _check_flat(scene, project)
    gids, sources = {EMPTY: 0}, []
    for first, source, mapping in tilesets(project, scene["grid"]):
        gids.update({key: first + local for key, local in mapping.items()})
        sources.append({"firstgid": first, "source": source})
    layers = [
        {
            "id": 1,
            "name": "Ground",
            "type": "tilelayer",
            "x": 0,
            "y": 0,
            "width": scene["width"],
            "height": scene["height"],
            "opacity": 1,
            "visible": True,
            "data": [cell_gid(cell, gids) for row in scene["cells"] for cell in row],
        }
    ]
    regions, objects = sprite_regions(project), []
    for item in scene.get("objects", []):
        objects.append(
            encode_object(
                item, regions, gids, project.get("object_definitions", {}).get("definitions", [])
            )
        )
    if objects:
        layers.append(
            {
                "id": 2,
                "name": "Sprites",
                "type": "objectgroup",
                "draworder": "index",
                "x": 0,
                "y": 0,
                "opacity": 1,
                "visible": True,
                "objects": objects,
            }
        )
    return {
        "type": "map",
        "version": "1.10",
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "infinite": False,
        "width": scene["width"],
        "height": scene["height"],
        "tilewidth": scene["grid"],
        "tileheight": scene["grid"],
        "nextlayerid": 3 if objects else 2,
        "nextobjectid": scene.get("next_object_id", max((o["id"] for o in objects), default=0) + 1),
        "tilesets": sources,
        "layers": layers,
    }


def _decode_flat(document, project):
    require(isinstance(document, dict), "Expected a Tiled map")
    allowed = set(_encode_flat({"width": 1, "height": 1, "grid": 8, "cells": [[EMPTY]]}, project))
    require(
        not set(document) - allowed - {"tiledversion", "compressionlevel"},
        "Unsupported Tiled map fields; refusing to discard data",
    )
    require(
        document.get("type") == "map"
        and document.get("orientation") == "orthogonal"
        and document.get("infinite") is False
        and document.get("renderorder", "right-down") == "right-down"
        and document.get("version") == "1.10",
        "Unsupported Tiled map format",
    )
    width, height, size = (document.get(k) for k in ("width", "height", "tilewidth"))
    check_dimensions(width, height, size)
    require(
        type(size) is int and size in GRIDS and document.get("tileheight") == size,
        "Unsupported Tiled grid",
    )
    layers = document.get("layers")
    require(
        isinstance(layers, list)
        and len(layers) in (1, 2)
        and all(isinstance(layer, dict) for layer in layers),
        "Only Ground and an optional Sprites layer are supported",
    )
    layer = layers[0]
    require(
        not set(layer)
        - {
            "id",
            "name",
            "type",
            "x",
            "y",
            "width",
            "height",
            "opacity",
            "visible",
            "data",
            "encoding",
            "compression",
        },
        "Unsupported layer fields; refusing to discard data",
    )
    require(
        layer.get("type") == "tilelayer"
        and layer.get("width") == width
        and layer.get("height") == height
        and layer.get("x", 0) == layer.get("y", 0) == 0
        and layer.get("opacity", 1) == 1
        and layer.get("visible", True) is True
        and layer.get("encoding", "csv") == "csv"
        and not layer.get("compression"),
        "Unsupported tile layer settings",
    )
    require(
        layer.get("id") == 1
        and layer.get("name") == "Ground"
        and document.get("nextlayerid", len(layers) + 1) == len(layers) + 1,
        "Unsupported layer identity",
    )
    known = {source: mapping for _, source, mapping in tilesets(project, size)}
    gids, seen = {0: EMPTY}, set()
    references = document.get("tilesets")
    require(isinstance(references, list), "Expected external tilesets")
    for reference in references:
        require(
            isinstance(reference, dict) and set(reference) == {"firstgid", "source"},
            "Only external tilesets are supported",
        )
        source, first = reference["source"], reference["firstgid"]
        require(
            isinstance(source, str)
            and str(PurePosixPath(source)) == source
            and source in known
            and source not in seen
            and integer(first, 1, 0x0FFFFFFF),
            "Unknown or invalid tileset reference",
        )
        seen.add(source)
        for key, local in known[source].items():
            require(first + local not in gids, "Overlapping Tiled GID ranges")
            gids[first + local] = key
    data = layer.get("data")
    sprites = sprite_regions(project)
    require(
        isinstance(data, list)
        and len(data) == width * height
        and all(
            type(gid) is int
            and 0 <= gid <= 0xFFFFFFFF
            and not gid & 0x10000000
            and (gid & 0x0FFFFFFF) in gids
            and gids[gid & 0x0FFFFFFF] not in sprites
            and (gid == 0 or bool(gids[gid & 0x0FFFFFFF]))
            for gid in data
        ),
        "Unknown, transformed or invalid Tiled GIDs",
    )
    objects = []
    if len(layers) == 2:
        layer = layers[1]
        require(
            not set(layer)
            - {"id", "name", "type", "x", "y", "opacity", "visible", "draworder", "objects"},
            "Unsupported sprite layer fields",
        )
        require(
            layer.get("id") == 2
            and layer.get("name") == "Sprites"
            and layer.get("type") == "objectgroup"
            and layer.get("draworder") == "index"
            and layer.get("x", 0) == layer.get("y", 0) == 0
            and layer.get("opacity", 1) == 1
            and layer.get("visible", True) is True,
            "Unsupported sprite layer settings",
        )
        require(isinstance(layer.get("objects"), list), "Expected sprite objects")
        for item in layer["objects"]:
            objects.append(decode_object(item, sprites, gids))
    scene = {
        "width": width,
        "height": height,
        "grid": size,
        "cells": [
            [gid_cell(gid, gids) for gid in data[y * width : (y + 1) * width]]
            for y in range(height)
        ],
        "objects": objects,
        "next_object_id": document.get("nextobjectid", 1),
    }
    _check_flat(scene, project)
    return scene


def scene_layers(scene):
    """Read the ordered model, including maps written before named layers."""
    if "layers" in scene:
        return scene["layers"]
    layers = [
        {"id": 1, "name": "Ground", "type": "tilelayer", "visible": True, "cells": scene["cells"]}
    ]
    if scene.get("objects"):
        layers.append(
            {
                "id": 2,
                "name": "Sprites",
                "type": "objectgroup",
                "visible": True,
                "objects": scene["objects"],
            }
        )
    return layers


def _flat_layer(scene, layer):
    return {
        "width": scene["width"],
        "height": scene["height"],
        "grid": scene["grid"],
        "cells": layer.get("cells", [[EMPTY] * scene["width"] for _ in range(scene["height"])]),
        "objects": layer.get("objects", []),
        "next_object_id": scene.get("next_object_id", 2147483647),
    }


def check_scene(scene, project):
    if isinstance(scene, dict) and "layers" not in scene:
        _check_flat(scene, project)
        return
    require(
        isinstance(scene, dict)
        and {"width", "height", "grid", "layers"} <= set(scene)
        and not set(scene)
        - {"width", "height", "grid", "layers", "next_layer_id", "next_object_id"},
        "Unsupported layered scene fields",
    )
    check_dimensions(scene["width"], scene["height"], scene["grid"])
    require(type(scene["grid"]) is int and scene["grid"] in GRIDS, "Unsupported grid")
    layers = scene["layers"]
    require(isinstance(layers, list) and 1 <= len(layers) <= 128, "Use 1..128 layers")
    ids, object_ids = set(), set()
    for layer in layers:
        require(
            isinstance(layer, dict) and layer.get("type") in ("tilelayer", "objectgroup"),
            "Unsupported layer type",
        )
        payload = "cells" if layer["type"] == "tilelayer" else "objects"
        require(
            set(layer) == {"id", "name", "type", "visible", payload}, "Unsupported layer fields"
        )
        require(
            integer(layer["id"], 1, 2147483646) and layer["id"] not in ids,
            "Invalid or duplicate layer ID",
        )
        ids.add(layer["id"])
        require(
            isinstance(layer["name"], str) and 1 <= len(layer["name"].strip()) <= 100,
            "Layer name must contain 1..100 characters",
        )
        require(type(layer["visible"]) is bool, "Invalid layer visibility")
        _check_flat(_flat_layer(scene, layer), project)
        for item in layer.get("objects", []):
            require(item["id"] not in object_ids, "Duplicate sprite object ID across layers")
            object_ids.add(item["id"])
    require(
        integer(scene.get("next_layer_id", max(ids) + 1), max(ids) + 1, 2147483647),
        "Invalid next layer ID",
    )
    require(
        integer(
            scene.get("next_object_id", max(object_ids, default=0) + 1),
            max(object_ids, default=0) + 1,
            2147483647,
        ),
        "Invalid next object ID",
    )


def encode(scene, project):
    check_scene(scene, project)
    if "layers" not in scene:
        return _encode_flat(scene, project)
    result = _encode_flat(_flat_layer(scene, {}), project)
    result["layers"] = []
    for layer in scene["layers"]:
        encoded = _encode_flat(_flat_layer(scene, layer), project)
        if layer["type"] == "tilelayer":
            item = encoded["layers"][0]
        else:
            item = {
                "type": "objectgroup",
                "draworder": "index",
                "x": 0,
                "y": 0,
                "opacity": 1,
                "objects": encoded["layers"][-1].get("objects", []),
            }
        item.update({key: layer[key] for key in ("id", "name", "visible")})
        result["layers"].append(item)
    result["nextlayerid"] = scene.get(
        "next_layer_id", max(layer["id"] for layer in scene["layers"]) + 1
    )
    result["nextobjectid"] = scene.get(
        "next_object_id",
        max((obj["id"] for layer in scene["layers"] for obj in layer.get("objects", [])), default=0)
        + 1,
    )
    return result


def decode(document, project):
    require(isinstance(document, dict), "Expected a Tiled map")
    check_dimensions(document.get("width"), document.get("height"), document.get("tilewidth"))
    layers = document.get("layers")
    require(isinstance(layers, list) and 1 <= len(layers) <= 128, "Use 1..128 layers")
    decoded = []
    for layer in layers:
        require(
            isinstance(layer, dict) and layer.get("type") in ("tilelayer", "objectgroup"),
            "Unsupported layer type",
        )
        require(integer(layer.get("id"), 1, 2147483646), "Invalid layer ID")
        require(type(layer.get("visible", True)) is bool, "Invalid layer visibility")
        candidate = dict(document, nextlayerid=2)
        normalized = dict(layer, id=1, name="Ground", visible=True)
        if layer["type"] == "tilelayer":
            candidate["layers"] = [normalized]
        else:
            ground = {
                "id": 1,
                "name": "Ground",
                "type": "tilelayer",
                "x": 0,
                "y": 0,
                "width": document.get("width"),
                "height": document.get("height"),
                "data": [0] * (document.get("width", 0) * document.get("height", 0)),
            }
            normalized.update(id=2, name="Sprites")
            candidate.update(layers=[ground, normalized], nextlayerid=3)
        flat = _decode_flat(candidate, project)
        payload = "cells" if layer["type"] == "tilelayer" else "objects"
        decoded.append(
            {
                "id": layer.get("id"),
                "name": layer.get("name"),
                "type": layer["type"],
                "visible": layer.get("visible", True),
                payload: flat[payload],
            }
        )
    scene = {
        "width": document["width"],
        "height": document["height"],
        "grid": document["tilewidth"],
        "layers": decoded,
        "next_layer_id": document.get("nextlayerid", max(layer["id"] for layer in decoded) + 1),
        "next_object_id": document.get("nextobjectid", 1),
    }
    check_scene(scene, project)
    # Keep the original flat API for the original Ground/Sprites subset.
    legacy = {
        "width": scene["width"],
        "height": scene["height"],
        "grid": scene["grid"],
        "cells": decoded[0].get("cells", []),
        "objects": decoded[1].get("objects", []) if len(decoded) == 2 else [],
        "next_object_id": scene["next_object_id"],
    }
    expected = scene_layers(legacy)
    if len(decoded) == 2 and not legacy["objects"]:
        expected.append(
            {"id": 2, "name": "Sprites", "type": "objectgroup", "visible": True, "objects": []}
        )
    if expected == decoded and scene["next_layer_id"] == len(decoded) + 1:
        return legacy
    return scene
