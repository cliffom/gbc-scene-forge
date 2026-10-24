"""Run the independent connector for optional browser acceptance checks."""

import argparse
from pathlib import Path

from fixture_connector import FixtureConnector

from gbc_scene_forge.server import serve

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, required=True)
parser.add_argument("--port", type=int, default=8777)
args = parser.parse_args()
serve(FixtureConnector(args.root), args.port)
