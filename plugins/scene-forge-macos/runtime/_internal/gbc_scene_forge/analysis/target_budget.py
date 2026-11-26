"""Static source-cell estimates, never a runtime allocation or hardware certificate."""

from gbc_scene_forge.analysis.artwork_usage import frame_closure
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats.tiled import scene_layers

WORK_LIMIT = 1_000_000
LIMITS = {"bg_tiles_reserved": 256, "obj_tiles_reserved": 256, "oam_reserved": 40}
POLICY = {
    "id": "gbc-static-split-v1",
    "version": 1,
    "addressing": "unsigned BG bank 0; OBJ bank 1; 256 8x8 tiles per bank",
    "residency": "all layers including hidden; whole scene and linked animation frames resident",
    "tiles": "unique atlas source 8x8 coordinates; no pixel deduplication or index remapping",
    "sprites": "rectangular metasprites; worst linked frame per placement; no culling",
}


def check_profile(value):
    require(
        isinstance(value, dict)
        and set(value) == {"id", "sprite_height", *LIMITS}
        and value["id"] == POLICY["id"]
        and type(value["sprite_height"]) is int
        and value["sprite_height"] in (8, 16),
        "Choose gbc-static-split-v1 with 8 or 16 pixel hardware sprites",
    )
    for key, limit in LIMITS.items():
        require(value[key] is None or integer(value[key], 0, limit), f"Invalid {key} reservation")


def report(scene, project, profile, scene_id):
    check_profile(profile)
    cells = {"bg_tiles": set(), "obj_tiles": set()}
    contributors = {key: [] for key in (*cells, "oam")}
    missing = []
    cache = {}
    accounted = set()
    region_indexes = {}
    closures = {}
    failures = {}
    oam = 0
    remaining = WORK_LIMIT
    for layer in scene_layers(scene):
        base = {"scene_id": scene_id, "layer_id": layer["id"], "layer_name": layer["name"]}
        placements = (
            [
                (a, x, y, None)
                for y, row in enumerate(layer["cells"])
                for x, a in enumerate(row)
                if a
            ]
            if layer["type"] == "tilelayer"
            else [
                (o["asset"], o["x"], o["y"], o["id"])
                for o in layer["objects"]
                if o.get("kind", "sprite") == "sprite"
            ]
        )
        for asset, x, y, oid in placements:
            source = {**base, "asset": asset, "x": x, "y": y, "object_id": oid}
            pool = "bg_tiles" if oid is None else "obj_tiles"
            try:
                identity = (pool, asset.rsplit("#", 1)[0])
                if identity in failures:
                    raise ValueError(failures[identity])
                if identity not in cache:
                    aid, name, *offset = identity[1].split("/")
                    manifest = project["atlases"][aid]["manifest"]
                    if aid not in region_indexes:
                        region_indexes[aid] = {r["name"]: r for r in manifest["regions"]}
                    regions = region_indexes[aid]
                    ox, oy = (
                        (int(offset[0]) * scene["grid"], int(offset[1]) * scene["grid"])
                        if oid is None
                        else (0, 0)
                    )
                    found = set()
                    count = 0
                    if (aid, name) not in closures:
                        closures[aid, name] = frame_closure(manifest, name)
                    for frame in closures[aid, name]:
                        r = regions[frame]
                        w, h = (
                            (scene["grid"], scene["grid"])
                            if oid is None
                            else (r["width"], r["height"])
                        )
                        require(
                            r["kind"] == ("tile" if oid is None else "sprite"), "Wrong artwork kind"
                        )
                        require(
                            ox + w <= r["width"] and oy + h <= r["height"],
                            "Animation frame lacks placed offset",
                        )
                        require(
                            all(v % 8 == 0 for v in (r["x"] + ox, r["y"] + oy, w, h)),
                            "Artwork does not align to hardware 8x8 cells",
                        )
                        require(
                            oid is None or h % profile["sprite_height"] == 0,
                            "Sprite height is not divisible by the hardware sprite height",
                        )
                        remaining -= w // 8 * (h // 8)
                        require(
                            remaining >= 0,
                            "Source-cell work limit exceeded; remaining estimates are unverified",
                        )
                        for cy in range(r["y"] + oy, r["y"] + oy + h, 8):
                            for cx in range(r["x"] + ox, r["x"] + ox + w, 8):
                                found.add((aid, cx, cy))
                        count = max(count, w // 8 * (h // profile["sprite_height"]))
                    cache[identity] = (found, count)
                found, count = cache[identity]
                if identity not in accounted:
                    if found - cells[pool]:
                        contributors[pool].append(source)
                    cells[pool].update(found)
                    accounted.add(identity)
                if oid is not None:
                    oam += count
                    contributors["oam"].append({**source, "required": count})
            except (KeyError, IndexError, ValueError, TypeError) as error:
                failures[identity] = str(error)
                missing.append({**source, "reason": str(error)})
    metrics = {}
    for key, required in (
        ("bg_tiles", len(cells["bg_tiles"])),
        ("obj_tiles", len(cells["obj_tiles"])),
        ("oam", oam),
    ):
        reserved = profile[f"{key}_reserved"]
        limit = LIMITS[f"{key}_reserved"]
        available = None if reserved is None else limit - reserved
        metrics[key] = {
            "required": required,
            "limit": limit,
            "available": available,
            "reserved": reserved,
            "status": "unverified"
            if missing or available is None
            else "over-estimate"
            if required > available
            else "within-estimate",
            "contributors": contributors[key],
        }
    return {
        "version": 1,
        "status": "unverified",
        "policy": POLICY,
        "profile": profile,
        "metrics": metrics,
        "unverified_contributors": missing,
        "warnings": [
            "Tile counts estimate source cells, not encoded unique patterns. Reduce source artwork or verify deduplication/streaming in the consuming build when over budget.",
            "OAM estimates assume every placed rectangular metasprite is resident simultaneously. Reduce actors or verify camera culling and runtime OAM allocation when over budget.",
            "Runtime unverified: 10 objects per scanline, camera transforms, dynamic actors, 8x16 even tile pairing, actual VRAM bank allocation, diagonal tile transforms, ROM banks, tilemaps, DMA and frame timing. These estimates cannot certify hardware compatibility.",
        ],
    }
