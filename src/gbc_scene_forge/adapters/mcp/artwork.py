"""Thin native-artwork routing for full candidates and recoverable compact handles."""

from gbc_scene_forge.artwork import dimensions, editable, review
from gbc_scene_forge.artwork.candidates import ArtworkCandidates
from gbc_scene_forge.artwork.conversion import ArtworkConversion
from gbc_scene_forge.core.validation import require

NAMES = {
    "list_artwork",
    "create_artwork",
    "duplicate_artwork",
    "open_artwork",
    "read_artwork_pixels",
    "edit_artwork_pixels",
    "review_artwork_candidate",
    "commit_artwork",
    "create_artwork_sheet",
    "duplicate_artwork_sheet",
    "edit_artwork_layout",
    "review_artwork_animation",
    "review_artwork_frame",
    "retain_artwork_candidate",
    "export_artwork_candidate",
    "list_artwork_candidates",
    "release_artwork_candidate",
    "review_sprite_tile_conversion",
    "commit_sprite_tile_conversion",
}


def capabilities():
    return {
        "pixel_format": "rgba8",
        "pixel_order": "Row-major, top-left; base64 straight RGBA8 bytes (sRGB).",
        "tile_sizes": [8, 16, 32],
        "sprite_dimension": {"minimum": 1, "maximum": dimensions.MAX_AXIS},
        "max_document_pixels": dimensions.MAX_PIXELS,
        "max_pixel_read_pixels": dimensions.MAX_READ_PIXELS,
        "max_input_bytes": dimensions.MAX_CANDIDATE_BYTES + 2 * 1024 * 1024,
        "max_image_bytes": dimensions.MAX_IMAGE_BYTES,
        "review_views": "Default: whole-document overview <=1024 per axis. Explicit rectangle: native detail, with scale fitting <=1024 per axis.",
        "max_pixel_writes": 65536,
        "max_pixel_batch_bytes": editable.MAX_BATCH,
        "max_candidate_bytes": editable.MAX_CANDIDATE,
        "max_review_scenes": review.MAX_SCENES,
        "max_review_map_bytes": review.MAX_MAP_BYTES,
        "reference_page_size": review.PAGE_SIZE,
        "commit_requires_review_receipt": True,
        "candidates": "Client-held envelopes or immutable project-scoped handles. compact=true retains a recoverable sidecar. List/export/release handles explicitly; 256 records/64 MiB, no expiration, restart-safe. Export before release or moving projects. Saved project export excludes sidecars.",
        "imported_artwork": "Read-only; duplicate an explicit tile cell or static sprite to edit.",
        "placement_variations": "Duplicate with 1..256 explicit saved scene/layer/cell or object locations. Review and commit artwork plus selected replacements atomically.",
        "sheets": {"max_frames": 128, "max_sequences": 64, "animation_review": "image/apng"},
    }


def call(adapter, project, name, a):
    require("compact" not in a or type(a["compact"]) is bool, "compact must be a boolean")
    conversion = ArtworkConversion(project.artwork.documents)
    if name == "commit_sprite_tile_conversion":
        return conversion.commit(a["plan"])
    if name == "review_sprite_tile_conversion":
        result = conversion.review(a["request"], a["viewport"])
        resources = []
        for key in ("before_png", "after_png"):
            resource = adapter.artifact(result.pop(key), "image/png", key + ".png")
            result[key.removesuffix("_png") + "_resource"] = resource
            resources.append(resource)
        return {**result, "resources": resources}
    candidates = ArtworkCandidates(project.artwork.documents)
    if name == "list_artwork_candidates":
        return candidates.list()
    a = dict(a)
    value = a.get("candidate")
    handle = isinstance(value, dict) and "handle" in value
    if handle:
        a["candidate"] = candidates.resolve(value)
    if name == "export_artwork_candidate":
        return a["candidate"]
    if name == "release_artwork_candidate":
        return candidates.release(value)
    if name == "retain_artwork_candidate":
        return candidates.retain(a["candidate"])
    result = _call(adapter, project, name, a)
    if (
        (handle or a.get("compact", False))
        and isinstance(result, dict)
        and "descriptor" in result
        and "rgba" in result
    ):
        return candidates.retain(result)
    return result


