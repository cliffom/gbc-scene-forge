"""Read the identity embedded alongside the browser assets at build time."""

import json
from importlib.resources import files

from . import __version__


def build_version():
    try:
        metadata = files("gbc_scene_forge").joinpath("static/build-info.json").read_text()
    except FileNotFoundError:
        # Source-only Python use before the first frontend build.
        return __version__
    return json.loads(metadata)["version"]
