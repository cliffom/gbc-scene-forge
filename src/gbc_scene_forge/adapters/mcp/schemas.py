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
        "Read-only saved artwork PNG camera and bounded overview at native pixel scale. "
        "Transparent, ordered visible layers, static sprites; planning overlays use review_blockout. "
        "Each view is at most 1024x1024; overview defaults to the top-left bounded region.",
        {
            **SCENE,
            "camera_id": ID,
            "overview": schema(
                {
                    "x": {"type": "integer", "minimum": 0, "maximum": 8192},
                    "y": {"type": "integer", "minimum": 0, "maximum": 8192},
                    "width": {"type": "integer", "minimum": 1, "maximum": 1024},
                    "height": {"type": "integer", "minimum": 1, "maximum": 1024},
                }
            ),
        },
        ("camera_id", "overview"),
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
    "Scene rename/duplicate/delete and definition/stamp deletion (use browser)",
    "Semantic terrain brushes and stamp placement (use browser or canonical save_scene)",
    "Animated artwork playback, browser selection/Undo, draft inspection/mutation",
    "Palette profile editing, tile metadata editing and sprite preview preference editing",
    "Generic PNG/Tiled intake, terrain brush commands and profile editing (use browser)",
    "Remote/HTTP MCP, subscriptions, prompts, tasks and game runtime/physics integration",
]
