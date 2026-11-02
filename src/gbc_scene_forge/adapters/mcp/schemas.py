"""MCP capability inventory and wire input schemas; no SDK import required."""

TEXT = {"type": "string", "minLength": 1, "maxLength": 100}
REVISION = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
ID = {"type": "integer", "minimum": 1, "maximum": 2147483646}
NATIVE = {
    "type": "object",
    "description": "Canonical Forge JSON; inspect get_scene/get_project first.",
}
PROJECT = {"project": TEXT}
GUARD = {**PROJECT, "project_revision": REVISION}
SCENE = {**GUARD, "scene_id": TEXT, "scene_revision": REVISION}


def schema(properties, optional=()):
    return {
        "type": "object",
        "properties": properties,
        "required": [key for key in properties if key not in optional],
        "additionalProperties": False,
    }


def tool(name, description, properties, optional=(), *, read=False):
    return {
        "name": name,
        "description": description,
        "inputSchema": schema(properties, optional),
        "annotations": {"readOnlyHint": read, "destructiveHint": not read, "openWorldHint": False},
    }


PATCH = schema(
    {
        key: value
        for key, value in (
            ("x", {"type": "integer"}),
            ("y", {"type": "integer"}),
            ("width", ID),
            ("height", ID),
            ("name", {"type": "string", "maxLength": 100}),
            ("class", {"type": "string", "maxLength": 100}),
            ("properties", {"type": "array", "maxItems": 256, "items": NATIVE}),
            (
                "origin",
                {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "integer"}},
            ),
        )
    },
    ("x", "y", "width", "height", "name", "class", "properties", "origin"),
)
PLACE = schema(
    {
        "op": {"const": "place"},
        "definition_id": TEXT,
        "x": {"type": "integer"},
        "y": {"type": "integer"},
        "width": ID,
        "height": ID,
        "name": TEXT,
        "layer_id": ID,
        "properties": {"type": "array", "maxItems": 128, "items": NATIVE},
    },
    ("width", "height", "name", "layer_id", "properties"),
)
EDIT = {
    "oneOf": [
        PLACE,
        schema(
            {
                "op": {"enum": ["update", "duplicate"]},
                "object_id": ID,
                "changes": PATCH,
            },
            ("changes",),
        ),
        schema({"op": {"const": "delete"}, "object_id": ID}),
        schema(
            {
                "op": {"const": "create_layer"},
                "name": TEXT,
                "type": {"enum": ["tilelayer", "objectgroup"]},
                "visible": {"type": "boolean"},
                "index": {"type": "integer", "minimum": 0, "maximum": 127},
            },
            ("visible", "index"),
        ),
        schema(
            {
                "op": {"const": "update_layer"},
                "layer_id": ID,
                "changes": {
                    **schema({"name": TEXT, "visible": {"type": "boolean"}}, ("name", "visible")),
                    "minProperties": 1,
                },
            }
        ),
        schema(
            {
                "op": {"const": "move_layer"},
                "layer_id": ID,
                "index": {"type": "integer", "minimum": 0, "maximum": 127},
            }
        ),
        schema({"op": {"const": "delete_layer"}, "layer_id": ID}),
        *[
            schema(
                {
                    "op": {"const": action},
                    "layer_id": ID,
                    "cells": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 4096,
                        "items": schema(
                            {
                                "x": {"type": "integer", "minimum": 0, "maximum": 65535},
                                "y": {"type": "integer", "minimum": 0, "maximum": 65535},
                                **(
                                    {"tile": {"type": "string", "maxLength": 256}}
                                    if action == "paint_tiles"
                                    else {}
                                ),
                            }
                        ),
                    },
                }
            )
            for action in ("paint_tiles", "erase_tiles")
        ],
    ]
}

