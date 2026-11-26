"""Describe a tool's checkout without attributing prebuilt inputs to that checkout."""

import hashlib
import subprocess
from pathlib import Path


def checkout(root):
    try:
        root = Path(root).resolve()
        toplevel = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], cwd=root, text=True, stderr=subprocess.PIPE
        ).strip()
        if Path(toplevel).resolve() != root:
            return None  # Git found an ancestor checkout, not this source tree.
        revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True, stderr=subprocess.PIPE
        ).strip()
        diff = subprocess.check_output(
            ["git", "diff", "--binary", "HEAD"], cwd=root, stderr=subprocess.PIPE
        )
    except (OSError, subprocess.CalledProcessError):
        return None  # An exported source tree has no observable Git provenance.
    return {
        "revision": revision,
        "tracked_source_dirty": bool(diff),
        "tracked_source_diff_sha256": hashlib.sha256(diff).hexdigest(),
    }
