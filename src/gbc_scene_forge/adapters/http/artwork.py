"""Thin browser transport for shared native artwork services and checkpoints."""

import base64

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
    if action == "duplicate":
        return documents.duplicate(
            data.get("source"), data.get("atlas_id"), data.get("name"), data.get("project_revision")
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
