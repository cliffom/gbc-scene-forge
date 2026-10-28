"""Launch the local editor with a project root or an explicit existing project."""

import argparse
from pathlib import Path

from .standalone import serve


def main():
    parser = argparse.ArgumentParser(description="Browse and edit local Scene Forge projects")
    parser.add_argument(
        "root",
        nargs="?",
        type=Path,
        default=None,
        help="Directory containing projects (default: .forge_project)",
    )
    parser.add_argument("--project-root", type=Path, help="Directory containing projects")
    parser.add_argument("--project", type=Path, help="Open one project directory directly")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if sum(value is not None for value in (args.root, args.project_root, args.project)) > 1:
        parser.error("Choose one of ROOT, --project-root, or --project")
    try:
        root = args.project or args.project_root or args.root or Path(".forge_project")
        serve(root, args.port, single_project=args.project is not None)
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
