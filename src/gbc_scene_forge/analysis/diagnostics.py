"""Read-only project diagnostics with explicit, bounded grid-walking assumptions."""

import math
from collections import deque

from gbc_scene_forge.analysis import palette_budget
from gbc_scene_forge.artwork import atlas
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats.tiled import cell_parts, scene_layers
from gbc_scene_forge.planning import world
from gbc_scene_forge.scene_objects import definitions as object_definitions
from gbc_scene_forge.scene_objects.preview import finite

CODES = (
    "gbc-budget",
    "overlapping-spawns",
    "blocked-entrance",
    "unreachable",
    "unverified-movement",
    "unused-asset",
    "missing-scene",
    "missing-object",
    "missing-definition",
    "kind",
    "required",
    "type",
    "min",
    "max",
    "choices",
    "unknown-field",
)
COLLISION_WORK_LIMIT = 1_000_000


class CollisionWorkExceeded(Exception):
    """The scene's shared collision-work budget has been exhausted."""


def options(value, document):
    value = {} if value is None else value
    require(
        isinstance(value, dict)
        and not set(value)
        - {
            "movement",
            "footprint",
            "spawn_definitions",
            "entrance_definitions",
            "goal_definitions",
            "include_hidden",
            "excluded_scenes",
            "excluded_codes",
        },
        "Invalid diagnostic options",
    )
    result = {
        "movement": "none",
        "footprint": {"x": -4, "y": -4, "width": 8, "height": 8},
        "include_hidden": False,
        "spawn_definitions": [],
        "entrance_definitions": [],
        "goal_definitions": [],
        "excluded_scenes": [],
        "excluded_codes": [],
        **value,
    }
    require(result["movement"] in ("none", "grid-four-way"), "Unsupported movement model")
    require(type(result["include_hidden"]) is bool, "Invalid hidden-layer rule")
    fp = result["footprint"]
    require(
        isinstance(fp, dict)
        and set(fp) == {"x", "y", "width", "height"}
        and all(finite(fp[k], -4096, 4096) for k in ("x", "y"))
        and all(finite(fp[k], 0, 4096) and fp[k] > 0 for k in ("width", "height")),
        "Invalid diagnostic footprint",
    )
    definitions = {d["id"] for d in document.get("object_definitions", {}).get("definitions", [])}
    for key, allowed in (
        ("spawn_definitions", definitions),
        ("entrance_definitions", definitions),
        ("goal_definitions", definitions),
        ("excluded_scenes", {s["id"] for s in document["scenes"]}),
        ("excluded_codes", set(CODES)),
    ):
        require(
            isinstance(result[key], list)
            and len(result[key]) <= len(allowed)
            and all(isinstance(v, str) and v in allowed for v in result[key])
            and len(set(result[key])) == len(result[key]),
            f"Invalid {key}",
        )
        result[key] = sorted(result[key])
    return result


def overlap(a, b):
    return a[0] < b[0] + b[2] and a[0] + a[2] > b[0] and a[1] < b[1] + b[3] and a[1] + a[3] > b[1]


def shape_overlap(rect, shape):
    if shape["kind"] == "polygon":
        points = shape["points"]
        for axis, edge, sign in (
            (0, rect[0], 1),
            (0, rect[0] + rect[2], -1),
            (1, rect[1], 1),
            (1, rect[1] + rect[3], -1),
        ):
            clipped = []
            for a, b in zip(points, points[1:] + points[:1]):
                ia, ib = (a[axis] - edge) * sign >= 0, (b[axis] - edge) * sign >= 0
                if ia:
                    clipped.append(a)
                if ia != ib:
                    t = (edge - a[axis]) / (b[axis] - a[axis])
                    clipped.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
            points = clipped
        return (
            abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1])))
            > 1e-8
        )
    bounds = tuple(shape[k] for k in ("x", "y", "width", "height"))
    if not overlap(rect, bounds):
        return False
    if shape["kind"] == "rectangle":
        return True
    x, y, w, h = bounds
    cx, cy = x + w / 2, y + h / 2
    px = max(rect[0], min(cx, rect[0] + rect[2]))
    py = max(rect[1], min(cy, rect[1] + rect[3]))
    return ((px - cx) / (w / 2)) ** 2 + ((py - cy) / (h / 2)) ** 2 < 1


