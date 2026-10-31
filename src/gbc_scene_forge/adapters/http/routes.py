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


PROJECT_ROUTES = {
    ("POST", "/api/create-project"): "_create_project",
    ("POST", "/api/create-blockout-scene"): "_create_blockout_scene",
    ("POST", "/api/blockout-review"): "_blockout_review",
    ("POST", "/api/create-scene"): "_create_scene",
    ("POST", "/api/save-scene"): "_save_scene",
    ("POST", "/api/checkpoint-draft"): "_checkpoint_draft",
    ("POST", "/api/list-drafts"): "_list_drafts",
    ("POST", "/api/restore-draft"): "_restore_draft",
    ("POST", "/api/download-draft"): "_download_draft",
    ("POST", "/api/delete-draft"): "_delete_draft",
    ("POST", "/api/export"): "_export",
    ("POST", "/api/palette-report"): "_palette_report",
    ("POST", "/api/palette-preflight"): "_palette_preflight",
    ("POST", "/api/diagnostics-report"): "_diagnostics_report",
    ("POST", "/api/world-report"): "_world_report",
    ("POST", "/api/save-world"): "_save_world",
    ("POST", "/api/save-object-definition"): "_save_object_definition",
    ("POST", "/api/delete-object-definition"): "_delete_object_definition",
    ("POST", "/api/object-report"): "_object_report",
    ("POST", "/api/save-stamp"): "_save_stamp",
    ("POST", "/api/delete-stamp"): "_delete_stamp",
    ("POST", "/api/save-palette-profile"): "_save_palette_profile",
    ("POST", "/api/save-preview-settings"): "_save_preview_settings",
    ("POST", "/api/save-tile-metadata"): "_save_tile_metadata",
    ("POST", "/api/rename-scene"): "_rename_scene",
    ("POST", "/api/duplicate-scene"): "_duplicate_scene",
    ("POST", "/api/delete-scene"): "_delete_scene",
    ("POST", "/api/delete-atlas"): "_delete_atlas",
    ("POST", "/api/import-tilesheet"): "_import_tilesheet",
    ("POST", "/api/import-tiled"): "_import_tiled",
    ("POST", "/api/import-atlas"): "_import_atlas",
    ("GET", "/api/project"): "_catalog",
    ("GET", "/api/revisions"): "_revisions",
    ("GET", "/api/choices"): "_choices",
    ("GET", "/api/snapshot"): "_snapshot",
}


