"""MCP capability inventory and wire input schemas; no SDK import required."""

from gbc_scene_forge.artwork import (
    atlas,
    dimensions,
    editable,
    layers,
    raster,
    review,
    sheets,
    workshop,
)
from gbc_scene_forge.scenes import authoring, rendering
from gbc_scene_forge.scenes import dimensions as scene_dimensions

TEXT = {"type": "string", "minLength": 1, "maxLength": 100}
REVISION = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
ID = {"type": "integer", "minimum": 1, "maximum": editable.MAX_PLACEMENT_ID}
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
                "index": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": scene_dimensions.MAX_LAYERS - 1,
                },
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
                "index": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": scene_dimensions.MAX_LAYERS - 1,
                },
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
                        "maxItems": authoring.MAX_TILE_EDITS,
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
        {
            **GUARD,
            "name": TEXT,
            "width": ID,
            "height": ID,
            "grid": {"enum": list(scene_dimensions.GRIDS)},
        },
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
            "operations": {
                "type": "array",
                "minItems": 1,
                "maxItems": authoring.MAX_OPERATIONS,
                "items": EDIT,
            },
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
                    "x": {"type": "integer", "minimum": 0, "maximum": scene_dimensions.MAX_PIXELS},
                    "y": {"type": "integer", "minimum": 0, "maximum": scene_dimensions.MAX_PIXELS},
                    "width": {"type": "integer", "minimum": 1, "maximum": rendering.MAX_DIMENSION},
                    "height": {"type": "integer", "minimum": 1, "maximum": rendering.MAX_DIMENSION},
                }
            ),
        },
        ("camera_id", "overview", "scene"),
        read=True,
    ),
    tool(
        "review_scene",
        "Read-only combined artwork and planning SVG camera/overview at native pixel scale. "
        "Embedded PNG artwork with planning geometry/labels above it. Respects authored hidden "
        "layers; filters are view-only. Camera selection uses authored visible cameras. "
        "Bounded to 1024x1024 per view, 4096 objects and 8 MiB per SVG. "
        "Optional canonical candidate retains saved guards and exact snapshot identity.",
        {
            **SCENE,
            "filters": schema(
                {
                    key: {"type": "boolean"}
                    for key in ("tiles", "sprites", "geometry", "gameplay", "guides")
                },
                ("tiles", "sprites", "geometry", "gameplay", "guides"),
            ),
            "camera_id": ID,
            "scene": NATIVE,
            "overview": schema(
                {
                    "x": {"type": "integer", "minimum": 0, "maximum": scene_dimensions.MAX_PIXELS},
                    "y": {"type": "integer", "minimum": 0, "maximum": scene_dimensions.MAX_PIXELS},
                    "width": {"type": "integer", "minimum": 1, "maximum": rendering.MAX_DIMENSION},
                    "height": {"type": "integer", "minimum": 1, "maximum": rendering.MAX_DIMENSION},
                }
            ),
        },
        ("camera_id", "overview", "scene", "filters"),
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
                "items": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": scene_dimensions.MAX_LAYERS - 1,
                },
            },
        },
    ),
]

