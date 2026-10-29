"""Start a disposable standalone workspace with a neighboring independent atlas input."""

import argparse
from pathlib import Path

from atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.adapters.http.server import serve

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
parser.add_argument("--port", type=int, default=0)
parser.add_argument("--single-project", action="store_true")
args = parser.parse_args()
if not (args.root.parent / "input/terrain.atlas.json").exists():
    bundle(args.root.parent / "input")
if not (args.root.parent / "sprites/actors.atlas.json").exists():
    sprite_bundle(args.root.parent / "sprites")
if not (args.root.parent / "spare/spare.atlas.json").exists():
    bundle(args.root.parent / "spare", "spare")
serve(args.root, args.port, single_project=args.single_project)
