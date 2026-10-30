"""Native-scale saved artwork rendering, without editor overlays or playback.

Matches the editor's canonical grid slicing, orthogonal transforms, sprite
origins and ordered visible layers. Output stays transparent outside artwork.
"""

from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats import tiled

MAX_DIMENSION = 1024
MAX_PIXELS = 1024 * 1024
MAX_WORK = 16 * MAX_PIXELS
MAX_SOURCE_PIXELS = 4 * MAX_PIXELS


def viewport(value):
    require(
        isinstance(value, dict) and set(value) == {"x", "y", "width", "height"},
        "Expected a pixel viewport: x, y, width, height",
    )
    require(all(integer(value[k], 0, 8192) for k in ("x", "y")), "Invalid viewport origin")
    require(
        all(integer(value[k], 1, MAX_DIMENSION) for k in ("width", "height"))
        and value["width"] * value["height"] <= MAX_PIXELS,
        "Artwork views support at most 1024 pixels per axis and 1048576 pixels",
    )
    return dict(value)


def render(scene, project, read_image, view):
    """Render a bounded rectangle, lazily reading validated declared atlas bytes."""
    view = viewport(view)
    width, height = view["width"], view["height"]
    output = bytearray(width * height * 4)
    grid = scene["grid"]
    tiles, sprites = {}, {}
    for atlas_id, entry in project["atlases"].items():
        for region in entry["manifest"]["regions"]:
            if region["kind"] == "sprite":
                sprites[f"{atlas_id}/{region['name']}"] = (entry["png"], region)
            elif region["width"] % grid == region["height"] % grid == 0:
                for y in range(region["height"] // grid):
                    for x in range(region["width"] // grid):
                        tiles[f"{atlas_id}/{region['name']}/{x}/{y}"] = (
                            entry["png"],
                            dict(
                                x=region["x"] + x * grid,
                                y=region["y"] + y * grid,
                                width=grid,
                                height=grid,
                            ),
                        )
    decoded = {}
    work = 0

    def blit(source, region, x, y, flags=0):
        nonlocal work
        x, y = x - view["x"], y - view["y"]
        rw, rh = region["width"], region["height"]
        left, top, right, bottom = max(0, x), max(0, y), min(width, x + rw), min(height, y + rh)
        if left >= right or top >= bottom:
            return
        work += (right - left) * (bottom - top)
        require(
            work <= MAX_WORK,
            "Artwork review exceeds 16777216 composited pixels; use a smaller view",
        )
        if source not in decoded:
            image = png.decode(read_image(source), generic=True)
            require(
                sum(w * h for w, h, _ in decoded.values()) + image[0] * image[1]
                <= MAX_SOURCE_PIXELS,
                "Artwork review exceeds 4194304 source pixels; use a smaller view",
            )
            decoded[source] = image
        sw, _, pixels = decoded[source]
        for dy in range(top, bottom):
            for dx in range(left, right):
                # Invert Tiled's diagonal, then horizontal/vertical transform.
                sx, sy = dx - x, dy - y
                if flags & 1:
                    sx = rw - 1 - sx
                if flags & 2:
                    sy = rh - 1 - sy
                if flags & 4:
                    sx, sy = sy, sx
                start = ((region["y"] + sy) * sw + region["x"] + sx) * 4
                color = pixels[start : start + 4]
                alpha = color[3]
                if not alpha:
                    continue
                dest = (dy * width + dx) * 4
                if alpha == 255 or not output[dest + 3]:
                    output[dest : dest + 4] = color
                else:
                    old = output[dest : dest + 4]
                    combined = alpha * 255 + old[3] * (255 - alpha)
                    for c in range(3):
                        output[dest + c] = (
                            color[c] * alpha * 255 + old[c] * old[3] * (255 - alpha) + combined // 2
                        ) // combined
                    output[dest + 3] = (combined + 127) // 255

    for layer in tiled.scene_layers(scene):
        if not layer["visible"]:
            continue
        if layer["type"] == "tilelayer":
            for y in range(
                max(0, view["y"] // grid),
                min(scene["height"], (view["y"] + height + grid - 1) // grid),
            ):
                for x in range(
                    max(0, view["x"] // grid),
                    min(scene["width"], (view["x"] + width + grid - 1) // grid),
                ):
                    asset, flags = tiled.cell_parts(layer["cells"][y][x])
                    if asset in tiles:
                        source, region = tiles[asset]
                        blit(source, region, x * grid, y * grid, flags)
        else:
            for item in layer["objects"]:
                if item.get("kind", "sprite") == "sprite":
                    source, region = sprites[item["asset"]]
                    ox, oy = item.get("origin", region.get("origin", [0, 0]))
                    blit(source, region, item["x"] - ox, item["y"] - oy)
    return png.encode(width, height, output)
