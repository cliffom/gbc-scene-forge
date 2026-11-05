"""Bounded, opt-in island suggestions and exact candidate cleanup constraints.

Suggestions describe color structure, not artistic defects. Plans contain no trusted
pixel writes: selection is recomputed against the exact source and normalized profile.
"""

import base64
from array import array
from collections import Counter

from gbc_scene_forge.artwork import editable, layers, png, raster, workshop
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.storage.files import digest

MAX_SCAN_PIXELS = 1_048_576
MAX_FINDINGS = 4096
PAGE_SIZE = 256
MAX_ISLAND = 16
MAX_PROTECTED_PIXELS = 4096
MAX_PROTECTED_RECTANGLES = 128
MAX_PROFILE_BYTES = 128 * 1024
MAX_WORK = 16_777_216
WARNINGS = [
    "Small islands may be intentional highlights or texture; review selected edits.",
    "Diagonal connectivity reduces thin-line damage but does not recognize features.",
]
UNSUPPORTED = [
    "semantic_feature_recognition",
    "outline_repair",
    "silhouette_quality",
    "plane_consolidation",
]


def profile_for(candidate, value):
    require(isinstance(value, dict), "Expected cleanup profile")
    require(len(record_bytes(value)) <= MAX_PROFILE_BYTES, "Cleanup profile exceeds 128 KiB")
    fields = {
        "rectangle",
        "protected_pixels",
        "protected_rectangles",
        "max_island_size",
        "connectivity",
        "max_color_distance",
        "min_boundary_percent",
        "allowed_palette",
        "color_budget",
    }
    require(not set(value) - fields, "Unsupported cleanup profile rule")
    d = candidate["descriptor"]
    result = {
        "rectangle": raster.rectangle(d, value.get("rectangle")),
        "max_island_size": value.get("max_island_size", 4),
        "connectivity": value.get("connectivity", 8),
        "max_color_distance": value.get("max_color_distance", 48),
        "min_boundary_percent": value.get("min_boundary_percent", 75),
    }
    require(
        "rectangle" not in value or isinstance(value["rectangle"], dict),
        "Expected editable rectangle",
    )
    for key, low, high in (
        ("max_island_size", 1, MAX_ISLAND),
        ("max_color_distance", 0, 441),
        ("min_boundary_percent", 50, 100),
    ):
        require(integer(result[key], low, high), f"Invalid cleanup {key}")
    require(
        type(result["connectivity"]) is int and result["connectivity"] in (4, 8),
        "Connectivity must be 4 or 8",
    )
    points = value.get("protected_pixels", [])
    require(
        isinstance(points, list) and len(points) <= MAX_PROTECTED_PIXELS,
        "Use at most 4096 protected pixels",
    )
    require(
        all(
            isinstance(pt, list)
            and len(pt) == 2
            and integer(pt[0], 0, d["width"] - 1)
            and integer(pt[1], 0, d["height"] - 1)
            for pt in points
        ),
        "Protected pixels must fit the artwork",
    )
    result["protected_pixels"] = [list(pt) for pt in sorted({tuple(pt) for pt in points})]
    rectangles = value.get("protected_rectangles", [])
    require(
        isinstance(rectangles, list) and len(rectangles) <= MAX_PROTECTED_RECTANGLES,
        "Use at most 128 protected rectangles",
    )
    require(all(isinstance(r, dict) for r in rectangles), "Expected protected rectangles")
    result["protected_rectangles"] = [raster.rectangle(d, r) for r in rectangles]
    if "allowed_palette" in value:
        palette = value["allowed_palette"]
        require(
            isinstance(palette, list) and 1 <= len(palette) <= 256, "Use 1..256 allowed RGBA colors"
        )
        result["allowed_palette"] = [list(c) for c in sorted({raster.color(c) for c in palette})]
    if "color_budget" in value:
        require(integer(value["color_budget"], 1, 256), "Color budget must be 1..256")
        result["color_budget"] = value["color_budget"]
    r = result["rectangle"]
    area = r["width"] * r["height"]
    require(area <= MAX_SCAN_PIXELS, "Cleanup scan exceeds 1048576 pixels; narrow rectangle")
    aggregate = d["width"] * d["height"] * (1 + len(d.get("layers", {}).get("items", [])))
    protection_work = sum(rect["width"] * rect["height"] for rect in rectangles)
    require(
        9 * area + aggregate + protection_work <= MAX_WORK,
        "Cleanup exceeds 16777216 pixel work; narrow scan/protection",
    )
    require(
        len(record_bytes(result)) <= MAX_PROFILE_BYTES, "Normalized cleanup profile exceeds 128 KiB"
    )
    return result


def target(candidate, layer_id):
    raw = editable.check_candidate(candidate)
    if "layers" in candidate["descriptor"]:
        item, flat = layers.target(candidate, layer_id)
        return base64.b64decode(flat["rgba"]), item["locked"]
    require(layer_id is None, "Flat cleanup requires no layer_id")
    return raw, False


