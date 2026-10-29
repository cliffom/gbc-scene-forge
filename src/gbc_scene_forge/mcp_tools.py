"""Semantic MCP tool inventory and thin, dependency-free project adapter.

The optional transport owns protocol/schema validation. This module also remains
usable by ordinary Python tests without installing any MCP dependencies.
"""

import base64
from collections import OrderedDict

from . import authoring, tiled
from .atlas import require
from .documents import Conflict
from .projects import Project
from .transactions import digest
from .workspaces import ProjectRoot

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
MAX_ARTIFACT = 16 * 1024 * 1024
MAX_CACHE = 24 * 1024 * 1024


class Adapter:
    def __init__(self, path, *, single_project=False):
        self.single = Project(path) if single_project else None
        self.workspace = None if single_project else ProjectRoot(path)
        self.artifacts = OrderedDict()

    def project(self, directory):
        if self.single:
            require(directory == "project", "The declared single project is named 'project'")
            return Project(self.single.root)
        return Project(self.workspace.path(directory))

    def artifact(self, data, mime, name):
        require(len(data) <= MAX_ARTIFACT, "MCP artifact exceeds 16 MiB; export in the browser")
        uri = f"forge-artifact://snapshot/{digest(data)}/{name}"
        self.artifacts[uri] = (data, mime)
        self.artifacts.move_to_end(uri)
        while sum(len(value[0]) for value in self.artifacts.values()) > MAX_CACHE:
            self.artifacts.popitem(last=False)
        return {"uri": uri, "name": name, "mimeType": mime, "size": len(data)}

    def read_artifact(self, uri):
        require(uri in self.artifacts, "Unknown or expired session artifact; generate it again")
        data, mime = self.artifacts[uri]
        if mime == "image/svg+xml":
            return {"uri": uri, "mimeType": mime, "text": data.decode()}
        return {"uri": uri, "mimeType": mime, "blob": base64.b64encode(data).decode()}

    def call(self, name, arguments):
        authoring.bounded(arguments)
        definition = next((t for t in TOOLS if t["name"] == name), None)
        require(definition is not None, "Unsupported capability; inspect capabilities/tools/list")
        shape = definition["inputSchema"]
        require(
            isinstance(arguments, dict)
            and set(shape["required"]) <= set(arguments)
            and not set(arguments) - set(shape["properties"]),
            "Invalid tool arguments",
        )
        a = arguments
        if name == "capabilities":
            return {
                "version": 1,
                "transport": "stdio",
                "tools": [t["name"] for t in TOOLS],
                "deferred": DEFERRED,
                "max_operations": 128,
                "max_input_bytes": authoring.MAX_INPUT,
                "max_artifact_bytes": MAX_ARTIFACT,
                "artifact_cache_bytes": MAX_CACHE,
                "history": "Saved writes only. Browser drafts and Undo remain independent.",
            }
        if name == "list_projects":
            return (
                {"projects": [{"directory": "project", **self.single.catalog()}]}
                if self.single
                else self.workspace.catalog()
            )
        if name == "create_project":
            require(self.workspace is not None, "Project creation requires --project-root")
            directory = self.workspace.create(a["name"], starter=a.get("starter", "empty"))
            return {"directory": directory, **self.project(directory).catalog()}
        project = self.project(a["project"])
        if name == "get_project":
            return project.catalog()
        if name == "get_scene":
            with project.transactions.locked():
                document, revision = project.read()
                return {
                    **project._load_scene(a["scene_id"], document),
                    "project_revision": revision,
                }
        revision = a["project_revision"]
        document = project._current(revision)
        if name in ("create_blockout_scene", "create_scene"):
            result = (
                project.create_blockout_scene(a["name"], a.get("options", {}), revision)
                if name == "create_blockout_scene"
                else project.create_scene(a["name"], a["width"], a["height"], a["grid"], revision)
            )
            return {**result, "project_revision": project.catalog()["revision"]}
        if name in ("edit_scene", "save_scene"):
            loaded = project.load_scene(a["scene_id"])
            if loaded["revision"] != a["scene_revision"]:
                raise Conflict("Scene changed on disk. Inspect again before editing.")
            candidate, allocated = (
                authoring.edit(loaded["scene"], document, a["operations"])
                if name == "edit_scene"
                else (a["scene"], [])
            )
            tiled.check_scene(candidate, document)
            # Preview and summary use the same canonical round trip as persistence.
            candidate = tiled.decode(tiled.encode(candidate, document), document)
            project._current(revision)
            if project.load_scene(loaded["id"])["revision"] != loaded["revision"]:
                raise Conflict("Scene changed while preparing edits. Inspect again.")
            summary = authoring.changes(loaded["scene"], candidate)
            dry_run = a.get("dry_run", False)
            require(type(dry_run) is bool, "dry_run must be boolean")
            if dry_run:
                result = {**loaded, "scene": candidate}
            else:
                result = project.save_scene(loaded["id"], candidate, loaded["revision"], revision)
            return {
                **result,
                "project_revision": revision,
                "dry_run": dry_run,
                "allocated_object_ids": allocated,
                "changes": summary,
            }
        if name == "review_blockout":
            result = project.blockout_review(
                a["scene_id"], revision, a["scene_revision"], a.get("scene"), a.get("camera_id")
            )
            for view in ("overview", "camera"):
                svg = result.pop(f"{view}_svg")
                result[f"{view}_resource"] = self.artifact(
                    svg.encode(), "image/svg+xml", f"{view}.svg"
                )
            return {**result, "units": "pixels"}
        if name == "diagnostics":
            return project.diagnostics_report(revision, a.get("options"))
        if name == "palette_report":
            return project.palette_report(a["scene_id"], revision, a["scene_revision"])
        if name == "export_bundle":
            require(
                a["scope"] == "project" or {"scene_id", "scene_revision"} <= set(a),
                "Scene exports require scene_id and scene_revision",
            )
            payload, filename = project.export_bundle(
                a["scope"], revision, a.get("scene_id"), scene_revision=a.get("scene_revision")
            )
            return {
                "filename": filename,
                "project_revision": revision,
                "resource": self.artifact(payload, "application/zip", "project.zip"),
            }
        if name == "save_object_definition":
            return project.save_object_definition(a["definition"], revision)
        if name == "save_world":
            return project.save_world(a["world"], revision, a["scene_revisions"])
        if name == "save_stamp":
            return project.save_stamp(a["name"], a["scene"], a["slots"], revision)
        raise ValueError("Unsupported capability")
