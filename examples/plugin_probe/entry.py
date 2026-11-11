"""Experimental bundled entry point; no change to the supported wheel launchers."""

import argparse
import json
import os
import platform
import sys
from pathlib import Path

# Private Python runs this file with -I -B; PyInstaller freezes the same entry.
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent / "site-packages"))


def selection(settings):
    if not settings or not Path(settings).is_absolute():
        raise ValueError("Set FORGE_PLUGIN_PROBE_SETTINGS to an absolute external settings file")
    path = Path(settings).resolve(strict=True)
    entry = Path(sys.executable) if getattr(sys, "frozen", False) else Path(__file__)
    bundle = entry.resolve().parent.parent
    if path.is_relative_to(bundle):
        raise ValueError("Probe settings must live outside the installed bundle")
    data = json.loads(path.read_text())
    root = Path(data["project_root"])
    if not root.is_absolute() or not root.is_dir():
        raise ValueError("Select an existing absolute project_root in the external settings file")
    root = root.resolve()
    if root.is_relative_to(bundle):
        raise ValueError("Project root must live outside the installed bundle")
    return path, root


def main():
    from gbc_scene_forge import __version__

    parser = argparse.ArgumentParser(description="Forge macOS arm64 plugin feasibility probe")
    parser.add_argument("--version", action="version", version=f"Forge probe {__version__}")
    parser.add_argument("mode", choices=("mcp", "browser"))
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
            raise ValueError("This experimental bundle supports only macOS arm64")
        settings, root = selection(os.environ.get("FORGE_PLUGIN_PROBE_SETTINGS"))
        os.chdir(settings.parent)  # Browser logs belong to external probe data, never plugin cache.
        if args.mode == "mcp":
            if args.port is not None or args.no_browser:
                parser.error("Browser options require browser mode")
            from gbc_scene_forge.adapters.mcp.server import main as launch

            remaining = []
        else:
            from gbc_scene_forge.adapters.cli import main as launch

            remaining = ["--port", str(0 if args.port is None else args.port)]
            if args.no_browser:
                remaining.append("--no-browser")
        sys.argv = [sys.argv[0], "--project-root", str(root), *remaining]
        return launch()
    except (ValueError, KeyError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
