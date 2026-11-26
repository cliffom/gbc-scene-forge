"""Shared artwork dependency rules for read-only analysis."""

from collections import deque


def frame_closure(manifest, start):
    """Include every linked sequence, independent of preview choices/playhead."""
    found = {start: None}
    pending = deque([start])
    sequences = {}
    for sequence in sorted(manifest.get("animations", []), key=lambda value: value["name"]):
        frames = list(dict.fromkeys(frame["region"] for frame in sequence["frames"]))
        for frame in frames:
            sequences.setdefault(frame, []).append((sequence["name"], frames))
    visited = set()
    while pending:
        region = pending.popleft()
        for name, frames in sequences.get(region, []):
            if name in visited:
                continue
            visited.add(name)
            for frame in frames:
                if frame not in found:
                    found[frame] = name
                    pending.append(frame)
    return found