def protected_mask(d, profile):
    mask = bytearray(d["width"] * d["height"])
    for x, y in profile["protected_pixels"]:
        mask[y * d["width"] + x] = 1
    for r in profile["protected_rectangles"]:
        for y in range(r["y"], r["y"] + r["height"]):
            start = y * d["width"] + r["x"]
            mask[start : start + r["width"]] = b"\1" * r["width"]
    return mask


def proposal_for(candidate, profile, layer_id):
    body = dict(
        version=1, candidate_revision=candidate["revision"], layer_id=layer_id, profile=profile
    )
    return {**body, "revision": digest(editable.canonical_bytes(body))}


def check_proposal(candidate, proposal):
    require(
        isinstance(proposal, dict)
        and set(proposal) == {"version", "candidate_revision", "layer_id", "profile", "revision"},
        "Expected exact cleanup proposal",
    )
    require(
        type(proposal["version"]) is int and proposal["version"] == 1,
        "Unsupported cleanup proposal version",
    )
    profile = profile_for(candidate, proposal["profile"])
    require(
        proposal == proposal_for(candidate, profile, proposal["layer_id"]),
        "Cleanup proposal is stale or mismatched; analyze again",
    )
    return profile


def islands(candidate, profile, layer_id):
    raw, _ = target(candidate, layer_id)
    d, r = candidate["descriptor"], profile["rectangle"]
    width = d["width"]
    x0, y0, w, h = (r[k] for k in ("x", "y", "width", "height"))
    protected = protected_mask(d, profile)
    seen = bytearray(w * h)
    directions = ((-1, 0), (1, 0), (0, -1), (0, 1))
    if profile["connectivity"] == 8:
        directions += ((-1, -1), (-1, 1), (1, -1), (1, 1))
    findings = []
    for start in range(w * h):
        if seen[start]:
            continue
        index = (y0 + start // w) * width + x0 + start % w
        color = raw[index * 4 : index * 4 + 4]
        seen[start] = 1
        if not color[3]:
            continue  # Hidden transparent RGB is never a cleanup candidate.
        pending = array("I", [start])
        component, boundary, size, blocked = [], Counter(), 0, False
        while pending:
            pos = pending.pop()
            x, y = pos % w, pos // w
            at = (y0 + y) * width + x0 + x
            size += 1
            blocked |= x in (0, w - 1) or y in (0, h - 1) or bool(protected[at])
            if size <= profile["max_island_size"]:
                component.append(at)
            for dx, dy in directions:
                nx, ny = x + dx, y + dy
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                neighbor = (y0 + ny) * width + x0 + nx
                other = raw[neighbor * 4 : neighbor * 4 + 4]
                if other == color:
                    mark = ny * w + nx
                    if not seen[mark]:
                        seen[mark] = 1
                        pending.append(mark)
                elif not blocked and size <= profile["max_island_size"] and (dx == 0 or dy == 0):
                    boundary[other] += 1
        if blocked or size > profile["max_island_size"] or not boundary:
            continue

        def distance(c):
            return sum((c[i] - color[i]) ** 2 for i in range(3))

        replacement = min(boundary, key=lambda c: (-boundary[c], distance(c), c))
        support, total = boundary[replacement], sum(boundary.values())
        if (
            replacement[3] != color[3]
            or distance(replacement) > profile["max_color_distance"] ** 2
            or 100 * support < profile["min_boundary_percent"] * total
        ):
            continue
        coordinates = [[i % width, i // width] for i in sorted(component)]
        findings.append(
            dict(
                id=f"island-{index}",
                pixels=coordinates,
                source=list(color),
                replacement=list(replacement),
                boundary_edges=total,
                matching_edges=support,
                squared_rgb_distance=distance(replacement),
                reason="small_color_island; artistic intent unverified",
            )
        )
        require(
            len(findings) <= MAX_FINDINGS,
            "Cleanup exceeds 4096 findings; narrow rectangle or thresholds",
        )
    return findings


def analyze(candidate, profile, layer_id=None, offset=0):
    profile = profile_for(candidate, profile)
    require(integer(offset, 0, MAX_FINDINGS), "Invalid cleanup page offset")
    findings = islands(candidate, profile, layer_id)
    return dict(
        proposal=proposal_for(candidate, profile, layer_id),
        findings=findings[offset : offset + PAGE_SIZE],
        total_findings=len(findings),
        next_offset=offset + PAGE_SIZE if offset + PAGE_SIZE < len(findings) else None,
        validation=validate(candidate, candidate, profile, layer_id),
    )


def validate(before, after, profile, layer_id=None):
    """Check actual sources/composite, independent of how the result was constructed."""
    profile = profile_for(before, profile)
    old, locked = target(before, layer_id)
    editable.check_candidate(after)

    def metadata(c):
        return {k: v for k, v in c.items() if k not in {"rgba", "layer_rgba", "revision"}}

    checks = {"identity_geometry_metadata_and_base": metadata(before) == metadata(after)}
    if not checks["identity_geometry_metadata_and_base"]:
        return validation_result(before, after, profile, layer_id, checks)
    new, _ = target(after, layer_id)
    d, r = before["descriptor"], profile["rectangle"]
    protected = protected_mask(d, profile)
    scope_ok = alpha_ok = hidden_ok = protected_ok = True
    changed = False
    for pos in range(len(old) // 4):
        a, b = old[pos * 4 : pos * 4 + 4], new[pos * 4 : pos * 4 + 4]
        alpha_ok &= a[3] == b[3]
        hidden_ok &= a[3] != 0 or a == b
        if a != b:
            changed = True
            x, y = pos % d["width"], pos // d["width"]
            scope_ok &= r["x"] <= x < r["x"] + r["width"] and r["y"] <= y < r["y"] + r["height"]
            protected_ok &= not protected[pos]
    checks.update(
        alpha=alpha_ok,
        hidden_transparent_rgb=hidden_ok,
        editable_region=scope_ok,
        protected_pixels=protected_ok,
        target_layer_lock=not locked or not changed,
    )
    checks["other_layers"] = all(
        raw == after.get("layer_rgba", {}).get(key)
        for key, raw in before.get("layer_rgba", {}).items()
        if key != layer_id
    )
    # Full target source AND full composite, including hidden transparent RGBA.
    if "allowed_palette" in profile or "color_budget" in profile:
        allowed = {bytes(c) for c in profile.get("allowed_palette", [])}
        palette_ok = budget_ok = True
        for raw in (new, base64.b64decode(after["rgba"])):
            colors = set()
            for i in range(0, len(raw), 4):
                color = raw[i : i + 4]
                if "allowed_palette" in profile:
                    palette_ok &= color in allowed
                if "color_budget" in profile and len(colors) <= profile["color_budget"]:
                    colors.add(color)
            budget_ok &= len(colors) <= profile.get("color_budget", 256)
        if "allowed_palette" in profile:
            checks["allowed_palette_source_and_composite"] = palette_ok
        if "color_budget" in profile:
            checks["color_budget_source_and_composite"] = budget_ok
    return validation_result(before, after, profile, layer_id, checks)


def validation_result(before, after, profile, layer_id, checks):
    return dict(
        source_candidate_revision=before["revision"],
        candidate_revision=after["revision"],
        proposal_revision=proposal_for(before, profile, layer_id)["revision"],
        passed=all(checks.values()),
        hard_checks=checks,
        warnings=list(WARNINGS),
        unsupported_checks=list(UNSUPPORTED),
    )


def preview(candidate, proposal, selected):
    profile = check_proposal(candidate, proposal)
    require(
        isinstance(selected, list)
        and len(selected) <= PAGE_SIZE
        and all(isinstance(s, str) for s in selected)
        and len(set(selected)) == len(selected),
        "Select at most 256 distinct finding IDs",
    )
    raw, locked = target(candidate, proposal["layer_id"])
    require(not locked, "Layer is locked; unlock explicitly and analyze again")
    findings = {f["id"]: f for f in islands(candidate, profile, proposal["layer_id"])}
    require(set(selected) <= findings.keys(), "Unknown cleanup finding; analyze again")
    changed = bytearray(raw)
    changes = []
    width = candidate["descriptor"]["width"]
    for key in sorted(selected):
        f = findings[key]
        for x, y in f["pixels"]:
            pos = (y * width + x) * 4
            changed[pos : pos + 4] = bytes(f["replacement"])
            changes.append(
                dict(x=x, y=y, before=f["source"], after=f["replacement"], finding_id=key)
            )
    if proposal["layer_id"] is None:
        result = workshop.with_sources(candidate, {"composite": bytes(changed)})
    else:
        rasters = workshop.sources(candidate)
        rasters[proposal["layer_id"]] = bytes(changed)
        result = layers.reseal(candidate, rasters)
    validation = validate(candidate, result, profile, proposal["layer_id"])
    require(
        validation["passed"],
        "Cleanup violates hard constraints: "
        + ", ".join(key for key, ok in validation["hard_checks"].items() if not ok),
    )
    return dict(
        candidate=result,
        proposal_revision=proposal["revision"],
        selected=sorted(selected),
        changes=changes,
        changed_pixels=len(changes),
        validation=validation,
    )


def images(before, after, layer_id, changes):
    """Bounded layer-source overview; exact coordinates remain in the changes report."""
    old, _ = target(before, layer_id)
    new, _ = target(after, layer_id)
    d = before["descriptor"]
    w, h = d["width"], d["height"]
    scale = max(1, (max(w, h) + 1023) // 1024)
    ow, oh = (w + scale - 1) // scale, (h + scale - 1) // scale
    marked = {(c["x"] // scale, c["y"] // scale) for c in changes}
    result = {}
    for name, raw in (("before", old), ("after", new), ("changes", new)):
        output = bytearray()
        for y in range(oh):
            for x in range(ow):
                pos = (y * scale * w + x * scale) * 4
                color = raw[pos : pos + 4]
                if name == "changes":
                    color = (
                        b"\xff\x00\xff\xff"
                        if (x, y) in marked
                        else bytes(c // 4 for c in color[:3]) + b"\xff"
                    )
                output.extend(color)
        result[name] = png.encode(ow, oh, output)
    return result
