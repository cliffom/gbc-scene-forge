"""Installed plugin compatibility and content identity, before project access.

Hashes detect incomplete/mixed installations; they are not publisher signatures.
Published installations are immutable. Never repair or download files at runtime.
"""

import hashlib
import json
import os
import platform
import stat
from pathlib import Path

from gbc_scene_forge import __version__
from gbc_scene_forge.core.validation import require

CHANGED_INSTALLATION = (
    "Plugin installation changed during this session. Restore its complete matching "
    "bundle or start a fresh conversation with the update; preserve project and browser recovery data."
)


def has_installation(root):
    return any(
        (root / name).exists() for name in ("plugin.json", "install.json", "compatibility.json")
    )


def metadata(root):
    """Stat the entire tree, including directories/receipt, without following links.

    ctime detects same-length writes even when a copier restores mtime. Directory
    entries and inode/device identity catch additions, removals and replacements.
    Access time is deliberately excluded: reading a validated bundle changes it.
    """

    def signature(info):
        return (
            info.st_dev,
            info.st_ino,
            info.st_mode,
            info.st_size,
            info.st_mtime_ns,
            info.st_ctime_ns,
        )

    result = {".": signature(root.lstat())}
    pending = [(root, "")]
    while pending:
        path, prefix = pending.pop()
        with os.scandir(path) as entries:
            for entry in entries:
                info = entry.stat(follow_symlinks=False)
                name = prefix + entry.name
                result[name] = signature(info)
                if stat.S_ISDIR(info.st_mode):
                    pending.append((entry.path, name + "/"))
    return result


class InstallationGuard:
    """One session's verified identity; unchanged requests read metadata only."""

    def __init__(self, root):
        self.root = Path(root).resolve()
        before = metadata(self.root) if has_installation(self.root) else None
        self.identity = verify(self.root)
        self._metadata = before
        if before is not None or self.identity is not None:
            require(
                self.identity is not None and before == metadata(self.root), CHANGED_INSTALLATION
            )

    def check(self):
        if self.identity is None:
            return  # Standalone runtimes do not own an installed plugin tree.
        try:
            current = metadata(self.root)
        except OSError as error:
            raise ValueError(CHANGED_INSTALLATION) from error
        if current != self._metadata:
            guard(self.root, self.identity)
            # Never cache metadata for bytes that changed during verification.
            require(current == metadata(self.root), CHANGED_INSTALLATION)
            self._metadata = current


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
    if not has_installation(root):
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
            CHANGED_INSTALLATION,
        )
