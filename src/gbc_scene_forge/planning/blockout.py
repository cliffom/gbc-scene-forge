"""Artwork-free planning using ordinary definitions, objects and portable Tiled layers.

These pure services are independent of HTTP and the browser, so other local clients
can create and inspect the same plans without introducing another document format.
"""

import copy
import hashlib
import html
import json
import re
from uuid import uuid4

from gbc_scene_forge.artwork.model import GRIDS
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.scene_objects import definitions as object_definitions
from gbc_scene_forge.scene_objects.model import check_object

ROLE = "blockout_role"
COLOR = "blockout_color"
SYMBOL = "blockout_symbol"
PATTERN = "blockout_pattern"
PRESETS = (
    ("solid", "Solid ground", "rectangle", 48, 16, "#94b87b", "G", "solid"),
    ("one_way", "One-way platform", "rectangle", 40, 8, "#afd39c", "1W", "one-way"),
    ("water", "Water", "rectangle", 32, 16, "#73b8dc", "W", "waves"),
    ("pit", "Pit", "rectangle", 24, 24, "#b096c4", "PIT", "cross"),
    ("damage", "Damaging terrain", "rectangle", 24, 16, "#e19483", "!", "cross"),
    ("climb", "Climb region", "rectangle", 16, 48, "#d3b873", "CL", "ladder"),
    ("enemy", "Enemy", "point", 0, 0, "#e59f91", "E", "solid"),
    ("patrol", "Patrol range", "rectangle", 64, 24, "#e59f91", "↔", "outline"),
    ("approach", "Flying approach", "rectangle", 64, 48, "#dca2d6", "↘", "outline"),
    ("reward", "Visible reward", "point", 0, 0, "#ead084", "+", "solid"),
    ("hidden_reward", "Hidden discoverable", "point", 0, 0, "#ead084", "?", "outline"),
    ("detour", "Optional detour", "rectangle", 48, 32, "#a9bbdb", "D", "outline"),
    ("spawn", "Player spawn", "point", 0, 0, "#a7dbb0", "S", "solid"),
    ("checkpoint", "Checkpoint", "point", 0, 0, "#9bdad6", "C", "solid"),
    ("boss_entrance", "Boss entrance", "point", 0, 0, "#e0a6b6", "B", "outline"),
    ("arena", "Boss arena", "rectangle", 160, 112, "#d49aac", "A", "outline"),
    ("exit", "Stage exit", "point", 0, 0, "#9bd4bd", "X", "solid"),
    ("section", "Named section", "rectangle", 160, 136, "#b1b5a7", "§", "outline"),
    ("note", "Design note", "point", 0, 0, "#ddd5b6", "N", "outline"),
    ("camera", "Camera frame", "rectangle", 160, 136, "#e7c977", "CAM", "outline"),
)
PATTERNS = ("solid", "one-way", "waves", "cross", "ladder", "outline")


def field(name, kind, default, **constraints):
    return {"name": name, "type": kind, "required": False, "default": default, **constraints}


def initialize(project):
    """Seed editable definitions once; never overwrite a project's existing presets."""
    library = project.setdefault("object_definitions", {"version": 1, "definitions": []})
    if any(any(f["name"] == ROLE for f in d["fields"]) for d in library["definitions"]):
        return
    require(len(library["definitions"]) + len(PRESETS) <= 128, "No room for blockout definitions")
    for role, label, kind, width, height, color, symbol, pattern in PRESETS:
        fields = [
            field(ROLE, "string", role),
            field(COLOR, "string", color),
            field(SYMBOL, "string", symbol),
            field(PATTERN, "string", pattern, choices=list(PATTERNS)),
            field("design_note", "string", ""),
        ]
        if role == "camera":
            fields += [field("scroll_x", "bool", True), field("scroll_y", "bool", False)]
        if role == "climb":
            for endpoint, edge in (("entry", "bottom"), ("exit", "top")):
                fields += [
                    field(
                        f"{endpoint}_edge",
                        "string",
                        edge,
                        choices=["top", "bottom", "left", "right"],
                    ),
                    field(f"{endpoint}_offset", "float", 0.5, min=0, max=1),
                ]
        if role in ("enemy", "patrol", "approach"):
            fields += [field("actor", "string", "")]
        if role in ("reward", "hidden_reward"):
            fields += [field("reward_type", "string", "")]
        library["definitions"].append(
            {
                "id": str(uuid4()),
                "name": label,
                "kind": kind,
                "fields": fields,
                **({"width": width, "height": height} if kind == "rectangle" else {}),
            }
        )
    object_definitions.check_library(library, tiled.sprite_regions(project))


