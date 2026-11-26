"""Bounded, in-memory Forge ZIP intake; no archive paths are extracted."""

import base64
import copy
import io
import json
import stat
import zipfile
import zlib
from pathlib import PurePosixPath

from gbc_scene_forge.artwork import animations, atlas, dimensions, editable, layers, png, tilesheet
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import exporting, tiled
from gbc_scene_forge.storage.files import digest

MAX_ZIP = 40 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
MAX_MEMBERS = 8192


def member_path(path):
    require(
        isinstance(path, str)
        and bool(path)
        and str(PurePosixPath(path)) == path
        and not path.startswith("/")
        and ".." not in PurePosixPath(path).parts
        and "\\" not in path
        and ":" not in path
        and all(ord(c) >= 32 for c in path),
        f"Unsafe ZIP member: {path}",
    )
    return path


def read_bundle(encoded):
    require(
        isinstance(encoded, str) and len(encoded) <= 4 * ((MAX_ZIP + 2) // 3),
        "Forge ZIP must be at most 40 MiB compressed",
    )
    try:
        raw = base64.b64decode(encoded, validate=True)
        require(len(raw) <= MAX_ZIP, "Forge ZIP must be at most 40 MiB compressed")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            require(len(entries) <= MAX_MEMBERS, "Forge ZIP exceeds 8192 members")
            files, total = {}, 0
            for info in entries:
                path = member_path(info.filename)
                require(path not in files, f"Duplicate ZIP member: {path}")
                require(
                    not info.is_dir()
                    and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                    f"Only regular ZIP files are supported: {path}",
                )
                require(
                    not info.flag_bits & 1
                    and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                    "Unsupported ZIP compression",
                )
                limit = (
                    dimensions.MAX_IMAGE_BYTES
                    if path.endswith(".png")
                    else 8 * 1024 * 1024
                    if path.endswith(".json")
                    else 4 * 1024 * 1024
                )
                total += info.file_size
                require(
                    info.file_size <= limit and total <= MAX_EXPANDED,
                    "Forge ZIP exceeds per-file limits or 256 MiB expanded",
                )
                files[path] = archive.read(info)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, zlib.error, EOFError) as error:
        raise ValueError(f"Invalid Forge ZIP: {error}") from error
    require("export.json" in files, "Choose a Forge export ZIP containing export.json")
    report = exporting.parse_json(files["export.json"], "export.json")
    require(
        report.get("version") == 1 and report.get("scope") in ("scene", "project"),
        "Unsupported Forge export version or scope",
    )
    inventory = report.get("files")
    require(
        isinstance(inventory, dict) and set(inventory) == set(files) - {"export.json"},
        "Export file inventory does not match ZIP members",
    )
    for path, checksum in inventory.items():
        require(digest(files[path]) == checksum, f"Checksum mismatch: {path}; export again")
    manifest = "forge.project.json" if report["scope"] == "project" else "forge-transfer.json"
    require(
        manifest in files,
        "This older scene export lacks authoring metadata. Export it again with Forge 0.26+.",
    )
    source = exporting.parse_json(files[manifest], manifest)
    scenes = report.get("scenes")
    require(
        isinstance(scenes, list)
        and all(isinstance(s, dict) for s in scenes)
        and [{k: s.get(k) for k in ("id", "name", "path")} for s in scenes] == source["scenes"],
        "Export scene list differs from its manifest",
    )
    require(
        isinstance(source.get("files"), dict)
        and isinstance(source.get("scenes"), list)
        and all(
            isinstance(item, dict) and isinstance(item.get("path"), str)
            for item in source["scenes"]
        ),
        "Invalid export manifest collections",
    )
    for path, checksum in source["files"].items():
        require(path in files, f"Missing dependency: {path}")
        require(digest(files[path]) == checksum, f"Dependency checksum mismatch: {path}")
    for item in source["scenes"]:
        require(item["path"] in files, f"Missing scene: {item['path']}")
    allowed = {"export.json", "EXPORT.md", manifest, "world.json", "object-definitions.json"}
    allowed.update(source["files"])
    allowed.update(item["path"] for item in source["scenes"])
    require(
        not set(files) - allowed,
        "Unexpected files in Forge export: " + ", ".join(sorted(set(files) - allowed)),
    )
    require(
        report["scope"] != "scene" or len(source["scenes"]) == 1,
        "A scene export must contain exactly one scene",
    )
    if "object-definitions.json" in files:
        require(
            exporting.parse_json(files["object-definitions.json"], "object-definitions.json")
            == source.get("object_definitions"),
            "Object definition sidecar differs from export manifest",
        )
    return source, files


