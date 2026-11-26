"""Bounded native RGBA documents and immutable, transport-independent candidates."""

import base64
import copy
import json
import re

from gbc_scene_forge.artwork import atlas, dimensions, layers, png, sheets
from gbc_scene_forge.artwork import metadata as tile_metadata
from gbc_scene_forge.core.identities import identity, name
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import identifier, integer, require
from gbc_scene_forge.storage.files import digest

MAX_CANDIDATE = dimensions.MAX_CANDIDATE_BYTES
MAX_BATCH = 1024 * 1024  # JSON bytes; each operation retains its existing serialization rule.
MAX_PIXEL_WRITES = 65_536  # Unique pixel writes per call; empty writes remain accepted.
MAX_DESCRIPTOR_BYTES = 64 * 1024  # UTF-8 two-space JSON with a final newline.
MAX_PLACEMENTS = 256  # Explicit saved locations in one atomic variation.
MAX_SOURCE_CELL = 2047  # Inclusive wire coordinate; actual source/scene fit is checked later.
MAX_PLACEMENT_ID = 2_147_483_646  # Leave room for the next native object/layer ID.
DESCRIPTOR_FIELDS = {
    "version",
    "id",
    "atlas_id",
    "region",
    "name",
    "kind",
    "width",
    "height",
    "origin",
    "pixel_format",
    "provenance",
}
CANDIDATE_FIELDS = {
    "version",
    "project_id",
    "document_id",
    "atlas_id",
    "descriptor",
    "rgba",
    "project_revision",
    "artwork_revision",
    "operation",
    "source",
    "metadata",
}


def canonical_bytes(value):
    """Sort aggregate hashes without changing saved file serialization."""
    try:
        return (
            json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        ).encode()
    except (ValueError, TypeError, RecursionError) as error:
        raise ValueError("Expected finite JSON artwork data") from error