TOOLS = [
    tool("capabilities", "Supported operations, limits and deferred capabilities.", {}, read=True),
    tool("list_projects", "List only projects declared by the server launch path.", {}, read=True),
    tool(
        "create_project",
        "Create a new empty/blockout project in the declared project root.",
        {"name": TEXT, "starter": {"enum": ["empty", "blockout"]}},
        ("starter",),
    ),
    tool(
        "get_project",
        "Inspect canonical project: scenes, assets, definitions, stamps, world and revision.",
        PROJECT,
        read=True,
    ),
    tool(
        "get_scene",
        "Inspect canonical scene, layers, cells, objects and both saved revisions.",
        {**PROJECT, "scene_id": TEXT},
        read=True,
    ),
    tool(
        "create_blockout_scene",
        "Create a native blockout and camera; dimensions default to pixels.",
        {**GUARD, "name": TEXT, "options": NATIVE},
        ("options",),
    ),
    tool(
        "create_scene",
        "Create an empty scene; width/height are cells, grid is pixels. At most 65536 cells and 8192 pixels per axis.",
        {**GUARD, "name": TEXT, "width": ID, "height": ID, "grid": {"enum": [8, 16, 32]}},
    ),
    tool(
        "rename_scene",
        "Rename a saved scene, preserving its UUID and content; returns renamed and exact catalog revision.",
        {**SCENE, "name": TEXT},
    ),
    tool(
        "duplicate_scene",
        "Duplicate saved content with a fresh scene UUID, retaining native layer/object IDs. "
        "Source and world connections are unchanged; returns duplicated, source_scene_id and scene_revision.",
        {**SCENE, "name": TEXT},
    ),
    tool(
        "delete_scene",
        "Delete a saved scene and its world position. dry_run reports exact affected connections "
        "without writing. Inspect first; confirm_broken_links:true acknowledges retaining those "
        "connections as broken links at the supplied revisions. Defaults to rejecting linked deletion.",
        {**SCENE, "dry_run": {"type": "boolean"}, "confirm_broken_links": {"type": "boolean"}},
        ("dry_run", "confirm_broken_links"),
    ),
    tool(
        "edit_scene",
        "Atomic 1..128 object, tile and layer operations; at most 4096 cell writes per batch. "
        "Tile x/y are cell indices; layer index is zero-based stored order (bottom to top). "
        "dry_run returns an unsaved candidate. "
        "properties replaces all explicit overrides; omitted fields are retained. No browser Undo.",
        {
            **SCENE,
            "operations": {"type": "array", "minItems": 1, "maxItems": 128, "items": EDIT},
            "dry_run": {"type": "boolean"},
        },
        ("dry_run",),
    ),
    tool(
        "place_stamp",
        "Place a saved stamp at x/y cell indices with the same grid; the whole stamp must fit. "
        "Maps type/name occurrence slots to existing visible layers, overwrites all covered cells "
        "including empty cells, appends objects with fresh IDs. No automatic layers or clipping. "
        "dry_run returns an unsaved candidate for review_artwork/review_blockout.",
        {
            **SCENE,
            "stamp_id": TEXT,
            "x": {"type": "integer", "minimum": 0, "maximum": 65535},
            "y": {"type": "integer", "minimum": 0, "maximum": 65535},
            "dry_run": {"type": "boolean"},
        },
        ("dry_run",),
    ),
    tool(
        "save_scene",
        "Save validated canonical scene content (layers, tiles, sprites, objects). "
        "Inspect/dry-run first; preserves normal broken-world-link guards.",
        {**SCENE, "scene": NATIVE},
    ),
    tool(
        "review_blockout",
        "Read-only planning overview and camera SVG resources for the exact snapshot. "
        "No artwork rendering or physics certification. Optional scene reviews an unsaved candidate.",
        {**SCENE, "camera_id": ID, "scene": NATIVE},
        ("camera_id", "scene"),
        read=True,
    ),
    tool(
        "import_atlas",
        "Preflight (dry_run) or atomically import/reimport a bounded uploaded gbc-atlas bundle. "
        "No filesystem paths. Reinspect scene revisions after importing.",
        {
            **GUARD,
            "bundle": schema(
                {
                    "name": {
                        "type": "string",
                        "maxLength": 100,
                        "pattern": r"^[^/\\:]+\.atlas\.json$",
                    },
                    "manifest": {"type": "string", "maxLength": 1048576},
                    "png": {
                        "type": "string",
                        "maxLength": 5592408,
                        "description": "Base64 PNG; total tool input remains bounded to 4 MiB.",
                    },
                }
            ),
            "reimport": {"type": "boolean"},
            "dry_run": {"type": "boolean"},
        },
        ("reimport", "dry_run"),
    ),
    tool(
        "review_artwork",
        "Read-only artwork PNG camera and bounded overview at native pixel scale. "
        "Transparent, ordered visible layers, static sprites; planning overlays use review_blockout. "
        "Each view is at most 1024x1024; overview defaults to the top-left bounded region. "
        "Optional scene reviews an unsaved canonical candidate with the original saved guards.",
        {
            **SCENE,
            "camera_id": ID,
            "scene": NATIVE,
            "overview": schema(
                {
                    "x": {"type": "integer", "minimum": 0, "maximum": 8192},
                    "y": {"type": "integer", "minimum": 0, "maximum": 8192},
                    "width": {"type": "integer", "minimum": 1, "maximum": 1024},
                    "height": {"type": "integer", "minimum": 1, "maximum": 1024},
                }
            ),
        },
        ("camera_id", "overview", "scene"),
        read=True,
    ),
    tool(
        "diagnostics",
        "Read-only project diagnostics at guarded saved revisions; no reachability certification.",
        {**GUARD, "options": NATIVE},
        ("options",),
        read=True,
    ),
    tool(
        "palette_report",
        "Read-only opt-in palette report; without a profile this is disabled; missing metadata remains unverified.",
        SCENE,
        read=True,
    ),
    tool(
        "export_bundle",
        "Read-only portable Tiled ZIP resource, up to 16 MiB. No arbitrary output paths.",
        {
            **GUARD,
            "scope": {"enum": ["project", "scene"]},
            "scene_id": TEXT,
            "scene_revision": REVISION,
        },
        ("scene_id", "scene_revision"),
        read=True,
    ),
    tool(
        "save_object_definition",
        "Create/update a reusable typed definition using the native schema.",
        {**GUARD, "definition": NATIVE},
    ),
    tool(
        "delete_object_definition",
        "Delete a definition; dry_run reports saved scene/stamp object references without writing. "
        "Instances keep definition IDs and explicit overrides; inherited defaults cease to resolve "
        "and references report missing-definition. Referenced definitions may be deleted.",
        {**GUARD, "definition_id": TEXT, "dry_run": {"type": "boolean"}},
        ("dry_run",),
    ),
    tool(
        "delete_stamp",
        "Delete a saved stamp without changing any existing placements. "
        "dry_run reports consequences without writing; returns deleted_stamp_id and updated catalog.",
        {**GUARD, "stamp_id": TEXT, "dry_run": {"type": "boolean"}},
        ("dry_run",),
    ),
    tool(
        "save_world",
        "Save native world layout/connections, guarding every scene revision.",
        {
            **GUARD,
            "world": NATIVE,
            "scene_revisions": {"type": "object", "additionalProperties": REVISION},
        },
    ),
    tool(
        "save_stamp",
        "Save a reusable native scene composition with a 0..127 occurrence slot per layer (same type/name), in layer order.",
        {
            **GUARD,
            "name": TEXT,
            "scene": NATIVE,
            "slots": {
                "type": "array",
                "maxItems": 128,
                "items": {"type": "integer", "minimum": 0, "maximum": 127},
            },
        },
    ),
]