def transformed_metadata(value, flags, size):
    def point(x, y):
        if flags & 4:
            x, y = y, x
        return [size - x if flags & 1 else x, size - y if flags & 2 else y]

    shapes = []
    for shape in value["shapes"]:
        if shape["kind"] == "polygon":
            shapes.append({**shape, "points": [point(*p) for p in shape["points"]]})
        else:
            a = point(shape["x"], shape["y"])
            b = point(shape["x"] + shape["width"], shape["y"] + shape["height"])
            shapes.append(
                {
                    **shape,
                    "x": min(a[0], b[0]),
                    "y": min(a[1], b[1]),
                    "width": abs(a[0] - b[0]),
                    "height": abs(a[1] - b[1]),
                }
            )
    return {**value, "shapes": shapes}


def collision_test(scene, document, include_hidden):
    """Index authored artwork collision shapes; touching edges remain walkable."""
    grid = scene["grid"]
    buckets = {}
    remaining = COLLISION_WORK_LIMIT

    def spend(amount=1):
        nonlocal remaining
        remaining -= amount
        if remaining < 0:
            raise CollisionWorkExceeded

    for layer in scene_layers(scene):
        if not include_hidden and not layer["visible"]:
            continue
        placements = []
        if layer["type"] == "tilelayer":
            placements = [
                (asset, str(grid), x * grid, y * grid, None)
                for y, row in enumerate(layer["cells"])
                for x, asset in enumerate(row)
                if asset
            ]
        else:
            placements = [
                (o["asset"], "sprites", o["x"], o["y"], o)
                for o in layer["objects"]
                if o.get("kind", "sprite") == "sprite"
            ]
        for asset, group, x, y, item in placements:
            asset, flags = cell_parts(asset)
            entry = document["atlases"][asset.split("/")[0]]
            metadata = entry.get("metadata", {}).get(group, {}).get(asset)
            if not metadata or not (metadata["solid"] or metadata["shapes"]):
                continue
            if flags:
                metadata = transformed_metadata(metadata, flags, grid)
            w = h = grid
            if item is not None:
                region = next(
                    r
                    for r in entry["manifest"]["regions"]
                    if asset == f"{entry['manifest']['id']}/{r['name']}"
                )
                w, h = region["width"], region["height"]
                ox, oy = item.get("origin", region.get("origin", [0, 0]))
                x, y = x - ox, y - oy
            record = (x, y, w, h, metadata)
            for by in range(math.floor(y / grid), math.ceil((y + h) / grid)):
                for bx in range(math.floor(x / grid), math.ceil((x + w) / grid)):
                    spend()
                    buckets.setdefault((bx, by), []).append(record)

    def blocked(rect):
        x, y, w, h = rect
        if x < 0 or y < 0 or x + w > scene["width"] * grid or y + h > scene["height"] * grid:
            return True
        if not buckets:
            return False
        for by in range(math.floor(y / grid), math.ceil((y + h) / grid)):
            for bx in range(math.floor(x / grid), math.ceil((x + w) / grid)):
                spend()
                for ox, oy, ow, oh, meta in buckets.get((bx, by), []):
                    spend()
                    if not overlap(rect, (ox, oy, ow, oh)):
                        continue
                    if not meta["shapes"]:
                        return True
                    for shape in meta["shapes"]:
                        spend(len(shape["points"]) if shape["kind"] == "polygon" else 1)
                        if shape_overlap((x - ox, y - oy, w, h), shape):
                            return True
        return False

    return blocked


def movement(scene, document, config, markers, emit):
    try:
        _movement(scene, document, config, markers, emit)
    except CollisionWorkExceeded:
        emit(
            "unverified-movement",
            "info",
            "Collision-work budget exceeded; remaining entrance and reachability checks were not run.",
        )


