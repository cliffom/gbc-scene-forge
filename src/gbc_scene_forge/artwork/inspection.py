"""Bounded coordinate-labelled contact sheets tied to exact review receipts."""

import base64

from gbc_scene_forge.artwork import editable, raster, review
from gbc_scene_forge.core.validation import integer, require


def contact_sheet(reviews, candidate, rectangles, *, scale=4, changed_overlay=False):
    require(
        isinstance(rectangles, list) and 1 <= len(rectangles) <= 8, "Choose 1..8 contact rectangles"
    )
    require(integer(scale, 1, 8), "Contact scale must be 1..8")
    require(type(changed_overlay) is bool, "changed_overlay must be boolean")
    pixels = editable.check_candidate(candidate)
    d = candidate["descriptor"]
    checked = [raster.rectangle(d, r) for r in rectangles]
    require(
        all(max(r["width"], r["height"]) * scale <= 512 for r in checked),
        "Each contact cell must fit 512 pixels per axis at explicit scale",
    )
    columns = 3 if changed_overlay else 2
    require(
        sum(r["width"] * r["height"] * scale * scale * columns for r in checked) <= 4_194_304,
        "Contact sheet exceeds 4194304 image pixels",
    )
    # Review supplies the existing receipt and saved scene/reference guards.
    report = reviews.review(candidate, scale=1)
    documents = reviews.documents
    with documents.store.read_session(candidate["project_revision"], verify_assets=True) as session:
        previous = documents.validate_base(candidate, session.document)
        before = (
            editable.decode_image(d, documents._asset(session.document, previous["png"]))
            if previous
            else bytes(len(pixels))
        )
        if "placements" in candidate:
            before = documents._copy_source(session.document, candidate["source"])[4]
    width = max(260, max(r["width"] * scale for r in checked) + 16)
    height = sum(r["height"] * scale + 48 for r in checked)
    require(width * columns * height <= 8_388_608, "Contact sheet layout exceeds 8388608 pixels")
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width * columns}" height="{height}" '
        'style="background:#20242b;color:white">'
    ]
    y = 0
    details = []
    for r in checked:
        before_label = "before" if previous or "placements" in candidate else "before (transparent)"
        views = [(before_label, before), ("after", pixels)]
        changed = 0
        if changed_overlay:
            overlay = bytearray(pixels)
            for row in range(r["y"], r["y"] + r["height"]):
                for x in range(r["x"], r["x"] + r["width"]):
                    offset = (row * d["width"] + x) * 4
                    if pixels[offset : offset + 4] != before[offset : offset + 4]:
                        changed += 1
                        overlay[offset : offset + 4] = bytes([255, 0, 255, 255])
            views.append(("changed (magenta)", bytes(overlay)))
        for column, (label, raw) in enumerate(views):
            view = review.isolated(d, raw, scale, r)
            data = base64.b64encode(view["enlarged_png"]).decode()
            x = column * width
            parts.append(
                f'<text x="{x + 4}" y="{y + 16}" fill="white" font-size="12">'
                f'{label}</text><text x="{x + 4}" y="{y + 32}" fill="white" font-size="12">'
                f"x={r['x']} y={r['y']} {r['width']}x{r['height']} "
                f"@{scale}x</text>"
            )
            parts.append(
                f'<image x="{x}" y="{y + 40}" width="{r["width"] * scale}" '
                f'height="{r["height"] * scale}" href="data:image/png;base64,{data}"/>'
            )
        details.append(
            {
                "rectangle": r,
                "scale": scale,
                "sample_step": 1,
                "changed_pixels": changed if changed_overlay else None,
            }
        )
        y += r["height"] * scale + 48
    parts.append("</svg>")
    documents._revalidate(candidate["project_revision"])
    # Exact rectangle-union area, without allocating a canvas-size coverage bitmap.
    bands = sorted({v for r in checked for v in (r["y"], r["y"] + r["height"])})
    area = 0
    for top, bottom in zip(bands, bands[1:]):
        intervals = sorted(
            (r["x"], r["x"] + r["width"])
            for r in checked
            if r["y"] <= top and r["y"] + r["height"] >= bottom
        )
        right = length = 0
        for left, end in intervals:
            length += max(0, end - max(left, right))
            right = max(right, end)
        area += length * (bottom - top)
    return {
        "candidate_revision": candidate["revision"],
        "receipt": report["receipt"],
        "project_revision": candidate["project_revision"],
        "artwork_revision": candidate["artwork_revision"],
        "rectangles": details,
        "complete": area == d["width"] * d["height"],
        "before_basis": "saved original"
        if previous or "placements" in candidate
        else "transparent",
        "changed_overlay": changed_overlay,
        "overlay": "Exact RGBA differences, including hidden RGB; magenta replaces changed pixels",
        "contact_svg": "".join(parts).encode(),
    }
