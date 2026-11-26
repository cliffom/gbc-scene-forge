"""Version-two native sheets: explicit frame identities over one exact RGBA raster."""

import copy

from gbc_scene_forge.artwork import dimensions
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.validation import identifier, integer, require

# Counts bound descriptor size and animation review work; durations are APNG uint16 ms.
MAX_FRAMES = 128
MAX_SEQUENCES = 64
MAX_SEQUENCE_FRAMES = 256
MAX_TOTAL_SEQUENCE_FRAMES = 1024
MIN_DURATION_MS = 1
MAX_DURATION_MS = 65_535


def check(descriptor):
    require(
        descriptor["origin"] == [0, 0],
        "Sheet root origin must be [0, 0]; use explicit frame origins",
    )
    frames, sequences = descriptor["frames"], descriptor["sequences"]
    require(isinstance(frames, list) and 1 <= len(frames) <= MAX_FRAMES, "Use 1..128 frames")
    indexed = {}
    for frame in frames:
        require(
            isinstance(frame, dict)
            and set(frame) == {"id", "name", "kind", "x", "y", "width", "height", "origin"}
            and identifier(frame["id"])
            and frame["id"] not in indexed,
            "Expected a unique immutable frame ID and explicit frame geometry",
        )
        require(name(frame["name"]) == frame["name"], "Use a trimmed frame name")
        w, h = frame["width"], frame["height"]
        require(
            frame["kind"] in ("tile", "sprite")
            and integer(w, dimensions.GRID_UNIT, dimensions.MAX_GRID_AXIS)
            and integer(h, dimensions.GRID_UNIT, dimensions.MAX_GRID_AXIS)
            and w % dimensions.GRID_UNIT == h % dimensions.GRID_UNIT == 0
            and integer(frame["x"], 0, descriptor["width"] - w)
            and integer(frame["y"], 0, descriptor["height"] - h)
            and frame["x"] % dimensions.GRID_UNIT == frame["y"] % dimensions.GRID_UNIT == 0,
            "Frame rectangles must be aligned multiples of eight inside the sheet",
        )
        origin = frame["origin"]
        require(
            isinstance(origin, list)
            and len(origin) == 2
            and integer(origin[0], 0, w - 1)
            and integer(origin[1], 0, h - 1)
            and (frame["kind"] != "tile" or origin == [0, 0]),
            "Frame origins must fit sprites; tile origins use [0, 0]",
        )
        indexed[frame["id"]] = frame
    require(descriptor["region"] in indexed, "The primary region must identify a sheet frame")
    require(
        indexed[descriptor["region"]]["kind"] == descriptor["kind"],
        "Primary frame kind differs from sheet kind",
    )
    require(
        isinstance(sequences, list) and len(sequences) <= MAX_SEQUENCES,
        "Use at most 64 sequences",
    )
    seen = set()
    total = 0
    for sequence in sequences:
        require(
            isinstance(sequence, dict)
            and set(sequence) == {"id", "name", "frames", "loop"}
            and identifier(sequence["id"])
            and sequence["id"] not in seen
            and type(sequence["loop"]) is bool,
            "Expected a unique sequence ID, name, frames and explicit looping",
        )
        require(name(sequence["name"]) == sequence["name"], "Use a trimmed sequence name")
        items = sequence["frames"]
        require(
            isinstance(items, list) and 1 <= len(items) <= MAX_SEQUENCE_FRAMES,
            "Use 1..256 timed frames per sequence",
        )
        total += len(items)
        require(total <= MAX_TOTAL_SEQUENCE_FRAMES, "Use at most 1024 total sequence frames")
        geometry = None
        for item in items:
            require(
                isinstance(item, dict)
                and set(item) == {"frame_id", "duration_ms"}
                and isinstance(item["frame_id"], str)
                and item["frame_id"] in indexed
                and integer(item["duration_ms"], MIN_DURATION_MS, MAX_DURATION_MS),
                "Sequence frames require an existing frame ID and duration within 1..65535 ms",
            )
            frame = indexed[item["frame_id"]]
            current = (frame["kind"], frame["width"], frame["height"], frame["origin"])
            require(geometry is None or geometry == current, "Sequence frames must share geometry")
            geometry = current
        seen.add(sequence["id"])


def regions(descriptor):
    return [
        {
            "name": frame["id"],
            **{key: frame[key] for key in ("kind", "x", "y", "width", "height")},
            **({"origin": copy.deepcopy(frame["origin"])} if frame["kind"] == "sprite" else {}),
        }
        for frame in descriptor["frames"]
    ]


def animations(descriptor):
    return [
        {
            "name": sequence["id"],
            "loop": sequence["loop"],
            "frames": [
                {"region": item["frame_id"], "duration_ms": item["duration_ms"]}
                for item in sequence["frames"]
            ],
        }
        for sequence in descriptor["sequences"]
    ]


def layout(descriptor, frames, sequences):
    """Immutable descriptor edit. Saved-base validation protects existing geometry."""
    require(descriptor["version"] == 2, "Open or create a version-two sheet first")
    result = copy.deepcopy(descriptor)
    result.update(frames=copy.deepcopy(frames), sequences=copy.deepcopy(sequences))
    check(result)
    return result


def compatible(saved, proposed):
    """Keep saved reference geometry stable; rename/reorder and append are safe."""
    immutable = set(saved) - {"frames", "sequences", "name"}
    require(all(saved[k] == proposed[k] for k in immutable), "Sheet identity and raster are fixed")
    frames = {frame["id"]: frame for frame in proposed["frames"]}
    for frame in saved["frames"]:
        require(
            frame["id"] in frames
            and all(frames[frame["id"]][k] == frame[k] for k in frame if k != "name"),
            "Saved frames cannot be removed or change geometry; create an explicit variation",
        )
