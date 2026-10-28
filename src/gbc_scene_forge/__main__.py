"""Launch the local editor with a project root or an explicit existing project."""

import argparse
import json
from pathlib import Path

from .projects import Project
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
    parser.add_argument(
        "--palette-preflight",
        metavar="SCENE_ID",
        help="Check a saved scene's GBC palette budget; output JSON, exit 1 unless it passes",
    )
    args = parser.parse_args()
    if sum(value is not None for value in (args.root, args.project_root, args.project)) > 1:
        parser.error("Choose one of ROOT, --project-root, or --project")
    try:
        if args.palette_preflight:
            if args.project is None:
                parser.error("--palette-preflight requires --project")
            project = Project(args.project)
            loaded = project.load_scene(args.palette_preflight)
            report = project.palette_report(
                loaded["id"], project.catalog()["revision"], loaded["revision"]
            )
            print(json.dumps(report, indent=2))
            return 0 if report["status"] == "pass" else 1
        root = args.project or args.project_root or args.root or Path(".forge_project")
        serve(root, args.port, single_project=args.project is not None)
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