def _call(adapter, project, name, a):
    documents = project.artwork.documents
    if name == "list_artwork":
        return documents.list(a["project_revision"])
    if name == "create_artwork":
        return documents.create(
            a["atlas_id"],
            a["name"],
            a["kind"],
            a["width"],
            a["height"],
            a["project_revision"],
            origin=a.get("origin"),
            region=a.get("region", "artwork"),
        )
    if name == "create_artwork_sheet":
        return documents.create_sheet(
            a["atlas_id"],
            a["name"],
            a["kind"],
            a["width"],
            a["height"],
            a["project_revision"],
            frames=a["frames"],
            sequences=a["sequences"],
        )
    if name == "duplicate_artwork_sheet":
        return documents.duplicate_sheet(
            a["source"], a["atlas_id"], a["name"], a["project_revision"]
        )
    if name == "duplicate_artwork":
        return documents.duplicate(
            a["source"],
            a["atlas_id"],
            a["name"],
            a["project_revision"],
            region=a.get("region", "artwork"),
            placements=a.get("placements"),
        )
    if name == "open_artwork":
        return documents.open(a["target"], a["project_revision"], a["artwork_revision"])
    candidate = a["candidate"]
    editable.check_candidate(candidate)
    if name in ("read_artwork_pixels", "edit_artwork_pixels", "edit_artwork_layout"):
        # Pure candidate operations retain their original base; never silently rebase.
        with project.store.read_session(
            candidate["project_revision"], verify_assets=True
        ) as session:
            documents.validate_base(candidate, session.document)
        if name == "read_artwork_pixels":
            return documents.read(candidate, a.get("rectangle"))
        if name == "edit_artwork_layout":
            return documents.layout(candidate, a["frames"], a["sequences"])
        if "patch" in a:
            require("writes" not in a, "Choose pixel writes or a rectangular patch")
            return editable.patch_pixels(candidate, a["patch"])
        return documents.edit(candidate, a["writes"])
    if name == "review_artwork_animation":
        result = project.artwork.reviews.animation(
            candidate, a["sequence_id"], scale=a.get("scale", 4)
        )
        resource = adapter.artifact(result.pop("animation_png"), "image/apng", "animation.apng")
        return {**result, "animation_resource": resource, "resources": [resource]}
    if name == "review_artwork_frame":
        result = project.artwork.reviews.frame(candidate, a["frame_id"], scale=a.get("scale", 4))
        resources = []
        for key in ("before", "after"):
            if result[key] is not None:
                for image_key in [k for k in result[key] if k.endswith("_png")]:
                    resource = adapter.artifact(
                        result[key].pop(image_key), "image/png", f"{key}-{image_key}.png"
                    )
                    result[key][image_key.removesuffix("_png") + "_resource"] = resource
                    resources.append(resource)
        return {**result, "resources": resources}
    if name == "commit_artwork":
        require(isinstance(a["receipt"], dict), "A matching artwork review receipt is required")
        return documents.save(candidate, receipt=a["receipt"])
    result = project.artwork.reviews.review(
        candidate,
        scale=a.get("scale", 4),
        scene=a.get("scene"),
        offset=a.get("offset", 0),
        rectangle=a.get("rectangle"),
    )
    resources = []
    for group in ("before", "after", "scene"):
        if result[group] is None:
            continue
        for key in list(result[group]):
            if key.endswith("_png"):
                resource = adapter.artifact(
                    result[group].pop(key), "image/png", f"{group}-{key[:-4]}.png"
                )
                result[group][key[:-4] + "_resource"] = resource
                resources.append(resource)
    return {**result, "resources": resources}
