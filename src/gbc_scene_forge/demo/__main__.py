"""Launch the opt-in demo: python -m gbc_scene_forge.demo."""

import argparse
from pathlib import Path

from ..server import serve
from . import DemoConnector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(".demo"), help="Persistent demo workspace"
    )
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    serve(DemoConnector(args.root), port=args.port)


if __name__ == "__main__":
    main()
