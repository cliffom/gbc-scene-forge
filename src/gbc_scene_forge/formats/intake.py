"""Strict preflight of external Tiled JSON maps and their declared PNG dependencies."""

import json
from pathlib import PurePosixPath

from gbc_scene_forge.artwork import atlas, tilesheet
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.validation import identifier, integer, require
from gbc_scene_forge.formats import tiled


def relative(path):
    require(
        isinstance(path, str)
        and path
        and "\\" not in path
        and ":" not in path
        and all(p not in ("", ".", "..") for p in path.split("/")),
        "Dependencies must stay inside the selected folder; absolute and parent paths are unsupported",
    )
    return path


def fields(value, allowed, defaults, context):
    require(isinstance(value, dict), f"{context}: expected a JSON object")
    unknown = set(value) - set(allowed) - set(defaults)
    require(not unknown, f"{context}: unsupported fields {sorted(unknown)}; no content imported")
    for key, expected in defaults.items():
        require(value.get(key, expected) == expected, f"{context}: unsupported {key}")


def prepare(payload, document):
    require(
        isinstance(payload, dict) and set(payload) == {"map", "files", "id", "name"},
        "Expected map path, files, asset ID prefix and scene name",
    )
    prefix = payload["id"]
    require(
        identifier(prefix) and len(prefix) <= 50, "Use an asset ID prefix of at most 50 characters"
    )
    title = name(payload["name"])
    files = payload["files"]
    require(isinstance(files, dict) and 1 <= len(files) <= 65, "Select at most 65 dependency files")
    require(all(relative(p) for p in files), "Invalid dependency path")
    require(
        all(isinstance(v, str) for v in files.values())
        and sum(len(v) for v in files.values()) <= 7 * 1024 * 1024,
        "Selected dependencies exceed 7 MiB encoded",
    )
    dependencies = []

    def read(path, kind):
        relative(path)
        require(path in files, f"Missing dependency: {path}")
        if path not in dependencies:
            dependencies.append(path)
        if kind == "json":
            require(len(files[path]) <= 1024 * 1024, f"JSON exceeds 1 MiB: {path}")
            value = json.loads(files[path])
            require(isinstance(value, dict), f"Expected JSON object: {path}")
            return value
        require(path.lower().endswith(".png"), "Only PNG sheet images are supported")
        return files[path]

    path = relative(payload["map"])
    source = read(path, "json")
    fields(
        source,
        {
            "type",
            "version",
            "tiledversion",
            "width",
            "height",
            "tilewidth",
            "tileheight",
            "layers",
            "tilesets",
            "nextlayerid",
            "nextobjectid",
        },
        {
            "orientation": "orthogonal",
            "renderorder": "right-down",
            "infinite": False,
            "compressionlevel": -1,
            "properties": [],
            "class": "",
            "parallaxoriginx": 0,
            "parallaxoriginy": 0,
        },
        "Map",
    )
    require(source.get("type", "map") == "map", "Expected a Tiled map")
    width, height, grid = (source.get(k) for k in ("width", "height", "tilewidth"))
    require(integer(width, 1, 256) and integer(height, 1, 256), "Map dimensions must be 1..256")
    require(
        type(grid) is int and grid in (8, 16, 32) and source.get("tileheight") == grid,
        "Only square 8, 16 or 32 px tiles are supported",
    )
    references = source.get("tilesets")
    require(isinstance(references, list) and 1 <= len(references) <= 16, "Use 1..16 tilesets")
    entries, changes, gids = {}, {}, {0: ""}
    for index, reference in enumerate(references):
        require(isinstance(reference, dict), "Invalid tileset reference")
        first = reference.get("firstgid")
        require(integer(first, 1, 0x0FFFFFFF), "Invalid firstgid")
        base = PurePosixPath(path).parent
        if "source" in reference:
            fields(reference, {"firstgid", "source"}, {}, "Tileset reference")
            dependency = relative(reference["source"])
            ts_path = str(base / dependency)
            ts = read(ts_path, "json")
            base = PurePosixPath(ts_path).parent
        else:
            ts = {k: v for k, v in reference.items() if k != "firstgid"}
        fields(
            ts,
            {
                "type",
                "version",
                "tiledversion",
                "name",
                "tilewidth",
                "tileheight",
                "image",
                "imagewidth",
                "imageheight",
                "columns",
                "tilecount",
                "margin",
                "spacing",
            },
            {
                "properties": [],
                "class": "",
                "tiles": [],
                "wangsets": [],
                "terrains": [],
                "tileoffset": {"x": 0, "y": 0},
                "objectalignment": "unspecified",
            },
            "Tileset",
        )
        require(ts.get("type", "tileset") == "tileset", "Expected a Tiled tileset")
        require(
            ts.get("tilewidth") == grid and ts.get("tileheight") == grid,
            "Tileset and map grids must match",
        )
        image_path = str(base / relative(ts.get("image")))
        atlas_id = f"{prefix}_{index + 1}"
        require(atlas_id not in document["atlases"], f"Asset ID already exists: {atlas_id}")
        bundle = tilesheet.bundle(
            {
                "id": atlas_id,
                "png": read(image_path, "png"),
                "grid": grid,
                "margin": ts.get("margin", 0),
                "spacing": ts.get("spacing", 0),
            }
        )
        manifest, image, image_width, pixels = bundle
        image_height = len(pixels) // (image_width * 4)
        columns = sum(r["y"] == manifest["regions"][0]["y"] for r in manifest["regions"])
        require(
            ts.get("imagewidth", image_width) == image_width
            and ts.get("imageheight", image_height) == image_height
            and ts.get("columns") == columns
            and ts.get("tilecount") == len(manifest["regions"]),
            "Tileset dimensions/count differ from PNG",
        )
        entry, assets = atlas.build_assets(*bundle)
        entries[atlas_id] = entry
        changes.update(assets)
        for local, region in enumerate(manifest["regions"]):
            gid = first + local
            require(gid <= 0x0FFFFFFF and gid not in gids, "Overlapping or invalid GID ranges")
            gids[gid] = f"{atlas_id}/{region['name']}/0/0"
    layers = source.get("layers")
    require(isinstance(layers, list) and 1 <= len(layers) <= 128, "Use 1..128 tile layers")
    converted = []
    for layer in layers:
        fields(
            layer,
            {"id", "name", "type", "width", "height", "data", "visible"},
            {
                "x": 0,
                "y": 0,
                "offsetx": 0,
                "offsety": 0,
                "opacity": 1,
                "parallaxx": 1,
                "parallaxy": 1,
                "properties": [],
                "class": "",
                "encoding": "csv",
                "compression": "",
                "locked": False,
                "mode": "normal",
            },
            "Layer",
        )
        require(layer.get("type") == "tilelayer", "Only tile layers are supported")
        require(
            layer.get("width") == width and layer.get("height") == height,
            "Layer dimensions must match the map",
        )
        data = layer.get("data")
        require(
            isinstance(data, list)
            and len(data) == width * height
            and all(
                integer(g, 0, 0xFFFFFFFF)
                and not g & 0x10000000
                and (g & 0x0FFFFFFF) in gids
                and (g == 0 or g & 0x0FFFFFFF)
                for g in data
            ),
            "Invalid, missing or unsupported tile GIDs",
        )
        converted.append(
            {
                "id": layer.get("id"),
                "name": layer.get("name"),
                "type": "tilelayer",
                "visible": layer.get("visible", True),
                "cells": [
                    [tiled.gid_cell(g, gids) for g in data[y * width : (y + 1) * width]]
                    for y in range(height)
                ],
            }
        )
    scene = {
        "width": width,
        "height": height,
        "grid": grid,
        "layers": converted,
        "next_object_id": source.get("nextobjectid", 1),
        "next_layer_id": source.get("nextlayerid", max(layer["id"] for layer in converted) + 1),
    }
    candidate = {**document, "atlases": {**document["atlases"], **entries}}
    tiled.check_scene(scene, candidate)
    return title, scene, entries, changes, dependencies