def revision(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def artwork_revision(entry, files):
    prefix = f"assets/{entry['manifest']['id']}/"
    return digest(
        canonical_bytes(
            {
                "entry": entry,
                "files": {p: d for p, d in files.items() if p.startswith(prefix)},
            }
        )
    )


def check_source(value):
    require(
        isinstance(value, dict)
        and set(value) == {"atlas_id", "region", "grid", "cell", "artwork_revision"}
        and identifier(value["atlas_id"])
        and identifier(value["region"])
        and revision(value["artwork_revision"]),
        "Expected an explicit source atlas/region and artwork revision",
    )
    require(
        (value["grid"] is None and value["cell"] is None)
        or (
            type(value["grid"]) is int
            and value["grid"] in atlas.GRIDS
            and isinstance(value["cell"], list)
            and len(value["cell"]) == 2
            and all(integer(v, 0, MAX_SOURCE_CELL) for v in value["cell"])
        ),
        "Tiles require an explicit grid and cell; sprites use null grid/cell",
    )


def check_descriptor(value):
    require(
        isinstance(value, dict)
        and set(value) - {"layers"}
        == (
            DESCRIPTOR_FIELDS | {"frames", "sequences"}
            if value.get("version") == 2
            else DESCRIPTOR_FIELDS
        ),
        "Unsupported editable descriptor fields",
    )
    require(
        type(value["version"]) is int
        and value["version"] in (1, 2)
        and identity(value["id"])
        and identifier(value["atlas_id"])
        and identifier(value["region"])
        and value["pixel_format"] == "rgba8",
        "Invalid editable document identity or format",
    )
    require(name(value["name"]) == value["name"], "Use a trimmed artwork name")
    w, h = value["width"], value["height"]
    dimensions.check(w, h)
    if value["kind"] == "tile" or value["version"] == 2:
        dimensions.grid_canvas(w, h)
    require(value["kind"] in ("tile", "sprite"), "Choose tile or sprite artwork")
    require(
        value["version"] == 2 or value["kind"] != "tile" or (w == h and w in atlas.GRIDS),
        "Tiles must be one square of 8, 16 or 32 pixels",
    )
    origin = value["origin"]
    require(
        isinstance(origin, list)
        and len(origin) == 2
        and integer(origin[0], 0, w - 1)
        and integer(origin[1], 0, h - 1)
        and (value["kind"] != "tile" or origin == [0, 0]),
        "Origin must be an integer pixel inside a sprite; tiles use [0, 0]",
    )
    provenance = value["provenance"]
    if provenance is not None:
        require(
            isinstance(provenance, dict)
            and set(provenance)
            == {"project_id", "source_format"}
            | {"atlas_id", "region", "grid", "cell", "artwork_revision"}
            and identity(provenance["project_id"])
            and (
                provenance["source_format"] is None or isinstance(provenance["source_format"], str)
            ),
            "Invalid artwork provenance",
        )
        check_source(
            {k: v for k, v in provenance.items() if k not in {"project_id", "source_format"}}
        )
    if "layers" in value:
        layers.check(value)
    if value["version"] == 2:
        sheets.check(value)
    require(len(record_bytes(value)) <= MAX_DESCRIPTOR_BYTES, "Editable descriptor exceeds 64 KiB")


def manifest(descriptor):
    check_descriptor(descriptor)
    if descriptor["version"] == 2:
        return {
            "version": 1,
            "id": descriptor["atlas_id"],
            "source_format": "forge-rgba",
            "png": "atlas.png",
            "regions": sheets.regions(descriptor),
            "animations": sheets.animations(descriptor),
            "sheet": {k: copy.deepcopy(v) for k, v in descriptor.items() if k != "layers"},
        }
    return {
        "version": 1,
        "id": descriptor["atlas_id"],
        "source_format": "forge-rgba",
        "png": "atlas.png",
        "regions": [
            {
                "name": descriptor["region"],
                "kind": descriptor["kind"],
                "x": 0,
                "y": 0,
                "width": descriptor["width"],
                "height": descriptor["height"],
                **({"origin": descriptor["origin"]} if descriptor["kind"] == "sprite" else {}),
            }
        ],
        "animations": [],
    }


def check_entry(entry):
    """Validate the schema-only native pointer and single-region atlas contract."""
    value = entry["editable"]
    atlas_id = entry["manifest"]["id"]
    require(
        isinstance(value, dict)
        and set(value) in ({"id", "path"}, {"id", "path", "layers"})
        and identity(value["id"])
        and value["path"] == f"assets/{atlas_id}/editable.json",
        "Invalid editable document pointer",
    )
    if "layers" in value:
        require(
            isinstance(value["layers"], list)
            and 1 <= len(value["layers"]) <= layers.MAX_LAYERS
            and len(set(value["layers"])) == len(value["layers"])
            and all(identity(i) for i in value["layers"]),
            "Invalid layer source identities",
        )
    if "sheet" in entry["manifest"]:
        descriptor = entry["manifest"]["sheet"]
        check_descriptor(descriptor)
        require(
            descriptor["version"] == 2
            and descriptor["id"] == value["id"]
            and descriptor["atlas_id"] == atlas_id
            and manifest(descriptor) == entry["manifest"],
            "Invalid native sheet manifest",
        )
        expected = mappings(descriptor)
        for group, mapping in expected.items():
            saved = entry["tiles"].get(group, {})
            require(
                set(saved) == set(mapping)
                and all(type(local) is int for local in saved.values())
                and set(saved.values()) == set(range(len(mapping))),
                "Invalid native sheet frame identities",
            )
        return
    regions = entry["manifest"].get("regions")
    require(
        isinstance(regions, list) and len(regions) == 1 and isinstance(regions[0], dict),
        "Native artwork requires one region",
    )
    r = regions[0]
    descriptor = {
        "version": 1,
        "id": value["id"],
        "atlas_id": atlas_id,
        "region": r.get("name"),
        "name": "Artwork",
        "kind": r.get("kind"),
        "width": r.get("width"),
        "height": r.get("height"),
        "origin": r.get("origin", [0, 0]),
        "pixel_format": "rgba8",
        "provenance": None,
    }
    require(
        manifest(descriptor) == entry["manifest"]
        and type(entry["manifest"].get("version")) is int
        and type(r.get("x")) is int
        and type(r.get("y")) is int,
        "Invalid native atlas manifest",
    )
    # Native IDs are canonical and cannot hide extra/missing cells or sprites.
    for size in atlas.GRIDS:
        expected = (
            {
                atlas.tile_key(atlas_id, r["name"], x, y): y * (r["width"] // size) + x
                for y in range(r["height"] // size)
                for x in range(r["width"] // size)
            }
            if r["kind"] == "tile" and r["width"] % size == r["height"] % size == 0
            else {}
        )
        require(entry["tiles"].get(str(size)) == expected, "Invalid native tile identities")
    expected = {f"{atlas_id}/{r['name']}": 0} if r["kind"] == "sprite" else {}
    require(entry["tiles"].get("sprites") == expected, "Invalid native sprite identity")


def declared_paths(entry):
    """The complete native source/derived inventory, including empty grid tilesets."""
    base = f"assets/{entry['manifest']['id']}"
    paths = {
        f"{base}/atlas.png",
        f"{base}/editable.json",
        f"{base}/{entry['manifest']['id']}.atlas.json",
    }
    for group, mapping in entry["tiles"].items():
        if group == "sprites" and not mapping:
            continue
        stem = "sprites" if group == "sprites" else f"grid-{group}"
        paths.add(f"{base}/{stem}.tsj")
        paths.update(f"{base}/{stem}/{local}.png" for local in mapping.values())
    paths.update(f"{base}/layers/{i}.png" for i in entry["editable"].get("layers", []))
    return paths


def read_descriptor(entry, data):
    require(len(data) <= MAX_DESCRIPTOR_BYTES, "Editable descriptor exceeds 64 KiB")
    value = json.loads(data)
    check_descriptor(value)
    require(
        value["id"] == entry["editable"]["id"] and manifest(value) == entry["manifest"],
        "Editable descriptor differs from atlas identity or geometry",
    )
    require(
        [i["id"] for i in value.get("layers", {}).get("items", [])]
        == entry["editable"].get("layers", []),
        "Layer source identities differ from descriptor",
    )
    return value


def decode_image(descriptor, image):
    w, h, pixels = png.decode(image, generic=True)
    require(
        (w, h) == (descriptor["width"], descriptor["height"]),
        "Editable PNG dimensions differ from descriptor",
    )
    return pixels


def seal(envelope):
    value = copy.deepcopy(envelope)
    value["revision"] = digest(canonical_bytes(envelope))
    check_candidate(value)
    return value


def check_candidate(value):
    require(
        isinstance(value, dict)
        and set(value) - {"layer_rgba"}
        in (CANDIDATE_FIELDS | {"revision"}, CANDIDATE_FIELDS | {"revision", "placements"}),
        "Unsupported artwork candidate fields",
    )
    require(len(canonical_bytes(value)) <= MAX_CANDIDATE, "Artwork candidate exceeds 24 MiB")
    check_descriptor(value["descriptor"])
    d = value["descriptor"]
    require(
        type(value["version"]) is int
        and value["version"] == 1
        and identity(value["project_id"])
        and value["document_id"] == d["id"]
        and value["atlas_id"] == d["atlas_id"]
        and revision(value["project_revision"])
        and value["operation"] in ("create", "edit", "duplicate"),
        "Invalid artwork candidate identity, operation or saved base",
    )
    require(
        (value["operation"] == "edit" and revision(value["artwork_revision"]))
        or (value["operation"] != "edit" and value["artwork_revision"] is None),
        "Invalid candidate artwork base",
    )
    if value["operation"] == "duplicate":
        check_source(value["source"])
    else:
        require(value["source"] is None, "Unexpected source dependency")
    if "placements" in value:
        require(value["operation"] == "duplicate", "Only duplication can replace placements")
        check_placements(value["placements"])
    encoded = value["rgba"]
    require(
        isinstance(encoded, str)
        and len(encoded) == 4 * ((d["width"] * d["height"] * 4 + 2) // 3)
        and len(encoded) <= dimensions.MAX_RGBA_BASE64,
        "Invalid RGBA byte count",
    )
    try:
        pixels = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise ValueError("Expected canonical base64 RGBA bytes") from error
    require(
        base64.b64encode(pixels).decode() == encoded
        and len(pixels) == d["width"] * d["height"] * 4,
        "Invalid RGBA byte count",
    )
    require(
        revision(value["revision"])
        and value["revision"]
        == digest(canonical_bytes({k: v for k, v in value.items() if k != "revision"})),
        "Artwork candidate digest mismatch",
    )
    entry = {"manifest": manifest(d), "tiles": mappings(d)}
    require(isinstance(value["metadata"], dict), "Expected candidate tile metadata")
    entry["metadata"] = value["metadata"]
    tile_metadata.check_entry(entry)
    if "layers" in d:
        rasters = layers.decoded(d, value.get("layer_rgba"))
        require(
            layers.composite(d, rasters) == pixels, "Composite differs from exact layer sources"
        )
    else:
        require("layer_rgba" not in value, "Unexpected layer pixels on flat artwork")
    return pixels


def mappings(descriptor):
    """Semantic keys for static or sheet regions, independent of display order."""
    result = {str(size): {} for size in atlas.GRIDS}
    result["sprites"] = {}
    for region in manifest(descriptor)["regions"]:
        if region["kind"] == "sprite":
            group = result["sprites"]
            group[f"{descriptor['atlas_id']}/{region['name']}"] = len(group)
        else:
            for size in atlas.GRIDS:
                if region["width"] % size or region["height"] % size:
                    continue
                group = result[str(size)]
                for y in range(region["height"] // size):
                    for x in range(region["width"] // size):
                        group[atlas.tile_key(descriptor["atlas_id"], region["name"], x, y)] = len(
                            group
                        )
    return result


def edit_layout(candidate, frames, sequences):
    check_candidate(candidate)
    body = {key: copy.deepcopy(value) for key, value in candidate.items() if key != "revision"}
    body["descriptor"] = sheets.layout(body["descriptor"], frames, sequences)
    return seal(body)


def check_placements(value):
    """Explicit saved locations; scene revisions guard both content and selection."""
    require(
        isinstance(value, list) and 1 <= len(value) <= MAX_PLACEMENTS, "Select 1..256 placements"
    )
    seen = set()
    for location in value:
        require(
            isinstance(location, dict)
            and set(location)
            in (
                {"scene_id", "scene_revision", "layer_id", "x", "y"},
                {"scene_id", "scene_revision", "layer_id", "object_id"},
            )
            and identity(location["scene_id"])
            and revision(location["scene_revision"])
            and integer(location["layer_id"], 1, MAX_PLACEMENT_ID),
            "Expected explicit saved scene/revision, layer and tile cell or sprite object",
        )
        if "object_id" in location:
            require(integer(location["object_id"], 1, MAX_PLACEMENT_ID), "Invalid sprite object ID")
            key = (location["scene_id"], location["layer_id"], "object", location["object_id"])
        else:
            require(
                integer(location["x"], 0, MAX_SOURCE_CELL)
                and integer(location["y"], 0, MAX_SOURCE_CELL),
                "Invalid tile placement coordinates",
            )
            key = (location["scene_id"], location["layer_id"], location["x"], location["y"])
        require(key not in seen, "Duplicate placement selection")
        seen.add(key)


def edit_pixels(candidate, writes):
    pixels = bytearray(check_candidate(candidate))
    require("layers" not in candidate["descriptor"], "Pixel edits require an explicit layer target")
    require(
        isinstance(writes, list) and len(writes) <= MAX_PIXEL_WRITES,
        "Use at most 65536 pixel writes",
    )
    # Compact decoded JSON is the request work budget, independent of pretty formatting.
    try:
        batch_bytes = json.dumps(
            writes, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode()
    except (ValueError, TypeError, RecursionError) as error:
        raise ValueError("Pixel batch must contain finite JSON values") from error
    require(len(batch_bytes) <= MAX_BATCH, "Pixel batch exceeds 1 MiB")
    d, seen = candidate["descriptor"], set()
    for write in writes:
        require(
            isinstance(write, dict) and set(write) == {"x", "y", "rgba"},
            "Expected x, y and rgba per pixel write",
        )
        x, y, color = write["x"], write["y"], write["rgba"]
        require(
            integer(x, 0, d["width"] - 1) and integer(y, 0, d["height"] - 1),
            "Pixel coordinates must be integers inside the artwork",
        )
        require((x, y) not in seen, "Duplicate pixel coordinate in batch")
        seen.add((x, y))
        require(
            isinstance(color, list)
            and len(color) == 4
            and all(integer(channel, 0, 255) for channel in color),
            "RGBA requires four integer channels within 0..255",
        )
        offset = (y * d["width"] + x) * 4
        pixels[offset : offset + 4] = bytes(color)
    envelope = {k: copy.deepcopy(v) for k, v in candidate.items() if k != "revision"}
    envelope["rgba"] = base64.b64encode(pixels).decode()
    return seal(envelope)


def patch_pixels(candidate, patch):
    """Replace a bounded rectangular chunk with exact straight RGBA bytes."""
    pixels = bytearray(check_candidate(candidate))
    require("layers" not in candidate["descriptor"], "Pixel edits require an explicit layer target")
    require(
        isinstance(patch, dict) and set(patch) == {"rectangle", "rgba"},
        "Expected a rectangle and base64 RGBA patch",
    )
    r = patch["rectangle"]
    # Check geometry and decoded area before decoding a patch.
    check_rectangle(candidate["descriptor"], r)
    require(
        isinstance(patch["rgba"], str)
        and len(patch["rgba"]) <= 4 * ((dimensions.MAX_READ_PIXELS * 4 + 2) // 3),
        "Pixel patch exceeds 65536 pixels; use smaller rectangles",
    )
    try:
        raw = base64.b64decode(patch["rgba"], validate=True)
    except ValueError as error:
        raise ValueError("Expected canonical base64 patch RGBA bytes") from error
    require(
        len(raw) == r["width"] * r["height"] * 4
        and base64.b64encode(raw).decode() == patch["rgba"],
        "Patch RGBA byte count differs from rectangle",
    )
    for row in range(r["height"]):
        start = ((r["y"] + row) * candidate["descriptor"]["width"] + r["x"]) * 4
        length = r["width"] * 4
        pixels[start : start + length] = raw[row * length : (row + 1) * length]
    envelope = {k: copy.deepcopy(v) for k, v in candidate.items() if k != "revision"}
    envelope["rgba"] = base64.b64encode(pixels).decode()
    return seal(envelope)


def check_rectangle(d, r):
    require(
        isinstance(r, dict)
        and set(r) == {"x", "y", "width", "height"}
        and integer(r["x"], 0, d["width"] - 1)
        and integer(r["y"], 0, d["height"] - 1)
        and integer(r["width"], 1, d["width"] - r["x"])
        and integer(r["height"], 1, d["height"] - r["y"]),
        "Read rectangle must fit the artwork",
    )
    require(
        r["width"] * r["height"] <= dimensions.MAX_READ_PIXELS,
        "Pixel read exceeds 65536 pixels; request smaller explicit rectangles",
    )


def read_pixels(candidate, rectangle=None):
    pixels = check_candidate(candidate)
    d = candidate["descriptor"]
    r = (
        rectangle
        if rectangle is not None
        else {"x": 0, "y": 0, "width": d["width"], "height": d["height"]}
    )
    check_rectangle(d, r)
    raw = b"".join(
        pixels[
            ((r["y"] + y) * d["width"] + r["x"]) * 4 : (
                (r["y"] + y) * d["width"] + r["x"] + r["width"]
            )
            * 4
        ]
        for y in range(r["height"])
    )
    return {
        "target": {"document_id": d["id"], "atlas_id": d["atlas_id"], "region": d["region"]},
        "rectangle": copy.deepcopy(r),
        "rgba": base64.b64encode(raw).decode(),
        "project_revision": candidate["project_revision"],
        "artwork_revision": candidate["artwork_revision"],
        "candidate_revision": candidate["revision"],
    }
