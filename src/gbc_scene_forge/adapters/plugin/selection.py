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

WORKSPACE_LIBRARY = ".gbc-scene-forge"


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


def choose_directory(mode, *, start_in=None):
    """The starting folder is a hint. Only the native chooser returns a grant."""
    prompts = {
        "project": "Open one existing Forge project. Forge will access only this project.",
        "root": "Choose a parent folder. Forge can discover and create immediate projects inside it.",
        "workspace": f"Choose your game folder. Forge stores projects inside {WORKSPACE_LIBRARY}/.",
    }
    require(mode in prompts, "Choose workspace, project or root")
    require(
        platform.system() == "Darwin",
        "Native plugin selection currently requires local macOS. "
        "Use the runtime's explicit --project or --project-root mode on other systems.",
    )
    # Pass the untrusted hint as data. If it cannot resolve to a folder, use the OS default.
    script = """on run argv
    if (count of argv) > 1 then
        set startingFolder to missing value
        try
            set candidateFolder to (POSIX file (item 2 of argv)) as alias
            if folder of (info for candidateFolder) then set startingFolder to candidateFolder
        end try
        if startingFolder is not missing value then
            return POSIX path of (choose folder with prompt (item 1 of argv) default location startingFolder)
        end if
    end if
    return POSIX path of (choose folder with prompt (item 1 of argv))
end run"""
    command = ["/usr/bin/osascript", "-e", script, "--", prompts[mode]]
    if start_in and "\x00" not in start_in and Path(start_in).is_absolute():
        command.append(start_in)
    try:
        result = subprocess.run(
            command,
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
            and record["mode"] in ("project", "root", "workspace")
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
        elif record["mode"] == "root":
            require(
                not (path / MANIFEST).exists(),
                "This is a Forge project. Choose 'project' to reopen it, or select its parent.",
            )
        return path

    def library(self, workspace, *, create=False):
        """Resolve only the immediate library of a previously confirmed game folder."""
        path = self.validate(workspace) / WORKSPACE_LIBRARY
        require(not path.is_symlink(), "The Forge library must not be a symlink")
        if create and not path.exists():
            parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                info = os.fstat(parent)
                require(
                    workspace["identity"] == [info.st_dev, info.st_ino],
                    "The game folder changed; choose it again",
                )
                try:
                    os.mkdir(path.name, mode=0o700, dir_fd=parent)
                except FileExistsError:
                    pass  # A concurrent chat may have created the same library.
            finally:
                os.close(parent)
        if not path.exists():
            return None
        self.validate(workspace)
        return self.prepare(path, "root", canonicalize=False)

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
        require(record["mode"] != "workspace", "Workspace selections belong to one chat")
        return record

    def prepare(self, path, mode, *, canonicalize=True):
        path = Path(path)
        require(path.is_absolute(), "Choose an absolute existing directory")
        if canonicalize:
            path = path.resolve(strict=True)
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
        require(record["mode"] != "workspace", "Workspace selections belong to one chat")
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
