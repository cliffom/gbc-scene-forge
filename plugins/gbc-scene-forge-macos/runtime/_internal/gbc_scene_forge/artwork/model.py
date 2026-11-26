"""Stable grid sizes and region identities shared by artwork and Tiled."""

GRIDS = (8, 16, 32)


def sprite_mapping(entry):
    """Older projects have metadata but no sprite tileset until their next mutation."""
    if "sprites" in entry["tiles"]:
        return entry["tiles"]["sprites"]
    atlas_id = entry["manifest"]["id"]
    return {
        f"{atlas_id}/{r['name']}": index
        for index, r in enumerate(r for r in entry["manifest"]["regions"] if r["kind"] == "sprite")
    }


def tile_key(atlas_id, region, x, y):
    return f"{atlas_id}/{region}/{x}/{y}"
