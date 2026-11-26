"""Read-only native artwork comparisons and revision-bound review receipts."""

import copy

from gbc_scene_forge.artwork import atlas, editable, placements, png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.scenes import authoring, rendering
from gbc_scene_forge.storage.files import digest

MAX_SCALE = 16  # Integer enlargement requested by the caller; output still has an axis cap.
MAX_VIEW_AXIS = 1024  # Fit whole-document views before enlargement.
MAX_SCENES = 64
MAX_MAP_BYTES = 16 * 1024 * 1024
PAGE_SIZE = 256
RECEIPT_FIELDS = {
    "version",
    "project_id",
    "project_revision",
    "candidate_revision",
    "artwork_revision",
    "files_revision",
    "scene_revisions",
    "context",
    "revision",
}


def sealed(value):
    return {**value, "revision": digest(editable.canonical_bytes(value))}


def check_receipt(candidate, receipt, session):
    """Return final journal expectations, including unchanged reviewed maps."""
    require(
        isinstance(receipt, dict)
        and set(receipt) == RECEIPT_FIELDS
        and type(receipt["version"]) is int
        and len(editable.canonical_bytes(receipt)) <= editable.MAX_CANDIDATE,
        "Expected a bounded artwork review receipt",
    )
    body = {k: v for k, v in receipt.items() if k != "revision"}
    require(sealed(body) == receipt, "Artwork review receipt digest differs")
    expected = {
        "version": 1,
        "project_id": candidate["project_id"],
        "project_revision": candidate["project_revision"],
        "candidate_revision": candidate["revision"],
        "artwork_revision": candidate["artwork_revision"],
        "files_revision": digest(editable.canonical_bytes(session.document["files"])),
    }
    if any(receipt[k] != v for k, v in expected.items()):
        raise Conflict("Artwork review no longer matches the candidate/base. Review again.")
    revisions = receipt["scene_revisions"]
    require(
        isinstance(revisions, dict)
        and set(revisions) == {s["id"] for s in session.document["scenes"]}
        and len(revisions) <= MAX_SCENES
        and all(editable.revision(v) for v in revisions.values()),
        "Review requires the exact revisions of every scanned saved scene",
    )
    context = receipt["context"]
    require(
        context is None
        or (
            isinstance(context, dict)
            and set(context) == {"scene_id", "scene_revision", "snapshot_revision", "viewport"}
            and isinstance(context["scene_id"], str)
            and context["scene_id"] in revisions
            and context["scene_revision"] == revisions[context["scene_id"]]
            and editable.revision(context["snapshot_revision"])
        ),
        "Invalid scene review context",
    )
    if context is not None:
        rendering.viewport(context["viewport"])
    return session.store.scene_guards(session.document, revisions)


def _locations(scene, prefix):
    for layer in tiled.scene_layers(scene):
        for y, row in enumerate(layer.get("cells", [])):
            for x, cell in enumerate(row):
                asset, flags = tiled.cell_parts(cell)
                if asset.startswith(prefix):
                    yield {
                        "layer_id": layer["id"],
                        "x": x,
                        "y": y,
                        "grid": scene["grid"],
                        "asset": asset,
                        "flags": flags,
                    }
        for item in layer.get("objects", []):
            if item.get("asset", "").startswith(prefix):
                yield {"layer_id": layer["id"], "object_id": item["id"], "asset": item["asset"]}


def references(document, scenes, prefix, offset, *, exact_asset=None, grid=None):
    """Count the full bounded scan; retain only a single page of exact locations."""
    details, count, affected = [], 0, []

    def add(location):
        nonlocal count
        if exact_asset is not None and (
            location["asset"] != exact_asset or (grid is not None and location.get("grid") != grid)
        ):
            return
        if offset <= count < offset + PAGE_SIZE:
            details.append(location)
        count += 1

    for loaded in scenes:
        start = count
        for location in _locations(loaded["scene"], prefix):
            add({"kind": "scene", "scene_id": loaded["id"], **location})
        if count > start:
            affected.append(
                {"id": loaded["id"], "revision": loaded["revision"], "placements": count - start}
            )
    for stamp in document.get("stamps", []):
        for location in _locations(stamp["scene"], prefix):
            add({"kind": "stamp", "stamp_id": stamp["id"], **location})
    for definition in document.get("object_definitions", {}).get("definitions", []):
        if definition.get("asset", "").startswith(prefix):
            add(
                {
                    "kind": "definition",
                    "definition_id": definition["id"],
                    "asset": definition["asset"],
                }
            )
    return {
        "scan_complete": True,
        "total": count,
        "scenes": affected,
        "locations": details,
        "offset": offset,
        "next_offset": offset + PAGE_SIZE if count > offset + PAGE_SIZE else None,
        "locations_complete": offset == 0 and count <= PAGE_SIZE,
    }


