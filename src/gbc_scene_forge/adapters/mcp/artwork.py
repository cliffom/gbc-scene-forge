"""Thin native-artwork routing for full candidates and recoverable compact handles."""

from gbc_scene_forge.artwork import dimensions, editable, layers, raster, review
from gbc_scene_forge.artwork.candidates import ArtworkCandidates
from gbc_scene_forge.artwork.conversion import ArtworkConversion
from gbc_scene_forge.core.validation import require

NAMES = {
    "delete_artwork",
    "edit_artwork_layers",
    "import_artwork_png",
    "edit_artwork_raster",
    "artwork_colors",
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
        "png_intake": "import_artwork_png: uploaded canonical base64 PNG <=17 MiB, non-interlaced RGB/RGBA8 or indexed 1/2/4/8-bit. New unpublished native sprite; no quantization or resize.",
        "raster_operations": {
            "operations": [
                "fill",
                "line",
                "rectangle",
                "ellipse",
                "copy",
                "move",
                "flip",
                "resize",
                "replace",
                "remap",
            ],
            "max_batch_operations": 128,
            "max_batch_pixel_work": 16777216,
            "coordinates": "top-left integer points; rectangles in bounds, resize transforms a region, not canvas; sequential batch, simultaneous remap",
        },
        "literal_colors": "artwork_colors: exact RGBA including hidden RGB; 256/page; at most 65536 distinct colors, narrow rectangle if exceeded. No automatic cleanup or hardware profile conversion.",
        "layers": {
            "version": 1,
            "max_layers": 8,
            "aggregate_pixels_including_composite": 4194304,
            "order": "bottom-to-top",
            "opacity": "0..255",
            "target": "Explicit layer_id for reads/edits/counts; unlock before writes or structural changes",
        },
        "inline_previews": "At most 2 PNG ImageContent blocks / 4 MiB decoded per response; resource links retained with existing session lifetime. Scene artwork overview does not require a camera.",
        "handoff": "Browser Agent candidates: inspect/download, explicitly adopt separately owned copy, return immutable candidate. No saved publication or Undo transfer; original saved bases remain fixed.",
        "saved_deletion": "delete_artwork: whole atlas/document, required current project revision, optional dry_run then exact plan. Blocks saved scene/definition/stamp references, retains independent candidates/checkpoints with original bases.",
    }


def call(adapter, project, name, a):
    require("compact" not in a or type(a["compact"]) is bool, "compact must be a boolean")
    if name == "delete_artwork":
        return project.artwork.delete_atlas(
            a["atlas_id"],
            a["project_revision"],
            dry_run=a.get("dry_run", False),
            plan=a.get("plan"),
        )
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
        return candidates.retain(result, owner=value.get("owner") if handle else None)
    return result


def _call(adapter, project, name, a):
    documents = project.artwork.documents
    if name == "import_artwork_png":
        return documents.intake(a["atlas_id"], a["name"], a["png"], a["project_revision"])
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
    if name in (
        "read_artwork_pixels",
        "edit_artwork_pixels",
        "edit_artwork_layout",
        "edit_artwork_raster",
        "artwork_colors",
        "edit_artwork_layers",
    ):
        # Pure candidate operations retain their original base; never silently rebase.
        with project.store.read_session(
            candidate["project_revision"], verify_assets=True
        ) as session:
            documents.validate_base(candidate, session.document)
        if name == "edit_artwork_layers":
            return layers.edit(candidate, a["layers"])
        if "layers" in candidate["descriptor"] and name != "edit_artwork_layout":
            if name in {"artwork_colors", "read_artwork_pixels"}:
                _, source = layers.target(candidate, a.get("layer_id"))
                result = (
                    raster.colors(source, a.get("rectangle"), a.get("offset", 0))
                    if name == "artwork_colors"
                    else documents.read(source, a.get("rectangle"))
                )
                return {
                    **result,
                    "candidate_revision": candidate["revision"],
                    "layer_id": a["layer_id"],
                }
            else:
                return layers.apply(
                    candidate,
                    a.get("layer_id"),
                    lambda flat: (
                        raster.edit(flat, a["operations"])
                        if name == "edit_artwork_raster"
                        else editable.patch_pixels(flat, a["patch"])
                        if "patch" in a
                        else editable.edit_pixels(flat, a["writes"])
                    ),
                )
        if name == "edit_artwork_raster":
            return raster.edit(candidate, a["operations"])
        if name == "artwork_colors":
            return raster.colors(candidate, a.get("rectangle"), a.get("offset", 0))
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
