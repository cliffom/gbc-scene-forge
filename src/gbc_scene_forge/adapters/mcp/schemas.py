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
        "Create an empty scene; width/height are cells, grid is pixels.",
        {**GUARD, "name": TEXT, "width": ID, "height": ID, "grid": {"enum": [8, 16, 32]}},
    ),
    tool(
        "edit_scene",
        "Atomic 1..128 blockout placements/object edits. dry_run returns an unsaved candidate. "
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
    "Artwork import/reimport (use browser supported atlas paths; no agent-supplied filesystem paths)",
    "Scene rename/duplicate/delete and definition/stamp deletion (use browser)",
    "Semantic tile painting, stamp placement and layer management (use canonical save_scene)",
    "Artwork-inclusive raster previews, browser selection/Undo, draft inspection/mutation",
    "Palette profile editing, tile metadata editing and sprite preview preference editing",
    "PNG/Tiled import (#25), autotiling (#23), broader hardware profiles (#29)",
    "Remote/HTTP MCP, subscriptions, prompts, tasks and game runtime/physics integration",
]