def values(item, project):
    props, _ = object_definitions.resolve(
        item, project.get("object_definitions", {}).get("definitions", [])
    )
    return {p["name"]: p["value"] for p in props}


def options(value=None):
    """Normalize units before any mutation; retain the existing bounded scene grid."""
    value = {} if value is None else value
    require(
        isinstance(value, dict)
        and not set(value)
        - {
            "width",
            "height",
            "grid",
            "units",
            "camera_width",
            "camera_height",
            "scroll_x",
            "scroll_y",
        },
        "Unsupported blockout options",
    )
    units, grid = value.get("units", "pixels"), value.get("grid", 8)
    require(
        units in ("pixels", "cells") and type(grid) is int and grid in GRIDS,
        "Invalid units or grid",
    )
    width, height = value.get("width", 960), value.get("height", 272)
    require(integer(width, 1, 8192) and integer(height, 1, 8192), "Use positive whole dimensions")
    if units == "pixels":
        require(
            width % grid == height % grid == 0, "Pixel dimensions must be divisible by the grid"
        )
        width, height = width // grid, height // grid
    require(integer(width, 1, 256) and integer(height, 1, 256), "Use at most 256 cells per axis")
    camera_width, camera_height = value.get("camera_width", 160), value.get("camera_height", 136)
    require(
        integer(camera_width, 1, width * grid) and integer(camera_height, 1, height * grid),
        "The camera frame must fit inside the scene",
    )
    scroll_x, scroll_y = value.get("scroll_x", True), value.get("scroll_y", False)
    require(type(scroll_x) is bool and type(scroll_y) is bool, "Camera axes must be booleans")
    return dict(
        width=width,
        height=height,
        grid=grid,
        camera_width=camera_width,
        camera_height=camera_height,
        scroll_x=scroll_x,
        scroll_y=scroll_y,
    )


def new_scene(project, settings=None):
    require(settings is None or isinstance(settings, dict), "Expected blockout options")
    candidate = copy.deepcopy(project)
    initialize(candidate)
    definitions = candidate["object_definitions"]["definitions"]
    camera = next(
        (
            d
            for d in definitions
            if d["kind"] == "rectangle"
            and any(f["name"] == ROLE and f.get("default") == "camera" for f in d["fields"])
        ),
        None,
    )
    require(camera is not None, "Add a rectangle definition with blockout_role default camera")
    defaults = {f["name"]: f.get("default") for f in camera["fields"]}
    settings = options(
        {
            "camera_width": camera["width"],
            "camera_height": camera["height"],
            "scroll_x": defaults.get("scroll_x", True),
            "scroll_y": defaults.get("scroll_y", False),
            **(settings or {}),
        }
    )
    layers = [
        dict(
            id=1,
            name="Artwork",
            type="tilelayer",
            visible=True,
            cells=[[""] * settings["width"] for _ in range(settings["height"])],
        )
    ]
    for layer_id, label in (
        (2, "Blockout geometry"),
        (3, "Gameplay markers"),
        (4, "Design notes"),
        (5, "Camera guides"),
    ):
        layers.append(dict(id=layer_id, name=label, type="objectgroup", visible=True, objects=[]))
    layers[-1]["objects"].append(
        dict(
            id=1,
            kind="rectangle",
            definition=camera["id"],
            name="Camera",
            x=0,
            y=0,
            width=settings["camera_width"],
            height=settings["camera_height"],
            properties=[
                dict(name=key, type="bool", value=settings[key]) for key in ("scroll_x", "scroll_y")
            ],
        )
    )
    scene = dict(
        width=settings["width"],
        height=settings["height"],
        grid=settings["grid"],
        layers=layers,
        next_layer_id=6,
        next_object_id=2,
    )
    tiled.check_scene(scene, candidate)
    project["object_definitions"] = candidate["object_definitions"]
    return scene


