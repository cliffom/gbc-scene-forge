"""Optional interoperability check against official Tiled executables."""

import argparse
import io
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge import png, tiled
from gbc_scene_forge.projects import Project

parser = argparse.ArgumentParser()
parser.add_argument("--tiled", required=True, help="Official Tiled executable")
parser.add_argument("--rasterizer", required=True, help="Official tmxrasterizer executable")
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix="forge-tiled-") as folder:
    root = Path(folder)
    project = Project.create(root / "world", "Tiled interoperability")
    source, _ = bundle(root / "input")
    project.import_atlas(source, project.catalog()["revision"])
    source, _ = sprite_bundle(root / "sprites")
    project.import_atlas(source, project.catalog()["revision"])
    loaded = project.create_scene("Village", 7, 5, 8, project.catalog()["revision"])
    loaded["scene"]["cells"][1][1] = "terrain/earth/0/0"
    loaded["scene"]["objects"] = [{"id": 1, "asset": "actors/idle", "x": 32, "y": 24}]
    loaded["scene"]["next_object_id"] = 2
    saved = project.save_scene(
        loaded["id"], loaded["scene"], loaded["revision"], project.catalog()["revision"]
    )
    terrain = {
        "terrain": "water",
        "solid": True,
        "next_shape_id": 8,
        "shapes": [
            {"id": 1, "kind": "rectangle", "x": 0, "y": 4, "width": 8, "height": 4},
            {"id": 2, "kind": "ellipse", "x": 1, "y": 0, "width": 6, "height": 8},
            {"id": 7, "kind": "polygon", "points": [[0, 8], [8, 8], [8, 0]]},
        ],
    }
    project.save_tile_metadata(
        "terrain", "8", "terrain/earth/0/0", terrain, project.catalog()["revision"]
    )
    project.save_tile_metadata(
        "actors",
        "sprites",
        "actors/idle",
        {"terrain": "actor", "solid": True, "shapes": [], "next_shape_id": 1},
        project.catalog()["revision"],
    )
    for relative, terrain_name in (
        ("terrain/grid-8.tsj", "water"),
        ("actors/sprites.tsj", "actor"),
    ):
        tileset = project.root / "assets" / relative
        tileset_export = tileset.with_name("roundtrip-" + tileset.name)
        subprocess.run(
            [args.tiled, "--export-tileset", "json", str(tileset), str(tileset_export)],
            check=True,
            timeout=30,
        )
        tile = json.loads(tileset_export.read_bytes())["tiles"][0]
        props = {p["name"]: (p["type"], p["value"]) for p in tile["properties"]}
        assert props["forge:terrain"] == ("string", terrain_name)
        assert props["forge:solid"] == ("bool", True)
        shapes = tile["objectgroup"]["objects"]
        if terrain_name == "water":
            assert props["forge:next_shape_id"] == ("int", 8)
            assert [shape["id"] for shape in shapes] == [1, 2, 7]
            assert (shapes[0]["x"], shapes[0]["y"], shapes[0]["width"], shapes[0]["height"]) == (
                0,
                4,
                8,
                4,
            )
            assert shapes[1]["ellipse"] is True
            assert shapes[2]["polygon"] == [{"x": 0, "y": 8}, {"x": 8, "y": 8}, {"x": 8, "y": 0}]
        else:
            assert (shapes[0]["width"], shapes[0]["height"]) == (16, 32)
    path = project.root / "scenes" / f"{loaded['id']}.tmj"
    exported = path.with_name("roundtrip.tmj")
    rendered = root / "rendered.png"
    subprocess.run(
        [args.tiled, "--export-map", "json", str(path), str(exported)], check=True, timeout=30
    )
    assert (
        tiled.decode(json.loads(exported.read_bytes()), project.catalog()["project"])
        == saved["scene"]
    )
    subprocess.run(
        [args.rasterizer, "--no-smoothing", str(path), str(rendered)], check=True, timeout=30
    )
    width, height, pixels = png.decode(rendered.read_bytes())
    assert (width, height) == (56, 40)
    assert pixels[(12 * width + 12) * 4 : (12 * width + 12) * 4 + 4] == bytes([0, 0, 0, 255])
    assert pixels[:4] == bytes([0, 0, 0, 0])
    assert pixels[(5 * width + 28) * 4 : (5 * width + 28) * 4 + 4] == bytes([255, 255, 255, 255])
    # Interleave objects and tile layers; keep hidden and empty layers with stable IDs.
    layered = {
        "width": 7,
        "height": 5,
        "grid": 8,
        "next_layer_id": 15,
        "next_object_id": 10,
        "layers": [
            {
                "id": 4,
                "name": "Actors behind",
                "type": "objectgroup",
                "visible": True,
                "objects": [{"id": 1, "asset": "actors/idle", "x": 32, "y": 24}],
            },
            {
                "id": 7,
                "name": "Foreground",
                "type": "tilelayer",
                "visible": True,
                "cells": saved["scene"]["cells"],
            },
            {
                "id": 9,
                "name": "Hidden actors",
                "type": "objectgroup",
                "visible": False,
                "objects": [
                    {
                        "id": 2,
                        "asset": "actors/idle",
                        "x": 16,
                        "y": 24,
                        "name": "Guard",
                        "class": "npc",
                        "origin": [4, 16],
                        "properties": [{"name": "dialogue", "type": "string", "value": "Hello"}],
                    }
                ],
            },
            {
                "id": 12,
                "name": "Hidden tiles",
                "type": "tilelayer",
                "visible": False,
                "cells": [["terrain/earth/0/0"] * 7 for _ in range(5)],
            },
            {
                "id": 14,
                "name": "Markers",
                "type": "objectgroup",
                "visible": True,
                "objects": [
                    {
                        "id": 8,
                        "kind": "point",
                        "name": "Entry",
                        "class": "spawn",
                        "x": 8,
                        "y": 8,
                        "properties": [
                            {"name": "enabled", "type": "bool", "value": False},
                            {"name": "facing", "type": "string", "value": ""},
                            {"name": "index", "type": "int", "value": 2},
                            {"name": "speed", "type": "float", "value": 1.25},
                            {"name": "weight", "type": "float", "value": 2.0},
                        ],
                    },
                    {
                        "id": 9,
                        "kind": "rectangle",
                        "name": "Door",
                        "class": "trigger",
                        "x": 40,
                        "y": 24,
                        "width": 16,
                        "height": 16,
                    },
                ],
            },
        ],
    }
    # Cover a known opaque sprite pixel with an opaque tile.
    layered["layers"][1]["cells"][0][3] = "terrain/earth/0/0"
    project.save_scene(loaded["id"], layered, saved["revision"], project.catalog()["revision"])
    subprocess.run(
        [args.tiled, "--export-map", "json", str(path), str(exported)], check=True, timeout=30
    )
    assert tiled.decode(json.loads(exported.read_bytes()), project.catalog()["project"]) == layered
    subprocess.run(
        [args.rasterizer, "--no-smoothing", str(path), str(rendered)], check=True, timeout=30
    )
    width, height, pixels = png.decode(rendered.read_bytes())
    assert pixels[(5 * width + 28) * 4 : (5 * width + 28) * 4 + 4] == bytes([0, 0, 0, 255])
    assert pixels[:4] == bytes([0, 0, 0, 0])
    assert pixels[(39 * width) * 4 : (39 * width) * 4 + 4] == bytes([0, 0, 0, 0])
    # Verify real ZIP output after extraction, relocation and removal of all sources.
    project.create_scene("Other", 4, 4, 16, project.catalog()["revision"])
    project_document = project.catalog()["project"]
    exports = []
    for scope in ("scene", "project"):
        kwargs = {"scene_id": loaded["id"]} if scope == "scene" else {}
        payload, _ = project.export_bundle(scope, project.catalog()["revision"], **kwargs)
        assert payload == project.export_bundle(scope, project.catalog()["revision"], **kwargs)[0]
        destination = root / f"export-{scope}"
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            archive.extractall(destination)
        moved = root / f"moved-{scope}"
        destination.rename(moved)
        exports.append((scope, moved))
    shutil.rmtree(project.root)
    shutil.rmtree(root / "input")
    shutil.rmtree(root / "sprites")
    for scope, moved in exports:
        path = moved / "scenes" / f"{loaded['id']}.tmj"
        exported = path.with_name("tiled-roundtrip.tmj")
        subprocess.run(
            [args.tiled, "--export-map", "json", str(path), str(exported)], check=True, timeout=30
        )
        assert tiled.decode(json.loads(exported.read_bytes()), project_document) == layered
        embedded = path.with_name("embedded.tmj")
        subprocess.run(
            [args.tiled, "--embed-tilesets", "--export-map", "json", str(path), str(embedded)],
            check=True,
            timeout=30,
        )
        tilesets = {s["name"]: s for s in json.loads(embedded.read_bytes())["tilesets"]}
        tile = tilesets["terrain"]["tiles"][0]
        assert {p["name"]: p["value"] for p in tile["properties"]}["forge:terrain"] == "water"
        assert len(tile["objectgroup"]["objects"]) == 3
        assert tile["animation"] == [{"tileid": 0, "duration": 100}, {"tileid": 1, "duration": 200}]
        assert tilesets["actors sprites"]["tiles"][0]["animation"] == [
            {"tileid": 0, "duration": 120}
        ]
        assert tilesets["actors sprites"]["tiles"][0]["objectgroup"]["objects"][0]["height"] == 32
        rendered = moved / "rendered.png"
        subprocess.run(
            [args.rasterizer, "--no-smoothing", str(path), str(rendered)], check=True, timeout=30
        )
        width, height, pixels = png.decode(rendered.read_bytes())
        assert (width, height) == (56, 40)
        assert pixels[(5 * width + 28) * 4 : (5 * width + 28) * 4 + 4] == bytes([0, 0, 0, 255])
        assert pixels[:4] == bytes([0, 0, 0, 0])
        if scope == "project":
            reopened = Project(moved)
            assert reopened.load_scene(loaded["id"])["scene"] == layered

print(
    "Official Tiled verified moved scene/project ZIP exports, animation frame order/timing, object/property/origin and terrain/collision data, and rasterized layers."
)
