"""Explicit static sprite-to-tile placement conversion over already saved artwork."""

import copy

from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.scenes import rendering
from gbc_scene_forge.storage.files import digest


class ArtworkConversion:
    def __init__(self, documents):
        self.documents = documents
        self.store = documents.store

    def _prepare(self, session, request):
        require(
            isinstance(request, dict)
            and set(request)
            == {
                "project_revision",
                "scene_id",
                "scene_revision",
                "layer_id",
                "object_ids",
                "tile_asset",
                "acknowledge_static",
            },
            "Provide explicit conversion bases, selected objects, target tile region and static acknowledgment",
        )
        require(
            request["acknowledge_static"] is True,
            "Explicitly acknowledge converting selected poses to static scenery; source animations remain intact",
        )
        ids = request["object_ids"]
        require(
            isinstance(ids, list)
            and 1 <= len(ids) <= 64
            and all(integer(i, 1, 2147483646) for i in ids)
            and len(ids) == len(set(ids)),
            "Select 1..64 distinct sprite objects",
        )
        require(integer(request["layer_id"], 1, 2147483646), "Choose an object layer")
        loaded = session.scene(request["scene_id"], max_bytes=16 * 1024 * 1024)
        if loaded["revision"] != request["scene_revision"]:
            raise Conflict("Selected scene changed. Retain work and review conversion again.")
        document = session.document
        model = copy.deepcopy(loaded["scene"])
        layers = copy.deepcopy(tiled.scene_layers(model))
        layer = next((value for value in layers if value["id"] == request["layer_id"]), None)
        require(
            layer is not None and layer["type"] == "objectgroup", "Select a sprite object layer"
        )
        asset = request["tile_asset"]
        require(
            model["width"]
            * model["height"]
            * (len(ids) + sum(value["type"] == "tilelayer" for value in layers))
            <= 1048576,
            "Conversion exceeds 1048576 output tile cells; narrow the selection or scene",
        )
        require(
            isinstance(asset, str) and len(asset.split("/")) == 2,
            "Choose an explicit tile region: atlas/frame",
        )
        atlas_id, region_id = asset.split("/")
        entry = document["atlases"].get(atlas_id)
        region = (
            next((r for r in entry["manifest"]["regions"] if r["name"] == region_id), None)
            if entry
            else None
        )
        grid = model["grid"]
        require(
            region is not None
            and region["kind"] == "tile"
            and region["width"] % grid == region["height"] % grid == 0,
            "Target must be a complete tile region compatible with the scene grid",
        )
        tw, tp = png.decode(self.documents._asset(document, entry["png"]), generic=True)[::2]
        target = png.decode(
            png.crop_rectangle(tw, tp, region["x"], region["y"], region["width"], region["height"])
        )[2]
        sprites = tiled.sprite_regions(document)
        selected = {item["id"]: item for item in layer["objects"] if item["id"] in ids}
        require(set(selected) == set(ids), "Selected sprite no longer exists on that layer")
        next_id = model.get("next_layer_id", max(value["id"] for value in layers) + 1)
        mapping, output, batch = [], [], []
        # Split the original object layer at each converted object. This retains
        # exact ordered compositing, including overlap with unselected sprites.
        original_used = False

        def object_layer(objects):
            nonlocal next_id, original_used
            if not objects:
                return
            value = copy.deepcopy(layer)
            value["objects"] = objects
            value["id"] = next_id if original_used else layer["id"]
            if original_used:
                next_id += 1
            original_used = True
            output.append(value)

        for item in layer["objects"]:
            if item["id"] not in selected:
                batch.append(item)
                continue
            object_layer(batch)
            batch = []
            require(
                item.get("kind", "sprite") == "sprite" and item.get("asset") in sprites,
                "Only sprite placements can become tiles",
            )
            require(
                not item.get("class") and not item.get("properties") and "definition" not in item,
                "Gameplay objects cannot become scenery; remove gameplay metadata explicitly first",
            )
            source = sprites[item["asset"]]
            source_entry = document["atlases"][item["asset"].split("/")[0]]
            require(
                (source["width"], source["height"]) == (region["width"], region["height"]),
                "Source and target dimensions must match; no implicit crop or padding",
            )
            sw, sp = png.decode(self.documents._asset(document, source_entry["png"]), generic=True)[
                ::2
            ]
            raw = png.decode(
                png.crop_rectangle(
                    sw, sp, source["x"], source["y"], source["width"], source["height"]
                )
            )[2]
            require(
                raw == target,
                "Target pixels must exactly match the source pose, including hidden RGB",
            )
            ox, oy = item.get("origin", source.get("origin", [0, 0]))
            left, top = item["x"] - ox, item["y"] - oy
            require(
                left % grid == top % grid == 0
                and left >= 0
                and top >= 0
                and left + region["width"] <= model["width"] * grid
                and top + region["height"] <= model["height"] * grid,
                "Origin-adjusted sprite bounds must align to the grid inside the scene; no implicit shifting",
            )
            cells = [["" for _ in range(model["width"])] for _ in range(model["height"])]
            for y in range(region["height"] // grid):
                for x in range(region["width"] // grid):
                    cells[top // grid + y][left // grid + x] = f"{asset}/{x}/{y}"
            output.append(
                {
                    "id": next_id,
                    "name": (item.get("name") or region_id)[:100],
                    "type": "tilelayer",
                    "visible": layer["visible"],
                    "cells": cells,
                }
            )
            mapping.append(
                {
                    "object_id": item["id"],
                    "source_asset": item["asset"],
                    "tile_asset": asset,
                    "layer_id": next_id,
                    "x": left // grid,
                    "y": top // grid,
                    "columns": region["width"] // grid,
                    "rows": region["height"] // grid,
                }
            )
            next_id += 1
        object_layer(batch)
        # Keep the original layer identity even when every object is converted.
        if not original_used:
            value = copy.deepcopy(layer)
            value["objects"] = []
            output.insert(0, value)
        position = layers.index(layer)
        layers[position : position + 1] = output
        model = {k: v for k, v in model.items() if k not in {"cells", "objects"}}
        model.update(layers=layers, next_layer_id=next_id)
        tiled.check_scene(model, document)
        plan = {
            "version": 1,
            "project_id": document["id"],
            "request": copy.deepcopy(request),
            "mapping": mapping,
        }
        plan["revision"] = digest(record_bytes(plan))
        return loaded, model, plan

    def review(self, request, viewport):
        require(isinstance(request, dict), "Provide an explicit conversion request")
        rendering.viewport(viewport)
        with self.store.read_session(
            request.get("project_revision"), verify_assets=True
        ) as session:
            loaded, model, plan = self._prepare(session, request)

            def read(path):
                return self.documents._asset(session.document, path)

            before = rendering.render(loaded["scene"], session.document, read, viewport)
            after = rendering.render(model, session.document, read, viewport)
            require(before == after, "Conversion changed the rendered appearance")
        return {
            "plan": plan,
            "before_png": before,
            "after_png": after,
            "timing": "Static poses only. All source sequences and unselected placements are retained.",
        }

    def commit(self, plan):
        require(
            isinstance(plan, dict) and isinstance(plan.get("request"), dict),
            "Review conversion first",
        )
        request = plan["request"]
        with self.store.read_session(
            request.get("project_revision"), verify_assets=True
        ) as session:
            loaded, model, current = self._prepare(session, request)
            require(current == plan, "Conversion review differs; review the exact selection again")
            path = f"scenes/{loaded['id']}.tmj"
            changes = {path: record_bytes(tiled.encode(model, session.document))}
            prepared, prepared_changes = copy.deepcopy(session.document), dict(changes)
            self.store.prepare_commit(prepared, prepared_changes)
            ack = {
                "project_revision": digest(prepared_changes["forge.project.json"]),
                "scene_revisions": {loaded["id"]: digest(changes[path])},
                "replaced_scenes": [loaded["id"]],
                "conversion_revision": plan["revision"],
            }
            document = session.document
        self.store.commit(
            document,
            request["project_revision"],
            changes,
            {path: loaded["revision"]},
            "Convert selected sprite placements to tiles",
        )
        return ack