def place(
    scene,
    project,
    definition_id,
    x,
    y,
    *,
    width=None,
    height=None,
    name=None,
    properties=None,
    layer_id=None,
):
    """Return a validated candidate and allocated identity, suitable for local adapters.

    The caller owns revision guards and durable commit. Inputs and existing objects
    are never mutated, and the normal scene/object/definition rules remain authoritative.
    """
    tiled.check_scene(scene, project)
    require("layers" in scene, "Use a layered blockout scene")
    candidate = copy.deepcopy(scene)
    definition = next(
        (
            d
            for d in project.get("object_definitions", {}).get("definitions", [])
            if d["id"] == definition_id
        ),
        None,
    )
    require(
        definition is not None and definition["kind"] in ("point", "rectangle"),
        "Choose a blockout definition",
    )
    item = dict(
        id=candidate.get("next_object_id", 1),
        definition=definition_id,
        kind=definition["kind"],
        name=definition["name"] if name is None else name,
        x=x,
        y=y,
        properties=[] if properties is None else copy.deepcopy(properties),
    )
    item["class"] = definition["name"]
    require(
        integer(x, 0, scene["width"] * scene["grid"] - 1)
        and integer(y, 0, scene["height"] * scene["grid"] - 1),
        "Place the object at whole pixels inside the scene",
    )
    if item["kind"] == "rectangle":
        item.update(
            width=min(definition["width"], scene["width"] * scene["grid"] - x)
            if width is None
            else width,
            height=min(definition["height"], scene["height"] * scene["grid"] - y)
            if height is None
            else height,
        )
    check_object(item, scene["width"] * scene["grid"], scene["height"] * scene["grid"], {})
    props = values(item, project)
    require(
        isinstance(props.get(ROLE), str) and bool(props[ROLE]), "Definition needs blockout_role"
    )
    layers = candidate["layers"]
    label = (
        "Camera guides"
        if props[ROLE] == "camera"
        else "Design notes"
        if props[ROLE] in ("note", "section")
        else "Gameplay markers"
        if item["kind"] == "point"
        else "Blockout geometry"
    )
    if layer_id is not None:
        require(integer(layer_id, 1, 2147483646), "Choose a valid object layer ID")
        layer = next(
            (
                layer
                for layer in layers
                if layer["id"] == layer_id and layer["type"] == "objectgroup" and layer["visible"]
            ),
            None,
        )
    else:
        layer = next(
            (
                layer
                for layer in layers
                if layer["type"] == "objectgroup" and layer["name"] == label and layer["visible"]
            ),
            None,
        )
        if layer is None:
            layer = next(
                (layer for layer in layers if layer["type"] == "objectgroup" and layer["visible"]),
                None,
            )
    require(layer is not None, "Choose a visible object layer")
    layer["objects"].append(item)
    candidate["next_object_id"] = item["id"] + 1
    tiled.check_scene(candidate, project)
    return candidate, item["id"]


def appearance(item, project):
    if item.get("kind", "sprite") not in ("point", "rectangle"):
        return None
    props = values(item, project)
    role = props.get(ROLE)
    if not isinstance(role, str) or not role:
        return None
    color = props.get(COLOR, "#83cfc1")
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        color = "#83cfc1"
    pattern = props.get(PATTERN, "outline")
    if pattern not in PATTERNS:
        pattern = "outline"
    symbol = props.get(SYMBOL, "?")
    return dict(role=role, color=color, pattern=pattern, symbol=str(symbol)[:6], properties=props)


def endpoint(item, props, prefix):
    """Climb entry/exit intent stays relative to its region when the region resizes."""
    edge, offset = (
        props.get(f"{prefix}_edge", "bottom" if prefix == "entry" else "top"),
        props.get(f"{prefix}_offset", 0.5),
    )
    if type(offset) not in (int, float) or not 0 <= offset <= 1:
        offset = 0.5
    x, y, w, h = (item[key] for key in ("x", "y", "width", "height"))
    if edge in ("left", "right"):
        return x + (w if edge == "right" else 0), y + h * offset
    return x + w * offset, y + (h if edge == "bottom" else 0)


