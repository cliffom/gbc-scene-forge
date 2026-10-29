"""Discover and create self-contained projects within a declared project root."""

import re
import unicodedata
from pathlib import Path

from .atlas import require
from .projects import MANIFEST, Project, name
from .transactions import safe_path


def slug(title):
    title = name(title)
    require(
        not any(c in title for c in ("/", "\\")), "Project names cannot contain path separators"
    )
    ascii_name = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    require(bool(value), "Use at least one letter or number in the project name")
    return value


class ProjectRoot:
    def __init__(self, root):
        self.root = Path(root).absolute()
        require(
            not (self.root / MANIFEST).exists(),
            "This directory is already a project. Use --project PATH to open it directly, "
            "or move it into a project root as a child directory.",
        )
        safe_path(self.root, ".root-check")
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, directory):
        require(
            isinstance(directory, str)
            and directory not in ("", ".", "..")
            and not any(c in directory for c in ("/", "\\")),
            "Choose a project directory inside the project root",
        )
        return safe_path(self.root, directory)

    def catalog(self):
        projects, unavailable = [], []
        for child in sorted(self.root.iterdir(), key=lambda p: p.name.casefold()):
            if child.is_symlink() or not child.is_dir() or not (child / MANIFEST).exists():
                continue
            try:
                project = Project(self.path(child.name), recover=False).read()[0]
                projects.append(
                    {"directory": child.name, "id": project["id"], "name": project["name"]}
                )
            except (ValueError, OSError, KeyError, TypeError) as error:
                unavailable.append({"directory": child.name, "error": str(error)})
        return {
            "project": None,
            "projects": projects,
            "unavailable": unavailable,
            "project_root": str(self.root),
        }

    def create(self, title, *, starter="empty"):
        require(
            starter in ("empty", "sample", "blockout"),
            "Choose an empty, sample or blockout project",
        )
        directory = slug(title)
        path = self.path(directory)
        try:
            path.mkdir()  # Atomic reservation; even an existing empty directory is not claimed.
        except FileExistsError as error:
            # Only an interrupted first-creation journal can be retried. Existing
            # projects, unrelated contents and even empty user folders are collisions.
            if path.is_dir() and {item.name for item in path.iterdir()} == {".forge"}:
                Project.prepare_creation(path)
            else:
                raise ValueError(
                    f"A directory named '{directory}' already exists. Choose another project name."
                ) from error
        if starter == "sample":
            from .sample import prepare

            prepare(path, title=title)
        else:
            Project.create(path, title, starter=starter)
        return directory
