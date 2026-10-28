"""Standalone point, rectangle and sprite objects, with Tiled property encoding."""

import math

from .atlas import integer, require

MAX_INT = 9007199254740991
ORIGIN_KEYS = ("forge:origin_x", "forge:origin_y")


def check_properties(properties):
    require(isinstance(properties, list) and len(properties) <= 128, "Use at most 128 properties")
    names = set()
    for prop in properties:
        require(
            isinstance(prop, dict) and set(prop) == {"name", "type", "value"},
            "Unsupported property fields",
        )
        name, kind, value = (prop[key] for key in ("name", "type", "value"))
        require(
            isinstance(name, str)
            and 1 <= len(name) <= 100
            and name.strip()
            and not name.startswith("forge:")
            and name not in names,
            "Property names must be unique, nonempty and not start with forge:",
        )
        names.add(name)
        valid = (
            (kind == "string" and isinstance(value, str) and len(value) <= 4096)
            or (kind == "bool" and type(value) is bool)
            or (kind == "int" and type(value) is int and -MAX_INT <= value <= MAX_INT)
            or (
                kind == "float"
                and type(value) in (int, float)
                and -MAX_INT <= value <= MAX_INT
                and math.isfinite(value)
            )
        )
        require(valid, f"Invalid {kind} property {name}; use string, bool, int or float")


def check_object(item, width, height, sprites):
    require(isinstance(item, dict), "Expected an object")
    common = {"id", "x", "y", "name", "class", "properties"}
    kind = item.get("kind", "sprite")
    extra = {
        "sprite": {"asset", "origin"},
        "point": {"kind"},
        "rectangle": {"kind", "width", "height"},
    }
    require(
        isinstance(kind, str)
        and kind in extra
        and {"id", "x", "y"} <= set(item)
        and not set(item) - common - extra[kind],
        "Unsupported object fields or kind",
    )
    require(integer(item["id"], 1, 2147483646), "Invalid object ID")
    require(
        integer(item["x"], 0, width - 1) and integer(item["y"], 0, height - 1),
        "Object position must be at whole pixels inside the scene",
    )
    for field in ("name", "class"):
        require(
            isinstance(item.get(field, ""), str) and len(item.get(field, "")) <= 100,
            f"Object {field} must be at most 100 characters",
        )
    check_properties(item.get("properties", []))
    if kind == "sprite":
        require(
            isinstance(item.get("asset"), str) and item["asset"] in sprites, "Unknown sprite asset"
        )
        if "origin" in item:
            origin, region = item["origin"], sprites[item["asset"]]
            require(
                isinstance(origin, list)
                and len(origin) == 2
                and integer(origin[0], 0, region["width"])
                and integer(origin[1], 0, region["height"]),
                "Sprite origin must be inside its native bounds (including edges)",
            )
    elif kind == "rectangle":
        require(
            integer(item.get("width"), 1, width - item["x"])
            and integer(item.get("height"), 1, height - item["y"]),
            "Rectangle dimensions must be positive whole pixels inside the scene",
        )


def encode_object(item, sprites, gids):
    result = {
        "id": item["id"],
        "name": item.get("name", ""),
        "type": item.get("class", ""),
        "x": item["x"],
        "y": item["y"],
        "width": 0,
        "height": 0,
        "rotation": 0,
        "visible": True,
        "opacity": 1,
    }
    properties = list(item.get("properties", []))
    if item.get("kind", "sprite") == "sprite":
        region = sprites[item["asset"]]
        ox, oy = item.get("origin", region.get("origin", [0, 0]))
        result.update(
            gid=gids[item["asset"]],
            x=item["x"] - ox,
            y=item["y"] - oy + region["height"],
            width=region["width"],
            height=region["height"],
        )
        if "origin" in item:
            properties.extend(
                {"name": key, "type": "int", "value": value}
                for key, value in zip(ORIGIN_KEYS, item["origin"])
            )
    elif item["kind"] == "point":
        result["point"] = True
    else:
        result.update(width=item["width"], height=item["height"])
    if properties:
        result["properties"] = sorted(properties, key=lambda prop: prop["name"])
    return result


def decode_object(item, sprites, gids):
    allowed = {
        "id",
        "name",
        "type",
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "visible",
        "opacity",
        "gid",
        "point",
        "properties",
    }
    require(
        isinstance(item, dict) and not set(item) - allowed,
        "Unsupported Tiled object fields; refusing to discard data",
    )
    require(
        item.get("rotation", 0) == 0
        and item.get("opacity", 1) == 1
        and item.get("visible", True) is True,
        "Unsupported object transform or visibility",
    )
    require(
        all(
            type(item.get(key)) in (int, float)
            and -MAX_INT <= item[key] <= MAX_INT
            and math.isfinite(item[key])
            and int(item[key]) == item[key]
            for key in ("x", "y")
        ),
        "Object coordinates must be whole pixels",
    )
    props = item.get("properties", [])
    require(isinstance(props, list), "Expected object properties")
    origin_props, properties = {}, []
    for prop in props:
        require(isinstance(prop, dict), "Expected a typed property")
        if prop.get("name") in ORIGIN_KEYS:
            require(
                set(prop) == {"name", "type", "value"}
                and prop["type"] == "int"
                and type(prop["value"]) is int
                and prop["name"] not in origin_props,
                "Invalid sprite origin property",
            )
            origin_props[prop["name"]] = prop["value"]
        else:
            properties.append(prop)
    check_properties(properties)
    result = {"id": item.get("id"), "x": int(item["x"]), "y": int(item["y"])}
    if "gid" in item:
        gid = item["gid"]
        require(
            type(gid) is int and gid in gids and gids[gid] in sprites,
            "Unknown or transformed sprite GID",
        )
        region = sprites[gids[gid]]
        require(
            "point" not in item
            and item.get("width") == region["width"]
            and item.get("height") == region["height"],
            "Only native-size sprites are supported",
        )
        origin = region.get("origin", [0, 0])
        if origin_props:
            require(set(origin_props) == set(ORIGIN_KEYS), "Sprite origin needs both coordinates")
            origin = [origin_props[key] for key in ORIGIN_KEYS]
            result["origin"] = origin
        result.update(
            asset=gids[gid], x=result["x"] + origin[0], y=result["y"] + origin[1] - region["height"]
        )
    else:
        require(not origin_props, "Only sprites may override their origin")
        if "point" in item:
            require(
                item["point"] is True and item.get("width", 0) == item.get("height", 0) == 0,
                "Invalid point dimensions",
            )
            result["kind"] = "point"
        else:
            require(
                all(
                    type(item.get(key)) in (int, float)
                    and 1 <= item[key] <= 8192
                    and int(item[key]) == item[key]
                    for key in ("width", "height")
                ),
                "Invalid rectangle dimensions",
            )
            result.update(kind="rectangle", width=int(item["width"]), height=int(item["height"]))
    for source, target in (("name", "name"), ("type", "class")):
        require(isinstance(item.get(source, ""), str), f"Invalid object {target}")
        if item.get(source):
            result[target] = item[source]
    if properties:
        result["properties"] = sorted(properties, key=lambda prop: prop["name"])
    return result
