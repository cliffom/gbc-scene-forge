"""Read-only, deterministic Tiled dependency snapshots and portable ZIP archives."""

import io
import json
import posixpath
import zipfile
from pathlib import PurePosixPath

from gbc_scene_forge.artwork import animations, png
from gbc_scene_forge.artwork import metadata as tile_metadata
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.storage.files import digest
from gbc_scene_forge.storage.paths import safe_path

MAX_BYTES = 256 * 1024 * 1024
MANIFEST = "forge.project.json"
GUIDE = """# Scene Forge Tiled export

Extract the ZIP and open a map under scenes/ in Tiled. Keep assets/ beside scenes/.
Move the entire extracted directory to preserve relative references. No connector,
original import folder, server or network connection is needed to open the maps.

A scene export contains one map and its external tilesets and PNG dependencies.
Maps may reference tilesets not currently painted on the canvas; those sets and
all their tile images are retained. A project export includes all saved scenes,
all managed assets and forge.project.json; launch Forge on the extracted directory
to keep editing. Transaction history and undeclared workspace files are excluded.

export.json lists scene names, source revisions, canvas overrides and SHA-256
checksums of the exported files. A canvas override changes only the downloaded
snapshot. Source project files and editor undo history stay unchanged.

World layout and connections are retained in forge.project.json for project exports
and world.json for both export scopes. Endpoint scene UUIDs and Tiled object IDs
remain stable. A scene-only export can reference scenes not included in the ZIP.
Connections describe authoring intent; Tiled does not execute transitions.

Maps use finite orthogonal grids, ordered named tile/object layers and external
image-collection tilesets. GID zero is empty; transformed GIDs are unsupported.
Objects support native-size sprites, points and rectangles, names, classes (Tiled
type) and string/int/float/bool custom properties. Coordinates use whole pixels.
Sprite object coordinates use Tiled's bottom-left anchor. Optional integer
forge:origin_x and forge:origin_y properties retain an instance's Forge origin.

Tile properties forge:terrain (string) and forge:solid (bool) retain authored
classifications and collision flags. Tile objectgroup rectangles, ellipses and
simple polygons retain collision geometry; a solid tile with no custom geometry
has a full-bounds rectangle. forge:next_shape_id retains the next authored ID.
Optional forge:terrain_mask (int, 0..15) records Forge's north/east/south/west
transition rule (bits 1/2/4/8). These are custom properties, not Wang sets or Tiled
automapping rules. Resolved placements display without a terrain engine.
Grid/collision view overlays are not baked into artwork. Export performs no game
build, movement simulation or collision simulation.

Supported atlas sequences become native Tiled tile animations with original frame
milliseconds and local tile IDs. A sequence animates its first region (each cell
for a grid-split region). forge:animation retains its name. Sequences sharing a
starting tile are skipped because Tiled supports one loop per tile; export.json
reports exported and skipped sequences. Named action/direction mappings remain
Forge project preferences, not Tiled actor behavior. Playback speed preferences
never alter exported timing. Source project files remain unchanged.

"""


def dependency(source, reference):
    require(
        isinstance(reference, str)
        and reference
        and ":" not in reference
        and "\\" not in reference
        and not reference.startswith("/")
        and str(PurePosixPath(reference)) == reference
        and all(ord(char) >= 32 for char in reference),
        f"Invalid dependency path in {source}",
    )
    path = posixpath.normpath(posixpath.join(posixpath.dirname(source), reference))
    require(
        path.startswith("assets/") and ".." not in PurePosixPath(path).parts,
        f"Dependency escapes exported assets: {source} -> {reference}",
    )
    return path


def parse_json(data, path):
    try:
        value = json.loads(data)
    except (ValueError, UnicodeError) as error:
        raise ValueError(f"Cannot export {path}: invalid JSON") from error
    require(isinstance(value, dict), f"Cannot export {path}: expected a JSON object")
    return value


