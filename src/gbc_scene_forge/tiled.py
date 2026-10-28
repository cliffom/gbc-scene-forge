"""Strict Tiled ground layer and native-size sprite objects with semantic references."""

import math
from pathlib import PurePosixPath

from .atlas import GRIDS, integer, require, sprite_mapping

EMPTY = ""


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


def check_scene(scene, project):
    require(
        isinstance(scene, dict)
        and {"width", "height", "grid", "cells"} <= set(scene)
        and not set(scene) - {"width", "height", "grid", "cells", "objects", "next_object_id"},
        "Unsupported scene fields",
    )
    require(
        integer(scene["width"], 1, 256) and integer(scene["height"], 1, 256),
        "Scene dimensions must be within 1..256",
    )
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
            and all(isinstance(cell, str) and cell in valid for cell in row)
            for row in cells
        ),
        "Invalid scene cells or unknown asset reference",
    )
    objects = scene.get("objects", [])
    require(isinstance(objects, list) and len(objects) <= 4096, "Invalid sprite objects")
    seen = set()
    for item in objects:
        require(
            isinstance(item, dict) and set(item) == {"id", "asset", "x", "y"},
            "Unsupported sprite object fields",
        )
        require(
            integer(item["id"], 1, 2147483646) and item["id"] not in seen,
            "Invalid or duplicate sprite object ID",
        )
        seen.add(item["id"])
        require(isinstance(item["asset"], str) and item["asset"] in sprites, "Unknown sprite asset")
        require(
            integer(item["x"], 0, scene["width"] * scene["grid"] - 1)
            and integer(item["y"], 0, scene["height"] * scene["grid"] - 1),
            "Sprite origin must be inside the scene",
        )
    require(
        integer(
            scene.get("next_object_id", max(seen, default=0) + 1),
            max(seen, default=0) + 1,
            2147483647,
        ),
        "Invalid next sprite object ID",
    )


def encode(scene, project):
    check_scene(scene, project)
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
            "data": [gids[cell] for row in scene["cells"] for cell in row],
        }
    ]
    regions, objects = sprite_regions(project), []
    for item in scene.get("objects", []):
        region = regions[item["asset"]]
        ox, oy = region.get("origin", [0, 0])
        objects.append(
            {
                "id": item["id"],
                "name": "",
                "type": "",
                "gid": gids[item["asset"]],
                "x": item["x"] - ox,
                "y": item["y"] - oy + region["height"],
                "width": region["width"],
                "height": region["height"],
                "rotation": 0,
                "visible": True,
                "opacity": 1,
            }
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


def whole_pixel(value):
    return type(value) in (int, float) and math.isfinite(value) and int(value) == value


def decode(document, project):
    require(isinstance(document, dict), "Expected a Tiled map")
    allowed = set(encode({"width": 1, "height": 1, "grid": 8, "cells": [[EMPTY]]}, project))
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
    require(integer(width, 1, 256) and integer(height, 1, 256), "Invalid Tiled dimensions")
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
        and all(type(gid) is int and gid in gids and gids[gid] not in sprites for gid in data),
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
            require(
                isinstance(item, dict)
                and not set(item)
                - {
                    "id",
                    "name",
                    "type",
                    "gid",
                    "x",
                    "y",
                    "width",
                    "height",
                    "rotation",
                    "visible",
                    "opacity",
                },
                "Unsupported sprite object fields",
            )
            gid = item.get("gid")
            require(
                type(gid) is int and gid in gids and gids[gid] in sprites,
                "Unknown or transformed sprite GID",
            )
            region = sprites[gids[gid]]
            require(
                item.get("rotation", 0) == 0
                and item.get("opacity", 1) == 1
                and item.get("visible", True) is True
                and item.get("width") == region["width"]
                and item.get("height") == region["height"]
                and not item.get("name")
                and not item.get("type")
                and whole_pixel(item.get("x"))
                and whole_pixel(item.get("y")),
                "Only unscaled, unrotated sprites at whole pixels are supported",
            )
            ox, oy = region.get("origin", [0, 0])
            objects.append(
                {
                    "id": item.get("id"),
                    "asset": gids[gid],
                    "x": int(item["x"]) + ox,
                    "y": int(item["y"]) + oy - region["height"],
                }
            )
    scene = {
        "width": width,
        "height": height,
        "grid": size,
        "cells": [[gids[gid] for gid in data[y * width : (y + 1) * width]] for y in range(height)],
        "objects": objects,
        "next_object_id": document.get("nextobjectid", 1),
    }
    check_scene(scene, project)
    return scene
