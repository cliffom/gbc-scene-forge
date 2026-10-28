"""Create a portable, editable standalone sample using original MIT-licensed pixel art."""

import argparse
import tempfile
from pathlib import Path

from . import png, preview_settings
from .documents import json_text
from .projects import MANIFEST, Project
from .standalone import serve

# Four-color RGB5 palettes and eight-pixel patterns are original project artwork.
PALETTES = [
    [[5, 10, 7], [11, 17, 8], [17, 23, 12], [26, 28, 18]],
    [[9, 8, 6], [17, 13, 9], [24, 20, 13], [29, 26, 18]],
    [[3, 8, 14], [5, 13, 20], [9, 19, 25], [18, 26, 28]],
    [[7, 8, 10], [13, 15, 16], [20, 22, 21], [28, 28, 24]],
    [[8, 5, 6], [15, 7, 7], [23, 11, 8], [29, 19, 11]],
    [[2, 3, 5], [6, 10, 16], [13, 21, 25], [30, 25, 17]],
]
TILES = [
    ("grass", 0, "11111111 11211111 12111121 11111111 11112111 11121111 11111112 11111121".split()),
    ("path", 1, "22222222 22212222 22222222 22222322 22222222 21222222 22222222 22222232".split()),
    ("water", 2, "11111111 11222111 11111111 11111111 22111112 11111111 11111221 11111111".split()),
    ("stone", 3, "01111110 12322221 12222221 12222221 01111110 22112222 22112232 11001111".split()),
    ("wall", 1, "33333333 22222222 21222212 21222212 22222222 33333333 11111111 22222222".split()),
    ("roof", 4, "11111111 22232223 22222222 00000000 11111111 23222322 22222222 00000000".split()),
    (
        "flowers",
        0,
        "11111111 11311111 13331111 11311111 11111131 11111333 11111131 11111111".split(),
    ),
    ("dirt", 1, "11111111 11211111 11111111 11111211 11111111 12111111 11111111 11111121".split()),
    (
        "ripple",
        2,
        "11111111 11111111 11122321 11111111 11111111 12221111 11111111 11111111".split(),
    ),
    ("wood", 1, "12221222 12221222 12221222 12221222 11111111 22212221 22212221 22212221".split()),
    (
        "window",
        1,
        "22222222 20000002 20303002 20303002 20000002 20303002 20000002 22222222".split(),
    ),
    ("door", 1, "20000002 20111102 20111102 20111102 20113102 20111102 20111102 20111102".split()),
]
HERO = (
    "........ ..1111.. .122221. .111111. .133331. ..3333.. ..1221.. .122221. "
    "31222213 31222213 ..2222.. ..1111.. ..1..1.. ..1..1.. .11..11. ........"
).split()


