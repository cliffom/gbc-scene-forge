"""Synthetic native-chooser replacement for stdio tests; never shipped in the runtime."""

import asyncio
import sys
from pathlib import Path

from gbc_scene_forge.adapters.mcp.server import run
from gbc_scene_forge.adapters.plugin.selection import Selection
from gbc_scene_forge.adapters.plugin.session import PluginSession

base = Path(sys.argv[1])
selection = Selection(base / "bundle", settings=base / "settings", cache=base / "cache")
choices = iter([base / "projects", base / "projects/design", None])
asyncio.run(run(PluginSession(selection, chooser=lambda mode: next(choices))))
