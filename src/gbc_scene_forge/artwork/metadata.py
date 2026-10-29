"""Forge-authored tileset metadata, separate from imported atlas provenance."""

import json

from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import integer, require

DEFAULT = {"terrain": "", "solid": False, "shapes": [], "next_shape_id": 1}


def dimensions(entry, group, asset):
    require(isinstance(group, str) and group in entry["tiles"], "Unknown tileset grid")
    require(isinstance(asset, str) and asset in entry["tiles"][group], "Unknown tile identity")
    if group != "sprites":
        return int(group), int(group)
    region = next(
        r for r in entry["manifest"]["regions"] if asset == f"{entry['manifest']['id']}/{r['name']}"
    )
    return region["width"], region["height"]


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def intersects(a, b, c, d):
    def on_segment(a, b, c):
        return cross(a, b, c) == 0 and all(
            min(a[i], b[i]) <= c[i] <= max(a[i], b[i]) for i in (0, 1)
        )

    return (
        (cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0)
        or on_segment(a, b, c)
        or on_segment(a, b, d)
        or on_segment(c, d, a)
        or on_segment(c, d, b)
    )


def check_metadata(value, width, height):
    require(
        isinstance(value, dict) and set(value) == set(DEFAULT), "Unsupported tile metadata fields"
    )
    require(
        isinstance(value["terrain"], str) and len(value["terrain"]) <= 100,
        "Terrain classification must contain at most 100 characters",
    )
    require(type(value["solid"]) is bool, "Collision solid flag must be boolean")
    shapes = value["shapes"]
    require(
        isinstance(shapes, list) and len(shapes) <= 32, "Use at most 32 collision shapes per tile"
    )
    seen = set()
    for shape in shapes:
        require(isinstance(shape, dict), "Expected a collision shape")
        require(
            integer(shape.get("id"), 1, 2147483646) and shape["id"] not in seen,
            "Invalid or duplicate collision shape ID",
        )
        seen.add(shape["id"])
        kind = shape.get("kind")
        require(kind in ("rectangle", "ellipse", "polygon"), "Unsupported collision shape")
        fields = {"points"} if kind == "polygon" else {"x", "y", "width", "height"}
        require(set(shape) == {"id", "kind"} | fields, "Unsupported collision shape fields")
        if kind == "polygon":
            points = shape["points"]
            require(
                isinstance(points, list)
                and 3 <= len(points) <= 32
                and all(
                    isinstance(p, list)
                    and len(p) == 2
                    and integer(p[0], 0, width)
                    and integer(p[1], 0, height)
                    for p in points
                ),
                "Polygons need 3..32 whole-pixel points inside the tile (including edges)",
            )
            require(len({tuple(p) for p in points}) == len(points), "Polygon points must be unique")
            edges = list(zip(points, points[1:] + points[:1]))
            require(
                sum(a[0] * b[1] - b[0] * a[1] for a, b in edges) != 0,
                "Collision polygon needs nonzero area",
            )
            require(
                all(
                    cross(points[i - 1], p, points[(i + 1) % len(points)]) != 0
                    for i, p in enumerate(points)
                ),
                "Remove collinear polygon vertices",
            )
            require(
                not any(
                    intersects(a, b, c, d)
                    for i, (a, b) in enumerate(edges)
                    for j, (c, d) in enumerate(edges)
                    if j > i + 1 and (i, j) != (0, len(edges) - 1)
                ),
                "Collision polygon must not intersect itself",
            )
        else:
            require(
                integer(shape["x"], 0, width - 1)
                and integer(shape["y"], 0, height - 1)
                and integer(shape["width"], 1, width - shape["x"])
                and integer(shape["height"], 1, height - shape["y"]),
                "Collision shapes need positive whole-pixel bounds inside the tile",
            )
    require(
        integer(value["next_shape_id"], max(seen, default=0) + 1, 2147483647),
        "Invalid next collision shape ID",
    )


def check_entry(entry):
    metadata = entry.get("metadata", {})
    require(isinstance(metadata, dict), "Expected tileset metadata")
    for group, records in metadata.items():
        require(group in entry["tiles"] and isinstance(records, dict), "Unknown metadata tileset")
        for asset, value in records.items():
            check_metadata(value, *dimensions(entry, group, asset))


def tile_fields(asset, value, width, height):
    properties = [{"name": "forge:asset", "type": "string", "value": asset}]
    result = {"properties": properties}
    if value is None:
        return result
    properties.extend(
        [
            {"name": "forge:terrain", "type": "string", "value": value["terrain"]},
            {"name": "forge:solid", "type": "bool", "value": value["solid"]},
            {"name": "forge:next_shape_id", "type": "int", "value": value["next_shape_id"]},
        ]
    )
    objects = []
    shapes = value["shapes"]
    if not shapes and value["solid"]:
        shapes = [{"id": 1, "kind": "rectangle", "x": 0, "y": 0, "width": width, "height": height}]
    for shape in shapes:
        item = {"id": shape["id"], "name": "", "type": "", "rotation": 0, "visible": True}
        if shape["kind"] == "polygon":
            item.update(
                x=0, y=0, width=0, height=0, polygon=[{"x": x, "y": y} for x, y in shape["points"]]
            )
        else:
            item.update({key: shape[key] for key in ("x", "y", "width", "height")})
            if shape["kind"] == "ellipse":
                item["ellipse"] = True
        objects.append(item)
    if objects:
        result["objectgroup"] = {
            "type": "objectgroup",
            "name": "",
            "draworder": "index",
            "opacity": 1,
            "visible": True,
            "x": 0,
            "y": 0,
            "objects": objects,
        }
    return result


def decorate(entry, group, document):
    """Apply authored data to generated records; semantic references survive atlas reimports."""
    values = entry.get("metadata", {}).get(group, {})
    mapping = {local: asset for asset, local in entry["tiles"][group].items()}
    for tile in document["tiles"]:
        asset = mapping[tile["id"]]
        tile.pop("objectgroup", None)
        tile.update(tile_fields(asset, values.get(asset), *dimensions(entry, group, asset)))
    return document


def decorate_changes(entry, changes):
    for group in entry["tiles"]:
        filename = "sprites" if group == "sprites" else f"grid-{group}"
        path = f"assets/{entry['manifest']['id']}/{filename}.tsj"
        if path in changes:
            document = json.loads(changes[path])
            changes[path] = json_text(decorate(entry, group, document)).encode()
