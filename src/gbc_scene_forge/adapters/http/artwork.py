"""Thin browser transport for shared native artwork services and checkpoints."""

import base64

from gbc_scene_forge.artwork.conversion import ArtworkConversion
from gbc_scene_forge.artwork.drafts import ArtworkDrafts
from gbc_scene_forge.core.validation import require


def images(value):
    if isinstance(value, bytes):
        return base64.b64encode(value).decode()
    if isinstance(value, dict):
        return {key: images(item) for key, item in value.items()}
    return value


def artwork_response(project, action, data):
    documents = project.artwork.documents
    drafts = ArtworkDrafts(documents)
    if action == "conversion-review":
        return images(
            ArtworkConversion(documents).review(data.get("request"), data.get("viewport"))
        )
    if action == "conversion-save":
        return ArtworkConversion(documents).commit(data.get("plan"))
    if action == "list":
        return documents.list(data.get("project_revision"))
    if action == "open":
        return documents.open(
            data.get("target"), data.get("project_revision"), data.get("artwork_revision")
        )
    if action == "create":
        return documents.create(
            data.get("atlas_id"),
            data.get("name"),
            data.get("kind"),
            data.get("width"),
            data.get("height"),
            data.get("project_revision"),
        )
    if action == "sheet-create":
        return documents.create_sheet(
            data.get("atlas_id"),
            data.get("name"),
            data.get("kind"),
            data.get("width"),
            data.get("height"),
            data.get("project_revision"),
            frames=data.get("frames"),
            sequences=data.get("sequences", []),
        )
    if action == "sheet-duplicate":
        return documents.duplicate_sheet(
            data.get("source"),
            data.get("atlas_id"),
            data.get("name"),
            data.get("project_revision"),
        )
    if action == "layout":
        return documents.layout(data.get("candidate"), data.get("frames"), data.get("sequences"))
    if action == "animation-review":
        return images(
            project.artwork.reviews.animation(
                data.get("candidate"), data.get("sequence_id"), scale=data.get("scale", 4)
            )
        )
    if action == "duplicate":
        return documents.duplicate(
            data.get("source"),
            data.get("atlas_id"),
            data.get("name"),
            data.get("project_revision"),
            placements=data.get("placements"),
        )
    if action == "edit":
        return documents.edit(data.get("candidate"), data.get("writes"))
    if action == "review":
        return images(
            project.artwork.reviews.review(
                data.get("candidate"),
                scale=data.get("scale", 4),
                scene=data.get("scene"),
                offset=data.get("offset", 0),
            )
        )
    if action == "save":
        require(isinstance(data.get("receipt"), dict), "Review the artwork before saving")
        return documents.save(data.get("candidate"), receipt=data["receipt"])
    if action == "draft-list":
        return drafts.list()
    if action == "draft-write":
        return drafts.write(data)
    if action == "draft-restore":
        return drafts.restore(data.get("id"), data.get("revision"))
    if action == "draft-download":
        return drafts.download(data.get("id"), data.get("revision"))
    if action == "draft-delete":
        return drafts.delete(data.get("id"), data.get("revision"), data.get("owner"))
    raise ValueError("Unknown artwork action")
