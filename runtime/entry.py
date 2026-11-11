"""Frozen runtime launcher; ordinary wheel entry points remain independent."""

import argparse
import json
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
    return (
        bundle.parent
        if any(
            (bundle.parent / name).is_file()
            for name in ("plugin.json", "install.json", "compatibility.json")
        )
        else bundle
    )


def main(argv=None):
    from gbc_scene_forge import __version__
    from gbc_scene_forge.adapters.plugin.distribution import verify

    bundle = plugin_directory(Path(sys.executable).resolve().parent)
    try:
        installed = verify(bundle)
    except ValueError as error:
        print(f"Scene Forge: {error}", file=sys.stderr)
        return 2
    if (sys.argv[1:] if argv is None else argv) == ["--identity"]:
        print(json.dumps({"runtime_version": __version__, "installation": installed}))
        return 0

    # Internal child mode is intentionally absent from user-facing help/options.
    if (sys.argv[1:] if argv is None else argv) == ["browser-worker"]:
        from gbc_scene_forge.adapters.plugin.browser import worker_main

        return worker_main()
    parser = argparse.ArgumentParser(description="Self-contained Scene Forge runtime")
    parser.add_argument("--version", action="version", version=f"Scene Forge {__version__}")
    parser.add_argument("--identity", action="store_true", help="Print installed build identities")
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
            command.add_argument(
                "--project-name", help="Immediate project name when plugin selection is a root"
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
            from gbc_scene_forge.adapters.plugin.session import PluginSession

            session = PluginSession(selection)
            record = session.status()["selection"]
            if record is None:
                raise ValueError(
                    session.error
                    or "No project selected. Use plugin_choose_location in Forge chat first."
                )
            single_project = record["mode"] == "project"
            from gbc_scene_forge.adapters.http.server import open_editor

            if not single_project and not args.project_name:
                raise ValueError("Select an immediate project with --project-name NAME")
            if args.port:
                raise ValueError("Managed plugin browsers select and preserve their own port")
            result = session.call(
                "plugin_browser",
                {"project": "project" if single_project else args.project_name, "action": "open"},
            )
            print(result["url"], file=sys.stderr, flush=True)
            if not args.no_browser:
                with redirect_stdout(sys.stderr):
                    open_editor(result["url"])
            return 0
        else:
            if args.mode == "browser" and args.project_name:
                raise ValueError("--project-name requires --plugin")
            root = external_directory(args.project or args.project_root, plugin_directory(bundle))
            single_project = args.project is not None
        if args.mode == "browser":
            if not 0 <= args.port <= 65535:
                raise ValueError("--port must be between 0 and 65535")
            from gbc_scene_forge.adapters.http.server import serve

            os.chdir(root)
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