def authoring_assets(entry, files):
    """Validate authoring sheets and stable mappings using the ordinary asset builders."""
    manifest = entry["manifest"]
    image = files[entry["png"]]
    encoded = base64.b64encode(image).decode()
    descriptor = None
    if manifest.get("source_format") == "forge-rgba":
        editable.check_entry(entry)
        path = entry["editable"]["path"]
        require(path in files, f"Missing editable descriptor: {path}")
        descriptor = editable.read_descriptor(entry, files[path])
        pixels = editable.decode_image(descriptor, image)
        layers.verify(descriptor, pixels, lambda path: files[path])
        width = descriptor["width"]
    elif manifest.get("source_format") == "png-tilesheet":
        checked, _, width, pixels = tilesheet.bundle(
            {"id": manifest["id"], "png": encoded, **manifest["slicing"]}
        )
        require(checked == manifest, "Unsupported PNG sheet authoring metadata")
    else:
        normalized = copy.deepcopy(manifest)
        normalized["png"] = "atlas.png"
        for key in ("source", "preview", "review_images"):
            normalized.pop(key, None)
        _, _, width, pixels = atlas.load_uploaded_bundle(
            {"name": "transfer.atlas.json", "manifest": json.dumps(normalized), "png": encoded}
        )
    _, canonical = atlas.build_assets(manifest, image, width, pixels)
    rebuilt, generated = atlas.build_assets(manifest, image, width, pixels, entry)
    for group, mapping in rebuilt["tiles"].items():
        filename = "sprites" if group == "sprites" else f"grid-{group}"
        path = f"assets/{manifest['id']}/{filename}.tsj"
        if path not in canonical:
            require(not mapping, f"Unsupported tile mapping: {path}")
            continue
        expected_keys = {
            p["value"]
            for t in json.loads(canonical[path])["tiles"]
            for p in t["properties"]
            if p["name"] == "forge:asset"
        }
        require(set(mapping) == expected_keys, f"Unsupported tile identities: {path}")
        # Older native projects have no sprite mapping or generated sprite files.
        # Inventory and map references are checked separately; rebuild only this
        # undeclared legacy group from its already-validated authoring sheet.
        if group == "sprites" and "sprites" not in entry["tiles"] and path not in files:
            continue
        require(path in files, f"Missing tileset dependency: {path}")
        document = exporting.parse_json(files[path], path)
        for image_path, size in exporting.tileset_images(document, path).items():
            require(image_path in files, f"Missing image dependency: {image_path}")
            w, h, _ = png.decode(files[image_path], generic=True)
            require((w, h) == size, f"Image dimensions differ: {image_path}")
        expected_animation = json.loads(generated[path])
        animations.decorate(entry, group, expected_animation)
        expected_tiles = {t["id"]: t for t in expected_animation["tiles"]}
        for tile in document["tiles"]:
            if "animation" in tile:
                require(
                    tile == expected_tiles.get(tile["id"]),
                    f"Animation differs from Forge authoring metadata: {path}",
                )
        for image_path in exporting.tileset_images(document, path):
            require(
                image_path in generated
                and png.decode(files[image_path], generic=True)
                == png.decode(generated[image_path], generic=True),
                f"Tile image differs from authoring sheet: {image_path}; restore it before exporting",
            )
        # Preserve metadata through its manifest representation; reject inconsistent
        # or externally edited TSJs rather than silently replacing their content.
        original = copy.deepcopy(document)
        for tile in original["tiles"]:
            tile.pop("animation", None)
            tile["properties"] = [
                p for p in tile.get("properties", []) if p["name"] != "forge:animation"
            ]
        require(
            original == json.loads(generated[path]),
            f"Tileset differs from Forge authoring metadata: {path}; export from Forge again",
        )
    if descriptor is not None:
        rebuilt["editable"] = copy.deepcopy(entry["editable"])
    return rebuilt


def dependencies(scene, source, references, files):
    # Declared tilesets are dependencies even when no tile from that set is painted.
    assets = set()
    for reference in references:
        path = exporting.dependency("scenes/map.tmj", reference["source"])
        require(path in files, f"Missing tileset dependency: {path}")
        assets.add(path.split("/")[1])
    definitions = set()
    for layer in tiled.scene_layers(scene):
        for row in layer.get("cells", []):
            assets.update(tiled.cell_parts(cell)[0].split("/")[0] for cell in row if cell)
        for obj in layer.get("objects", []):
            if "asset" in obj:
                assets.add(obj["asset"].split("/")[0])
            if "definition" in obj:
                definitions.add(obj["definition"])
    library = {d["id"]: d for d in source.get("object_definitions", {}).get("definitions", [])}
    for key in definitions:
        require(key in library, f"Missing object definition: {key}")
        if "asset" in library[key]:
            assets.add(library[key]["asset"].split("/")[0])
    return sorted(assets), sorted(definitions)


def remap_asset(value, mapping):
    prefix, separator, tail = value.partition("/")
    return mapping[prefix] + separator + tail if separator else value


def remap_scene(scene, assets, definitions):
    result = copy.deepcopy(scene)
    for layer in tiled.scene_layers(result):
        for row in layer.get("cells", []):
            row[:] = [remap_asset(cell, assets) if cell else cell for cell in row]
        for obj in layer.get("objects", []):
            if "asset" in obj:
                obj["asset"] = remap_asset(obj["asset"], assets)
            if "definition" in obj:
                obj["definition"] = definitions[obj["definition"]]
    return result
