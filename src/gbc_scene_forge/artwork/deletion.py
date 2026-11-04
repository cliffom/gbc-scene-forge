"""Saved artwork deletion plans, reference blockers and atomic GID re-encoding."""

import copy

from gbc_scene_forge.artwork import editable
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import identifier, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.storage.files import digest


def delete(store, atlas_id, revision, *, scene_guard=None, dry_run=False, plan=None):
    require(type(dry_run) is bool, "dry_run must be boolean")
    with store.read_session(revision, verify_assets=True) as session:
        document = session.document
        require(
            identifier(atlas_id) and atlas_id in document["atlases"], "Choose an existing atlas"
        )
        require(len(document["scenes"]) <= 64, "Deletion supports at most 64 saved scenes")
        scenes = session.scenes(
            max_bytes=16 * 1024 * 1024, limit_message="Deletion exceeds 16 MiB saved scenes"
        )
        if scene_guard is not None:
            require(
                isinstance(scene_guard, dict) and set(scene_guard) == {"id", "revision"},
                "Expected the open scene's ID and revision",
            )
            require(any(s["id"] == scene_guard["id"] for s in scenes), "Choose an existing scene")
            if not any(
                s["id"] == scene_guard["id"] and s["revision"] == scene_guard["revision"]
                for s in scenes
            ):
                raise Conflict("The open scene changed on disk. Reopen before deleting artwork.")
        prefix = atlas_id + "/"

        def used(scene):
            return any(
                cell.startswith(prefix)
                for layer in tiled.scene_layers(scene)
                for row in layer.get("cells", [])
                for cell in row
            ) or any(
                obj.get("asset", "").startswith(prefix)
                for layer in tiled.scene_layers(scene)
                for obj in layer.get("objects", [])
            )

        blockers = (
            [dict(kind="scene", id=s["id"], name=s["name"]) for s in scenes if used(s["scene"])]
            + [
                dict(kind="definition", id=d["id"], name=d["name"])
                for d in document.get("object_definitions", {}).get("definitions", [])
                if d.get("asset", "").startswith(prefix)
            ]
            + [
                dict(kind="stamp", id=s["id"], name=s["name"])
                for s in document.get("stamps", [])
                if used(s["scene"])
            ]
        )
        files = sorted(p for p in document["files"] if p.startswith(f"assets/{atlas_id}/"))
        entry = document["atlases"][atlas_id]
        guards = {f"scenes/{s['id']}.tmj": s["revision"] for s in scenes}
        report = dict(
            atlas_id=atlas_id,
            document_id=entry.get("editable", {}).get("id"),
            project_revision=revision,
            artwork_revision=editable.artwork_revision(entry, document["files"]),
            files=files,
            blockers=blockers,
            scene_revisions=guards,
            retained_work="Candidate sidecars and recovery checkpoints are retained. Their original bases become stale; export/inspect before reconciliation.",
        )
        report["revision"] = digest(editable.canonical_bytes(report))
        if plan is not None and report != plan:
            raise Conflict("Deletion consequences changed; inspect a fresh deletion preview")
        if dry_run:
            return report
        require(
            not blockers,
            "Atlas is used by saved scenes, definitions or stamps: "
            + ", ".join(f"{b['kind']} {b['name']}" for b in blockers)
            + ". Remove references and save before deleting.",
        )
        changes = {p: None for p in files}
        del document["atlases"][atlas_id]
        for scene in scenes:
            changes[f"scenes/{scene['id']}.tmj"] = record_bytes(
                tiled.encode(scene["scene"], document)
            )
        prepared, prepared_changes = copy.deepcopy(document), dict(changes)
        store.prepare_commit(prepared, prepared_changes)
        ack = dict(
            deleted=atlas_id,
            project=prepared,
            revision=digest(prepared_changes["forge.project.json"]),
            scene_revisions={s["id"]: digest(changes[f"scenes/{s['id']}.tmj"]) for s in scenes},
        )
    store.commit(document, revision, changes, guards, "Delete atlas")
    return ack
