"""Path containment independent of any project's asset pipeline."""

from pathlib import Path


def reject_symlinks(path, root):
    path, root = Path(path).absolute(), Path(root).absolute()
    if not path.is_relative_to(root):
        raise ValueError("Path must stay inside the configured workspace")
    current = root
    for part in (None, *path.relative_to(root).parts):
        if part is not None:
            current /= part
        if current.is_symlink():
            raise ValueError(f"Symlinks are not supported: {current}")
