"""Optional interoperability check against official Tiled executables."""

import argparse
import json
import subprocess
import tempfile
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
print("Official Tiled map export/reopen and rasterized tile/empty pixels passed.")
