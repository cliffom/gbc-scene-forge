"""Generic PNG slicing; deliberately makes no GBC palette compatibility claims."""

import base64

from gbc_scene_forge.artwork import png
from gbc_scene_forge.artwork.model import GRIDS
from gbc_scene_forge.core.validation import identifier, integer, require


def image_bytes(encoded):
    require(isinstance(encoded, str) and len(encoded) <= 5592408, "PNG exceeds 4 MiB")
    try:
        image = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise ValueError("Invalid PNG encoding") from error
    require(len(image) <= 4 * 1024 * 1024, "PNG exceeds 4 MiB")
    return image


def bundle(value):
    require(
        isinstance(value, dict) and set(value) == {"id", "png", "grid", "margin", "spacing"},
        "Expected PNG, asset ID, grid, margin and spacing",
    )
    atlas_id, grid, margin, spacing = (value[k] for k in ("id", "grid", "margin", "spacing"))
    require(identifier(atlas_id), "Use an asset ID starting with a letter: a-z, 0-9, underscore")
    require(type(grid) is int and grid in GRIDS, "Choose an 8, 16 or 32 pixel grid")
    require(integer(margin, 0, 2048) and integer(spacing, 0, 2048), "Invalid margin or spacing")
    image = image_bytes(value["png"])
    width, height, pixels = png.decode(image, generic=True)
    inner_w, inner_h = width - 2 * margin, height - 2 * margin
    require(
        inner_w >= grid
        and inner_h >= grid
        and (inner_w + spacing) % (grid + spacing) == 0
        and (inner_h + spacing) % (grid + spacing) == 0,
        "Grid, margin and spacing must slice the entire sheet exactly",
    )
    columns, rows = (inner_w + spacing) // (grid + spacing), (inner_h + spacing) // (grid + spacing)
    require(columns * rows <= 255, "Use at most 255 tiles per sheet")
    # Coordinate names preserve existing identities when rows/columns are appended.
    regions = [
        {
            "name": f"tile_{x}_{y}",
            "kind": "tile",
            "x": margin + x * (grid + spacing),
            "y": margin + y * (grid + spacing),
            "width": grid,
            "height": grid,
        }
        for y in range(rows)
        for x in range(columns)
    ]
    manifest = {
        "version": 1,
        "id": atlas_id,
        "png": "atlas.png",
        "regions": regions,
        "animations": [],
        "source_format": "png-tilesheet",
        "slicing": {"grid": grid, "margin": margin, "spacing": spacing},
    }
    return manifest, image, width, pixels
