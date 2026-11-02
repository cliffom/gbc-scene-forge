"""Native artwork use cases composed by ArtworkService, independent of transports."""

import base64
import copy
from uuid import uuid4

from gbc_scene_forge.artwork import atlas, editable, png
from gbc_scene_forge.artwork.review import check_receipt
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import identifier, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.storage.files import digest
from gbc_scene_forge.storage.paths import safe_path


class ArtworkDocuments:
    def __init__(self, store):
        self.store = store

    def list(self, project_revision):
        """Discover explicit native targets and exact saved artwork bases."""
        require(editable.revision(project_revision), "Expected the exact saved project revision")
        with self.store.read_session(project_revision, verify_assets=True) as session:
            result = []
            for atlas_id, entry in session.document["atlases"].items():
                if "editable" not in entry:
                    continue
                descriptor = self._descriptor(session.document, entry)
                result.append(
                    {
                        "target": self._target(descriptor),
                        "descriptor": descriptor,
                        "artwork_revision": editable.artwork_revision(
                            entry, session.document["files"]
                        ),
                    }
                )
        self._revalidate(project_revision)
        return {"project_revision": project_revision, "documents": result}

    @staticmethod
    def _target(descriptor):
        return {
            "document_id": descriptor["id"],
            "atlas_id": descriptor["atlas_id"],
            "region": descriptor["region"],
        }

    def _asset(self, document, path, limit=4 * 1024 * 1024):
        target = safe_path(self.store.root, path)
        require(
            path in document["files"] and target.stat().st_size <= limit,
            "Missing or oversized artwork source",
        )
        data = target.read_bytes()
        if digest(data) != document["files"][path]:
            raise Conflict(
                "Artwork changed during read. Retain work and restore declared source bytes."
            )
        return data

    def _descriptor(self, document, entry):
        return editable.read_descriptor(
            entry, self._asset(document, entry["editable"]["path"], 64 * 1024)
        )

    def _revalidate(self, project_revision):
        with self.store.read_session(project_revision, verify_assets=True):
            pass

    def _absence(self, document, descriptor):
        atlas_id = descriptor["atlas_id"]
        require(
            atlas_id not in document["atlases"]
            and all(
                e.get("editable", {}).get("id") != descriptor["id"]
                for e in document["atlases"].values()
            ),
            "Artwork identity already exists",
        )
        prefix = f"assets/{atlas_id}/"
        directory = safe_path(self.store.root, f"assets/{atlas_id}")
        require(
            not any(p.startswith(prefix) for p in document["files"])
            and (
                not directory.exists()
                or (
                    directory.is_dir()
                    and not any(p.is_symlink() or not p.is_dir() for p in directory.rglob("*"))
                )
            ),
            "Artwork output path already exists; choose a fresh atlas ID",
        )

    @staticmethod
    def _envelope(
        document,
        project_revision,
        descriptor,
        pixels,
        operation,
        *,
        artwork_revision=None,
        source=None,
        metadata=None,
    ):
        return editable.seal(
            {
                "version": 1,
                "project_id": document["id"],
                "document_id": descriptor["id"],
                "atlas_id": descriptor["atlas_id"],
                "descriptor": descriptor,
                "rgba": base64.b64encode(pixels).decode(),
                "project_revision": project_revision,
                "artwork_revision": artwork_revision,
                "operation": operation,
                "source": source,
                "metadata": metadata or {},
            }
        )

    def create(
        self,
        atlas_id,
        display_name,
        kind,
        width,
        height,
        project_revision,
        *,
        origin=None,
        region="artwork",
    ):
        descriptor = {
            "version": 1,
            "id": str(uuid4()),
            "atlas_id": atlas_id,
            "region": region,
            "name": name(display_name),
            "kind": kind,
            "width": width,
            "height": height,
            "origin": [0, 0] if origin is None else copy.deepcopy(origin),
            "pixel_format": "rgba8",
            "provenance": None,
        }
        editable.check_descriptor(descriptor)
        require(editable.revision(project_revision), "Expected the exact saved project revision")
        with self.store.read_session(project_revision, verify_assets=True) as session:
            self._absence(session.document, descriptor)
            result = self._envelope(
                session.document, project_revision, descriptor, bytes(width * height * 4), "create"
            )
        self._revalidate(project_revision)
        return result

    def _native(self, document, target, artwork_revision):
        require(
            isinstance(target, dict)
            and set(target) == {"document_id", "atlas_id", "region"}
            and identifier(target["atlas_id"]),
            "Expected an explicit document/atlas/region target",
        )
        entry = document["atlases"].get(target["atlas_id"])
        require(
            entry is not None and "editable" in entry,
            "Imported artwork is read-only; duplicate a tile cell or sprite first",
        )
        descriptor = self._descriptor(document, entry)
        require(
            target == self._target(descriptor), "Editable target identity differs from document"
        )
        if editable.artwork_revision(entry, document["files"]) != artwork_revision:
            raise Conflict("Artwork changed. Retain the candidate and reopen the saved artwork.")
        return entry, descriptor

    def open(self, target, project_revision, artwork_revision):
        require(editable.revision(artwork_revision), "Expected the exact saved artwork revision")
        require(editable.revision(project_revision), "Expected the exact saved project revision")
        with self.store.read_session(project_revision, verify_assets=True) as session:
            entry, descriptor = self._native(session.document, target, artwork_revision)
            pixels = editable.decode_image(descriptor, self._asset(session.document, entry["png"]))
            result = self._envelope(
                session.document,
                project_revision,
                descriptor,
                pixels,
                "edit",
                artwork_revision=artwork_revision,
                metadata=entry.get("metadata", {}),
            )
        self._revalidate(project_revision)
        return result

    def _copy_source(self, document, source):
        editable.check_source(source)
        entry = document["atlases"].get(source["atlas_id"])
        require(entry is not None, "Choose an existing source atlas")
        if editable.artwork_revision(entry, document["files"]) != source["artwork_revision"]:
            raise Conflict(
                "Source artwork changed. Retain work and prepare a fresh copy explicitly."
            )
        region = next(
            (r for r in entry["manifest"]["regions"] if r["name"] == source["region"]), None
        )
        require(region is not None, "Choose an existing source region")
        width, _, pixels = png.decode(self._asset(document, entry["png"]), generic=True)
        if region["kind"] == "tile":
            grid, cell = source["grid"], source["cell"]
            require(
                grid is not None
                and region["width"] % grid == region["height"] % grid == 0
                and cell[0] < region["width"] // grid
                and cell[1] < region["height"] // grid,
                "Choose a complete tile cell within the region",
            )
            x, y = region["x"] + cell[0] * grid, region["y"] + cell[1] * grid
            w, h, origin = grid, grid, [0, 0]
            group = str(grid)
            key = atlas.tile_key(source["atlas_id"], source["region"], *cell)
        else:
            require(source["grid"] is None, "Sprite copies require null grid/cell")
            x, y, w, h = (region[k] for k in ("x", "y", "width", "height"))
            origin = region.get("origin", [0, 0])
            group, key = "sprites", f"{source['atlas_id']}/{source['region']}"
        raw = png.decode(png.crop_rectangle(width, pixels, x, y, w, h))[2]
        metadata = copy.deepcopy(entry.get("metadata", {}).get(group, {}).get(key))
        return region["kind"], w, h, origin, raw, group, metadata, entry

    def _duplicate_data(self, document, source, descriptor):
        kind, w, h, origin, pixels, group, metadata, entry = self._copy_source(document, source)
        require(
            (descriptor["kind"], descriptor["width"], descriptor["height"], descriptor["origin"])
            == (kind, w, h, origin),
            "Duplicate must retain source dimensions, kind and origin",
        )
        provenance = {
            "project_id": document["id"],
            **source,
            "source_format": entry["manifest"].get("source_format"),
        }
        require(descriptor["provenance"] == provenance, "Duplicate provenance differs from source")
        key = f"{descriptor['atlas_id']}/{descriptor['region']}" + (
            "/0/0" if kind == "tile" else ""
        )
        return pixels, {group: {key: metadata}} if metadata is not None else {}

    def duplicate(self, source, atlas_id, display_name, project_revision, *, region="artwork"):
        require(editable.revision(project_revision), "Expected the exact saved project revision")
        with self.store.read_session(project_revision, verify_assets=True) as session:
            kind, w, h, origin, pixels, group, metadata, entry = self._copy_source(
                session.document, source
            )
            descriptor = {
                "version": 1,
                "id": str(uuid4()),
                "atlas_id": atlas_id,
                "region": region,
                "name": name(display_name),
                "kind": kind,
                "width": w,
                "height": h,
                "origin": copy.deepcopy(origin),
                "pixel_format": "rgba8",
                "provenance": {
                    "project_id": session.document["id"],
                    **copy.deepcopy(source),
                    "source_format": entry["manifest"].get("source_format"),
                },
            }
            editable.check_descriptor(descriptor)
            self._absence(session.document, descriptor)
            key = f"{atlas_id}/{region}" + ("/0/0" if kind == "tile" else "")
            metadata = {group: {key: metadata}} if metadata is not None else {}
            result = self._envelope(
                session.document,
                project_revision,
                descriptor,
                pixels,
                "duplicate",
                source=source,
                metadata=metadata,
            )
        self._revalidate(project_revision)
        return result

    edit = staticmethod(editable.edit_pixels)
    read = staticmethod(editable.read_pixels)

    def validate_base(self, candidate, document):
        """Validate candidate policy against a caller's already-held read session."""
        d = candidate["descriptor"]
        require(document["id"] == candidate["project_id"], "Candidate belongs to another project")
        if candidate["operation"] == "edit":
            previous, saved = self._native(document, self._target(d), candidate["artwork_revision"])
            require(
                saved == d and previous.get("metadata", {}) == candidate["metadata"],
                "Pixel edits cannot change descriptor or tile metadata",
            )
            return previous
        self._absence(document, d)
        if candidate["operation"] == "create":
            require(
                d["provenance"] is None and not candidate["metadata"],
                "Blank creation cannot declare provenance or tile metadata",
            )
        else:
            _, metadata = self._duplicate_data(document, candidate["source"], d)
            require(metadata == candidate["metadata"], "Duplicate metadata differs from source")
        return None

    def save(self, candidate, *, receipt=None):
        """Commit the exact submitted candidate; acknowledgments never reread later state."""
        pixels = editable.check_candidate(candidate)
        d = candidate["descriptor"]
        revision = candidate["project_revision"]
        with self.store.read_session(revision, verify_assets=True) as session:
            document = session.document
            previous = self.validate_base(candidate, document)
            reviewed = {}
            if receipt is not None:
                reviewed = check_receipt(candidate, receipt, session)
            # Adding an atlas changes Tiled ranges: decode all maps with the OLD catalog.
            scenes = (
                [session.scene(item["id"]) for item in document["scenes"]]
                if previous is None
                else []
            )
            image = png.encode(d["width"], d["height"], pixels)
            seed = previous if previous is not None else {"metadata": candidate["metadata"]}
            entry, changes = atlas.build_assets(
                editable.manifest(d), image, d["width"], pixels, seed
            )
            entry["editable"] = {"id": d["id"], "path": f"assets/{d['atlas_id']}/editable.json"}
            changes[entry["editable"]["path"]] = record_bytes(d)
            document["atlases"][d["atlas_id"]] = entry
            expected, scene_revisions = dict(reviewed), {}
            for loaded in scenes:
                path = f"scenes/{loaded['id']}.tmj"
                encoded = record_bytes(tiled.encode(loaded["scene"], document))
                # Guard every saved scene even when its encoding need not change.
                expected[path] = loaded["revision"]
                if digest(encoded) != loaded["revision"]:
                    changes[path] = encoded
                    scene_revisions[loaded["id"]] = digest(encoded)
            prepared, prepared_changes = copy.deepcopy(document), dict(changes)
            self.store.prepare_commit(prepared, prepared_changes)
            acknowledgment = {
                "project_id": document["id"],
                "document_id": d["id"],
                "atlas_id": d["atlas_id"],
                "candidate_revision": candidate["revision"],
                "project_revision": digest(prepared_changes["forge.project.json"]),
                "artwork_revision": editable.artwork_revision(
                    prepared["atlases"][d["atlas_id"]], prepared["files"]
                ),
                "png_digest": digest(image),
                "scene_revisions": scene_revisions,
            }
            if receipt is not None:
                acknowledgment["review_revision"] = receipt["revision"]
        self.store.commit(document, revision, changes, expected, "Save editable artwork")
        return acknowledgment