DEFERRED = [
    "Semantic terrain brushes (use browser or canonical save_scene)",
    "Interactive playback control, browser selection/Undo, browser draft inspection/mutation",
    "Palette profile editing, tile metadata editing and sprite preview preference editing",
    "Tiled intake, terrain brush commands and profile editing (use browser)",
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
    "items": {"type": "integer", "minimum": 0, "maximum": dimensions.MAX_AXIS - 1},
}
GRID_DIMENSION = {
    "type": "integer",
    "minimum": dimensions.GRID_UNIT,
    "maximum": dimensions.MAX_GRID_AXIS,
    "multipleOf": dimensions.GRID_UNIT,
}
DIMENSION = {"type": "integer", "minimum": 1, "maximum": dimensions.MAX_AXIS}
SOURCE_PROPERTIES = {
    "atlas_id": ASSET_ID,
    "region": ASSET_ID,
    "grid": {"enum": [None, *atlas.GRIDS]},
    "cell": {
        "anyOf": [
            NULL,
            {
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": {"type": "integer", "minimum": 0, "maximum": editable.MAX_SOURCE_CELL},
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
    "maxItems": editable.MAX_PLACEMENTS,
    "items": {
        "oneOf": [
            schema(
                {
                    **PLACEMENT_BASE,
                    "x": {"type": "integer", "minimum": 0, "maximum": editable.MAX_SOURCE_CELL},
                    "y": {"type": "integer", "minimum": 0, "maximum": editable.MAX_SOURCE_CELL},
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
FRAME = schema(
    {
        "id": ASSET_ID,
        "name": TEXT,
        "kind": {"enum": ["tile", "sprite"]},
        "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": dimensions.MAX_GRID_AXIS - dimensions.GRID_UNIT,
            "multipleOf": dimensions.GRID_UNIT,
        },
        "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": dimensions.MAX_GRID_AXIS - dimensions.GRID_UNIT,
            "multipleOf": dimensions.GRID_UNIT,
        },
        "width": GRID_DIMENSION,
        "height": GRID_DIMENSION,
        "origin": ORIGIN,
    }
)
FRAMES = {"type": "array", "minItems": 1, "maxItems": sheets.MAX_FRAMES, "items": FRAME}
SEQUENCES = {
    "type": "array",
    "maxItems": sheets.MAX_SEQUENCES,
    "items": schema(
        {
            "id": ASSET_ID,
            "name": TEXT,
            "loop": {"type": "boolean"},
            "frames": {
                "type": "array",
                "minItems": 1,
                "maxItems": sheets.MAX_SEQUENCE_FRAMES,
                "items": schema(
                    {
                        "frame_id": ASSET_ID,
                        "duration_ms": {
                            "type": "integer",
                            "minimum": sheets.MIN_DURATION_MS,
                            "maximum": sheets.MAX_DURATION_MS,
                        },
                    }
                ),
            },
        }
    ),
}
SHEET_DESCRIPTOR = schema(
    {
        **DESCRIPTOR["properties"],
        "version": {"const": 2},
        "width": GRID_DIMENSION,
        "height": GRID_DIMENSION,
        "frames": FRAMES,
        "sequences": SEQUENCES,
    }
)
LAYER = schema(
    {
        "id": UUID,
        "name": TEXT,
        "visible": {"type": "boolean"},
        "locked": {"type": "boolean"},
        "opacity": {"type": "integer", "minimum": 0, "maximum": 255},
    }
)
LAYERS = {"type": "array", "minItems": 1, "maxItems": layers.MAX_LAYERS, "items": LAYER}
for shape in (DESCRIPTOR, SHEET_DESCRIPTOR):
    shape["properties"]["layers"] = schema({"version": {"const": 1}, "items": LAYERS})
DESCRIPTOR = {"oneOf": [DESCRIPTOR, SHEET_DESCRIPTOR]}
CANDIDATE = schema(
    {
        "version": {"const": 1},
        "project_id": UUID,
        "document_id": UUID,
        "atlas_id": ASSET_ID,
        "descriptor": DESCRIPTOR,
        "rgba": {"type": "string", "maxLength": dimensions.MAX_RGBA_BASE64},
        "project_revision": REVISION,
        "artwork_revision": {"anyOf": [REVISION, NULL]},
        "operation": {"enum": ["create", "edit", "duplicate"]},
        "source": {"anyOf": [SOURCE, NULL]},
        "metadata": {"type": "object", "maxProperties": 4},
        "revision": REVISION,
        "placements": PLACEMENTS,
        "layer_rgba": {
            "type": "object",
            "maxProperties": 8,
            "additionalProperties": {"type": "string", "maxLength": dimensions.MAX_RGBA_BASE64},
        },
    },
    ("placements", "layer_rgba"),
)
RECTANGLE = schema(
    {
        "x": {"type": "integer", "minimum": 0, "maximum": dimensions.MAX_AXIS - 1},
        "y": {"type": "integer", "minimum": 0, "maximum": dimensions.MAX_AXIS - 1},
        "width": {"type": "integer", "minimum": 1, "maximum": dimensions.MAX_AXIS},
        "height": {"type": "integer", "minimum": 1, "maximum": dimensions.MAX_AXIS},
    }
)
POINT = {
    "type": "array",
    "minItems": 2,
    "maxItems": 2,
    "items": {"type": "integer", "minimum": 0, "maximum": dimensions.MAX_AXIS - 1},
}
RGBA = {
    "type": "array",
    "minItems": 4,
    "maxItems": 4,
    "items": {"type": "integer", "minimum": 0, "maximum": 255},
}
RASTER_OPERATION = {
    "oneOf": [
        schema(
            {"op": {"const": "fill"}, "at": POINT, "rgba": RGBA, "rectangle": RECTANGLE},
            ("rectangle",),
        ),
        schema({"op": {"const": "line"}, "from": POINT, "to": POINT, "rgba": RGBA}),
        schema(
            {
                "op": {"enum": ["rectangle", "ellipse"]},
                "rectangle": RECTANGLE,
                "rgba": RGBA,
                "filled": {"type": "boolean"},
            },
            ("filled",),
        ),
        schema({"op": {"enum": ["copy", "move"]}, "rectangle": RECTANGLE, "to": POINT}),
        schema(
            {
                "op": {"const": "flip"},
                "rectangle": RECTANGLE,
                "axis": {"enum": ["horizontal", "vertical"]},
            }
        ),
        schema(
            {
                "op": {"const": "resize"},
                "rectangle": RECTANGLE,
                "to": POINT,
                "width": DIMENSION,
                "height": DIMENSION,
            }
        ),
        schema(
            {"op": {"const": "replace"}, "from": RGBA, "rgba": RGBA, "rectangle": RECTANGLE},
            ("rectangle",),
        ),
        schema(
            {
                "op": {"const": "remap"},
                "rectangle": RECTANGLE,
                "colors": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": raster.MAX_REMAP_PAIRS,
                    "items": {"type": "array", "minItems": 2, "maxItems": 2, "items": RGBA},
                },
            },
            ("rectangle",),
        ),
    ]
}
VIEWPORT = schema(
    {
        "x": {"type": "integer", "minimum": 0, "maximum": scene_dimensions.MAX_PIXELS},
        "y": {"type": "integer", "minimum": 0, "maximum": scene_dimensions.MAX_PIXELS},
        "width": {"type": "integer", "minimum": 1, "maximum": rendering.MAX_DIMENSION},
        "height": {"type": "integer", "minimum": 1, "maximum": rendering.MAX_DIMENSION},
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
HANDLE = schema(
    {
        "handle": REVISION,
        "project_id": UUID,
        "project_revision": REVISION,
        "revision": REVISION,
        "owner": UUID,
    },
    ("owner",),
)
ARTWORK_CANDIDATE = {**PROJECT, "candidate": {"oneOf": [CANDIDATE, HANDLE]}}
TOOLS.extend(
    [
        tool(
            "edit_artwork_layers",
            "Set the explicit bottom-to-top layer list (1..8); [] explicitly flattens unlocked layers. First migration preserves flat pixels in the first item. Stable UUIDs, names, visibility, opacity 0..255 and locks. New IDs allocate transparent rasters. Review again.",
            {**ARTWORK_CANDIDATE, "layers": {**LAYERS, "minItems": 0}},
            read=True,
        ),
        tool(
            "import_artwork_png",
            "Upload a non-interlaced RGB/RGBA8 or indexed PNG as an unpublished independent editable sprite. Exact pixels; no resize/quantization. Use compact=true, then review/commit.",
            {
                **GUARD,
                "atlas_id": ASSET_ID,
                "name": TEXT,
                "png": {"type": "string", "maxLength": 4 * ((dimensions.MAX_IMAGE_BYTES + 2) // 3)},
            },
            read=True,
        ),
        tool(
            "edit_artwork_raster",
            "Atomic sequential exact-RGBA raster operations. Explicit rectangles/points; no active selection. Supports fill, line, rectangle/ellipse, copy/move, flip, region resize, replace/remap. Returns a new candidate; review again.",
            {
                **ARTWORK_CANDIDATE,
                "operations": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": raster.MAX_OPERATIONS,
                    "items": RASTER_OPERATION,
                },
            },
            read=True,
        ),
        tool(
            "artwork_colors",
            "Exact RGBA counts including hidden RGB, ordered by count then RGBA; pages of 256. Does not edit or quantize.",
            {
                **ARTWORK_CANDIDATE,
                "rectangle": RECTANGLE,
                "offset": {"type": "integer", "minimum": 0},
            },
            ("rectangle", "offset"),
            read=True,
        ),
    ]
)
TOOLS.extend(
    [
        tool(
            "create_artwork_sheet",
            "Prepare an unsaved exact-RGBA sheet with explicit stable frames and named timed sequences. No inventory writes; use edit/review/commit_artwork to save.",
            {
                **GUARD,
                "atlas_id": ASSET_ID,
                "name": TEXT,
                "kind": {"enum": ["tile", "sprite"]},
                "width": DIMENSION,
                "height": DIMENSION,
                "frames": FRAMES,
                "sequences": SEQUENCES,
            },
            read=True,
        ),
        tool(
            "duplicate_artwork_sheet",
            "Copy a complete declared source atlas into an independent native sheet. Retains exact pixels including hidden RGB, origins and sequence timing. Source grid/cell must be null; no redrawing or quantization.",
            {**GUARD, "source": SOURCE, "atlas_id": ASSET_ID, "name": TEXT},
            read=True,
        ),
        tool(
            "edit_artwork_layout",
            "Return a new unsaved sheet candidate with explicit frame and sequence layout. Saved frame geometry is protected at review/commit; reorder/rename and append are supported. Editing invalidates prior review.",
            {**ARTWORK_CANDIDATE, "frames": FRAMES, "sequences": SEQUENCES},
            read=True,
        ),
        tool(
            "review_artwork_animation",
            "Generate a timing-preserving exact-RGBA APNG resource for an explicit native sequence, bound to candidate/base and a commit review receipt. No browser interaction required. Bounded to 4194304 total output frame pixels.",
            {
                **ARTWORK_CANDIDATE,
                "sequence_id": ASSET_ID,
                "scale": {"type": "integer", "minimum": 1, "maximum": review.MAX_SCALE},
            },
            ("scale",),
            read=True,
        ),
    ]
)
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
            "Prepare a transparent unsaved tile/static sprite candidate. Tiles are 8/16/32 squares; static sprite axes are integer pixels within 1..4096, with at most 4194304 total pixels. No inventory writes.",
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
            "Read exact row-major base64 straight RGBA8 bytes, including hidden RGB under alpha zero. Reads at most 65536 pixels; use explicit rectangles for larger documents. Retains original candidate/base revisions.",
            {**ARTWORK_CANDIDATE, "rectangle": RECTANGLE},
            ("rectangle",),
            read=True,
        ),
        tool(
            "edit_artwork_pixels",
            "Return a new unsaved candidate from unique x/y/RGBA writes; no saved mutation. Choose writes (at most 65536 and 1 MiB batch JSON) or a base64 rectangle patch (at most 65536 pixels). Invalid batches reject entirely; review again after editing.",
            {
                **ARTWORK_CANDIDATE,
                "patch": schema(
                    {"rectangle": RECTANGLE, "rgba": {"type": "string", "maxLength": 349528}}
                ),
                "writes": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": editable.MAX_PIXEL_WRITES,
                    "items": schema(
                        {
                            "x": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": dimensions.MAX_AXIS - 1,
                            },
                            "y": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": dimensions.MAX_AXIS - 1,
                            },
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
            ("writes", "patch"),
            read=True,
        ),
        tool(
            "review_artwork_candidate",
            "Read-only native/enlarged before/after PNG resources, saved references and commit receipt for exact candidate/base. Optional explicit saved or temporary scene context. Default whole-document overview; optional rectangle selects native detail. Scale 1..16 is fitted to output <=1024 per axis; 64 scenes/16 MiB map scan; 256 locations per offset page.",
            {
                **ARTWORK_CANDIDATE,
                "scale": {"type": "integer", "minimum": 1, "maximum": review.MAX_SCALE},
                "rectangle": RECTANGLE,
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
            ("scale", "offset", "scene", "rectangle"),
            read=True,
        ),
        tool(
            "commit_artwork",
            "Atomically save the exact candidate using its required matching review receipt. Reject stale candidate/project/artwork/scenes. Returns exact committed revisions/digests; never automatically replay an ambiguous write.",
            {**ARTWORK_CANDIDATE, "receipt": RECEIPT},
        ),
    ]
)

# The compact path retains immutable, recoverable project-local sidecars. Full
# envelopes remain accepted for stateless clients and explicit recovery.
for definition in TOOLS:
    if definition["name"] in {
        "import_artwork_png",
        "edit_artwork_raster",
        "edit_artwork_layers",
        "create_artwork",
        "create_artwork_sheet",
        "duplicate_artwork",
        "duplicate_artwork_sheet",
        "open_artwork",
        "edit_artwork_pixels",
        "edit_artwork_layout",
    }:
        definition["inputSchema"]["properties"]["compact"] = {"type": "boolean"}
        # Optional compact output persists a sidecar, even though saved artwork
        # is unchanged. Advertise the possible write truthfully to clients.
        definition["annotations"].update(readOnlyHint=False, destructiveHint=False)
        definition["description"] += (
            " Optional compact=true returns a restart-safe immutable handle (256 records/64 MiB per project, no expiration); handle inputs retain compact output. Export before explicit release."
        )
TOOLS.extend(
    [
        tool(
            "retain_artwork_candidate",
            "Retain exact candidate pixels as an immutable project-local sidecar and return its compact handle. Idempotent; no saved artwork mutation.",
            ARTWORK_CANDIDATE,
        ),
        tool(
            "export_artwork_candidate",
            "Export the complete recoverable envelope, including exact RGBA, even if its saved base is stale. No automatic rebase.",
            ARTWORK_CANDIDATE,
            read=True,
        ),
        tool(
            "list_artwork_candidates",
            "Recover candidate handles after restart. Project-local sidecars do not expire and are excluded from project ZIP exports. Export before release or moving projects.",
            PROJECT,
            read=True,
        ),
        tool(
            "release_artwork_candidate",
            "Explicitly delete one immutable candidate sidecar. Export its envelope first if recovery is needed. Does not change saved artwork.",
            {**PROJECT, "candidate": HANDLE},
        ),
    ]
)

CONVERSION_REQUEST = schema(
    {
        "project_revision": REVISION,
        "scene_id": UUID,
        "scene_revision": REVISION,
        "layer_id": ID,
        "object_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "uniqueItems": True,
            "items": ID,
        },
        "tile_asset": {"type": "string", "pattern": "^[a-z][a-z0-9_]{0,63}/[a-z][a-z0-9_]{0,63}$"},
        "acknowledge_static": {"const": True},
    }
)
TOOLS.extend(
    [
        tool(
            "review_sprite_tile_conversion",
            "Review selected saved sprite poses becoming static tile scenery. Target tile region must have identical exact RGBA/dimensions. Origin-adjusted bounds must align to scene grid. Splits layers to preserve overlap order. Rejects gameplay metadata; source animations and unselected references remain. No implicit crop, shift or timing loss.",
            {**PROJECT, "request": CONVERSION_REQUEST, "viewport": VIEWPORT},
            read=True,
        ),
        tool(
            "commit_sprite_tile_conversion",
            "Atomically apply the exact reviewed conversion plan, retaining saved source artwork and unselected references. Rejects stale project/assets/scene and changed mapping. Do not replay ambiguous commits.",
            {
                **PROJECT,
                "plan": schema(
                    {
                        "version": {"const": 1},
                        "project_id": UUID,
                        "request": CONVERSION_REQUEST,
                        "mapping": {"type": "array", "maxItems": 64, "items": NATIVE},
                        "revision": REVISION,
                    }
                ),
            },
        ),
    ]
)
TOOLS.append(
    tool(
        "review_artwork_frame",
        "Read exact native/enlarged before/after PNG resources for an explicit sheet frame ID. Bound to the complete candidate and saved bases with a commit review receipt. Scale 1..16; maximum 1024 per output axis.",
        {
            **ARTWORK_CANDIDATE,
            "frame_id": ASSET_ID,
            "scale": {"type": "integer", "minimum": 1, "maximum": review.MAX_SCALE},
        },
        ("scale",),
        read=True,
    )
)

for definition in TOOLS:
    if definition["name"] in {
        "edit_artwork_pixels",
        "read_artwork_pixels",
        "edit_artwork_raster",
        "artwork_colors",
    }:
        definition["inputSchema"]["properties"]["layer_id"] = UUID

TOOLS.append(
    tool(
        "delete_artwork",
        "Delete one complete saved artwork document/atlas and its declared files. dry_run=true reports reference blockers and guarded consequences. No cascade; retained drafts/candidates stay available with stale bases. Candidate cleanup uses release_artwork_candidate.",
        {**GUARD, "atlas_id": ASSET_ID, "dry_run": {"type": "boolean"}, "plan": NATIVE},
        ("dry_run", "plan"),
    )
)

# Illustration production reuses the native envelope, layer UUIDs and raster schemas.
_PIXEL_TOOL = next(t for t in TOOLS if t["name"] == "edit_artwork_pixels")["inputSchema"][
    "properties"
]
BATCH_OPERATION = {
    "oneOf": [
        schema({"op": {"const": "layers"}, "layers": {**LAYERS, "minItems": 0}}),
        *[
            schema({"op": {"const": kind}, "layer_id": {"anyOf": [UUID, NULL]}, field: shape})
            for kind, field, shape in (
                ("pixels", "writes", _PIXEL_TOOL["writes"]),
                ("patch", "patch", _PIXEL_TOOL["patch"]),
                (
                    "raster",
                    "operations",
                    {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": raster.MAX_OPERATIONS,
                        "items": RASTER_OPERATION,
                    },
                ),
            )
        ],
    ]
}
_RGB = {
    "type": "array",
    "minItems": 3,
    "maxItems": 3,
    "items": {"type": "integer", "minimum": 0, "maximum": 255},
}
_PNG_UPLOAD = {"type": "string", "maxLength": 4 * ((dimensions.MAX_IMAGE_BYTES + 2) // 3)}
TOOLS.extend(
    [
        tool(
            "edit_artwork_batch",
            "Atomic candidate edits: layer list, explicit layer UUID pixel writes/patches/raster, final locks. Later operations use UUIDs declared earlier. 128 operations/1 MiB/16777216 pixel work; invalid batch retains no prefix. Review/commit separately.",
            {
                **ARTWORK_CANDIDATE,
                "operations": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": workshop.MAX_BATCH_OPERATIONS,
                    "items": BATCH_OPERATION,
                },
            },
            read=True,
        ),
        tool(
            "prepare_artwork_document",
            "Create an independent static sprite from exact candidate sources: nearest-floor document scaling or anchored crop/pad. All layers must be unlocked. Origin scales/translates; crop removing origin rejects. New identity, no reference replacements; sheet frames/timing require explicit flatten_sheet=true and are omitted. Returns candidate and before/after report.",
            {
                **ARTWORK_CANDIDATE,
                "atlas_id": ASSET_ID,
                "name": TEXT,
                "width": DIMENSION,
                "height": DIMENSION,
                "mode": {"enum": ["nearest", "canvas"]},
                "anchor": {"enum": ["top-left", "center", "bottom-right"]},
                "flatten_sheet": {"type": "boolean"},
            },
            ("flatten_sheet",),
            read=True,
        ),
        tool(
            "convert_artwork_palette",
            "Opt-in no-dither palette conversion on unlocked sources. Choose RGB palette or exact RGBA budget 1..256. Weighted median cut then nearest squared sRGB, lexicographic ties. Alpha and hidden transparent RGB unchanged; impossible budgets reject. Returns candidate and counts/choices report. Review again.",
            {
                **ARTWORK_CANDIDATE,
                "palette": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": workshop.MAX_PALETTE_COLORS,
                    "items": _RGB,
                },
                "budget": {"type": "integer", "minimum": 1, "maximum": workshop.MAX_PALETTE_COLORS},
            },
            ("palette", "budget"),
            read=True,
        ),
        tool(
            "import_artwork_layers",
            "Import 1..8 PNGs in bottom-to-top order into one unpublished sprite. Explicit layer UUID/name/visibility/opacity/lock and nonnegative offsets. Each PNG must fit, transparent padding, no crop or quantization. Existing native layer aggregate and input bounds apply.",
            {
                **GUARD,
                "atlas_id": ASSET_ID,
                "name": TEXT,
                "width": DIMENSION,
                "height": DIMENSION,
                "layers": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": layers.MAX_LAYERS,
                    "items": schema(
                        {
                            "layer": LAYER,
                            "png": _PNG_UPLOAD,
                            "offset": {
                                "type": "array",
                                "minItems": 2,
                                "maxItems": 2,
                                "items": {"type": "integer", "minimum": 0, "maximum": 4095},
                            },
                        }
                    ),
                },
            },
            read=True,
        ),
        tool(
            "export_artwork_bundle",
            "Read-only artwork ZIP resource: authoritative unchanged candidate.json, document.json, composite/layer PNGs and exact composite palette. Recover candidate.json with retain_artwork_candidate; saved bases remain fixed. 16 MiB artifact limit; archive candidates for larger recoverable transfers.",
            ARTWORK_CANDIDATE,
            read=True,
        ),
        tool(
            "plan_artwork_candidate_archive",
            "Read-only archive recommendations grouped by owner and exact document identity. Reports exact saved matches, uncertain alternatives, bytes and reclaim estimates; no eviction, rebasing or saved changes. Select handles explicitly and optionally pass the unchanged plan to archive_artwork_candidates for stale-plan rejection.",
            PROJECT,
            read=True,
        ),
        tool(
            "archive_artwork_candidates",
            "Explicitly archive 1..32 selected handles (64 MiB total) as unchanged full envelopes in a durable project-local ZIP before optional release=true. Reports per-candidate partial release failures. Archives survive restart, retain owner in filenames and are excluded from project exports. Download using read_artwork_archive; restore envelopes with retain_artwork_candidate and original owner.",
            {
                **PROJECT,
                "candidates": {"type": "array", "minItems": 1, "maxItems": 32, "items": HANDLE},
                "release": {"type": "boolean"},
                "plan": {
                    "type": "object",
                    "description": "Unchanged plan_artwork_candidate_archive response; "
                    "revalidate all evidence before archiving explicitly selected handles.",
                },
            },
            ("release", "plan"),
        ),
        tool(
            "read_artwork_archive",
            "Download durable archive in base64 chunks of up to 1 MiB; follow next_offset and verify assembled SHA-256. List archives through list_artwork_candidates after restart or interrupted response.",
            {**PROJECT, "archive": REVISION, "offset": {"type": "integer", "minimum": 0}},
            ("offset",),
            read=True,
        ),
        tool(
            "inspect_artwork_candidate",
            "Review coordinate-labelled before/after SVG (default) or PNG, with optional explicit before_candidate and magenta composite RGBA change overlay. PNGs support bounded inline images. The receipt always guards the after candidate against its saved base. 1..8 rectangles, explicit nearest-neighbor scale 1..8, <=512 per cell axis/4194304 image pixels/8388608 layout pixels. Exact candidate/base receipt, rectangles and completeness; no automatic cleanup.",
            {
                **ARTWORK_CANDIDATE,
                "rectangles": {"type": "array", "minItems": 1, "maxItems": 8, "items": RECTANGLE},
                "scale": {"type": "integer", "minimum": 1, "maximum": 8},
                "changed_overlay": {"type": "boolean"},
                "before_candidate": {"oneOf": [CANDIDATE, HANDLE]},
                "format": {"type": "string", "enum": ["svg", "png"]},
            },
            ("scale", "changed_overlay", "before_candidate", "format"),
            read=True,
        ),
    ]
)
for definition in TOOLS:
    if definition["name"] in {
        "edit_artwork_batch",
        "prepare_artwork_document",
        "convert_artwork_palette",
        "import_artwork_layers",
    }:
        definition["inputSchema"]["properties"]["compact"] = {"type": "boolean"}
        definition["annotations"].update(readOnlyHint=False, destructiveHint=False)
    if definition["name"] == "retain_artwork_candidate":
        definition["inputSchema"]["properties"]["owner"] = UUID