DEFERRED = [
    "Semantic terrain brushes (use browser or canonical save_scene)",
    "Animated artwork playback, browser selection/Undo, draft inspection/mutation",
    "Palette profile editing, tile metadata editing and sprite preview preference editing",
    "Generic PNG/Tiled intake, terrain brush commands and profile editing (use browser)",
    "Remote/HTTP MCP, subscriptions, prompts, tasks and game runtime/physics integration",
]

# Version-1 native artwork envelopes. The shared domain validates cross-field
# dimensions, hashes, metadata and byte/work budgets beyond these wire shapes.
UUID = {
    "type": "string",
    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
}
ASSET_ID = {"type": "string", "pattern": "^[a-z][a-z0-9_]{0,63}$"}
NULL = {"type": "null"}
ORIGIN = {
    "type": "array",
    "minItems": 2,
    "maxItems": 2,
    "items": {"type": "integer", "minimum": 0, "maximum": 255},
}
DIMENSION = {"type": "integer", "minimum": 8, "maximum": 256, "multipleOf": 8}
SOURCE_PROPERTIES = {
    "atlas_id": ASSET_ID,
    "region": ASSET_ID,
    "grid": {"enum": [None, 8, 16, 32]},
    "cell": {
        "anyOf": [
            NULL,
            {
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": {"type": "integer", "minimum": 0, "maximum": 2047},
            },
        ]
    },
    "artwork_revision": REVISION,
}
SOURCE = schema(SOURCE_PROPERTIES)
TARGET = schema({"document_id": UUID, "atlas_id": ASSET_ID, "region": ASSET_ID})
PLACEMENT_BASE = {"scene_id": UUID, "scene_revision": REVISION, "layer_id": ID}
PLACEMENTS = {
    "type": "array",
    "minItems": 1,
    "maxItems": 256,
    "items": {
        "oneOf": [
            schema(
                {
                    **PLACEMENT_BASE,
                    "x": {"type": "integer", "minimum": 0, "maximum": 2047},
                    "y": {"type": "integer", "minimum": 0, "maximum": 2047},
                }
            ),
            schema({**PLACEMENT_BASE, "object_id": ID}),
        ]
    },
}
DESCRIPTOR = schema(
    {
        "version": {"const": 1},
        "id": UUID,
        "atlas_id": ASSET_ID,
        "region": ASSET_ID,
        "name": TEXT,
        "kind": {"enum": ["tile", "sprite"]},
        "width": DIMENSION,
        "height": DIMENSION,
        "origin": ORIGIN,
        "pixel_format": {"const": "rgba8"},
        "provenance": {
            "anyOf": [
                NULL,
                schema(
                    {
                        **SOURCE_PROPERTIES,
                        "project_id": UUID,
                        "source_format": {"anyOf": [NULL, {"type": "string", "maxLength": 65536}]},
                    }
                ),
            ]
        },
    }
)
CANDIDATE = schema(
    {
        "version": {"const": 1},
        "project_id": UUID,
        "document_id": UUID,
        "atlas_id": ASSET_ID,
        "descriptor": DESCRIPTOR,
        "rgba": {"type": "string", "maxLength": 349528},
        "project_revision": REVISION,
        "artwork_revision": {"anyOf": [REVISION, NULL]},
        "operation": {"enum": ["create", "edit", "duplicate"]},
        "source": {"anyOf": [SOURCE, NULL]},
        "metadata": {"type": "object", "maxProperties": 4},
        "revision": REVISION,
        "placements": PLACEMENTS,
    },
    ("placements",),
)
RECTANGLE = schema(
    {
        "x": {"type": "integer", "minimum": 0, "maximum": 255},
        "y": {"type": "integer", "minimum": 0, "maximum": 255},
        "width": {"type": "integer", "minimum": 1, "maximum": 256},
        "height": {"type": "integer", "minimum": 1, "maximum": 256},
    }
)
VIEWPORT = schema(
    {
        "x": {"type": "integer", "minimum": 0, "maximum": 8192},
        "y": {"type": "integer", "minimum": 0, "maximum": 8192},
        "width": {"type": "integer", "minimum": 1, "maximum": 1024},
        "height": {"type": "integer", "minimum": 1, "maximum": 1024},
    }
)
RECEIPT = schema(
    {
        "version": {"const": 1},
        "project_id": UUID,
        "project_revision": REVISION,
        "candidate_revision": REVISION,
        "artwork_revision": {"anyOf": [REVISION, NULL]},
        "files_revision": REVISION,
        "scene_revisions": {
            "type": "object",
            "maxProperties": 64,
            "additionalProperties": REVISION,
        },
        "context": {
            "anyOf": [
                NULL,
                schema(
                    {
                        "scene_id": UUID,
                        "scene_revision": REVISION,
                        "snapshot_revision": REVISION,
                        "viewport": VIEWPORT,
                    }
                ),
            ]
        },
        "revision": REVISION,
    }
)
ARTWORK_CANDIDATE = {**PROJECT, "candidate": CANDIDATE}
TOOLS.extend(
    [
        tool(
            "list_artwork",
            "Discover native document targets and exact artwork revisions, plus imported/native source regions for duplication. Read-only.",
            GUARD,
            read=True,
        ),
        tool(
            "create_artwork",
            "Prepare a transparent unsaved tile/static sprite candidate. Tiles are 8/16/32 squares; sprite axes are multiples of 8 within 8..256. No inventory writes.",
            {
                **GUARD,
                "atlas_id": ASSET_ID,
                "name": TEXT,
                "kind": {"enum": ["tile", "sprite"]},
                "width": DIMENSION,
                "height": DIMENSION,
                "origin": ORIGIN,
                "region": ASSET_ID,
            },
            ("origin", "region"),
            read=True,
        ),
        tool(
            "duplicate_artwork",
            "Prepare an unsaved copy with fresh identity and retained metadata/origin. Explicit source grid/cell for tiles; null for sprites. Optional placements selects 1..256 saved scene/layer/cell or object locations for atomic replacement on reviewed commit. Omit for duplication alone.",
            {
                **GUARD,
                "source": SOURCE,
                "atlas_id": ASSET_ID,
                "name": TEXT,
                "region": ASSET_ID,
                "placements": PLACEMENTS,
            },
            ("region", "placements"),
            read=True,
        ),
        tool(
            "open_artwork",
            "Open an exact saved native document as a client-held candidate. Imported assets must be duplicated first.",
            {**GUARD, "target": TARGET, "artwork_revision": REVISION},
            read=True,
        ),
        tool(
            "read_artwork_pixels",
            "Read exact row-major base64 straight RGBA8 bytes, including hidden RGB under alpha zero. Optional rectangle must fit. Retains original candidate/base revisions.",
            {**ARTWORK_CANDIDATE, "rectangle": RECTANGLE},
            ("rectangle",),
            read=True,
        ),
        tool(
            "edit_artwork_pixels",
            "Return a new unsaved candidate from unique x/y/RGBA writes; no saved mutation. At most 65536 writes and 1 MiB batch JSON. Invalid batches reject entirely; review again after editing.",
            {
                **ARTWORK_CANDIDATE,
                "writes": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 65536,
                    "items": schema(
                        {
                            "x": {"type": "integer", "minimum": 0, "maximum": 255},
                            "y": {"type": "integer", "minimum": 0, "maximum": 255},
                            "rgba": {
                                "type": "array",
                                "minItems": 4,
                                "maxItems": 4,
                                "items": {"type": "integer", "minimum": 0, "maximum": 255},
                            },
                        }
                    ),
                },
            },
            read=True,
        ),
        tool(
            "review_artwork_candidate",
            "Read-only native/enlarged before/after PNG resources, saved references and commit receipt for exact candidate/base. Optional explicit saved or temporary scene context. Scale 1..16; output <=1024 per axis; 64 scenes/16 MiB map scan; 256 locations per offset page.",
            {
                **ARTWORK_CANDIDATE,
                "scale": {"type": "integer", "minimum": 1, "maximum": 16},
                "offset": {"type": "integer", "minimum": 0, "maximum": 2147483647},
                "scene": schema(
                    {
                        "scene_id": UUID,
                        "scene_revision": REVISION,
                        "scene": {"anyOf": [NATIVE, NULL]},
                        "viewport": VIEWPORT,
                    }
                ),
            },
            ("scale", "offset", "scene"),
            read=True,
        ),
        tool(
            "commit_artwork",
            "Atomically save the exact candidate using its required matching review receipt. Reject stale candidate/project/artwork/scenes. Returns exact committed revisions/digests; never automatically replay an ambiguous write.",
            {**ARTWORK_CANDIDATE, "receipt": RECEIPT},
        ),
    ]
)
