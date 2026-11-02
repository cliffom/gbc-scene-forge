"""Thin native-artwork routing; candidates and receipts remain client-held JSON."""

from gbc_scene_forge.artwork import editable, review
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
}


def capabilities():
    return {
        "pixel_format": "rgba8",
        "pixel_order": "Row-major, top-left; base64 straight RGBA8 bytes (sRGB).",
        "tile_sizes": [8, 16, 32],
        "sprite_dimension": {"minimum": 8, "maximum": 256, "multiple_of": 8},
        "max_pixel_writes": 65536,
        "max_pixel_batch_bytes": editable.MAX_BATCH,
        "max_candidate_bytes": editable.MAX_CANDIDATE,
        "max_review_scenes": review.MAX_SCENES,
        "max_review_map_bytes": review.MAX_MAP_BYTES,
        "reference_page_size": review.PAGE_SIZE,
        "commit_requires_review_receipt": True,
        "candidates": "Client-held immutable envelopes; no server candidate cache or draft writes.",
        "imported_artwork": "Read-only; duplicate an explicit tile cell or static sprite to edit.",
    }


def call(adapter, project, name, a):
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
    if name == "duplicate_artwork":
        return documents.duplicate(
            a["source"],
            a["atlas_id"],
            a["name"],
            a["project_revision"],
            region=a.get("region", "artwork"),
        )
    if name == "open_artwork":
        return documents.open(a["target"], a["project_revision"], a["artwork_revision"])
    candidate = a["candidate"]
    editable.check_candidate(candidate)
    if name in ("read_artwork_pixels", "edit_artwork_pixels"):
        # Pure candidate operations retain their original base; never silently rebase.
        with project.store.read_session(
            candidate["project_revision"], verify_assets=True
        ) as session:
            documents.validate_base(candidate, session.document)
        if name == "read_artwork_pixels":
            return documents.read(candidate, a.get("rectangle"))
        return documents.edit(candidate, a["writes"])
    if name == "commit_artwork":
        require(isinstance(a["receipt"], dict), "A matching artwork review receipt is required")
        return documents.save(candidate, receipt=a["receipt"])
    result = project.artwork.reviews.review(
        candidate, scale=a.get("scale", 4), scene=a.get("scene"), offset=a.get("offset", 0)
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
