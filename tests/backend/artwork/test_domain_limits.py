"""Shared authoring boundaries and unchanged advertised MCP contracts (#171)."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from uuid import UUID

from gbc_scene_forge.adapters.mcp import artwork, schemas
from gbc_scene_forge.artwork import dimensions, editable, layers, raster, sheets, workshop
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.scenes import authoring
from gbc_scene_forge.scenes import dimensions as scene_dimensions

FIXTURE = json.loads((Path(__file__).parents[2] / "fixtures/domain-limits.json").read_text())


def descriptor(case):
    value = copy.deepcopy(FIXTURE["descriptor"])
    value.update(case.get("descriptor", {}))
    if value["version"] == 2:
        value["frames"] = [
            {**FIXTURE["frame"], "id": f"f{i}", **case.get("frame", {})}
            for i in range(case.get("frame_count", 1))
        ]
        value["sequences"] = [
            dict(
                id=f"s{i}",
                name="S",
                loop=True,
                frames=[dict(frame_id="f0", duration_ms=case.get("duration", 1))] * count,
            )
            for i, count in enumerate(case.get("sequence_lengths", []))
        ]
    if "layer_count" in case:
        value["layers"] = dict(
            version=1,
            items=[
                dict(id=str(UUID(int=i + 1)), name="L", visible=True, locked=False, opacity=255)
                for i in range(case["layer_count"])
            ],
        )
    if "descriptor_bytes" in case:
        value["provenance"] = dict(
            project_id=value["id"],
            atlas_id="sheet",
            region="f0",
            grid=None,
            cell=None,
            artwork_revision="a" * 64,
            source_format="",
        )
        value["provenance"]["source_format"] = "x" * (
            case["descriptor_bytes"] - len(record_bytes(value))
        )
        assert len(record_bytes(value)) == case["descriptor_bytes"]
    return value


def placements(case):
    result = []
    for i in range(case.get("count", 1)):
        item = dict(
            scene_id=FIXTURE["descriptor"]["id"], scene_revision="a" * 64, layer_id=1, x=i, y=0
        )
        if case.get("field") == "object_id":
            item.pop("x")
            item.pop("y")
        if "field" in case:
            item[case["field"]] = case["value"]
        result.append(item)
    return result


class DomainLimitsTests(unittest.TestCase):
    def test_shared_lower_and_upper_boundaries(self):
        for case in FIXTURE["descriptor_cases"]:
            with self.subTest(case=case["name"]):
                value = descriptor(case)
                original = copy.deepcopy(value)
                if case["valid"]:
                    editable.check_descriptor(value)
                else:
                    with self.assertRaises(ValueError):
                        editable.check_descriptor(value)
                if "sheet_valid" in case:
                    sheets.check(value)  # Count ceiling is independent of serialized byte ceiling.
                self.assertEqual(value, original)
        for case in FIXTURE["placement_cases"]:
            with self.subTest(case=case["name"]):
                if case["valid"]:
                    editable.check_placements(placements(case))
                else:
                    with self.assertRaises(ValueError):
                        editable.check_placements(placements(case))
        for case in FIXTURE["scene_cases"]:
            args = [case[k] for k in ("width", "height", "grid")]
            with self.subTest(scene=case):
                if case["valid"]:
                    scene_dimensions.check_dimensions(*args)
                else:
                    with self.assertRaises(ValueError):
                        scene_dimensions.check_dimensions(*args)

    def test_policy_fixture_and_mcp_advertising(self):
        policy = FIXTURE["policy"]
        artwork_names = {
            "MAX_ARTWORK_AXIS": dimensions.MAX_AXIS,
            "MAX_ARTWORK_PIXELS": dimensions.MAX_PIXELS,
            "MAX_RGBA_BASE64": dimensions.MAX_RGBA_BASE64,
            "GRID_UNIT": dimensions.GRID_UNIT,
            "MAX_GRID_AXIS": dimensions.MAX_GRID_AXIS,
            "MAX_DESCRIPTOR_BYTES": editable.MAX_DESCRIPTOR_BYTES,
            "MAX_LAYERS": layers.MAX_LAYERS,
            "MAX_PIXEL_PATCH_PIXELS": dimensions.MAX_READ_PIXELS,
        }
        self.assertEqual(artwork_names, policy["artwork"])
        for key, value in policy["sheets"].items():
            self.assertEqual(getattr(sheets, key), value, key)
        for key, value in policy["placements"].items():
            self.assertEqual(getattr(editable, key), value, key)
        self.assertEqual(
            {
                "MAX_SCENE_CELLS": scene_dimensions.MAX_CELLS,
                "MAX_SCENE_PIXELS": scene_dimensions.MAX_PIXELS,
                "MAX_SCENE_LAYERS": scene_dimensions.MAX_LAYERS,
                "MAX_OBJECTS_PER_LAYER": scene_dimensions.MAX_OBJECTS_PER_LAYER,
            },
            policy["scene"],
        )
        self.assertEqual(
            {
                "scene_operations": authoring.MAX_OPERATIONS,
                "scene_tile_edits": authoring.MAX_TILE_EDITS,
                "scene_json_bytes": authoring.MAX_INPUT,
                "raster_operations": raster.MAX_OPERATIONS,
                "raster_work_pixels": raster.MAX_WORK,
                "candidate_operations": workshop.MAX_BATCH_OPERATIONS,
                "candidate_work_pixels": workshop.MAX_BATCH_WORK,
                "artwork_json_bytes": editable.MAX_BATCH,
                "pixel_writes": editable.MAX_PIXEL_WRITES,
            },
            policy["operations"],
        )
        advertised = artwork.capabilities()
        self.assertEqual(advertised["sheets"]["max_frames"], sheets.MAX_FRAMES)
        self.assertEqual(advertised["sheets"]["max_sequences"], sheets.MAX_SEQUENCES)
        self.assertEqual(advertised["max_pixel_writes"], editable.MAX_PIXEL_WRITES)
        self.assertEqual(advertised["layers"]["max_layers"], layers.MAX_LAYERS)
        self.assertEqual(schemas.FRAMES["maxItems"], sheets.MAX_FRAMES)
        self.assertEqual(schemas.SEQUENCES["maxItems"], sheets.MAX_SEQUENCES)
        self.assertEqual(schemas.PLACEMENTS["maxItems"], editable.MAX_PLACEMENTS)
        self.assertEqual(
            schemas.GRID_DIMENSION,
            dict(
                type="integer",
                minimum=dimensions.GRID_UNIT,
                maximum=dimensions.MAX_GRID_AXIS,
                multipleOf=dimensions.GRID_UNIT,
            ),
        )
        timed = schemas.SEQUENCES["items"]["properties"]["frames"]
        self.assertEqual((timed["minItems"], timed["maxItems"]), (1, sheets.MAX_SEQUENCE_FRAMES))
        duration = timed["items"]["properties"]["duration_ms"]
        self.assertEqual(
            (duration["minimum"], duration["maximum"]),
            (sheets.MIN_DURATION_MS, sheets.MAX_DURATION_MS),
        )
        tools = {item["name"]: item["inputSchema"]["properties"] for item in schemas.TOOLS}
        for tool, field, limit in (
            ("edit_scene", "operations", authoring.MAX_OPERATIONS),
            ("edit_artwork_pixels", "writes", editable.MAX_PIXEL_WRITES),
            ("edit_artwork_raster", "operations", raster.MAX_OPERATIONS),
            ("edit_artwork_batch", "operations", workshop.MAX_BATCH_OPERATIONS),
            ("import_artwork_layers", "layers", layers.MAX_LAYERS),
        ):
            with self.subTest(tool=tool):
                self.assertEqual(
                    (tools[tool][field]["minItems"], tools[tool][field]["maxItems"]), (1, limit)
                )
        self.assertEqual(
            advertised["raster_operations"]["max_batch_operations"], raster.MAX_OPERATIONS
        )
        self.assertEqual(advertised["raster_operations"]["max_batch_pixel_work"], raster.MAX_WORK)
        self.assertEqual(advertised["max_pixel_read_pixels"], dimensions.MAX_READ_PIXELS)
        self.assertEqual(advertised["max_pixel_batch_bytes"], editable.MAX_BATCH)

    def test_actual_operation_boundaries_and_atomic_rejection(self):
        with tempfile.TemporaryDirectory() as root:
            project = Project.create(Path(root) / "project", "Limits")
            candidate = project.artwork.documents.create(
                "art", "Art", "sprite", 8, 8, project.catalog()["revision"]
            )
            original = copy.deepcopy(candidate)
            fill = dict(
                op="rectangle",
                rectangle=dict(x=0, y=0, width=1, height=1),
                rgba=[1, 2, 3, 0],
                filled=True,
            )
            pixel = dict(op="pixels", layer_id=None, writes=[])
            for count in (1, 128):
                raster.edit(candidate, [fill] * count)
                workshop.batch(candidate, [pixel] * count)
            for count in (0, 129):
                with self.assertRaisesRegex(ValueError, "1..128 raster"):
                    raster.edit(candidate, [fill] * count)
                with self.assertRaisesRegex(ValueError, "1..128 candidate"):
                    workshop.batch(candidate, [pixel] * count)
            editable.edit_pixels(candidate, [])  # Unlike operation batches, writes may be empty.
            with self.assertRaisesRegex(ValueError, "65536 pixel writes"):
                editable.edit_pixels(candidate, [None] * 65537)
            self.assertEqual(candidate, original)
            saved = project.scenes.create("Scene", 1, 1, 8, project.catalog()["revision"])
            scene = saved["scene"]
            document = project.catalog()["project"]
            scene_original = copy.deepcopy(scene)
            layer_id = tiled.scene_layers(scene)[0]["id"]
            operation = dict(op="update_layer", layer_id=layer_id, changes=dict(visible=True))
            for count in (1, 128):
                authoring.edit(scene, document, [operation] * count)
            for count in (0, 129):
                with self.assertRaisesRegex(ValueError, "1..128 operations"):
                    authoring.edit(scene, document, [operation] * count)
            erase = dict(op="erase_tiles", layer_id=layer_id, cells=[dict(x=0, y=0)] * 4096)
            authoring.edit(scene, document, [erase])
            # Repeated coordinates count as writes, even when the second operation is a no-op.
            extra = dict(op="erase_tiles", layer_id=layer_id, cells=[dict(x=0, y=0)])
            with self.assertRaisesRegex(ValueError, "4096 tile edits per atomic batch"):
                authoring.edit(scene, document, [erase, extra])
            self.assertEqual(scene, scene_original)

    def test_contractual_first_errors_remain_in_order(self):
        bad = descriptor(dict(frame_count=0, sequence_lengths=[1] * 65))
        with self.assertRaisesRegex(ValueError, "Use 1..128 frames"):
            editable.check_descriptor(bad)
        bad = descriptor(dict(sequence_lengths=[257], duration=0))
        with self.assertRaisesRegex(ValueError, "Use 1..256 timed frames"):
            editable.check_descriptor(bad)
        with self.assertRaisesRegex(ValueError, "Select 1..256 placements"):
            editable.check_placements([{}] * 257)
