"""User-owned plugin selection, independent of domain filesystem grants."""

import json
import os
import platform
import subprocess
import tempfile
from pathlib import Path

from gbc_scene_forge.core.validation import require
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import MANIFEST


def locations():
    """Use OS-owned user locations; never infer a project from cwd or a checkout."""
    home = Path.home().resolve()
    system = platform.system()
    if system == "Darwin":
        return home / "Library/Application Support/Scene Forge", home / "Library/Caches/Scene Forge"
    if system == "Windows":
        return (
            Path(os.environ.get("APPDATA", home / "AppData/Roaming")) / "Scene Forge",
            Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local")) / "Scene Forge/Cache",
        )
    return (
        Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "scene-forge",
        Path(os.environ.get("XDG_CACHE_HOME", home / ".cache")) / "scene-forge",
    )


def separate(path, other):
    require(
        not path.is_relative_to(other) and not other.is_relative_to(path),
        "Projects, settings, caches and the plugin bundle must have separate locations",
    )


def choose_directory(mode):
    """Only the native chooser can grant a new path; MCP accepts no path argument."""
    require(mode in ("project", "root"), "Choose project or root")
    require(
        platform.system() == "Darwin",
        "Native plugin selection currently requires local macOS. "
        "Use the runtime's explicit --project or --project-root mode on other systems.",
    )
    prompt = (
        "Open one existing Forge project. Forge will access only this project."
        if mode == "project"
        else "Choose a parent folder. Forge can discover and create immediate projects inside it."
    )
    # A fixed OS executable and constant script, without a shell or interpolated paths.
    script = f'POSIX path of (choose folder with prompt "{prompt}")'
    try:
        result = subprocess.run(
            ["/usr/bin/osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=55,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise ValueError("Folder selection timed out. Ask to choose a location again.") from error
    if result.returncode and "(-128)" in result.stderr:
        return None
    require(
        result.returncode == 0,
        "Cannot open the folder chooser. Allow automation/folder access in macOS System "
        "Settings → Privacy & Security, then choose a location again. " + result.stderr.strip(),
    )
    return Path(result.stdout.strip())


class Selection:
    def __init__(self, bundle, *, settings=None, cache=None):
        default_settings, default_cache = locations()
        self.bundle = Path(bundle).resolve()
        self.settings = Path(settings or default_settings).absolute() / "selection.json"
        self.cache = Path(cache or default_cache).absolute()
        separate(self.settings.parent, self.bundle)
        separate(self.cache, self.bundle)
        separate(self.settings.parent, self.cache)
        self.check_owned_paths()

    def check_owned_paths(self):
        require(
            self.settings.parent.resolve() == self.settings.parent
            and self.cache.resolve() == self.cache,
            "Settings/cache location changed into a symlink. Restore it before selecting a project.",
        )

    def validate(self, record):
        self.check_owned_paths()
        require(
            isinstance(record, dict)
            and set(record) == {"schema_version", "mode", "path", "identity"}
            and record["schema_version"] == 1
            and record["mode"] in ("project", "root")
            and isinstance(record["path"], str),
            "Invalid saved selection. Ask Forge to change location or reset selection.",
        )
        path = Path(record["path"])
        require(path.is_absolute(), "Choose an absolute existing directory")
        canonical = path.resolve(strict=True)
        require(canonical == path, "Selected location moved or became a symlink; choose it again")
        require(path.is_dir(), "Selected directory is unavailable; choose its new location")
        for owned in (self.bundle, self.settings.parent, self.cache):
            separate(path, owned)
        info = path.stat()
        require(
            record["identity"] == [info.st_dev, info.st_ino],
            "Selected directory was replaced; choose its location again",
        )
        require(
            os.access(path, os.R_OK | os.W_OK | os.X_OK),
            "Selected directory is read-only or access was denied. "
            "Grant folder access or choose a writable location.",
        )
        if record["mode"] == "project":
            Project(path, recover=False)  # Discovery must not replay interrupted writes.
        else:
            require(
                not (path / MANIFEST).exists(),
                "This is a Forge project. Choose 'project' to reopen it, or select its parent.",
            )
        return path

    def load(self):
        self.check_owned_paths()
        require(
            not self.settings.is_symlink(), "Settings must not be a symlink; reset its location"
        )
        if not self.settings.exists():
            return None
        require(
            self.settings.stat().st_size <= 8192, "Invalid oversized selection; reset selection"
        )
        try:
            record = json.loads(self.settings.read_text())
        except (ValueError, RecursionError) as error:
            raise ValueError(
                "Invalid saved selection. Ask Forge to change location or reset selection."
            ) from error
        self.validate(record)
        return record

    def prepare(self, path, mode):
        require(Path(path).is_absolute(), "Choose an absolute existing directory")
        path = Path(path).resolve(strict=True)
        info = path.stat()
        record = {
            "schema_version": 1,
            "mode": mode,
            "path": str(path),
            "identity": [info.st_dev, info.st_ino],
        }
        self.validate(record)
        return record

    def save(self, record):
        self.validate(record)
        require(not self.settings.is_symlink(), "Settings must not be a symlink")
        self.settings.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # NamedTemporaryFile is owner-only before publication. No chmod or other
        # fallible step after replacement may turn a successful switch into an error.
        stream = tempfile.NamedTemporaryFile(dir=self.settings.parent, delete=False)
        temporary = Path(stream.name)
        try:
            with stream:
                stream.write(json.dumps(record).encode())
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.settings)
        finally:
            temporary.unlink(missing_ok=True)

    def reset(self):
        # Unlink only the selection entry, never a project, cache or settings directory.
        self.check_owned_paths()
        self.settings.unlink(missing_ok=True)
