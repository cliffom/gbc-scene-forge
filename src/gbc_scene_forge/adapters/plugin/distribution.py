"""Installed plugin compatibility and content identity, before project access.

Hashes detect incomplete/mixed installations; they are not publisher signatures.
Published installations are immutable. Never repair or download files at runtime.
"""

import hashlib
import json
import platform
import stat
from pathlib import Path

from gbc_scene_forge import __version__
from gbc_scene_forge.core.validation import require


def inventory(root):
    result = {}
    for path in sorted(root.rglob("*")):
        name = path.relative_to(root).as_posix()
        if name == "install.json":
            continue
        require(path.resolve().is_relative_to(root), "Plugin contains an external symlink")
        if path.is_symlink():
            result[name] = {"link": str(path.readlink())}
        elif path.is_file():
            with path.open("rb") as stream:
                result[name] = {
                    "sha256": hashlib.sha256(stream.read()).hexdigest(),
                    "executable": bool(path.stat().st_mode & stat.S_IXUSR),
                }
        else:
            require(path.is_dir(), "Plugin contains an unsupported file type")
    return result


def build_id(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def verify(root):
    """Return installed identity, or reject before any project/settings mutation."""
    root = Path(root).resolve()
    if not any(
        (root / name).exists() for name in ("plugin.json", "install.json", "compatibility.json")
    ):
        return None  # Standalone wheel/runtime, without a plugin distribution.
    try:
        require(
            not (root / "install.json").is_symlink(), "Installation receipt must not be a symlink"
        )
        manifest = json.loads((root / "plugin.json").read_text())
        contract = json.loads((root / "compatibility.json").read_text())
        receipt = json.loads((root / "install.json").read_text())
        require(
            contract["schema_version"] == receipt["schema_version"] == 1
            and manifest["name"] == contract["plugin"] == receipt["plugin"] == "scene-forge"
            and manifest["version"] == receipt["plugin_version"]
            and contract["runtime_version"] == receipt["runtime_version"] == __version__
            and contract["project_format"] == contract["selection_format"] == 1
            and contract["target"] == receipt["target"] == "macos-arm64",
            "Incompatible plugin/runtime/project-format combination",
        )
        require(
            (platform.system(), platform.machine()) == ("Darwin", "arm64")
            and tuple(map(int, platform.mac_ver()[0].split(".")[:2]))
            >= tuple(map(int, contract["minimum_macos"].split("."))),
            "This bundle requires local macOS 27.0+ on Apple Silicon",
        )
        files = inventory(root)
        require(
            files == receipt["files"] and build_id(files) == receipt["build_id"],
            "Incomplete or changed plugin installation",
        )
        return {
            key: receipt[key]
            for key in ("plugin", "plugin_version", "runtime_version", "target", "build_id")
        }
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise ValueError(
            f"{error}. Restore the complete compatible plugin bundle and start a new conversation. "
            "Keep user projects/settings and the previous installation for recovery."
        ) from error


def guard(root, expected):
    if expected is not None:
        require(
            verify(root) == expected,
            "Plugin installation changed during this session. Restore its complete matching "
            "bundle or start a fresh conversation with the update; preserve project and browser recovery data.",
        )