class ProjectAPI:
    """Per-project routing state; HTTP framing and security stay in the handler."""

    def __init__(self, root: Path, project: Project | None):
        self.root = root
        self.project = project
        self.updates = Updates(project.store) if project else None

    def post(self, route: str, data: dict[str, Any]) -> Response:
        # Historically all POSTs except creation require an initialized project,
        # including unknown routes. Keep that validation order intact.
        if route != "/api/create-project":
            require(self.project is not None, "Create a project first")
        handler = PROJECT_ROUTES.get(("POST", route))
        if handler is None:
            return Response({"error": "Not found"}, status=404)
        return getattr(self, handler)(self.project, data)

    def get(self, route: str, query: dict[str, list[str]], token: str) -> Response:
        handler = PROJECT_ROUTES.get(("GET", route))
        if handler is None or (route != "/api/project" and self.updates is None):
            return Response({"error": "Not found"}, status=404)
        return getattr(self, handler)(query, token)

    def _catalog(self, query, token) -> Response:
        return Response(
            dict(
                self.project.catalog() if self.project else {"project": None},
                token=token,
                project_path=str(self.root),
            )
        )

    def _choices(self, query, token) -> Response:
        return Response(self.updates.choices())

    def _revisions(self, query, token) -> Response:
        return Response(self.updates.revisions(query.get("scene", [None])[0]))

    def _snapshot(self, query, token) -> Response:
        return Response(
            dict(
                self.updates.snapshot(query.get("scene", [None])[0]),
                token=token,
                project_path=str(self.root),
            )
        )

    def _create_project(self, project, data) -> Response:
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

    def _create_blockout_scene(self, project, data) -> Response:
        return Response(
            project.planning.create_blockout(
                data.get("name"), data.get("options"), data.get("project_revision")
            )
        )

    def _blockout_review(self, project, data) -> Response:
        return Response(
            project.planning.review_blockout(
                data.get("scene_id"),
                data.get("project_revision"),
                data.get("scene_revision"),
                data.get("scene"),
                data.get("camera_id"),
            )
        )

    def _create_scene(self, project, data) -> Response:
        return Response(
            project.scenes.create(
                data.get("name"),
                data.get("width"),
                data.get("height"),
                data.get("grid"),
                data.get("project_revision"),
            )
        )

    def _save_scene(self, project, data) -> Response:
        return Response(
            project.scenes.save(
                data.get("id"),
                data.get("scene"),
                data.get("revision"),
                data.get("project_revision"),
                confirm_broken_links=data.get("confirm_broken_links", False),
            )
        )

    def _checkpoint_draft(self, project, data) -> Response:
        return Response(Drafts(project.store).write(data))

    def _list_drafts(self, project, data) -> Response:
        return Response(Drafts(project.store).list())

    def _restore_draft(self, project, data) -> Response:
        return Response(Drafts(project.store).restore(data.get("id"), data.get("revision")))

    def _download_draft(self, project, data) -> Response:
        return Response(Drafts(project.store).download(data.get("id"), data.get("revision")))

    def _delete_draft(self, project, data) -> Response:
        return Response(Drafts(project.store).delete(data.get("id"), data.get("revision")))

    def _export(self, project, data) -> Response:
        payload, filename = project.export_bundle(
            data.get("scope"),
            data.get("project_revision"),
            data.get("scene_id"),
            data.get("scene"),
            data.get("scene_revision"),
        )
        return Response(payload, "application/zip", filename=filename)

    def _palette_report(self, project, data) -> Response:
        report = project.reports.palettes(
            data.get("scene_id"),
            data.get("project_revision"),
            data.get("scene_revision"),
            data.get("scene"),
        )
        return Response(report)

    def _palette_preflight(self, project, data) -> Response:
        response = self._palette_report(project, data)
        return Response(response.body, status=422 if response.body["status"] != "pass" else 200)

    def _diagnostics_report(self, project, data) -> Response:
        return Response(
            project.reports.diagnostics(
                data.get("project_revision"),
                data.get("options"),
                data.get("scene_id"),
                data.get("scene_revision"),
                data.get("scene"),
            )
        )

    def _world_report(self, project, data) -> Response:
        return Response(
            project.reports.world(
                data.get("project_revision"),
                data.get("scene_id"),
                data.get("scene_revision"),
                data.get("scene"),
            )
        )

    def _save_world(self, project, data) -> Response:
        return Response(
            project.planning.save_world(
                data.get("world"),
                data.get("project_revision"),
                data.get("scene_revisions"),
            )
        )

    def _save_object_definition(self, project, data) -> Response:
        return Response(
            project.objects.save_definition(data.get("definition"), data.get("project_revision"))
        )

    def _delete_object_definition(self, project, data) -> Response:
        return Response(
            project.objects.delete_definition(data.get("id"), data.get("project_revision"))
        )

    def _object_report(self, project, data) -> Response:
        return Response(
            project.reports.objects(
                data.get("scene_id"),
                data.get("project_revision"),
                data.get("scene_revision"),
                data.get("scene"),
            )
        )

    def _save_stamp(self, project, data) -> Response:
        return Response(
            project.objects.save_stamp(
                data.get("name"),
                data.get("scene"),
                data.get("slots"),
                data.get("project_revision"),
            )
        )

    def _delete_stamp(self, project, data) -> Response:
        return Response(project.objects.delete_stamp(data.get("id"), data.get("project_revision")))

    def _save_palette_profile(self, project, data) -> Response:
        return Response(
            project.reports.save_profile(data.get("profile"), data.get("project_revision"))
        )

    def _save_preview_settings(self, project, data) -> Response:
        return Response(
            project.objects.save_preview(data.get("settings"), data.get("project_revision"))
        )

    def _save_tile_metadata(self, project, data) -> Response:
        return Response(
            project.artwork.set_metadata(
                data.get("atlas"),
                data.get("group"),
                data.get("asset"),
                data.get("metadata"),
                data.get("project_revision"),
            )
        )

    def _rename_scene(self, project, data) -> Response:
        return Response(
            project.scenes.rename(
                data.get("id"),
                data.get("name"),
                data.get("revision"),
                data.get("project_revision"),
            )
        )

    def _duplicate_scene(self, project, data) -> Response:
        return Response(
            project.scenes.duplicate(
                data.get("id"),
                data.get("name"),
                data.get("revision"),
                data.get("project_revision"),
                data.get("scene"),
            )
        )

    def _delete_scene(self, project, data) -> Response:
        return Response(
            project.scenes.delete(
                data.get("id"),
                data.get("revision"),
                data.get("project_revision"),
                confirm_broken_links=data.get("confirm_broken_links", False),
            )
        )

    def _delete_atlas(self, project, data) -> Response:
        return Response(
            project.artwork.delete_atlas(
                data.get("id"),
                data.get("project_revision"),
                scene_guard=data.get("scene"),
            )
        )

    def _import_tilesheet(self, project, data) -> Response:
        return Response(
            project.artwork.import_tilesheet(
                data.get("sheet"),
                data.get("project_revision"),
                reimport=data.get("reimport", False),
                dry_run=data.get("dry_run", True),
            )
        )

    def _import_tiled(self, project, data) -> Response:
        return Response(
            project.imports.tiled(
                data.get("bundle"),
                data.get("project_revision"),
                dry_run=data.get("dry_run", True),
                confirmation=data.get("confirmation"),
            )
        )

    def _import_atlas(self, project, data) -> Response:
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
