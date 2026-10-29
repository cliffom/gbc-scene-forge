"""Compile representable atlas sequences to Tiled's one-loop-per-tile model."""

from collections import defaultdict

from gbc_scene_forge.artwork.model import sprite_mapping, tile_key


def decorate(entry, group, document):
    manifest = entry["manifest"]
    atlas_id = manifest["id"]
    regions = {r["name"]: r for r in manifest["regions"]}
    mapping = sprite_mapping(entry) if group == "sprites" else entry["tiles"][group]
    tiles = {tile["id"]: tile for tile in document["tiles"]}
    candidates, report = defaultdict(list), []
    for animation in manifest.get("animations", []):
        first = regions[animation["frames"][0]["region"]]
        if (first["kind"] == "sprite") != (group == "sprites"):
            continue
        size = None if group == "sprites" else int(group)
        if size and (first["width"] % size or first["height"] % size):
            report.append(
                {"name": animation["name"], "status": "skipped", "reason": "incompatible grid"}
            )
            continue
        offsets = (
            [(0, 0)]
            if size is None
            else [
                (x, y)
                for y in range(first["height"] // size)
                for x in range(first["width"] // size)
            ]
        )
        for x, y in offsets:
            frames = []
            for frame in animation["frames"]:
                region = regions[frame["region"]]
                key = (
                    f"{atlas_id}/{region['name']}"
                    if size is None
                    else tile_key(atlas_id, region["name"], x, y)
                )
                local = mapping.get(key)
                if local not in tiles:
                    frames = []
                    break
                frames.append(
                    {
                        "tileid": local,
                        "duration": frame.get("duration_ms", region.get("duration_ms")),
                    }
                )
            if frames:
                candidates[frames[0]["tileid"]].append((animation["name"], frames))
            else:
                report.append(
                    {"name": animation["name"], "status": "skipped", "reason": "missing frame tile"}
                )
    for local, choices in sorted(candidates.items()):
        for name, frames in choices:
            result = {"name": name, "tileid": local}
            if len(choices) > 1:
                report.append({**result, "status": "skipped", "reason": "shared starting tile"})
                continue
            tiles[local]["animation"] = frames
            props = tiles[local].setdefault("properties", [])
            props[:] = [p for p in props if p["name"] != "forge:animation"]
            props.append({"name": "forge:animation", "type": "string", "value": name})
            report.append({**result, "status": "exported"})
    return report
