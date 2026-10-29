"""HTTP payload decoding and dispatch onto the project's domain services."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from gbc_scene_forge.core.validation import require
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.drafts import Drafts
from gbc_scene_forge.project.updates import Updates


@dataclass(frozen=True)
class Response:
    body: Any
    content_type: str = "application/json"
    status: int = 200
    filename: str | None = None


class ProjectAPI:
    """Per-project routing state; HTTP framing and security stay in the handler."""

    def __init__(self, root: Path, project: Project | None):
        self.root = root
        self.project = project
        self.updates = Updates(project.store) if project else None

    def post(self, route: str, data: dict[str, Any]) -> Response:
        project = self.project
        if route == "/api/create-project":
            require(project is None, "A project is already open")
            starter = data.get("starter", "empty")
            require(
                starter in ("empty", "sample", "blockout"),
                "Choose an empty, sample or blockout project",
            )
            project = Project.create(self.root, data.get("name"), starter=starter)
            self.project = project
            self.updates = Updates(project.store)
            return Response(project.catalog())
        require(project is not None, "Create a project first")
        if route == "/api/create-blockout-scene":
            return Response(
                project.planning.create_blockout(
                    data.get("name"), data.get("options"), data.get("project_revision")
                )
            )
        elif route == "/api/blockout-review":
            return Response(
                project.planning.review_blockout(
                    data.get("scene_id"),
                    data.get("project_revision"),
                    data.get("scene_revision"),
                    data.get("scene"),
                    data.get("camera_id"),
                )
            )
        elif route == "/api/create-scene":
            return Response(
                project.scenes.create(
                    data.get("name"),
                    data.get("width"),
                    data.get("height"),
                    data.get("grid"),
                    data.get("project_revision"),
                )
            )
        elif route == "/api/save-scene":
            return Response(
                project.scenes.save(
                    data.get("id"),
                    data.get("scene"),
                    data.get("revision"),
                    data.get("project_revision"),
                    confirm_broken_links=data.get("confirm_broken_links", False),
                )
            )
        elif route == "/api/checkpoint-draft":
            return Response(Drafts(project.store).write(data))
        elif route == "/api/list-drafts":
            return Response(Drafts(project.store).list())
        elif route == "/api/restore-draft":
            return Response(Drafts(project.store).restore(data.get("id"), data.get("revision")))
        elif route == "/api/download-draft":
            return Response(Drafts(project.store).download(data.get("id"), data.get("revision")))
        elif route == "/api/delete-draft":
            return Response(Drafts(project.store).delete(data.get("id"), data.get("revision")))
        elif route == "/api/export":
            payload, filename = project.export_bundle(
                data.get("scope"),
                data.get("project_revision"),
                data.get("scene_id"),
                data.get("scene"),
                data.get("scene_revision"),
            )
            return Response(payload, "application/zip", filename=filename)
        elif route in ("/api/palette-report", "/api/palette-preflight"):
            report = project.reports.palettes(
                data.get("scene_id"),
                data.get("project_revision"),
                data.get("scene_revision"),
                data.get("scene"),
            )
            return Response(
                report,
                status=422 if route.endswith("preflight") and report["status"] != "pass" else 200,
            )
        elif route == "/api/diagnostics-report":
            return Response(
                project.reports.diagnostics(
                    data.get("project_revision"),
                    data.get("options"),
                    data.get("scene_id"),
                    data.get("scene_revision"),
                    data.get("scene"),
                )
            )
        elif route == "/api/world-report":
            return Response(
                project.reports.world(
                    data.get("project_revision"),
                    data.get("scene_id"),
                    data.get("scene_revision"),
                    data.get("scene"),
                )
            )
        elif route == "/api/save-world":
            return Response(
                project.planning.save_world(
                    data.get("world"),
                    data.get("project_revision"),
                    data.get("scene_revisions"),
                )
            )
        elif route == "/api/save-object-definition":
            return Response(
                project.objects.save_definition(
                    data.get("definition"), data.get("project_revision")
                )
            )
        elif route == "/api/delete-object-definition":
            return Response(
                project.objects.delete_definition(data.get("id"), data.get("project_revision"))
            )
        elif route == "/api/object-report":
            return Response(
                project.reports.objects(
                    data.get("scene_id"),
                    data.get("project_revision"),
                    data.get("scene_revision"),
                    data.get("scene"),
                )
            )
        elif route == "/api/save-stamp":
            return Response(
                project.objects.save_stamp(
                    data.get("name"),
                    data.get("scene"),
                    data.get("slots"),
                    data.get("project_revision"),
                )
            )
        elif route == "/api/delete-stamp":
            return Response(
                project.objects.delete_stamp(data.get("id"), data.get("project_revision"))
            )
        elif route == "/api/save-palette-profile":
            return Response(
                project.reports.save_profile(data.get("profile"), data.get("project_revision"))
            )
        elif route == "/api/save-preview-settings":
            return Response(
                project.objects.save_preview(data.get("settings"), data.get("project_revision"))
            )
        elif route == "/api/save-tile-metadata":
            return Response(
                project.artwork.set_metadata(
                    data.get("atlas"),
                    data.get("group"),
                    data.get("asset"),
                    data.get("metadata"),
                    data.get("project_revision"),
                )
            )
        elif route == "/api/rename-scene":
            return Response(
                project.scenes.rename(
                    data.get("id"),
                    data.get("name"),
                    data.get("revision"),
                    data.get("project_revision"),
                )
            )
        elif route == "/api/duplicate-scene":
            return Response(
                project.scenes.duplicate(
                    data.get("id"),
                    data.get("name"),
                    data.get("revision"),
                    data.get("project_revision"),
                    data.get("scene"),
                )
            )
        elif route == "/api/delete-scene":
            return Response(
                project.scenes.delete(
                    data.get("id"),
                    data.get("revision"),
                    data.get("project_revision"),
                    confirm_broken_links=data.get("confirm_broken_links", False),
                )
            )
        elif route == "/api/delete-atlas":
            return Response(
                project.artwork.delete_atlas(
                    data.get("id"),
                    data.get("project_revision"),
                    scene_guard=data.get("scene"),
                )
            )
        elif route == "/api/import-atlas":
            require(
                ("path" in data) != ("bundle" in data),
                "Choose an atlas folder or manifest path",
            )
            if "bundle" in data:
                return Response(
                    project.artwork.import_bundle(
                        data["bundle"],
                        data.get("project_revision"),
                        reimport=data.get("reimport", False),
                    )
                )
            else:
                require(isinstance(data.get("path"), str), "Choose an atlas manifest path")
                return Response(
                    project.artwork.import_atlas(
                        data["path"],
                        data.get("project_revision"),
                        reimport=data.get("reimport", False),
                    )
                )
        else:
            return Response({"error": "Not found"}, status=404)