def camera_axis(value):
    return "scroll" if value is True else "fixed" if value is False else "unverified"


def xml_text(text):
    return html.escape(
        "".join(
            c
            for c in text
            if ord(c) in (9, 10, 13)
            or 0x20 <= ord(c) <= 0xD7FF
            or 0xE000 <= ord(c) <= 0xFFFD
            or 0x10000 <= ord(c) <= 0x10FFFF
        )
    )


def svg_labels(candidates, view):
    """Bounded, deterministic vector captions using explicit monospace metrics.

    Priority matches the browser: cameras, markers, notes, geometry, endpoints.
    Full captions remain available in SVG titles and the native scene inspector.
    """
    placed, body = [], []
    left, top = view["x"], view["y"]
    right, bottom = left + view["width"], top + view["height"]
    height, gap = 20, 4
    max_chars = min(32, int((view["width"] - 2 * gap - 16) / 7))
    if max_chars < 2 or view["height"] < height + 2 * gap:
        return body
    for priority, x, y, width, item_height, label, color in sorted(
        candidates, key=lambda candidate: candidate[0]
    ):
        if x >= right or y >= bottom or x + width <= left or y + item_height <= top:
            continue
        caption = label if len(label) <= max_chars else label[: max_chars - 1] + "…"
        w = len(caption) * 7 + 16
        anchor_x, anchor_y = max(left, x), max(top, y)
        for dx, dy in (
            (6, -height - 6),
            (6, 6),
            (6, height + 10),
            (6, -height * 2 - 10),
            (-w - 6, 6),
        ):
            px = max(left + gap, min(anchor_x + dx, right - w - gap))
            py = max(top + gap, min(anchor_y + dy, bottom - height - gap))
            if any(
                px < ox + ow + gap
                and px + w + gap > ox
                and py < oy + height + gap
                and py + height + gap > oy
                for ox, oy, ow in placed
            ):
                continue
            placed.append((px, py, w))
            body.append(
                f'<g class="blockout-label"><title>{xml_text(label)}</title>'
                f'<rect x="{px}" y="{py}" width="{w}" height="{height}" rx="3" fill="#17201a" stroke="{color}"/>'
                f'<text x="{px + 8}" y="{py + 14}" fill="#f4f6ef" font-family="monospace" font-size="11" textLength="{len(caption) * 7}" lengthAdjust="spacingAndGlyphs">{xml_text(caption)}</text></g>'
            )
            break
        if len(placed) >= 160:
            break
    return body


