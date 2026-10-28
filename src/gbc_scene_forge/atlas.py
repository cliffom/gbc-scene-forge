"""Validate explicit gbc-atlas inputs without executing atlas or game code."""

import base64
import copy
import json
import re
import tempfile
from pathlib import Path

from . import png, tile_metadata
from .documents import json_text
from .paths import reject_symlinks

GRIDS = (8, 16, 32)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identifier(value):
    return isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def relative_file(root, name):
    require(isinstance(name, str) and bool(name) and "\\" not in name, "Invalid bundle path")
    path = Path(name)
    require(
        not path.is_absolute() and not re.match(r"^[a-zA-Z]:", name) and ".." not in path.parts,
        "Bundle path escapes its folder",
    )
    target = root / path
    reject_symlinks(target, root)
    return target


def load_bundle(path):
    path = Path(path).absolute()
    require(path.name.endswith(".atlas.json"), "Choose a *.atlas.json manifest")
    reject_symlinks(path, path.parent)
    require(path.stat().st_size <= 1024 * 1024, "Atlas manifest exceeds 1 MiB")
    manifest = json.loads(path.read_bytes())
    require(isinstance(manifest, dict), "Atlas manifest must be an object")
    require(
        type(manifest.get("version")) is int and manifest["version"] == 1,
        "Unsupported atlas manifest version",
    )
    require(identifier(manifest.get("id")), "Invalid atlas ID")
    image_path = relative_file(path.parent, manifest.get("png"))
    require(image_path.suffix.lower() == ".png", "Atlas image must be PNG")
    require(image_path.stat().st_size <= 4 * 1024 * 1024, "Atlas PNG exceeds 4 MiB")
    image = image_path.read_bytes()
    width, height, pixels = png.decode(image)
    require(width * height // 64 <= 256, "Atlas supports at most 256 cells")
    # Optional authoring files need not be present, but unsafe declarations are rejected.
    for key in ("source", "preview"):
        if key in manifest:
            relative_file(path.parent, manifest[key])
    reviews = manifest.get("review_images", [])
    require(isinstance(reviews, list), "review_images must be a list")
    for name in reviews:
        relative_file(path.parent, name)
    palettes = manifest.get("palettes")
    require(isinstance(palettes, list) and 1 <= len(palettes) <= 8, "Use 1..8 palettes")
    for palette in palettes:
        require(
            isinstance(palette, list)
            and len(palette) == 4
            and all(
                isinstance(color, list)
                and len(color) == 3
                and all(integer(v, 0, 31) for v in color)
                for color in palette
            ),
            "Palettes require four RGB5 triplets",
        )
    assignments = manifest.get("cell_palettes")
    require(
        isinstance(assignments, list)
        and len(assignments) == width * height // 64
        and all(integer(v, 0, len(palettes) - 1) for v in assignments),
        "cell_palettes must assign every atlas cell",
    )
    regions = manifest.get("regions")
    require(isinstance(regions, list) and 1 <= len(regions) <= 255, "Declare 1..255 regions")
    names, kinds = {}, {}
    for region in regions:
        require(isinstance(region, dict), "Region must be an object")
        name = region.get("name")
        require(identifier(name) and name not in names, "Invalid or duplicate region name")
        require(region.get("kind") in ("tile", "sprite"), "Invalid region kind")
        require(
            all(
                integer(region.get(k), 0, 256) and region[k] % 8 == 0
                for k in ("x", "y", "width", "height")
            ),
            "Regions need aligned pixel rectangles",
        )
        x, y, w, h = (region[k] for k in ("x", "y", "width", "height"))
        require(w > 0 and h > 0 and x + w <= width and y + h <= height, "Region outside atlas")
        require(
            region["kind"] != "sprite" or y % 16 == h % 16 == 0,
            "Sprite regions need aligned 8x16 pairs",
        )
        origin = region.get("origin", [0, 0])
        require(
            isinstance(origin, list)
            and len(origin) == 2
            and integer(origin[0], 0, w - 1)
            and integer(origin[1], 0, h - 1),
            "Invalid region origin",
        )
        require(
            "duration_ms" not in region or integer(region["duration_ms"], 1, 65535),
            "Invalid region duration",
        )
        names[name] = region
        for cy in range(y // 8, (y + h) // 8):
            for cx in range(x // 8, (x + w) // 8):
                require(
                    kinds.get((cx, cy), region["kind"]) == region["kind"],
                    "Overlapping tile/sprite kinds",
                )
                kinds[cx, cy] = region["kind"]
    require(len(kinds) == width * height // 64, "Every atlas cell must belong to a region")
    for (cx, cy), kind in kinds.items():
        palette_id = assignments[cy * (width // 8) + cx]
        palette = [tuple((v * 255 + 15) // 31 for v in color) for color in palettes[palette_id]]
        visible = palette if kind == "tile" else palette[1:]
        require(len(set(visible)) == len(visible), "Duplicate visible palette colors")
        if kind == "sprite":
            require(
                assignments[(cy ^ 1) * (width // 8) + cx] == palette_id,
                "Sprite pairs must share a palette",
            )
        for py in range(cy * 8, cy * 8 + 8):
            for px in range(cx * 8, cx * 8 + 8):
                pos = (py * width + px) * 4
                sample = pixels[pos : pos + 4]
                require(
                    sample[3] in (0, 255) and (kind != "tile" or sample[3] == 255),
                    "Invalid tile/sprite transparency",
                )
                require(
                    sample[3] == 0 or tuple(sample[:3]) in visible,
                    "PNG pixel outside its assigned RGB5 palette",
                )
    animations = manifest.get("animations", [])
    require(isinstance(animations, list), "animations must be a list")
    seen = set()
    for animation in animations:
        require(
            isinstance(animation, dict)
            and identifier(animation.get("name"))
            and animation["name"] not in seen,
            "Invalid or duplicate animation",
        )
        seen.add(animation["name"])
        frames = animation.get("frames")
        require(isinstance(frames, list) and 1 <= len(frames) <= 255, "Animation needs frames")
        shapes = []
        for frame in frames:
            require(
                isinstance(frame, dict) and frame.get("region") in names, "Unknown animation region"
            )
            region = names[frame["region"]]
            require(
                integer(frame.get("duration_ms", region.get("duration_ms")), 1, 65535),
                "Animation frame needs duration_ms",
            )
            shapes.append(
                [region[k] for k in ("width", "height", "kind")] + [region.get("origin", [0, 0])]
            )
        require(all(shape == shapes[0] for shape in shapes), "Animation frame shapes differ")
    # Keep all metadata; imported runtime paths are normalized separately by project storage.
    return copy.deepcopy(manifest), image, width, pixels


def load_uploaded_bundle(bundle):
    """Validate browser-selected bytes through the same importer as local paths."""
    require(
        isinstance(bundle, dict) and set(bundle) == {"name", "manifest", "png"},
        "Expected an atlas manifest and PNG bundle",
    )
    name, text, encoded = (bundle[key] for key in ("name", "manifest", "png"))
    require(
        isinstance(name, str)
        and name.endswith(".atlas.json")
        and ":" not in name
        and "/" not in name
        and "\\" not in name,
        "Invalid atlas manifest filename",
    )
    require(
        isinstance(text, str) and len(text.encode("utf-8")) <= 1024 * 1024,
        "Atlas manifest exceeds 1 MiB",
    )
    require(
        isinstance(encoded, str) and len(encoded) <= 4 * ((4 * 1024 * 1024 + 2) // 3),
        "Atlas PNG exceeds 4 MiB",
    )
    manifest = json.loads(text)
    require(isinstance(manifest, dict), "Atlas manifest must be an object")
    try:
        image = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise ValueError("Invalid atlas PNG encoding") from error
    require(len(image) <= 4 * 1024 * 1024, "Atlas PNG exceeds 4 MiB")
    with tempfile.TemporaryDirectory(prefix="forge-atlas-import-") as folder:
        root = Path(folder)
        target = relative_file(root, manifest.get("png"))
        require(target.suffix.lower() == ".png", "Atlas image must be PNG")
        require(target != root / name, "Atlas PNG must be separate from its manifest")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(image)
        path = root / name
        path.write_text(text, encoding="utf-8")
        return load_bundle(path)


def tile_key(atlas_id, region, x, y):
    return f"{atlas_id}/{region}/{x}/{y}"


def sprite_mapping(entry):
    """Older projects have metadata but no sprite tileset until their next mutation."""
    if "sprites" in entry["tiles"]:
        return entry["tiles"]["sprites"]
    atlas_id = entry["manifest"]["id"]
    return {
        f"{atlas_id}/{r['name']}": index
        for index, r in enumerate(r for r in entry["manifest"]["regions"] if r["kind"] == "sprite")
    }


def build_sprites(entry, width, pixels):
    atlas_id = entry["manifest"]["id"]
    mapping = copy.deepcopy(sprite_mapping(entry))
    records, changes = [], {}
    for region in entry["manifest"]["regions"]:
        if region["kind"] != "sprite":
            continue
        key = f"{atlas_id}/{region['name']}"
        if key not in mapping:
            mapping[key] = len(mapping)
        local = mapping[key]
        changes[f"assets/{atlas_id}/sprites/{local}.png"] = png.crop_rectangle(
            width, pixels, region["x"], region["y"], region["width"], region["height"]
        )
        records.append(
            {
                "id": local,
                "image": f"sprites/{local}.png",
                "imagewidth": region["width"],
                "imageheight": region["height"],
                "properties": [{"name": "forge:asset", "type": "string", "value": key}],
            }
        )
    if records:
        changes[f"assets/{atlas_id}/sprites.tsj"] = json_text(
            {
                "type": "tileset",
                "version": "1.10",
                "name": f"{atlas_id} sprites",
                "tilewidth": max(r["imagewidth"] for r in records),
                "tileheight": max(r["imageheight"] for r in records),
                "tilecount": len(records),
                "columns": 0,
                "margin": 0,
                "spacing": 0,
                "objectalignment": "bottomleft",
                "tiles": sorted(records, key=lambda t: t["id"]),
            }
        ).encode()
    entry["tiles"]["sprites"] = mapping
    return changes


def build_assets(manifest, image, width, pixels, previous=None):
    atlas_id = manifest["id"]
    base = f"assets/{atlas_id}"
    old = previous or {}
    tiles = copy.deepcopy(old.get("tiles", {str(size): {} for size in GRIDS}))
    changes = {f"{base}/atlas.png": image}
    for size in GRIDS:
        mapping = tiles[str(size)]
        records = []
        for region in manifest["regions"]:
            if region["kind"] != "tile" or region["width"] % size or region["height"] % size:
                continue
            for y in range(region["height"] // size):
                for x in range(region["width"] // size):
                    key = tile_key(atlas_id, region["name"], x, y)
                    if key not in mapping:
                        mapping[key] = len(mapping)
                    local = mapping[key]
                    changes[f"{base}/grid-{size}/{local}.png"] = png.crop(
                        width, pixels, region["x"] + x * size, region["y"] + y * size, size
                    )
                    records.append(
                        {
                            "id": local,
                            "image": f"grid-{size}/{local}.png",
                            "imagewidth": size,
                            "imageheight": size,
                            "properties": [{"name": "forge:asset", "type": "string", "value": key}],
                        }
                    )
        changes[f"{base}/grid-{size}.tsj"] = json_text(
            {
                "type": "tileset",
                "version": "1.10",
                "name": atlas_id,
                "tilewidth": size,
                "tileheight": size,
                "tilecount": len(records),
                "columns": 0,
                "margin": 0,
                "spacing": 0,
                "tiles": sorted(records, key=lambda t: t["id"]),
            }
        ).encode()
    normalized = dict(manifest, png="atlas.png")
    # This copy is runtime interchange metadata; original declarations remain provenance.
    for key in ("source", "preview", "review_images"):
        normalized.pop(key, None)
    changes[f"{base}/{atlas_id}.atlas.json"] = json_text(normalized).encode()
    entry = {"manifest": manifest, "tiles": tiles, "png": f"{base}/atlas.png"}
    if "metadata" in old:
        entry["metadata"] = copy.deepcopy(old["metadata"])
    changes.update(build_sprites(entry, width, pixels))
    tile_metadata.check_entry(entry)
    tile_metadata.decorate_changes(entry, changes)
    return entry, changes
