"""Path containment independent of any project's asset pipeline."""

from pathlib import Path


def reject_symlinks(path: str | Path, root: str | Path) -> None:
    path, root = Path(path).absolute(), Path(root).absolute()
    if not path.is_relative_to(root):
        raise ValueError("Path must stay inside the configured workspace")
    current = root
    for part in (None, *path.relative_to(root).parts):
        if part is not None:
            current /= part
        if current.is_symlink():
            raise ValueError(f"Symlinks are not supported: {current}")


def safe_path(root: Path, name: str) -> Path:
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError("Transaction path must stay inside the project")
    target = root / relative
    reject_symlinks(target, root)
    return target