def _movement(scene, document, config, markers, emit):
    entrances = [m for m in markers if m["entrance"]]
    starts = [m for m in markers if m["spawn"] or m["entrance"]]
    goals = [m for m in markers if m["goal"]]
    fp = config["footprint"]

    def rect(x, y):
        return (x + fp["x"], y + fp["y"], fp["width"], fp["height"])

    spawns = [m for m in markers if m["spawn"]]
    # Sweep and overlap work is intentionally bounded for hostile/very large projects.
    if len(spawns) > 512:
        emit("unverified-movement", "info", "More than 512 spawns; overlap check was not run.")
    else:
        for i, a in enumerate(spawns):
            for b in spawns[i + 1 :]:
                if overlap(rect(a["x"], a["y"]), rect(b["x"], b["y"])):
                    emit(
                        "overlapping-spawns",
                        "warning",
                        f"Spawn overlaps object {b['id']} under the selected footprint.",
                        a,
                    )
    if config["movement"] == "none":
        emit(
            "unverified-movement",
            "info",
            "Reachability and blocked entrances not checked: choose a movement model.",
        )
        return
    blocked = collision_test(scene, document, config["include_hidden"])
    for marker in entrances:
        if blocked(rect(marker["x"], marker["y"])):
            emit(
                "blocked-entrance",
                "error",
                "Entrance footprint intersects collision or scene bounds.",
                marker,
            )
    if scene["width"] * scene["height"] > 65536 or len(starts) * len(goals) > 4096:
        emit(
            "unverified-movement",
            "info",
            "Reachability exceeds the 65,536-cell / 4,096 start-goal pair limit.",
        )
        return
    if not starts or not goals:
        emit(
            "unverified-movement",
            "info",
            "Reachability needs at least one spawn/entrance and one goal in this scene.",
        )
        return
    grid = scene["grid"]

    def point(cell):
        return ((cell[0] + 0.5) * grid, (cell[1] + 0.5) * grid)

    def swept(a, b):
        return blocked(
            (
                min(a[0], b[0]) + fp["x"],
                min(a[1], b[1]) + fp["y"],
                fp["width"] + abs(a[0] - b[0]),
                fp["height"] + abs(a[1] - b[1]),
            )
        )

    def anchors(m):
        p = (m["x"], m["y"])
        x, y = p[0] / grid - 0.5, p[1] / grid - 0.5
        # Conservative straight sweep to adjacent lattice centers (no diagonal grid edges).
        return [
            (cx, cy)
            for cx in {math.floor(x), math.ceil(x)}
            for cy in {math.floor(y), math.ceil(y)}
            if 0 <= cx < scene["width"]
            and 0 <= cy < scene["height"]
            and not swept(p, point((cx, cy)))
        ]

    # Connected components let all starts/goals share one deterministic traversal.
    components = {}
    component = 0
    for y in range(scene["height"]):
        for x in range(scene["width"]):
            cell = (x, y)
            if cell in components or blocked(rect(*point(cell))):
                continue
            component += 1
            components[cell] = component
            queue = deque([cell])
            while queue:
                a = queue.popleft()
                for b in ((a[0] - 1, a[1]), (a[0] + 1, a[1]), (a[0], a[1] - 1), (a[0], a[1] + 1)):
                    if (
                        0 <= b[0] < scene["width"]
                        and 0 <= b[1] < scene["height"]
                        and b not in components
                        and not swept(point(a), point(b))
                    ):
                        components[b] = component
                        queue.append(b)
    for start in starts:
        reachable = {components[c] for c in anchors(start) if c in components}
        for goal in goals:
            if start["id"] == goal["id"]:
                continue
            if not reachable.intersection(components[c] for c in anchors(goal) if c in components):
                emit(
                    "unreachable",
                    "warning",
                    f"Goal object {goal['id']} has no route from object {start['id']} under the selected grid model; this does not establish runtime reachability.",
                    goal,
                    start=start["id"],
                )