def render_svg(scene, project, camera=None):
    """Portable, escaped planning preview. Artwork stays in the main editor/export.

    This is a bounded geometric review, not a physics or reachability simulation.
    """
    width, height = scene["width"] * scene["grid"], scene["height"] * scene["grid"]
    view = camera or dict(x=0, y=0, width=width, height=height)
    require(
        sum(
            len(layer.get("objects", [])) for layer in tiled.scene_layers(scene) if layer["visible"]
        )
        <= 4096,
        "SVG review supports at most 4096 visible objects; hide layers to review a subset",
    )
    body, labels = [], []
    for layer in tiled.scene_layers(scene):
        if not layer["visible"]:
            continue
        for item in layer.get("objects", []):
            style = appearance(item, project)
            if style is None or (camera and style["role"] == "camera"):
                continue
            x, y, color = item["x"], item["y"], style["color"]
            label = f"{style['symbol']} {item.get('name') or style['role']}"
            if style["role"] in ("note", "section") and style["properties"].get("design_note"):
                label += " · " + str(style["properties"]["design_note"])
            body.append(f"<g><title>{xml_text(label)}</title>")
            dash = ' stroke-dasharray="4 3"' if style["pattern"] in ("outline", "one-way") else ""
            if item.get("kind") == "rectangle":
                w, h = item["width"], item["height"]
                opacity = "0.08" if style["pattern"] == "outline" else "0.28"
                body.append(
                    f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}" fill-opacity="{opacity}" stroke="{color}"{dash}/>'
                )
                if style["pattern"] == "one-way":
                    body.append(f'<path d="M{x} {y}h{w}" stroke="{color}" stroke-width="3"/>')
                if style["pattern"] in ("cross", "ladder", "waves"):
                    # At most 16 pattern marks per object regardless of its footprint.
                    step = max(8, h / 16)
                    for row in range(min(16, int(h / step))):
                        py = y + (row + 0.5) * step
                        path = (
                            f"M{x} {py}h{w}"
                            if style["pattern"] != "waves"
                            else f"M{x} {py}q{w / 4} -4 {w / 2} 0t{w / 2} 0"
                        )
                        body.append(
                            f'<path d="{path}" fill="none" stroke="{color}" stroke-opacity="0.6"/>'
                        )
                    if style["pattern"] == "cross":
                        body.append(
                            f'<path d="M{x} {y}l{w} {h}m{-w} 0l{w} {-h}" stroke="{color}"/>'
                        )
                if style["role"] == "climb":
                    for prefix in ("entry", "exit"):
                        px, py = endpoint(item, style["properties"], prefix)
                        body.append(f'<circle cx="{px}" cy="{py}" r="3" fill="{color}"/>')
                        labels.append((5, px, py, 1, 1, prefix.upper(), color))
            else:
                body.append(
                    f'<path d="M{x} {y - 5}l5 5 -5 5 -5 -5Z" fill="{color}" fill-opacity="0.4" stroke="{color}"/>'
                )

            if style["role"] == "camera":
                props = style["properties"]
                label += f" · X {camera_axis(props.get('scroll_x'))} · Y {camera_axis(props.get('scroll_y'))}"
            priority = (
                1
                if style["role"] == "camera"
                else 2
                if item["kind"] == "point" and style["role"] != "note"
                else 3
                if style["role"] in ("note", "section")
                else 4
            )
            point = item["kind"] == "point"
            labels.append(
                (
                    priority,
                    x - (5 if point else 0),
                    y - (5 if point else 0),
                    10 if point else item["width"],
                    10 if point else item["height"],
                    label,
                    color,
                )
            )
            body.append("</g>")
    body.extend(svg_labels(labels, view))
    require(
        sum(len(part.encode("utf-8")) for part in body) <= 2 * 1024 * 1024,
        "Review exceeds 2 MiB; hide layers to review a subset",
    )
    return (
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{view["width"]}" height="{view["height"]}" '
            f'viewBox="{view["x"]} {view["y"]} {view["width"]} {view["height"]}">'
            f'<rect x="{view["x"]}" y="{view["y"]}" width="{view["width"]}" height="{view["height"]}" fill="#151a18"/>'
        )
        + "".join(body)
        + "</svg>"
    )


def review(scene, project, camera_id=None):
    require(
        camera_id is None or integer(camera_id, 1, 2147483646), "Choose a valid camera object ID"
    )
    tiled.check_scene(scene, project)
    require(
        sum(
            len(layer.get("objects", [])) for layer in tiled.scene_layers(scene) if layer["visible"]
        )
        <= 4096,
        "SVG review supports at most 4096 visible objects; hide layers to review a subset",
    )
    cameras = [
        item
        for layer in tiled.scene_layers(scene)
        if layer["visible"]
        for item in layer.get("objects", [])
        if item.get("kind") == "rectangle"
        and (appearance(item, project) or {}).get("role") == "camera"
    ]
    camera = (
        next((c for c in cameras if c["id"] == camera_id), None)
        if camera_id is not None
        else next(iter(cameras), None)
    )
    require(camera is not None, "Show a camera frame layer or choose a valid camera object")
    return dict(
        version=1,
        snapshot_revision=hashlib.sha256(
            json.dumps(scene, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        width=scene["width"] * scene["grid"],
        height=scene["height"] * scene["grid"],
        camera=copy.deepcopy(camera),
        camera_properties=values(camera, project),
        screens_x=scene["width"] * scene["grid"] / camera["width"],
        screens_y=scene["height"] * scene["grid"] / camera["height"],
        overview_svg=render_svg(scene, project),
        camera_svg=render_svg(scene, project, camera),
        includes_artwork=False,
    )
