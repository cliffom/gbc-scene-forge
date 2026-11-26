"""Launch an editable standalone sample copy."""

import argparse
from pathlib import Path

from gbc_scene_forge.adapters.http.server import serve
from gbc_scene_forge.project.application import Project


def main():
    parser = argparse.ArgumentParser(description="Copy or reopen the standalone demo project")
    parser.add_argument("--root", type=Path, default=Path(".demo"))
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--reset", action="store_true", help="Restore the bundled demo before serving"
    )
    args = parser.parse_args()
    try:
        project = Project.from_sample(args.root, reset=args.reset)
        print(f"Demo project: {project.root}", flush=True)
        print(
            "Select Riverside or Courtyard from the scene dropdown. "
            "make demo resets this copy; use make run PROJECT=... to keep editing.",
            flush=True,
        )
        serve(project.root, args.port, single_project=True)
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