def isolated(descriptor, pixels, scale, rectangle=None):
    """Bound both overview and detail images, independently of source dimensions."""
    width, height = descriptor["width"], descriptor["height"]
    if rectangle is not None:
        require(
            isinstance(rectangle, dict)
            and set(rectangle) == {"x", "y", "width", "height"}
            and integer(rectangle["x"], 0, width - 1)
            and integer(rectangle["y"], 0, height - 1)
            and integer(rectangle["width"], 1, width - rectangle["x"])
            and integer(rectangle["height"], 1, height - rectangle["y"]),
            "Review rectangle must fit the artwork",
        )
        rendering.viewport(rectangle)
        x, y, w, h = (rectangle[k] for k in ("x", "y", "width", "height"))
        pixels = b"".join(
            pixels[((y + row) * width + x) * 4 : ((y + row) * width + x + w) * 4]
            for row in range(h)
        )
        width, height = w, h
    else:
        rectangle = {"x": 0, "y": 0, "width": width, "height": height}
    # Integer nearest-neighbor sampling covers the entire image without allocating
    # an enlarged source. Exact source pixels remain available via bounded reads.
    step = max(1, (max(width, height) + MAX_VIEW_AXIS - 1) // MAX_VIEW_AXIS)
    if step > 1:
        pixels = b"".join(
            pixels[(y * width + x) * 4 : (y * width + x + 1) * 4]
            for y in range(0, height, step)
            for x in range(0, width, step)
        )
        width, height = (width + step - 1) // step, (height + step - 1) // step
    scale = min(scale, MAX_VIEW_AXIS // max(width, height))
    rows = []
    for y in range(height):
        row = b"".join(
            pixels[(y * width + x) * 4 : (y * width + x + 1) * 4] * scale for x in range(width)
        )
        rows.extend([row] * scale)
    return {
        "rectangle": dict(rectangle),
        "sample_step": step,
        "scale": scale,
        "native_png": png.encode(width, height, pixels),
        "enlarged_png": png.encode(width * scale, height * scale, b"".join(rows)),
    }


class ArtworkReview:
    def __init__(self, documents):
        self.documents = documents
        self.store = documents.store

    def animation(self, candidate, sequence_id, *, scale=4):
        from gbc_scene_forge.artwork.animation_review import render

        # Generate against the same dependency validation as a commit review.
        report = self.review(candidate, scale=1)
        result = render(candidate, sequence_id, scale)
        with self.store.read_session(candidate["project_revision"], verify_assets=True) as session:
            self.documents.validate_base(candidate, session.document)
            check_receipt(candidate, report["receipt"], session)
        return {**result, "receipt": report["receipt"]}

    def frame(self, candidate, frame_id, *, scale=4):
        editable.check_candidate(candidate)
        require(integer(scale, 1, MAX_SCALE), "Review scale must be within 1..16")
        d = candidate["descriptor"]
        require(d["version"] == 2, "Frame reviews require a native sheet")
        frame = next((f for f in d["frames"] if f["id"] == frame_id), None)
        require(frame is not None, "Choose an existing frame ID")
        rectangle = {k: frame[k] for k in ("x", "y", "width", "height")}
        report = self.review(candidate, scale=scale, rectangle=rectangle)
        images = {key: report[key] for key in ("before", "after")}
        with self.store.read_session(candidate["project_revision"], verify_assets=True) as session:
            self.documents.validate_base(candidate, session.document)
            check_receipt(candidate, report["receipt"], session)
        return {
            "candidate_revision": candidate["revision"],
            "frame": copy.deepcopy(frame),
            "receipt": report["receipt"],
            "references": report["references"],
            **images,
        }

    def review(self, candidate, *, scale=4, scene=None, offset=0, rectangle=None):
        """Compare artwork and optionally one explicitly based saved/candidate scene.

        Scene input: {scene_id, scene_revision, scene, viewport}; scene may be null
        to review saved placements. A temporary candidate may reference new artwork.
        Images are PNG bytes; receipts and reference data are transport-neutral JSON.
        """
        pixels = editable.check_candidate(candidate)
        require(integer(scale, 1, MAX_SCALE), "Review scale must be an integer within 1..16")
        require(integer(offset, 0, 2147483647), "Invalid reference page offset")
        if scene is not None:
            authoring.bounded(scene)
            require(
                isinstance(scene, dict)
                and set(scene) == {"scene_id", "scene_revision", "scene", "viewport"}
                and editable.revision(scene["scene_revision"]),
                "Expected explicit scene ID/base, scene candidate and pixel viewport",
            )
            rendering.viewport(scene["viewport"])
        d = candidate["descriptor"]
        after = isolated(d, pixels, scale, rectangle)
        revision = candidate["project_revision"]
        with self.store.read_session(revision, verify_assets=True) as session:
            document = session.document
            previous = self.documents.validate_base(candidate, document)
            require(
                len(document["scenes"]) <= MAX_SCENES,
                "Artwork review supports at most 64 saved scenes; narrow the project scope",
            )
            loaded = session.scenes(
                max_bytes=MAX_MAP_BYTES,
                limit_message="Artwork review exceeds 16 MiB saved maps; narrow the project scope",
            )
            replacements = placements.replace(candidate, loaded)
            revisions = {s["id"]: s["revision"] for s in loaded}
            old_pixels = (
                editable.decode_image(d, self.documents._asset(document, previous["png"]))
                if previous is not None
                else bytes(len(pixels))
            )
            reference_prefix, exact_asset, reference_grid = d["atlas_id"] + "/", None, None
            if replacements:
                source = candidate["source"]
                reference_prefix = f"{source['atlas_id']}/"
                exact_asset = f"{source['atlas_id']}/{source['region']}"
                if source["grid"] is not None:
                    exact_asset += f"/{source['cell'][0]}/{source['cell'][1]}"
                    reference_grid = source["grid"]
                old_pixels = self.documents._copy_source(document, source)[4]
            result = {
                "candidate_revision": candidate["revision"],
                "target": self.documents._target(d),
                "width": d["width"],
                "height": d["height"],
                "scale": scale,
                "before": isolated(d, old_pixels, scale, rectangle)
                if previous is not None or replacements
                else None,
                "after": after,
                "references": references(
                    document,
                    loaded,
                    reference_prefix,
                    offset,
                    exact_asset=exact_asset,
                    grid=reference_grid,
                ),
                "scene": None,
            }
            if replacements:
                result["replacements"] = copy.deepcopy(candidate["placements"])
            context = None
            if scene is not None:
                saved = next((s for s in loaded if s["id"] == scene["scene_id"]), None)
                require(saved is not None, "Choose an existing scene base for temporary review")
                if saved["revision"] != scene["scene_revision"]:
                    raise Conflict("Scene base changed. Retain the candidate and review again.")
                require(
                    not replacements or scene["scene"] is None,
                    "Variation review uses saved scenes, not unsaved scene candidates",
                )
                temporary = copy.deepcopy(document)
                image = png.encode(d["width"], d["height"], pixels)
                entry, _ = atlas.build_assets(
                    editable.manifest(d),
                    image,
                    d["width"],
                    pixels,
                    previous or {"metadata": candidate["metadata"]},
                )
                temporary["atlases"][d["atlas_id"]] = entry
                model = (
                    replacements.get(saved["id"], saved["scene"])
                    if replacements
                    else (saved["scene"] if scene["scene"] is None else scene["scene"])
                )
                tiled.check_scene(model, temporary)
                model = tiled.decode(tiled.encode(model, temporary), temporary)
                context = {
                    "scene_id": saved["id"],
                    "scene_revision": saved["revision"],
                    "snapshot_revision": authoring.snapshot(model),
                    "viewport": dict(scene["viewport"]),
                }
                view = context["viewport"]
                require(
                    view["x"] < model["width"] * model["grid"]
                    and view["y"] < model["height"] * model["grid"],
                    "Review viewport origin must be inside the scene",
                )

                def render(source):
                    def read_image(path):
                        if path == entry["png"]:
                            return source
                        return self.documents._asset(document, path)

                    return rendering.render(model, temporary, read_image, view)

                result["scene"] = {
                    **context,
                    "before_png": rendering.render(
                        saved["scene"],
                        document,
                        lambda path: self.documents._asset(document, path),
                        view,
                    )
                    if replacements
                    else render(png.encode(d["width"], d["height"], old_pixels)),
                    "after_png": render(image),
                }
            receipt = sealed(
                {
                    "version": 1,
                    "project_id": candidate["project_id"],
                    "project_revision": revision,
                    "candidate_revision": candidate["revision"],
                    "artwork_revision": candidate["artwork_revision"],
                    "files_revision": digest(editable.canonical_bytes(document["files"])),
                    "scene_revisions": revisions,
                    "context": context,
                }
            )
            self.store.current(revision)
            check_receipt(candidate, receipt, session)
        # Recheck after expensive rendering and lock release, including raw map bytes.
        with self.store.read_session(revision, verify_assets=True) as session:
            self.documents.validate_base(candidate, session.document)
            check_receipt(candidate, receipt, session)
        return {**result, "receipt": receipt}
