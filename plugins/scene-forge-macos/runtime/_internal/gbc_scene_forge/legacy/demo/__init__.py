"""Explicit opt-in demo connector; all mutable files belong to its own workspace."""

import base64
import hashlib
import io
import json
import struct
import sys
import zipfile
import zlib
from pathlib import Path

from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.legacy.contract import BuildPlan, CheckStep, Workspace
from gbc_scene_forge.legacy.documents import check_document, encode_document
from gbc_scene_forge.storage.paths import safe_path
from gbc_scene_forge.storage.transactions import Transactions

SCENES = {"village": "Village square", "river": "Riverside crossing"}
TILES = {
    "grass": (111, 153, 80),
    "path": (211, 188, 134),
    "water": (72, 133, 173),
    "tree": (47, 94, 62),
    "flowers": (192, 137, 155),
    "roof": (164, 79, 63),
    "wall": (190, 179, 145),
    "door": (98, 69, 49),
    "bridge": (151, 110, 67),
}
SOLID = {"water", "tree", "roof", "wall"}
CELL_SIZE = 8
WIDTH, HEIGHT = 16, 12


def png(width, height, pixel):
    """Encode small RGB previews using only the standard library."""

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    raw = b"".join(
        b"\0" + b"".join(bytes(pixel(x, y)) for x in range(width)) for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def tile_pixel(tile, x, y, light="day"):
    color = TILES[tile]
    # Small repeating details keep tile boundaries legible without an image dependency.
    shade = 0.82 if (x + y * 3) % 7 == 0 else 1
    if tile in {"roof", "wall", "bridge"} and y % 4 == 0:
        shade = 0.7
    if tile == "water" and y % 4 == 1 and x % 4 < 3:
        shade = 1.2
    if tile == "tree" and (x in (0, 7) or y in (0, 7)):
        color = TILES["grass"]
    if tile == "flowers" and (x, y) not in {(2, 2), (3, 2), (5, 5), (5, 4)}:
        color = TILES["grass"]
    factors = (0.55, 0.65, 0.85) if light == "night" else (1, 1, 1)
    return tuple(min(255, int(c * shade * factor)) for c, factor in zip(color, factors))


class DemoConnector:
    identity = "scene-forge-demo"
    contract_version = 1

    def __init__(self, root):
        root = Path(root).absolute()
        self.workspace = Workspace(root, root / "drafts", history="history", reviews="reviews")
        # Recover interrupted promotion before deciding whether seed files are missing.
        Transactions(root, self.workspace.history).recover()
        for target in SCENES:
            path = self.source_path(target)
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                path.write_bytes((Path(__file__).parent / "scenes" / f"{target}.json").read_bytes())

    def source_path(self, target, root=None):
        if target not in SCENES:
            raise ValueError("Unknown demo scene")
        return safe_path(root if root is not None else self.workspace.root, f"levels/{target}.json")

    def catalog(self):
        return {
            "contract_version": self.contract_version,
            "connector": self.identity,
            "project": {
                "name": "SCENE FORGE DEMO",
                "label": "Demo workshop",
                "source_label": "DEMO PREVIEW",
            },
            "capabilities": {"apply": True, "export": True, "templates": True, "references": False},
            "profiles": {
                target: {
                    "label": label,
                    "type": "grid",
                    "width": WIDTH,
                    "height": HEIGHT,
                    "cell_size": CELL_SIZE,
                    "erase_cell": "grass",
                    "lighting": ["day", "night"],
                    "states": [{"id": "standard", "label": "Standard"}],
                    "animation_frames": 0,
                    "guide": None,
                }
                for target, label in SCENES.items()
            },
            "families": [{"id": "terrain", "url": "/art/terrain", "regions": []}],
            "entries": [
                {
                    "id": tile,
                    "label": tile.title(),
                    "family": "terrain",
                    "profiles": list(SCENES),
                    "rect": {"x": i * CELL_SIZE, "y": 0, "width": CELL_SIZE, "height": CELL_SIZE},
                }
                for i, tile in enumerate(TILES)
            ],
        }

    def source_revision(self, target):
        return hashlib.sha256(self.source_path(target).read_bytes()).hexdigest()

    def load(self, target, *, template=False):
        data = json.loads(self.source_path(target).read_text())
        cells = [["grass"] * WIDTH for _ in range(HEIGHT)] if template else data["cells"]
        return {
            "scene": {
                "version": 1,
                "connector": self.identity,
                "id": target,
                "name": data["name"],
                "profile": target,
                "source_digest": self.source_revision(target),
                "width": WIDTH,
                "height": HEIGHT,
                "cells": cells,
                "references": [],
            },
            "locked": [],
            "constraints": [],
            "markers": [],
            "revision": None,
        }

    def normalize(self, scene):
        scene = dict(scene)
        scene.setdefault("connector", self.identity)
        self.check_shape(scene)
        return scene

    def check_shape(self, scene):
        check_document(scene)
        if scene["connector"] != self.identity or scene["profile"] not in SCENES:
            raise ValueError("Scene belongs to another connector or target")
        if (scene["width"], scene["height"]) != (WIDTH, HEIGHT):
            raise ValueError("Demo scenes must be 16 by 12 cells")
        if any(cell not in TILES for row in scene["cells"] for cell in row):
            raise ValueError("Unknown demo tile")
        if scene["references"]:
            raise ValueError("Demo scenes do not support composition references")

    def compare(self, scene):
        current = self.load(scene["profile"])["scene"]
        return {
            "differs": scene["cells"] != current["cells"],
            "source_revision": current["source_digest"],
        }

    def validate(self, scene):
        self.check_shape(scene)
        issues = []
        if scene["source_digest"] != self.source_revision(scene["profile"]):
            issues.append(
                {"code": "stale_source", "message": "Demo sources changed; reload the scene"}
            )
        return {
            "valid": not issues,
            "errors": [issue["message"] for issue in issues],
            "warnings": [],
            "issues": issues,
        }

    def preview(self, scene, light=None, state=None, frame=0):
        self.check_shape(scene)
        image = png(
            WIDTH * CELL_SIZE,
            HEIGHT * CELL_SIZE,
            lambda x, y: tile_pixel(
                scene["cells"][y // CELL_SIZE][x // CELL_SIZE],
                x % CELL_SIZE,
                y % CELL_SIZE,
                light or "day",
            ),
        )
        return {
            "png": "data:image/png;base64," + base64.b64encode(image).decode(),
            "collision": [[tile in SOLID for tile in row] for row in scene["cells"]],
            "comparison": self.compare(scene),
        }

    def asset(self, name):
        if name != "terrain":
            raise ValueError("Unknown demo image")
        tiles = list(TILES)
        return png(
            len(tiles) * CELL_SIZE,
            CELL_SIZE,
            lambda x, y: tile_pixel(tiles[x // CELL_SIZE], x % CELL_SIZE, y),
        )

    def export(self, scene):
        self.check_shape(scene)
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("scene.json", json_text(encode_document(scene)))
        return output.getvalue()

    def input_files(self, root):
        return [f"levels/{target}.json" for target in SCENES]

    def output_files(self, root):
        return tuple(f"compiled/{target}.bin" for target in SCENES)

    def prepare(self, scene, stage, review_id):
        result = self.validate(scene)
        if not result["valid"]:
            raise ValueError("; ".join(result["errors"]))
        current = self.load(scene["profile"])["scene"]
        changed = sum(
            a != b for old, new in zip(current["cells"], scene["cells"]) for a, b in zip(old, new)
        )
        if not changed:
            raise ValueError("No demo changes to apply")
        target = scene["profile"]
        self.source_path(target, stage).write_text(
            json_text({"name": SCENES[target], "cells": scene["cells"]})
        )
        # Compile the declared JSON inputs to tile indexes inside the candidate workspace.
        code = (
            "import json; from pathlib import Path; "
            f"tiles = {list(TILES)!r}; targets = {list(SCENES)!r}; "
            "Path('compiled').mkdir(exist_ok=True); "
            "[(Path('compiled') / (target + '.bin')).write_bytes(bytes(tiles.index(cell) "
            "for row in json.loads((Path('levels') / (target + '.json')).read_text())['cells'] "
            "for cell in row)) for target in targets]; print('Demo scenes compiled')"
        )
        return BuildPlan(
            sources=(f"levels/{target}.json",),
            outputs=self.output_files(stage),
            artifacts=self.output_files(stage),
            checks=(CheckStep("Compile demo scenes", (sys.executable, "-c", code)),),
            review={
                "target": SCENES[target],
                "changed_cells": changed,
                "note": "Updates only the local demo workspace.",
                "views": [
                    {
                        "label": light.title(),
                        "before": self.preview(current, light)["png"],
                        "after": self.preview(scene, light)["png"],
                    }
                    for light in ("day", "night")
                ],
            },
            message="Demo scene updated. Undo Apply restores the previous version.",
        )

    def approve(self, plan, stage, review_id):
        pass

    def refresh(self):
        pass

    def activity(self, text, fallback):
        return text.strip().splitlines()[-1] if text.strip() else fallback
