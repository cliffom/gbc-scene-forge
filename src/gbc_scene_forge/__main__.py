"""Launch the standalone editor with an explicit local project directory."""

import argparse
from pathlib import Path

from .projects import Project
from .standalone import serve


def main():
    parser = argparse.ArgumentParser(description="Create or open a standalone Scene Forge project")
    parser.add_argument("root", type=Path, help="Project directory (new or existing)")
    parser.add_argument(
        "--create", metavar="NAME", help="Create an empty named project before serving"
    )
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    try:
        root = args.root.absolute()
        if args.create:
            Project.create(root, args.create)
        serve(root, args.port)
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
