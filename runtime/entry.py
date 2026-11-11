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


def plugin_directory(bundle):
    # Delivery places the executable in bin/ or runtime/ under the manifest.
    # Exclude that whole installation, not only its executable subdirectory.
    return bundle.parent if (bundle.parent / "plugin.json").is_file() else bundle


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
        group.add_argument(
            "--plugin", action="store_true", help="Use per-user native project selection"
        )
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
        if args.plugin:
            from gbc_scene_forge.adapters.plugin.selection import Selection

            selection = Selection(plugin_directory(bundle))
            if args.mode == "mcp":
                import asyncio

                from gbc_scene_forge.adapters.mcp.server import run
                from gbc_scene_forge.adapters.plugin.session import PluginSession

                asyncio.run(run(PluginSession(selection)))
                return 0
            record = selection.load()
            if record is None:
                raise ValueError(
                    "No project selected. Use plugin_choose_location in Forge chat first."
                )
            root = selection.validate(record)
            single_project = record["mode"] == "project"
        else:
            root = external_directory(args.project or args.project_root, bundle)
            single_project = args.project is not None
        if args.mode == "browser":
            if not 0 <= args.port <= 65535:
                raise ValueError("--port must be between 0 and 65535")
            from gbc_scene_forge.adapters.http.server import serve

            # Plugin logs/cache belong to user cache, separate from saved projects/settings.
            if args.plugin:
                selection.cache.mkdir(parents=True, exist_ok=True)
            os.chdir(selection.cache if args.plugin else root)
            with redirect_stdout(sys.stderr):
                serve(
                    root,
                    args.port,
                    single_project=single_project,
                    open_browser=not args.no_browser,
                )
        else:
            import asyncio

            from gbc_scene_forge.adapters.mcp.server import open_adapter, run

            # The SDK owns stdout; diagnostics/errors continue to use stderr.
            asyncio.run(run(open_adapter(root, single_project=single_project)))
    except (ValueError, OSError) as error:
        parser.error(str(error))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
