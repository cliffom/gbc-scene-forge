"""Bounded illustration preparation and atomic edits using native candidates."""

import base64
import copy
import io
import zipfile
from collections import Counter

from gbc_scene_forge.artwork import dimensions, editable, layers, png, raster
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import integer, require

MAX_BATCH_WORK = 16_777_216


def sources(candidate):
    pixels = editable.check_candidate(candidate)
    if "layers" in candidate["descriptor"]:
        return layers.decoded(candidate["descriptor"], candidate["layer_rgba"])
    return {"composite": pixels}


def with_sources(candidate, rasters):
    if "layers" in candidate["descriptor"]:
        return layers.reseal(candidate, rasters)
    body = {k: copy.deepcopy(v) for k, v in candidate.items() if k != "revision"}
    body["rgba"] = base64.b64encode(rasters["composite"]).decode()
    return editable.seal(body)


def counts(raw):
    return Counter(raw[i : i + 4] for i in range(0, len(raw), 4))


def summary(candidate):
    d = candidate["descriptor"]
    return {
        "width": d["width"],
        "height": d["height"],
        "composite_colors": len(counts(base64.b64decode(candidate["rgba"]))),
        "source_colors": {key: len(counts(raw)) for key, raw in sources(candidate).items()},
    }


def prepare(documents, candidate, atlas_id, name, width, height, mode, anchor, flatten_sheet=False):
    """Independent static sprite: original references, frames and bases stay untouched."""
    rasters = sources(candidate)
    d = candidate["descriptor"]
    dimensions.check(width, height)
    require(mode in {"nearest", "canvas"}, "Choose nearest scaling or canvas extent")
    require(anchor in {"top-left", "center", "bottom-right"}, "Unsupported canvas anchor")
    require(type(flatten_sheet) is bool, "flatten_sheet must be boolean")
    require(d["version"] != 2 or flatten_sheet, "Sheet preparation requires flatten_sheet=true")
    require(
        not any(i["locked"] for i in d.get("layers", {}).get("items", [])),
        "Unlock layers before document preparation",
    )
    require(
        width * height * (len(rasters) + 1 if "layers" in d else 1) <= layers.MAX_AGGREGATE_PIXELS,
        "Prepared sources and composite exceed aggregate pixel budget",
    )
    old_w, old_h = d["width"], d["height"]
    divisor = {"top-left": None, "center": 2, "bottom-right": 1}[anchor]
    dx = (width - old_w) // divisor if divisor else 0
    dy = (height - old_h) // divisor if divisor else 0
    origin = (
        [d["origin"][0] * width // old_w, d["origin"][1] * height // old_h]
        if mode == "nearest"
        else [d["origin"][0] + dx, d["origin"][1] + dy]
    )
    require(
        0 <= origin[0] < width and 0 <= origin[1] < height,
        "Crop removes origin; choose another anchor or canvas",
    )
    result = documents.create(
        atlas_id, name, "sprite", width, height, candidate["project_revision"], origin=origin
    )
    if "layers" in d:
        result = layers.edit(result, d["layers"]["items"])
    transformed = {}
    for key, raw in rasters.items():
        target = bytearray(width * height * 4)
        for y in range(height):
            sy = y * old_h // height if mode == "nearest" else y - dy
            for x in range(width):
                sx = x * old_w // width if mode == "nearest" else x - dx
                if 0 <= sx < old_w and 0 <= sy < old_h:
                    offset = (y * width + x) * 4
                    source = (sy * old_w + sx) * 4
                    target[offset : offset + 4] = raw[source : source + 4]
        transformed[key] = bytes(target)
    result = with_sources(result, transformed)
    return {
        "candidate": result,
        "report": {
            "source_candidate_revision": candidate["revision"],
            "before": summary(candidate),
            "after": summary(result),
            "mode": mode,
            "anchor": anchor,
            "offset": [dx, dy] if mode == "canvas" else None,
            "sampling": "nearest-floor",
            "padding": [0, 0, 0, 0],
            "origin": origin,
            "frames_discarded": d["version"] == 2,
            "references": "Independent document; no saved references or placement replacements copied",
            "metadata": "Frame/sequence and tile metadata omitted; layer IDs and properties retained",
        },
    }


def convert_palette(candidate, *, palette=None, budget=None):
    """Deterministic no-dither RGB mapping preserving each pixel's literal alpha."""
    rasters = sources(candidate)
    require((palette is None) != (budget is None), "Choose target palette or color budget")
    require(
        not any(i["locked"] for i in candidate["descriptor"].get("layers", {}).get("items", [])),
        "Unlock layers before palette conversion",
    )
    histogram = Counter()
    alphas = set()
    transparent = set()
    original_colors = set()
    for raw in rasters.values():
        for color, count in counts(raw).items():
            if len(original_colors) <= 256:
                original_colors.add(color)
            if color[3]:
                histogram[color[:3]] += count
                alphas.add(color[3])
            else:
                transparent.add(color)
    require(len(histogram) <= 65536, "Conversion supports at most 65536 source RGB colors")
    if palette is not None:
        require(isinstance(palette, list) and 1 <= len(palette) <= 256, "Use 1..256 RGB colors")
        require(
            all(
                isinstance(c, list) and len(c) == 3 and all(integer(v, 0, 255) for v in c)
                for c in palette
            ),
            "Expected RGB8 palette",
        )
        choices = sorted({bytes(c) for c in palette})
        require(
            len(histogram) * len(choices) <= MAX_BATCH_WORK, "Palette search exceeds work budget"
        )
        algorithm = "nearest squared sRGB distance; lexicographic ties"
    else:
        require(integer(budget, 1, 256), "Use an exact RGBA budget within 1..256")
        require(
            len(transparent) <= budget,
            "Budget cannot preserve hidden transparent RGB; increase budget",
        )
        if (
            len(original_colors) <= budget
            and len(counts(base64.b64decode(candidate["rgba"]))) <= budget
        ):
            return palette_result(
                candidate,
                candidate,
                sorted(histogram),
                budget,
                "Already within exact RGBA budget; unchanged",
            )
        # Reserve hidden transparent colors and all alpha levels: transparency is never quantized.
        slots = (budget - len(transparent)) // max(1, len(alphas))
        require(
            slots >= 1 or not histogram, "Budget cannot preserve alpha/hidden RGB; increase budget"
        )
        # Weighted median cut, stable axis and lexicographic ties; no external dependency.
        boxes = [sorted(histogram)] if histogram else []
        while len(boxes) < slots:
            splittable = [b for b in boxes if len(b) > 1]
            if not splittable:
                break

            def spread(b):
                return max(max(c[a] for c in b) - min(c[a] for c in b) for a in range(3))

            box = max(splittable, key=lambda b: (spread(b), sum(histogram[c] for c in b), b))
            axis = max(
                range(3), key=lambda a: (max(c[a] for c in box) - min(c[a] for c in box), -a)
            )
            ordered = sorted(box, key=lambda c: (c[axis], c))
            half, running, split = sum(histogram[c] for c in box) / 2, 0, 1
            for index, c in enumerate(ordered[:-1]):
                running += histogram[c]
                split = index + 1
                if running >= half:
                    break
            boxes.remove(box)
            boxes.extend([ordered[:split], ordered[split:]])
        choices = sorted(
            {
                bytes(
                    round(sum(c[a] * histogram[c] for c in b) / sum(histogram[c] for c in b))
                    for a in range(3)
                )
                for b in boxes
            }
        )
        algorithm = "weighted median cut RGB, nearest squared sRGB mapping; lexicographic ties"
    mapping = {
        c: min(choices, key=lambda p: (sum((p[a] - c[a]) ** 2 for a in range(3)), p))
        for c in histogram
    }
    changed = {}
    for key, raw in rasters.items():
        table = {c: mapping[c[:3]] + c[3:] if c[3] else c for c in counts(raw)}
        changed[key] = b"".join(table[raw[i : i + 4]] for i in range(0, len(raw), 4))
    result = with_sources(candidate, changed)
    if budget is not None:
        # Layer compositing can create extra colors; reject rather than silently exceed the budget.
        require(
            summary(result)["composite_colors"] <= budget,
            "Layer composite exceeds budget; flatten explicitly or use a larger budget",
        )
    return palette_result(candidate, result, choices, budget, algorithm)


def palette_result(candidate, result, choices, budget, algorithm):
    return {
        "candidate": result,
        "report": {
            "before": summary(candidate),
            "after": summary(result),
            "budget": budget,
            "palette_rgb": [list(c) for c in choices],
            "algorithm": algorithm,
            "dither": False,
            "alpha": "Exact alpha and hidden transparent RGB retained; nontransparent RGB may be lossy",
        },
    }


def batch(candidate, operations):
    """Retain only the final candidate; UUIDs supplied in layer operations are batch references."""
    editable.check_candidate(candidate)
    require(
        isinstance(operations, list) and 1 <= len(operations) <= 128,
        "Provide 1..128 candidate operations",
    )
    require(len(record_bytes(operations)) <= editable.MAX_BATCH, "Candidate batch exceeds 1 MiB")
    result, work = candidate, 0
    for op in operations:
        require(isinstance(op, dict), "Expected candidate operation")
        kind = op.get("op")
        fields = {
            "layers": {"layers"},
            "pixels": {"layer_id", "writes"},
            "patch": {"layer_id", "patch"},
            "raster": {"layer_id", "operations"},
        }
        require(kind in fields and set(op) == fields[kind] | {"op"}, "Unexpected batch fields")
        if kind == "raster":
            require(
                isinstance(op["operations"], list) and 1 <= len(op["operations"]) <= 128,
                "Provide 1..128 raster operations",
            )
        d = result["descriptor"]
        # Includes repeated layer composition and worst-case raster visits, even for tiny writes.
        work += (
            d["width"]
            * d["height"]
            * (len(d.get("layers", {}).get("items", [])) + 1)
            * (len(op["operations"]) + 1 if kind == "raster" else 1)
        )
        require(work <= MAX_BATCH_WORK, "Candidate batch exceeds 16777216 pixel work")
        if kind == "layers":
            result = layers.edit(result, op["layers"])
            continue

        def apply(flat):
            if kind == "raster":
                return raster.edit(flat, op["operations"])
            if kind == "patch":
                return editable.patch_pixels(flat, op["patch"])
            return editable.edit_pixels(flat, op["writes"])

        if "layers" in d:
            result = layers.apply(result, op["layer_id"], apply)
        else:
            require(op["layer_id"] is None, "Flat artwork requires layer_id:null")
            result = apply(result)
    return result


def intake_layers(documents, atlas_id, name, width, height, project_revision, items):
    dimensions.check(width, height)
    require(isinstance(items, list) and 1 <= len(items) <= 8, "Import 1..8 PNG layers")
    require(
        width * height * (len(items) + 1) <= layers.MAX_AGGREGATE_PIXELS,
        "Layer intake exceeds aggregate pixel budget",
    )
    candidate = documents.create(atlas_id, name, "sprite", width, height, project_revision)
    metadata, rasters = [], {}
    total = 0
    for item in items:
        require(
            isinstance(item, dict) and set(item) == {"layer", "png", "offset"},
            "Expected layer metadata, PNG and offset",
        )
        layer, offset, encoded = item["layer"], item["offset"], item["png"]
        require(
            isinstance(offset, list)
            and len(offset) == 2
            and all(integer(v, 0, 4095) for v in offset),
            "Expected nonnegative integer offset",
        )
        require(
            isinstance(encoded, str)
            and len(encoded) <= 4 * ((dimensions.MAX_IMAGE_BYTES + 2) // 3),
            "PNG upload exceeds limit",
        )
        data = base64.b64decode(encoded, validate=True)
        require(base64.b64encode(data).decode() == encoded, "Expected canonical PNG base64")
        w, h, raw = png.decode(data, generic=True)
        total += w * h
        require(total <= layers.MAX_AGGREGATE_PIXELS, "Decoded PNG intake exceeds pixel budget")
        x, y = offset
        require(x + w <= width and y + h <= height, "Layer PNG must fit canvas; no implicit crop")
        padded = bytearray(width * height * 4)
        for row in range(h):
            start = ((y + row) * width + x) * 4
            padded[start : start + w * 4] = raw[row * w * 4 : (row + 1) * w * 4]
        metadata.append(layer)
        # Validation before indexing the declared UUID also rejects malformed metadata.
        probe = copy.deepcopy(candidate["descriptor"])
        probe["layers"] = {"version": 1, "items": metadata}
        layers.check(probe)
        rasters[layer["id"]] = bytes(padded)
    candidate = layers.edit(candidate, metadata)
    return layers.reseal(candidate, rasters)


def bundle(candidate):
    """candidate.json is the authoritative existing envelope, PNGs are convenience views."""
    rasters = sources(candidate)
    d = candidate["descriptor"]
    palette = counts(base64.b64decode(candidate["rgba"]))
    require(len(palette) <= 65536, "Bundle palette exceeds 65536 colors")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("candidate.json", record_bytes(candidate))
        archive.writestr("document.json", record_bytes(d))
        archive.writestr(
            "composite.png",
            png.encode(d["width"], d["height"], base64.b64decode(candidate["rgba"])),
        )
        archive.writestr(
            "palette.json",
            record_bytes([{"rgba": list(c), "count": n} for c, n in sorted(palette.items())]),
        )
        for key, raw in rasters.items():
            archive.writestr(f"layers/{key}.png", png.encode(d["width"], d["height"], raw))
    return output.getvalue()
