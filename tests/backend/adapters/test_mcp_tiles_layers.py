"""Atomic saved tile/layer authoring, native validation and revision protection."""

import copy
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from support.atlas_fixture import bundle

from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.scenes import authoring


class TileLayerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.adapter = Adapter(self.root / "projects")
        created = self.adapter.call("create_project", dict(name="Tiles", starter="blockout"))
        self.project = Project(self.root / "projects/tiles")
        self.loaded = self.adapter.call(
            "create_blockout_scene",
            dict(
                project="tiles",
                project_revision=created["revision"],
                name="Small",
                options=dict(width=32, height=32, camera_width=16, camera_height=16),
            ),
        )
        source, _ = bundle(self.root / "art")
        self.project.artwork.import_atlas(source, self.project.catalog()["revision"])
        self.tile_id = self.loaded["scene"]["layers"][0]["id"]

    def args(self):
        return dict(
            project="tiles",
            project_revision=self.project.catalog()["revision"],
            scene_id=self.loaded["id"],
            scene_revision=self.project.scenes.load(self.loaded["id"])["revision"],
        )

    def edit(self, operations, **options):
        return self.adapter.call("edit_scene", {**self.args(), "operations": operations, **options})

    def test_paint_erase_and_dry_run_preserve_other_content(self):
        original = self.project.scenes.load(self.loaded["id"])
        operations = [
            dict(
                op="paint_tiles",
                layer_id=self.tile_id,
                cells=[
                    dict(x=0, y=0, tile="terrain/earth/0/0"),
                    dict(x=3, y=3, tile="terrain/stone/0/0#1"),
                ],
            )
        ]
        preview = self.edit(operations, dry_run=True)
        self.assertEqual(self.project.scenes.load(self.loaded["id"]), original)
        self.assertEqual(preview["changes"]["tile_change_count"], 2)
        self.assertEqual(preview["changes"]["object_change_count"], 0)
        self.assertEqual(preview["changes"]["changed_layer_ids"], [self.tile_id])
        self.assertEqual(
            preview["changes"]["tile_changes"][1],
            dict(layer_id=self.tile_id, x=3, y=3, before="", after="terrain/stone/0/0#1"),
        )
        saved = self.edit(operations)
        self.assertEqual(saved["scene"], preview["scene"])
        self.assertEqual(saved["scene"]["layers"][1:], original["scene"]["layers"][1:])
        self.assertEqual(
            Project(self.project.root).scenes.load(saved["id"])["scene"], saved["scene"]
        )
        erased = self.edit([dict(op="erase_tiles", layer_id=self.tile_id, cells=[dict(x=0, y=0)])])
        self.assertEqual(erased["changes"]["tile_change_count"], 1)
        self.assertEqual(erased["scene"]["layers"][0]["cells"][3][3], "terrain/stone/0/0#1")
        self.assertEqual(erased["scene"]["layers"][0]["cells"][0][0], "")

    def test_layer_creation_update_reorder_delete_and_ids(self):
        original = self.loaded["scene"]
        next_id = original["next_layer_id"]
        preview = self.edit(
            [
                dict(op="create_layer", type="tilelayer", name="Overlay", index=0, visible=False),
                dict(op="create_layer", type="objectgroup", name="Props"),
                dict(
                    op="update_layer", layer_id=next_id, changes=dict(name="Details", visible=True)
                ),
                dict(op="move_layer", layer_id=next_id, index=2),
                dict(
                    op="paint_tiles",
                    layer_id=next_id,
                    cells=[dict(x=1, y=2, tile="terrain/earth/0/0")],
                ),
            ],
            dry_run=True,
        )
        self.assertEqual(preview["allocated_layer_ids"], [next_id, next_id + 1])
        self.assertEqual(preview["scene"]["next_object_id"], original["next_object_id"])
        self.assertEqual(preview["scene"]["layers"][2]["name"], "Details")
        self.assertTrue(preview["scene"]["layers"][2]["visible"])
        self.assertEqual(preview["scene"]["layers"][-1]["objects"], [])
        self.assertEqual(preview["changes"]["after_layer_order"][2], next_id)
        details = next(
            change for change in preview["changes"]["layer_changes"] if change["id"] == next_id
        )
        self.assertIsNone(details["before"])
        self.assertEqual(
            details["after"], dict(name="Details", type="tilelayer", visible=True, index=2)
        )
        self.adapter.call("save_scene", {**self.args(), "scene": preview["scene"]})
        result = self.edit([dict(op="delete_layer", layer_id=next_id)])
        self.assertEqual(result["changes"]["tile_change_count"], 1)
        self.assertNotIn(next_id, result["changes"]["after_layer_order"])
        added = self.edit([dict(op="create_layer", type="tilelayer", name="Replacement")])
        self.assertEqual(added["allocated_layer_ids"], [next_id + 2])
        self.assertEqual(added["scene"]["next_layer_id"], next_id + 3)

    def test_reordering_reports_content_unchanged_layers(self):
        before = self.loaded["scene"]["layers"]
        result = self.edit([dict(op="move_layer", layer_id=before[0]["id"], index=len(before) - 1)])
        self.assertEqual(result["changes"]["changed_layer_ids"], sorted(v["id"] for v in before))
        self.assertEqual(result["changes"]["object_change_count"], 0)
        self.assertEqual(result["changes"]["tile_change_count"], 0)
        self.assertEqual(result["scene"]["layers"][-1], before[0])

    def test_invalid_batches_are_atomic_including_overwritten_bad_cells(self):
        original = self.project.scenes.load(self.loaded["id"])
        object_layer = self.loaded["scene"]["layers"][-1]["id"]
        bad_operations = [
            dict(op="paint_tiles", layer_id=9999, cells=[dict(x=0, y=0, tile="")]),
            dict(op="paint_tiles", layer_id=object_layer, cells=[dict(x=0, y=0, tile="")]),
            *[
                dict(op="paint_tiles", layer_id=self.tile_id, cells=[dict(x=x, y=y, tile=tile)])
                for x, y, tile in [
                    (-1, 0, ""),
                    (4, 0, ""),
                    (0, 4, ""),
                    (True, 0, ""),
                    (0, 0.5, ""),
                    (0, 0, "missing/tile"),
                    (0, 0, None),
                ]
            ],
            dict(
                op="paint_tiles",
                layer_id=self.tile_id,
                cells=[dict(x=0, y=0, tile="bad"), dict(x=0, y=0, tile="")],
            ),
            dict(op="erase_tiles", layer_id=self.tile_id, cells=[]),
            dict(op="erase_tiles", layer_id=self.tile_id, cells=[dict(x=0, y=0, tile="")]),
            dict(op="create_layer", type="group", name="Unsupported"),
            dict(op="create_layer", type="tilelayer", name=" "),
            dict(op="create_layer", type="tilelayer", name="Bad", visible=1),
            dict(op="create_layer", type="tilelayer", name="Bad", index=999),
            dict(op="update_layer", layer_id=self.tile_id, changes=dict(type="objectgroup")),
            dict(op="update_layer", layer_id=self.tile_id, changes={}),
            dict(op="move_layer", layer_id=self.tile_id, index=True),
            dict(op="delete_layer", layer_id=False),
        ]
        for bad in bad_operations:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.edit([dict(op="create_layer", name="Temporary", type="objectgroup"), bad])
            self.assertEqual(self.project.scenes.load(self.loaded["id"]), original)

    def test_cell_budget_is_per_batch_and_summaries_are_bounded(self):
        cell = dict(x=0, y=0, tile="terrain/earth/0/0")
        operation = dict(op="paint_tiles", layer_id=self.tile_id, cells=[cell] * 2049)
        with self.assertRaisesRegex(ValueError, "4096"):
            self.edit([operation, operation])
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], self.loaded["scene"])
        self.edit([{**operation, "cells": [cell] * 4096}])
        before = copy.deepcopy(self.loaded["scene"])
        after = copy.deepcopy(before)
        for scene in (before, after):
            scene.update(width=16, height=16)
            scene["layers"][0]["cells"] = [[""] * 16 for _ in range(16)]
        after["layers"][0]["cells"] = [["terrain/earth/0/0"] * 16 for _ in range(16)]
        summary = authoring.changes(before, after)
        self.assertEqual(summary["tile_change_count"], 256)
        self.assertEqual(len(summary["tile_changes"]), 128)
        self.assertTrue(summary["tile_changes_truncated"])

    def test_flat_scene_support_and_final_layer_protection(self):
        plain = self.adapter.call(
            "create_scene",
            dict(
                project="tiles",
                project_revision=self.args()["project_revision"],
                name="Plain",
                width=4,
                height=4,
                grid=8,
            ),
        )
        self.loaded = plain
        self.assertNotIn("layers", plain["scene"])
        result = self.edit(
            [dict(op="paint_tiles", layer_id=1, cells=[dict(x=2, y=1, tile="terrain/earth/0/0")])]
        )
        self.assertEqual(result["scene"]["cells"][1][2], "terrain/earth/0/0")
        with self.assertRaisesRegex(ValueError, "at least one layer"):
            self.edit([dict(op="delete_layer", layer_id=1)])
        self.edit([dict(op="create_layer", type="objectgroup", name="Props")])
        result = self.edit([dict(op="delete_layer", layer_id=1)])
        self.assertEqual(result["scene"]["layers"][0]["type"], "objectgroup")

    def test_wrong_grid_tile_is_rejected_and_repeated_cells_have_net_summary(self):
        plain = self.adapter.call(
            "create_scene",
            dict(
                project="tiles",
                project_revision=self.args()["project_revision"],
                name="Large grid",
                width=2,
                height=2,
                grid=16,
            ),
        )
        self.loaded = plain
        with self.assertRaisesRegex(ValueError, "Unknown tile"):
            self.edit(
                [
                    dict(
                        op="paint_tiles",
                        layer_id=1,
                        cells=[dict(x=0, y=0, tile="terrain/earth/0/0")],
                    )
                ]
            )
        self.assertEqual(self.project.scenes.load(plain["id"])["revision"], plain["revision"])
        # Empty writes are valid even with no tile artwork for this grid.
        result = self.edit(
            [
                dict(
                    op="paint_tiles",
                    layer_id=1,
                    cells=[dict(x=0, y=0, tile=""), dict(x=0, y=0, tile="")],
                )
            ]
        )
        self.assertEqual(result["changes"]["tile_change_count"], 0)
        self.assertEqual(result["changes"]["changed_layer_ids"], [])

    def test_empty_default_sprites_layer_survives_canonicalization_and_reopen(self):
        self.loaded = self.adapter.call(
            "create_scene",
            dict(
                project="tiles",
                project_revision=self.args()["project_revision"],
                name="Ground only",
                width=4,
                height=4,
                grid=8,
            ),
        )
        original = self.project.scenes.load(self.loaded["id"])
        self.assertNotIn("layers", original["scene"])
        operations = [dict(op="create_layer", type="objectgroup", name="Sprites", visible=True)]
        preview = self.edit(operations, dry_run=True)
        expected = dict(id=2, type="objectgroup", name="Sprites", visible=True, objects=[])
        self.assertEqual(tiled.scene_layers(preview["scene"])[-1], expected)
        self.assertEqual(preview["allocated_layer_ids"], [2])
        self.assertEqual(preview["scene"]["next_layer_id"], 3)
        self.assertEqual(self.project.scenes.load(self.loaded["id"]), original)
        saved = self.edit(operations)
        self.assertEqual(saved["scene"], preview["scene"])
        self.assertEqual(saved["allocated_layer_ids"], [2])
        reopened = Project(self.project.root).scenes.load(saved["id"])
        self.assertEqual(reopened["scene"], saved["scene"])
        followup = self.edit(
            [
                dict(op="update_layer", layer_id=2, changes=dict(visible=False)),
                dict(op="update_layer", layer_id=2, changes=dict(visible=True)),
                dict(op="create_layer", type="objectgroup", name="Props"),
            ]
        )
        self.assertEqual(followup["allocated_layer_ids"], [3])
        self.assertEqual(followup["scene"]["layers"][1], expected)
        self.assertEqual(followup["scene"]["next_layer_id"], 4)

    def test_project_and_scene_conflicts_cover_dry_runs(self):
        old = self.args()
        operation = dict(op="update_layer", layer_id=self.tile_id, changes=dict(name="Changed"))
        self.edit([operation])
        for dry_run in (False, True):
            with self.assertRaises(Conflict):
                self.adapter.call(
                    "edit_scene", {**old, "operations": [operation], "dry_run": dry_run}
                )
        old = self.args()
        self.project.scenes.create("Other", 4, 4, 8, old["project_revision"])
        for dry_run in (False, True):
            with self.assertRaises(Conflict):
                self.adapter.call(
                    "edit_scene", {**old, "operations": [operation], "dry_run": dry_run}
                )

    def test_linked_layer_deletion_remains_guarded(self):
        definitions = self.project.catalog()["project"]["object_definitions"]["definitions"]
        definition = next(d for d in definitions if d["name"] == "Solid ground")
        # Place a real native object, then reference it from a world connection.
        placed = self.edit(
            [
                dict(op="place", definition_id=definition["id"], x=0, y=0, width=8, height=8),
                dict(op="place", definition_id=definition["id"], x=8, y=0, width=8, height=8),
            ]
        )
        identity = placed["allocated_object_ids"][0]
        layer = next(
            v
            for v in placed["scene"]["layers"]
            if any(o["id"] == identity for o in v.get("objects", []))
        )
        endpoint = dict(scene=self.loaded["id"], object=identity)
        world = dict(
            version=1,
            positions={},
            connections=[
                dict(
                    id=str(uuid4()),
                    name="Link",
                    direction="one-way",
                    source=endpoint,
                    destination=dict(
                        scene=self.loaded["id"], object=placed["allocated_object_ids"][1]
                    ),
                )
            ],
        )
        self.project.planning.save_world(
            world, self.args()["project_revision"], {self.loaded["id"]: placed["revision"]}
        )
        with self.assertRaisesRegex(ValueError, "linked objects"):
            self.edit([dict(op="delete_layer", layer_id=layer["id"])])
        self.assertEqual(self.project.scenes.load(placed["id"])["scene"], placed["scene"])

    def test_layer_and_identity_limits_do_not_partially_write(self):
        scene = copy.deepcopy(self.loaded["scene"])
        scene["next_layer_id"] = 2147483647
        saved = self.adapter.call("save_scene", {**self.args(), "scene": scene})
        with self.assertRaises(ValueError):
            self.edit([dict(op="create_layer", type="tilelayer", name="Exhausted")])
        self.assertEqual(self.project.scenes.load(saved["id"])["scene"], saved["scene"])
        scene = copy.deepcopy(self.loaded["scene"])
        while len(scene["layers"]) < 128:
            scene["layers"].append(
                dict(
                    id=scene["next_layer_id"],
                    type="objectgroup",
                    name="Props",
                    visible=True,
                    objects=[],
                )
            )
            scene["next_layer_id"] += 1
        self.adapter.call("save_scene", {**self.args(), "scene": scene})
        with self.assertRaisesRegex(ValueError, "128 layers"):
            self.edit([dict(op="create_layer", type="tilelayer", name="Too many")])
        tiled.check_scene(
            self.project.scenes.load(self.loaded["id"])["scene"], self.project.catalog()["project"]
        )
