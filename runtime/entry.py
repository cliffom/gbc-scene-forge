"""Frozen runtime launcher; ordinary wheel entry points remain independent."""

import argparse
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path


def external_directory(value, bundle):
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("Select an absolute existing project directory")
    path = path.resolve(strict=True)
    if not path.is_dir():
        raise ValueError("Select an existing project directory")
    if path.is_relative_to(bundle) or bundle.is_relative_to(path):
        raise ValueError("Project directories must be outside and separate from the runtime bundle")
    return path


def main(argv=None):
    from gbc_scene_forge import __version__

    parser = argparse.ArgumentParser(description="Self-contained Scene Forge runtime")
    parser.add_argument("--version", action="version", version=f"Scene Forge {__version__}")
    modes = parser.add_subparsers(dest="mode", required=True)
    for mode in ("browser", "mcp"):
        command = modes.add_parser(mode, help=f"Launch the {mode} server")
        group = command.add_mutually_exclusive_group(required=True)
        group.add_argument("--project-root", type=Path, help="Absolute existing parent of projects")
        group.add_argument("--project", type=Path, help="Absolute existing Forge project")
        if mode == "browser":
            command.add_argument(
                "--port", type=int, default=0, help="Loopback port (default: auto)"
            )
            command.add_argument(
                "--no-browser", action="store_true", help="Only print the editor URL"
            )
    args = parser.parse_args(argv)
    try:
        bundle = Path(sys.executable).resolve().parent
        root = external_directory(args.project or args.project_root, bundle)
        if args.mode == "browser":
            if not 0 <= args.port <= 65535:
                raise ValueError("--port must be between 0 and 65535")
            from gbc_scene_forge.adapters.http.server import serve

            # Existing HTTP logging is cwd-relative; all writes belong to the explicit selection.
            os.chdir(root)
            with redirect_stdout(sys.stderr):
                serve(
                    root,
                    args.port,
                    single_project=args.project is not None,
                    open_browser=not args.no_browser,
                )
        else:
            import asyncio

            from gbc_scene_forge.adapters.mcp.server import open_adapter, run

            # The SDK owns stdout; diagnostics/errors continue to use stderr.
            asyncio.run(run(open_adapter(root, single_project=args.project is not None)))
    except (ValueError, OSError) as error:
        parser.error(str(error))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