def tileset_images(document, path):
    allowed = {
        "type",
        "version",
        "tiledversion",
        "name",
        "tilewidth",
        "tileheight",
        "tilecount",
        "columns",
        "margin",
        "spacing",
        "objectalignment",
        "tiles",
    }
    require(
        not set(document) - allowed
        and document.get("type") == "tileset"
        and document.get("version") == "1.10"
        and document.get("columns") == 0
        and document.get("margin", 0) == document.get("spacing", 0) == 0
        and document.get("objectalignment", "bottomleft") == "bottomleft",
        f"Unsupported tileset fields or settings in {path}; export needs image-collection tilesets",
    )
    tiles = document.get("tiles")
    require(
        isinstance(tiles, list) and document.get("tilecount") == len(tiles),
        f"Invalid tileset tile count in {path}",
    )
    images, seen = {}, set()
    for tile in tiles:
        require(
            isinstance(tile, dict)
            and not set(tile)
            - {
                "id",
                "image",
                "imagewidth",
                "imageheight",
                "properties",
                "objectgroup",
                "animation",
            },
            f"Unsupported tile fields in {path}; refusing to omit dependencies",
        )
        local = tile.get("id")
        require(
            type(local) is int and local >= 0 and local not in seen,
            f"Invalid or duplicate tile ID in {path}",
        )
        seen.add(local)
        image = dependency(path, tile.get("image"))
        require(image.endswith(".png"), f"Tile image must be PNG: {image}")
        size = tile.get("imagewidth"), tile.get("imageheight")
        require(all(type(v) is int and v > 0 for v in size), f"Invalid image dimensions in {path}")
        require(
            image not in images or images[image] == size, f"Conflicting image dimensions in {path}"
        )
        images[image] = size
        properties = tile.get("properties", [])
        require(isinstance(properties, list), f"Invalid tile properties in {path}")
        names = set()
        for prop in properties:
            require(
                isinstance(prop, dict) and set(prop) == {"name", "type", "value"},
                f"Unsupported tile properties in {path}",
            )
            name, kind = prop["name"], prop["type"]
            require(
                isinstance(name, str)
                and name not in names
                and name
                in {
                    "forge:asset",
                    "forge:terrain",
                    "forge:terrain_mask",
                    "forge:solid",
                    "forge:next_shape_id",
                    "forge:animation",
                },
                f"Unsupported or duplicate tile property in {path}",
            )
            names.add(name)
            expected = (
                "bool"
                if name == "forge:solid"
                else "int"
                if name in ("forge:next_shape_id", "forge:terrain_mask")
                else "string"
            )
            require(
                kind == expected
                and type(prop["value"]) is {"bool": bool, "int": int, "string": str}[kind],
                f"Invalid tile property type in {path}",
            )
            if name == "forge:terrain_mask":
                require(0 <= prop["value"] <= 15, f"Invalid terrain mask in {path}")
        if "objectgroup" in tile:
            group = tile["objectgroup"]
            require(
                isinstance(group, dict)
                and not set(group)
                - {"type", "name", "id", "draworder", "opacity", "visible", "x", "y", "objects"}
                and isinstance(group.get("objects"), list),
                f"Unsupported collision group in {path}",
            )
            require(
                group.get("type") == "objectgroup"
                and group.get("x", 0) == group.get("y", 0) == 0
                and group.get("opacity", 1) == 1
                and group.get("visible", True) is True
                and group.get("draworder", "index") == "index",
                f"Unsupported collision group settings in {path}",
            )
            shapes = []
            for shape in group["objects"]:
                require(
                    isinstance(shape, dict)
                    and not set(shape)
                    - {
                        "id",
                        "name",
                        "type",
                        "x",
                        "y",
                        "width",
                        "height",
                        "rotation",
                        "visible",
                        "ellipse",
                        "polygon",
                    },
                    f"Unsupported collision geometry in {path}",
                )
                require(
                    type(shape.get("id")) is int
                    and shape.get("rotation", 0) == 0
                    and shape.get("visible", True) is True
                    and not shape.get("name")
                    and not shape.get("type"),
                    f"Unsupported collision shape settings in {path}",
                )
                if "polygon" in shape:
                    vertices = shape["polygon"]
                    require(
                        isinstance(vertices, list)
                        and all(
                            isinstance(point, dict)
                            and set(point) == {"x", "y"}
                            and type(point["x"]) is int
                            and type(point["y"]) is int
                            for point in vertices
                        )
                        and type(shape.get("x")) is int
                        and type(shape.get("y")) is int
                        and shape.get("width", 0) == shape.get("height", 0) == 0
                        and "ellipse" not in shape,
                        f"Invalid collision polygon in {path}",
                    )
                    shapes.append(
                        {
                            "id": shape["id"],
                            "kind": "polygon",
                            "points": [
                                [point["x"] + shape["x"], point["y"] + shape["y"]]
                                for point in vertices
                            ],
                        }
                    )
                else:
                    require(
                        "ellipse" not in shape or shape["ellipse"] is True,
                        f"Invalid collision ellipse in {path}",
                    )
                    shapes.append(
                        {
                            "id": shape["id"],
                            "kind": "ellipse" if "ellipse" in shape else "rectangle",
                            **{key: shape.get(key) for key in ("x", "y", "width", "height")},
                        }
                    )
            try:
                tile_metadata.check_metadata(
                    {
                        "terrain": "",
                        "solid": False,
                        "shapes": shapes,
                        "next_shape_id": max((shape["id"] for shape in shapes), default=0) + 1,
                    },
                    *size,
                )
            except ValueError as error:
                raise ValueError(f"Invalid collision geometry in {path}: {error}") from error
    for tile in tiles:
        if "animation" not in tile:
            continue
        frames = tile["animation"]
        require(
            isinstance(frames, list) and 1 <= len(frames) <= 255,
            f"Invalid tile animation in {path}",
        )
        for frame in frames:
            require(
                isinstance(frame, dict)
                and set(frame) == {"tileid", "duration"}
                and type(frame["tileid"]) is int
                and frame["tileid"] in seen
                and type(frame["duration"]) is int
                and 1 <= frame["duration"] <= 65535,
                f"Invalid animation frame in {path}",
            )
    return images


