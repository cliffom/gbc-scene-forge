"""Deterministic bounded raster operations; no transport, active selection or clipboard."""

import base64
import copy
from array import array
from collections import Counter

from gbc_scene_forge.artwork import dimensions, editable
from gbc_scene_forge.core.validation import integer, require

MAX_OPERATIONS = 128
MAX_WORK = 16_777_216  # Sum of visited rectangle pixels, including fill/copy/transform work.
COLOR_PAGE = 256
MAX_COLORS = 65_536


def rectangle(d, value=None):
    r = value if value is not None else dict(x=0, y=0, width=d["width"], height=d["height"])
    require(
        isinstance(r, dict)
        and set(r) == {"x", "y", "width", "height"}
        and integer(r["x"], 0, d["width"] - 1)
        and integer(r["y"], 0, d["height"] - 1)
        and integer(r["width"], 1, d["width"] - r["x"])
        and integer(r["height"], 1, d["height"] - r["y"]),
        "Rectangle must fit the artwork",
    )
    return r


def color(value):
    require(
        isinstance(value, list) and len(value) == 4 and all(integer(v, 0, 255) for v in value),
        "Expected exact RGBA8 color",
    )
    return bytes(value)


def edit(candidate, operations):
    pixels = bytearray(editable.check_candidate(candidate))
    require(
        isinstance(operations, list) and 1 <= len(operations) <= MAX_OPERATIONS,
        "Provide 1..128 raster operations",
    )
    require(
        len(editable.canonical_bytes(operations)) <= editable.MAX_BATCH,
        "Raster operations exceed 1 MiB",
    )
    d, work = candidate["descriptor"], 0
    width = d["width"]

    def offset(x, y):
        return (y * width + x) * 4

    for op in operations:
        require(isinstance(op, dict) and isinstance(op.get("op"), str), "Expected raster operation")
        kind = op["op"]
        fields = {
            "fill": ({"at", "rgba"}, {"rectangle"}),
            "line": ({"from", "to", "rgba"}, set()),
            "rectangle": ({"rectangle", "rgba"}, {"filled"}),
            "ellipse": ({"rectangle", "rgba"}, {"filled"}),
            "copy": ({"rectangle", "to"}, set()),
            "move": ({"rectangle", "to"}, set()),
            "flip": ({"rectangle", "axis"}, set()),
            "resize": ({"rectangle", "to", "width", "height"}, set()),
            "replace": ({"from", "rgba"}, {"rectangle"}),
            "remap": ({"colors"}, {"rectangle"}),
        }
        require(kind in fields, "Unsupported raster operation")
        mandatory, optional = fields[kind]
        require(
            mandatory | {"op"} <= set(op) and not set(op) - mandatory - optional - {"op"},
            "Unexpected raster operation fields",
        )
        r = rectangle(d, op.get("rectangle"))
        x0, y0, w, h = (r[k] for k in ("x", "y", "width", "height"))

        def point(value):
            require(
                isinstance(value, list)
                and len(value) == 2
                and integer(value[0], 0, width - 1)
                and integer(value[1], 0, d["height"] - 1),
                "Point must fit the artwork",
            )
            return value

        if kind == "line":
            a, b = point(op["from"]), point(op["to"])
            work += max(abs(b[0] - a[0]), abs(b[1] - a[1])) + 1
        else:
            work += w * h
        require(work <= MAX_WORK, "Raster batch exceeds 16777216 pixel work; split operations")
        if kind in {"copy", "move", "flip", "resize"}:
            source = bytes().join(
                pixels[offset(x0, y) : offset(x0 + w, y)] for y in range(y0, y0 + h)
            )
            target = point(op["to"]) if "to" in op else [x0, y0]
            tw, th = (op["width"], op["height"]) if kind == "resize" else (w, h)
            rectangle(d, dict(x=target[0], y=target[1], width=tw, height=th))
            work += tw * th
            require(work <= MAX_WORK, "Raster batch exceeds pixel work budget")
            if kind == "flip":
                require(op["axis"] in ("horizontal", "vertical"), "Choose horizontal or vertical")
            if kind == "move":
                for y in range(y0, y0 + h):
                    pixels[offset(x0, y) : offset(x0 + w, y)] = bytes(w * 4)
            for y in range(th):
                for x in range(tw):
                    sx, sy = x * w // tw, y * h // th
                    if kind == "flip":
                        sx = w - 1 - x if op["axis"] == "horizontal" else x
                        sy = h - 1 - y if op["axis"] == "vertical" else y
                    start = (sy * w + sx) * 4
                    i = offset(target[0] + x, target[1] + y)
                    pixels[i : i + 4] = source[start : start + 4]
            continue
        if kind in {"replace", "remap"}:
            pairs = [[op["from"], op["rgba"]]] if kind == "replace" else op["colors"]
            require(
                isinstance(pairs, list) and 1 <= len(pairs) <= 1024,
                "Use 1..1024 explicit color pairs",
            )
            mapping = {}
            for pair in pairs:
                require(
                    isinstance(pair, list) and len(pair) == 2, "Expected [source, target] pairs"
                )
                old, new = color(pair[0]), color(pair[1])
                require(old not in mapping, "Duplicate source color")
                mapping[old] = new
            for y in range(y0, y0 + h):
                for x in range(x0, x0 + w):
                    i = offset(x, y)
                    pixels[i : i + 4] = mapping.get(bytes(pixels[i : i + 4]), pixels[i : i + 4])
            continue
        ink = color(op["rgba"])
        if kind == "fill":
            x, y = point(op["at"])
            require(x0 <= x < x0 + w and y0 <= y < y0 + h, "Fill seed outside rectangle")
            old = pixels[offset(x, y) : offset(x, y) + 4]
            if old == ink:
                continue
            pending = array("I", [(y - y0) * w + x - x0])
            visited = bytearray(w * h)
            visited[pending[0]] = 1
            while pending:
                mark = pending.pop()
                x, y = x0 + mark % w, y0 + mark // w
                i = offset(x, y)
                if pixels[i : i + 4] != old:
                    continue
                pixels[i : i + 4] = ink
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if x0 <= nx < x0 + w and y0 <= ny < y0 + h:
                        neighbor = (ny - y0) * w + nx - x0
                        if not visited[neighbor]:
                            visited[neighbor] = 1
                            pending.append(neighbor)
        elif kind == "line":
            x, y = a
            bx, by = b
            dx, dy = abs(bx - x), -abs(by - y)
            sx, sy = (1 if x < bx else -1), (1 if y < by else -1)
            error = dx + dy
            while True:
                i = offset(x, y)
                pixels[i : i + 4] = ink
                if (x, y) == (bx, by):
                    break
                twice = 2 * error
                if twice >= dy:
                    error += dy
                    x += sx
                if twice <= dx:
                    error += dx
                    y += sy
        else:
            require(type(op.get("filled", False)) is bool, "filled must be boolean")

            def inside(x, y):
                return (2 * x + 1 - w) ** 2 * h * h + (2 * y + 1 - h) ** 2 * w * w <= w * w * h * h

            for y in range(h):
                for x in range(w):
                    draw = kind == "rectangle" and (
                        op.get("filled", False) or x in (0, w - 1) or y in (0, h - 1)
                    )
                    if kind == "ellipse":
                        draw = inside(x, y) and (
                            op.get("filled", False)
                            or not all(
                                inside(nx, ny)
                                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                            )
                        )
                    if draw:
                        i = offset(x0 + x, y0 + y)
                        pixels[i : i + 4] = ink
    body = {k: copy.deepcopy(v) for k, v in candidate.items() if k != "revision"}
    body["rgba"] = base64.b64encode(pixels).decode()
    return editable.seal(body)


def colors(candidate, region=None, offset=0):
    pixels = editable.check_candidate(candidate)
    d = candidate["descriptor"]
    r = rectangle(d, region)
    require(integer(offset, 0, dimensions.MAX_PIXELS), "Invalid color page offset")
    counts = Counter()
    for y in range(r["y"], r["y"] + r["height"]):
        start = (y * d["width"] + r["x"]) * 4
        for i in range(start, start + r["width"] * 4, 4):
            counts[pixels[i : i + 4]] += 1
            require(
                len(counts) <= MAX_COLORS,
                "Color counts exceed 65536 distinct colors; choose a smaller rectangle",
            )
    ordered = sorted(counts, key=lambda c: (-counts[c], c))
    return dict(
        candidate_revision=candidate["revision"],
        rectangle=r,
        total_colors=len(counts),
        colors=[dict(rgba=list(c), count=counts[c]) for c in ordered[offset : offset + COLOR_PAGE]],
        next_offset=offset + COLOR_PAGE if offset + COLOR_PAGE < len(counts) else None,
    )
