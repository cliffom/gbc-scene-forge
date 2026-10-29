"""Semantic MCP tool inventory and thin, dependency-free project adapter.

The optional transport owns protocol/schema validation. This module also remains
usable by ordinary Python tests without installing any MCP dependencies.
"""

import base64
from collections import OrderedDict

from gbc_scene_forge.core.validation import require
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.workspaces import ProjectRoot
from gbc_scene_forge.scenes import authoring
from gbc_scene_forge.storage.files import digest

from .schemas import DEFERRED, TOOLS

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
            with project.store.read_session() as session:
                revision = session.revision
                return {
                    **session.scene(a["scene_id"]),
                    "project_revision": revision,
                }
        revision = a["project_revision"]
        if name in ("create_blockout_scene", "create_scene"):
            result = (
                project.planning.create_blockout(a["name"], a.get("options", {}), revision)
                if name == "create_blockout_scene"
                else project.scenes.create(a["name"], a["width"], a["height"], a["grid"], revision)
            )
            return {**result, "project_revision": project.catalog()["revision"]}
        if name in ("edit_scene", "save_scene"):
            return project.scenes.edit(
                a["scene_id"],
                revision,
                a["scene_revision"],
                operations=a["operations"] if name == "edit_scene" else None,
                scene=a.get("scene"),
                dry_run=a.get("dry_run", False),
            )
        if name == "review_blockout":
            result = project.planning.review_blockout(
                a["scene_id"], revision, a["scene_revision"], a.get("scene"), a.get("camera_id")
            )
            for view in ("overview", "camera"):
                svg = result.pop(f"{view}_svg")
                result[f"{view}_resource"] = self.artifact(
                    svg.encode(), "image/svg+xml", f"{view}.svg"
                )
            return {**result, "units": "pixels"}
        if name == "diagnostics":
            return project.reports.diagnostics(revision, a.get("options"))
        if name == "palette_report":
            return project.reports.palettes(a["scene_id"], revision, a["scene_revision"])
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
            return project.objects.save_definition(a["definition"], revision)
        if name == "save_world":
            return project.planning.save_world(a["world"], revision, a["scene_revisions"])
        if name == "save_stamp":
            return project.objects.save_stamp(a["name"], a["scene"], a["slots"], revision)
        raise ValueError("Unsupported capability")