def archive(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for path, data in sorted(files.items()):
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, data, compresslevel=9)
    return stream.getvalue()


def export_bundle(project, scope, revision, scene_id=None, scene=None, scene_revision=None):
    require(scope in ("scene", "project"), "Choose scene or project export")
    require(
        scene is None or (isinstance(scene_id, str) and isinstance(scene_revision, str)),
        "A canvas export needs its saved scene ID and revision",
    )
    require(
        scope != "project" or scene is not None or scene_id is None,
        "A scene ID in project export needs a canvas snapshot",
    )
    with project.transactions.locked():
        document, current = project.read()
        if current != revision:
            raise Conflict("Project changed on disk. Reopen it before exporting.")
        manifest_bytes = safe_path(project.root, MANIFEST).read_bytes()
        if digest(manifest_bytes) != revision:
            raise Conflict("Project changed while preparing the export. Try again.")
        selected = (
            document["scenes"]
            if scope == "project"
            else [item for item in document["scenes"] if item["id"] == scene_id]
        )
        require(scope == "project" or len(selected) == 1, "Choose a saved scene to export")
        require(
            scene is None or any(item["id"] == scene_id for item in selected),
            "The canvas scene is no longer in this project",
        )
        files, guards, snapshots, sets = {}, {MANIFEST: revision}, [], set()
        total = 0
        animation_report = {}

        def include(path, data):
            nonlocal total
            if path in files:
                return
            require(
                str(PurePosixPath(path)) == path
                and not path.startswith("/")
                and ".." not in PurePosixPath(path).parts
                and "\\" not in path
                and ":" not in path
                and all(ord(char) >= 32 for char in path),
                f"Unsafe export member: {path}",
            )
            total += len(data)
            require(
                total <= MAX_BYTES,
                "Export exceeds 256 MiB. Export one scene or reduce imported assets.",
            )
            files[path] = data

        def replace(path, data):
            nonlocal total
            total -= len(files.pop(path))
            include(path, data)

        def asset(path):
            if path in files:
                return files[path]
            require(
                path in document["files"],
                f"Missing declared dependency: {path}. Restore or reimport it before exporting.",
            )
            target = safe_path(project.root, path)
            require(target.is_file(), f"Missing dependency: {path}. Restore it before exporting.")
            require(
                target.stat().st_size <= MAX_BYTES - total,
                "Export exceeds 256 MiB. Export one scene or reduce imported assets.",
            )
            data = target.read_bytes()
            if digest(data) != document["files"][path]:
                raise Conflict(
                    f"Project asset changed on disk: {path}. Restore it before exporting."
                )
            guards[path] = document["files"][path]
            include(path, data)
            return data

        for item in selected:
            path = item["path"]
            target = safe_path(project.root, path)
            require(target.is_file(), f"Missing scene: {path}. Restore it before exporting.")
            require(target.stat().st_size <= 4 * 1024 * 1024, f"Scene exceeds 4 MiB: {path}")
            original = target.read_bytes()
            guards[path] = digest(original)
            # Validate every saved scene, including one replaced by a canvas override.
            saved_scene = tiled.decode(parse_json(original, path), document)
            if (
                item["id"] == scene_id
                and scene_revision is not None
                and digest(original) != scene_revision
            ):
                raise Conflict(f"Scene changed on disk: {path}. Reopen it before exporting.")
            overridden = scene is not None and item["id"] == scene_id
            # Refresh inherited values in exports without rewriting authoring maps.
            candidate = scene if overridden else saved_scene
            has_definitions = any(
                "definition" in obj
                for layer in tiled.scene_layers(candidate)
                for obj in layer.get("objects", [])
            )
            data = (
                json_text(tiled.encode(candidate, document)).encode()
                if overridden or has_definitions
                else original
            )
            require(len(data) <= 4 * 1024 * 1024, f"Scene exceeds 4 MiB: {path}")
            encoded = parse_json(data, path)
            include(path, data)
            snapshots.append(
                {**item, "source_revision": digest(original), "canvas_override": overridden}
            )
            sets.update(dependency(path, reference["source"]) for reference in encoded["tilesets"])
        if scope == "project":
            include(MANIFEST, manifest_bytes)
            for path in sorted(document["files"]):
                asset(path)
            sets.update(path for path in files if path.endswith(".tsj"))
        for path in sorted(sets):
            require(path.endswith(".tsj"), f"Expected an external Tiled tileset: {path}")
            tileset = parse_json(asset(path), path)
            # Validate source data before adding generated animation metadata.
            tileset_images(tileset, path)
            for atlas_id, entry in document["atlases"].items():
                for group in entry["tiles"]:
                    filename = "sprites" if group == "sprites" else f"grid-{group}"
                    if path == f"assets/{atlas_id}/{filename}.tsj":
                        animation_report[path] = animations.decorate(entry, group, tileset)
            encoded_tileset = json_text(tileset).encode()
            if any(item["status"] == "exported" for item in animation_report.get(path, [])):
                replace(path, encoded_tileset)
            images = tileset_images(tileset, path)
            for image, expected_size in images.items():
                raw = asset(image)
                try:
                    width, height, _ = png.decode(raw)
                except ValueError as error:
                    raise ValueError(f"Cannot export image {image}: {error}") from error
                require(
                    (width, height) == expected_size, f"Tileset/image dimensions differ: {image}"
                )
        # Copies are frozen. Recheck source bytes to detect direct external edits
        # even though cooperating Forge writers have been held out by the lock.
        for path, expected in guards.items():
            target = safe_path(project.root, path)
            if not target.is_file() or digest(target.read_bytes()) != expected:
                raise Conflict(
                    f"File changed while exporting: {path}. Try again after reviewing it."
                )
        if scope == "project":
            for path in document["files"]:
                document["files"][path] = digest(files[path])
            replace(MANIFEST, json_text(document).encode())
        if document.get("world"):
            include("world.json", json_text(document["world"]).encode())
        if document.get("object_definitions"):
            include("object-definitions.json", json_text(document["object_definitions"]).encode())
        include("EXPORT.md", GUIDE.encode())
        include(
            "export.json",
            json_text(
                {
                    "version": 1,
                    "scope": scope,
                    "project": {"id": document["id"], "name": document["name"]},
                    "scenes": snapshots,
                    "animations": animation_report,
                    "files": {path: digest(data) for path, data in sorted(files.items())},
                }
            ).encode(),
        )
    return archive(files), f"forge-{scope}-{scene_id if scope == 'scene' else document['id']}.zip"
