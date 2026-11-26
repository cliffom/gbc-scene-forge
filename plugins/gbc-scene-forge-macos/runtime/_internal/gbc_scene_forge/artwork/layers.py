"""Version-one layered extension for static and sheet native documents.

Items are bottom-to-top. All rasters are full-canvas straight RGBA8. Composite
uses integer source-over, rounding halves upward; hidden RGB belongs to sources.
"""

import base64
import copy
from uuid import uuid4

from gbc_scene_forge.artwork import dimensions
from gbc_scene_forge.core.identities import identity, name
from gbc_scene_forge.core.validation import integer, require

MAX_LAYERS = 8
MAX_AGGREGATE_PIXELS = dimensions.MAX_PIXELS  # Composite plus every layer; <=16 MiB decoded.


def check(descriptor):
    value = descriptor["layers"]
    require(
        isinstance(value, dict)
        and set(value) == {"version", "items"}
        and type(value["version"]) is int
        and value["version"] == 1,
        "Unsupported layer extension version",
    )
    items = value["items"]
    require(isinstance(items, list) and 1 <= len(items) <= MAX_LAYERS, "Use 1..8 layers")
    require(
        descriptor["width"] * descriptor["height"] * (len(items) + 1) <= MAX_AGGREGATE_PIXELS,
        "Layers and composite exceed 4194304 aggregate pixels; reduce canvas or layer count",
    )
    seen = set()
    for item in items:
        require(
            isinstance(item, dict)
            and set(item) == {"id", "name", "visible", "opacity", "locked"}
            and identity(item["id"])
            and item["id"] not in seen,
            "Invalid or duplicate layer identity",
        )
        seen.add(item["id"])
        require(
            name(item["name"]) == item["name"]
            and type(item["visible"]) is bool
            and type(item["locked"]) is bool
            and integer(item["opacity"], 0, 255),
            "Expected layer name, visible/locked booleans and opacity 0..255",
        )


def decoded(descriptor, encoded):
    check(descriptor)
    ids = {i["id"] for i in descriptor["layers"]["items"]}
    require(isinstance(encoded, dict) and set(encoded) == ids, "Layer pixel identities differ")
    size = descriptor["width"] * descriptor["height"] * 4
    result = {}
    for key, value in encoded.items():
        require(
            isinstance(value, str) and len(value) == 4 * ((size + 2) // 3),
            "Invalid layer RGBA byte count",
        )
        try:
            raw = base64.b64decode(value, validate=True)
        except ValueError as error:
            raise ValueError("Expected canonical layer RGBA") from error
        require(
            len(raw) == size and base64.b64encode(raw).decode() == value,
            "Invalid layer RGBA encoding",
        )
        result[key] = raw
    return result


def composite(descriptor, rasters):
    result = bytearray(descriptor["width"] * descriptor["height"] * 4)
    for item in descriptor["layers"]["items"]:
        if not item["visible"] or not item["opacity"]:
            continue
        source = rasters[item["id"]]
        for i in range(0, len(source), 4):
            alpha = (source[i + 3] * item["opacity"] + 127) // 255
            if not alpha:
                continue
            if alpha == 255 or result[i + 3] == 0:
                result[i : i + 4] = source[i : i + 3] + bytes([alpha])
                continue
            denominator = alpha * 255 + result[i + 3] * (255 - alpha)
            for c in range(3):
                numerator = source[i + c] * alpha * 255 + result[i + c] * result[i + 3] * (
                    255 - alpha
                )
                result[i + c] = (numerator + denominator // 2) // denominator
            result[i + 3] = (denominator + 127) // 255
    return bytes(result)


def reseal(body, rasters):
    from gbc_scene_forge.artwork import editable

    body = copy.deepcopy(body)
    body.pop("revision", None)
    body["layer_rgba"] = {key: base64.b64encode(raw).decode() for key, raw in rasters.items()}
    body["rgba"] = base64.b64encode(composite(body["descriptor"], rasters)).decode()
    return editable.seal(body)


def edit(candidate, items):
    from gbc_scene_forge.artwork import editable

    pixels = editable.check_candidate(candidate)
    body = copy.deepcopy(candidate)
    previous = body["descriptor"].get("layers", {}).get("items", [])
    if items == []:
        require(
            previous and not any(i["locked"] for i in previous), "Unlock layers before flattening"
        )
        body.pop("layer_rgba")
        body["descriptor"].pop("layers")
        body.pop("revision")
        return editable.seal(body)
    if not previous:
        # Explicit migration supplies the base item; its first ID owns the flat bytes.
        require(isinstance(items, list) and items, "Provide a base layer")
    body["descriptor"]["layers"] = {"version": 1, "items": copy.deepcopy(items)}
    check(body["descriptor"])
    rasters = (
        decoded(candidate["descriptor"], candidate["layer_rgba"])
        if previous
        else {items[0]["id"]: pixels}
    )
    old = {item["id"]: item for item in previous}
    for item in previous:
        if item["locked"]:
            require(
                any(
                    {**i, "locked": True} == item and index == previous.index(item)
                    for index, i in enumerate(items)
                ),
                "Unlock a layer before removing, reordering or changing it",
            )
    # Unlocking is an explicit metadata operation. It grants no pixel write in this call.
    for item in items:
        if item["id"] in old and old[item["id"]]["locked"]:
            require({**item, "locked": True} == old[item["id"]], "Only unlock a locked layer")
    return reseal(body, {item["id"]: rasters.get(item["id"], bytes(len(pixels))) for item in items})


def item(display_name="Layer"):
    return dict(id=str(uuid4()), name=display_name, visible=True, opacity=255, locked=False)


def target(candidate, layer_id):
    from gbc_scene_forge.artwork import editable

    editable.check_candidate(candidate)
    item = next(
        (
            i
            for i in candidate["descriptor"].get("layers", {}).get("items", [])
            if i["id"] == layer_id
        ),
        None,
    )
    require(item is not None, "Choose an explicit layer ID")
    body = copy.deepcopy(candidate)
    body.pop("layer_rgba")
    body["descriptor"].pop("layers")
    body["rgba"] = candidate["layer_rgba"][layer_id]
    body.pop("revision")
    return item, editable.seal(body)


def apply(candidate, layer_id, operation):
    item, flat = target(candidate, layer_id)
    require(not item["locked"], "Layer is locked; unlock it explicitly before editing")
    changed = operation(flat)
    rasters = decoded(candidate["descriptor"], candidate["layer_rgba"])
    rasters[layer_id] = base64.b64decode(changed["rgba"])
    return reseal(candidate, rasters)


def read_sources(descriptor, read):
    from gbc_scene_forge.artwork import editable

    return {
        i["id"]: editable.decode_image(
            descriptor, read(f"assets/{descriptor['atlas_id']}/layers/{i['id']}.png")
        )
        for i in descriptor["layers"]["items"]
    }


def verify(descriptor, pixels, read):
    if "layers" in descriptor:
        require(
            composite(descriptor, read_sources(descriptor, read)) == pixels,
            "Flattened PNG differs from layer sources",
        )