def _bundle(folder):
    pixels = bytearray(64 * 16 * 4)
    regions, assignments = [], [0] * 16

    def draw(x, y, rows, palette):
        colors = [bytes([*((v * 255 + 15) // 31 for v in c), 255]) for c in PALETTES[palette]]
        for dy, row in enumerate(rows):
            for dx, value in enumerate(row):
                offset = ((y + dy) * 64 + x + dx) * 4
                pixels[offset : offset + 4] = bytes(4) if value == "." else colors[int(value)]

    for index, (name, palette, rows) in enumerate(TILES):
        x, y = (index % 6) * 8, (index // 6) * 8
        draw(x, y, rows, palette)
        assignments[y // 8 * 8 + x // 8] = palette
        regions.append({"name": name, "kind": "tile", "x": x, "y": y, "width": 8, "height": 8})
    for index, name in enumerate(("hero_idle", "hero_step")):
        x = 48 + index * 8
        rows = HERO if index == 0 else [*HERO[:12], ".11..1..", ".....11.", "........", "........"]
        draw(x, 0, rows, 5)
        assignments[x // 8] = assignments[8 + x // 8] = 5
        regions.append(
            {
                "name": name,
                "kind": "sprite",
                "x": x,
                "y": 0,
                "width": 8,
                "height": 16,
                "origin": [4, 14],
                "duration_ms": 160,
            }
        )
    manifest = {
        "version": 1,
        "id": "sample",
        "png": "sample.png",
        "palettes": PALETTES,
        "cell_palettes": assignments,
        "regions": regions,
        "animations": [
            {"name": "idle", "frames": [{"region": "hero_idle", "duration_ms": 400}]},
            {
                "name": "walk",
                "frames": [
                    {"region": "hero_step", "duration_ms": 160},
                    {"region": "hero_idle", "duration_ms": 160},
                ],
            },
        ],
    }
    path = folder / "sample.atlas.json"
    path.write_text(json_text(manifest))
    (folder / "sample.png").write_bytes(png.encode(64, 16, bytes(pixels)))
    return path


def _scene(project, title, courtyard=False):
    def tile(name):
        return f"sample/{name}/0/0"

    width, height = 28, 20
    ground = [[tile("grass") for _ in range(width)] for _ in range(height)]
    detail = [["" for _ in range(width)] for _ in range(height)]
    for y in range(height):
        for x in range(width):
            if 13 <= x <= 15 or 13 <= y <= 15:
                ground[y][x] = tile("path")
            elif (x * 17 + y * 13) % 29 == 0:
                ground[y][x] = tile("flowers")
            if x in (0, width - 1) or y in (0, height - 1):
                ground[y][x] = tile("stone")
            if 3 <= x <= 9 and 3 <= y <= 8:
                ground[y][x] = tile(
                    "wood" if courtyard else "ripple" if (x + y) % 3 == 0 else "water"
                )
            if 18 <= x <= 24 and 4 <= y <= 9:
                detail[y][x] = tile("roof" if y <= 5 else "wall")
    detail[7][19] = detail[7][23] = tile("window")
    detail[8][21] = detail[9][21] = tile("door")
    for y in range(10, 14):
        ground[y][21] = tile("path")
    loaded = project.create_scene(title, width, height, 8, project.catalog()["revision"])
    scene = {
        "width": width,
        "height": height,
        "grid": 8,
        "next_layer_id": 4,
        "next_object_id": 4,
        "layers": [
            {"id": 1, "name": "Ground", "type": "tilelayer", "visible": True, "cells": ground},
            {"id": 2, "name": "Cottage", "type": "tilelayer", "visible": True, "cells": detail},
            {
                "id": 3,
                "name": "Characters and markers",
                "type": "objectgroup",
                "visible": True,
                "objects": [
                    {"id": 1, "asset": "sample/hero_idle", "x": 116, "y": 112, "name": "Explorer"},
                    {
                        "id": 2,
                        "kind": "point",
                        "x": 116,
                        "y": 136,
                        "name": "Arrival",
                        "class": "Spawn",
                        "properties": [{"name": "direction", "type": "string", "value": "up"}],
                    },
                    {
                        "id": 3,
                        "kind": "rectangle",
                        "x": 168,
                        "y": 72,
                        "width": 8,
                        "height": 8,
                        "name": "Cottage entrance",
                        "class": "Trigger",
                        "properties": [],
                    },
                ],
            },
        ],
    }
    project.save_scene(loaded["id"], scene, loaded["revision"], project.catalog()["revision"])


def prepare(root):
    """Seed a new/empty folder atomically; reopening never rewrites user edits."""
    root = Path(root).absolute()
    if (root / MANIFEST).exists():
        return Project(root)
    Project.prepare_creation(root)
    root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".forge-sample-", dir=root.parent) as folder:
        staging = Path(folder)
        project = Project.create(staging / "project", "Scene Forge demo")
        project.import_atlas(_bundle(staging), project.catalog()["revision"])
        for name, terrain, solid in (
            ("grass", "grass", False),
            ("flowers", "grass", False),
            ("path", "path", False),
            ("water", "water", True),
            ("ripple", "water", True),
            ("stone", "stone", True),
            ("wall", "wall", True),
            ("roof", "roof", True),
        ):
            project.save_tile_metadata(
                "sample",
                "8",
                f"sample/{name}/0/0",
                {"terrain": terrain, "solid": solid, "shapes": [], "next_shape_id": 1},
                project.catalog()["revision"],
            )
        _scene(project, "Riverside")
        _scene(project, "Courtyard", courtyard=True)
        settings = preview_settings.defaults()
        settings["check_collisions"] = True
        settings["footprint"] = {"x": -3, "y": -3, "width": 6, "height": 3}
        settings["mappings"] = {
            "sample/hero_idle": {
                f"{action}:{direction}": action
                for action in preview_settings.ACTIONS
                for direction in preview_settings.DIRECTIONS
            }
        }
        project.save_preview_settings(settings, project.catalog()["revision"])
        # Check again after building, so another process's project is never replaced.
        Project.prepare_creation(root)
        project.root.rename(root)
    return Project(root)


def main():
    parser = argparse.ArgumentParser(description="Create or reopen the standalone sample project")
    parser.add_argument("--root", type=Path, default=Path(".demo"))
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    try:
        project = prepare(args.root)
        print(f"Demo project: {project.root}", flush=True)
        print(
            "Choose Riverside or Courtyard, then Open scene. Saved edits survive restarts.",
            flush=True,
        )
        serve(project.root, args.port, single_project=True)
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