def report(document, scenes, config):
    findings = []
    excluded = set(config["excluded_scenes"])
    definitions = document.get("object_definitions", {}).get("definitions", [])
    endpoints = {
        (link[key]["scene"], link[key]["object"])
        for link in document.get("world", world.empty())["connections"]
        for key in ("source", "destination")
    }
    used = set()

    def assets(value):
        if isinstance(value, str) and "/" in value:
            used.add(cell_parts(value)[0])
        elif isinstance(value, dict):
            for child in value.values():
                assets(child)
        elif isinstance(value, list):
            for child in value:
                assets(child)

    # Excluded/hidden scenes still count as asset consumers; so do reusable libraries.
    assets([s["scene"] for s in scenes.values()])
    assets(document.get("stamps", []))
    assets(definitions)
    assets(document.get("preview", {}))
    # Preview preferences identify sprites by key rather than by value.
    preview_sprite = document.get("preview", {}).get("sprite", {})
    for collection in ("mappings", "selections"):
        assets(list(preview_sprite.get(collection, {})))
    for entry in document["scenes"]:
        sid = entry["id"]
        if sid in excluded:
            continue
        scene = scenes[sid]["scene"]

        def emit(code, severity, message, marker=None, **extra):
            location = (
                {}
                if marker is None
                else {
                    "object": marker["id"],
                    "layer": marker["layer"],
                    "x": marker["x"],
                    "y": marker["y"],
                }
            )
            findings.append(
                {
                    "scene": sid,
                    "code": code,
                    "severity": severity,
                    "message": message,
                    **location,
                    **extra,
                }
            )

        profile = document.get("gbc_palette_profile")
        if profile is not None and profile["version"] == 2:
            budget = palette_budget.report(scene, document, profile, sid)
            emit(
                "gbc-budget",
                "info",
                "GBC runtime compatibility is unverified; open GBC budgets for assumptions and contributors.",
            )
            for pool, metric in budget["hardware"]["metrics"].items():
                emit(
                    "gbc-budget",
                    "warning" if metric["status"] == "over-estimate" else "info",
                    f"{pool}: {metric['required']} estimated; {metric['available']} available — {metric['status']}.",
                )
            for message in budget["errors"]:
                emit("gbc-budget", "error", message)
        markers = []
        for layer in scene_layers(scene):
            if not config["include_hidden"] and not layer["visible"]:
                continue
            for item in layer.get("objects", []):
                marker = {**item, "layer": layer["id"]}
                for error in object_definitions.resolve(item, definitions)[1]:
                    emit(
                        error["code"],
                        "warning" if error["code"] == "unknown-field" else "error",
                        f"Object {item['id']}: {error['field'] or 'definition'} — {error['code']}.",
                        marker,
                        field=error["field"],
                    )
                for role in ("spawn", "entrance", "goal"):
                    marker[role] = item.get("definition") in config[f"{role}_definitions"]
                marker["entrance"] |= (sid, item["id"]) in endpoints
                markers.append(marker)
        movement(scene, document, config, markers, emit)
    connections = {
        link["id"]: link["name"] for link in document.get("world", world.empty())["connections"]
    }
    for finding in world.report(document, scenes)["findings"]:
        if finding["scene"] in excluded:
            continue
        if not config["include_hidden"] and finding["layer"] is not None:
            layer = next(
                candidate
                for candidate in scene_layers(scenes[finding["scene"]]["scene"])
                if candidate["id"] == finding["layer"]
            )
            if not layer["visible"]:
                continue
        # Definition errors already have object locations; retain connection context as well.
        findings.append(
            {
                **finding,
                "severity": "warning" if finding["code"] == "unknown-field" else "error",
                "message": f"Connection {connections[finding['connection']]} {finding['endpoint']}: {finding['field'] or 'endpoint'} — {finding['code']}.",
            }
        )
    for aid, entry in sorted(document["atlases"].items()):
        mappings = {**entry["tiles"], "sprites": atlas.sprite_mapping(entry)}
        # Animation frames are dependencies of any used region in that sequence.
        changed = True
        while changed:
            before = len(used)
            for animation in entry["manifest"].get("animations", []):
                prefixes = {f"{aid}/{f['region']}" for f in animation["frames"]}
                frames = {
                    asset
                    for mapping in mappings.values()
                    for asset in mapping
                    if asset in prefixes or "/".join(asset.split("/")[:2]) in prefixes
                }
                if used & frames:
                    used.update(frames)
            changed = len(used) != before
        for group, mapping in sorted(mappings.items()):
            for asset in sorted(mapping):
                if asset not in used:
                    findings.append(
                        {
                            "code": "unused-asset",
                            "severity": "info",
                            "asset": asset,
                            "group": group,
                            "message": f"Unused asset {asset} ({group}); retained in the project.",
                        }
                    )
    suppressed = sum(f["code"] in config["excluded_codes"] for f in findings)
    findings = [f for f in findings if f["code"] not in config["excluded_codes"]]
    for index, finding in enumerate(findings):
        finding["id"] = f"finding-{index + 1}"
    return {
        "version": 1,
        "options": config,
        "findings": findings,
        "suppressed": suppressed,
        "status": "fail"
        if any(f["severity"] == "error" for f in findings)
        else "warning"
        if any(f["severity"] == "warning" for f in findings)
        else "unverified"
        if any(f["code"] in ("unverified-movement", "gbc-budget") for f in findings)
        else "pass",
        "scenes": [{"id": e["id"], "name": e["name"]} for e in document["scenes"]],
    }
