"""Synthetic scene-skill replays through the actual bounded plugin profile.

Directory grants and inspection are synthetic: these checks establish canonical
data, preview resources and export/reopen behavior, not model image visibility.
"""

import base64
import copy
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from uuid import uuid4

from support.atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.adapters.plugin.selection import Selection
from gbc_scene_forge.adapters.plugin.session import PluginSession
from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.planning import blockout
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.scenes.authoring import snapshot


class PluginSceneWorkflows(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.project = Project.create(self.root / "project", "Scene recipes")
        runtime = self.root / "runtime"
        runtime.mkdir()
        self.selection = Selection(
            runtime, settings=self.root / "settings", cache=self.root / "cache"
        )
        self.session = PluginSession(self.selection, chooser=lambda _: self.project.root)
        self.session.call("plugin_status", {})
        self.session.call("plugin_choose_location", {"mode": "project"})
        self.available = set(self.session.call("capabilities", {})["tools"])

    def call(self, tool, **arguments):
        self.assertIn(tool, self.available)
        return self.session.call(tool, {"project": "project", **arguments})

    def catalog(self):
        return self.call("get_project")

    def guards(self, scene_id):
        loaded = self.call("get_scene", scene_id=scene_id)
        return dict(
            scene_id=scene_id,
            scene_revision=loaded["revision"],
            project_revision=loaded["project_revision"],
        )

    def create_plan(self, width=256):
        loaded = self.call(
            "create_blockout_scene",
            project_revision=self.catalog()["revision"],
            name="Room",
            options=dict(
                units="pixels", width=width, height=128, grid=8, camera_width=64, camera_height=64
            ),
        )
        return loaded["id"]

    def review(self, guards, scene):
        planning = self.call("review_blockout", **guards, scene=scene)
        self.assertEqual(planning["snapshot_revision"], snapshot(scene))
        self.assertIn(
            "<svg", self.session.read_artifact(planning["overview_resource"]["uri"])["text"]
        )
        artwork = self.call("review_artwork", **guards, scene=scene)
        self.assertEqual(artwork["snapshot_revision"], planning["snapshot_revision"])
        artifact = self.session.read_artifact(artwork["overview_resource"]["uri"])
        width, height, rgba = png.decode(base64.b64decode(artifact["blob"]), generic=True)
        self.assertEqual((width, height), (scene["width"] * scene["grid"], 128))
        return rgba

    def export_reopen(self, scene_id, expected):
        result = self.call(
            "export_bundle", project_revision=self.catalog()["revision"], scope="project"
        )
        artifact = self.session.read_artifact(result["resource"]["uri"])
        destination = self.root / "reopened"
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(artifact["blob"]))) as archive:
            archive.extractall(destination)
        reopened = Project(destination)
        self.assertEqual(reopened.scenes.load(scene_id)["scene"], expected)
        source = copy.deepcopy(self.catalog()["project"])
        exported = copy.deepcopy(reopened.catalog()["project"])
        files = source.pop("files")
        exported.pop("files")  # Export regenerates portable Tiled tilesets.
        self.assertEqual(exported, source)
        for path in files:
            if path.endswith(".png"):
                self.assertEqual(
                    (reopened.root / path).read_bytes(), (self.project.root / path).read_bytes()
                )
        # A fresh conversation can select the extracted portable project.
        fresh = PluginSession(self.selection, chooser=lambda _: destination)
        fresh.call("plugin_choose_location", {"mode": "project"})
        self.assertEqual(
            fresh.call("get_scene", dict(project="project", scene_id=scene_id))["scene"], expected
        )
        return reopened

    def test_artwork_free_plan_review_save_export_and_reopen(self):
        scene_id = self.create_plan()
        guards = self.guards(scene_id)
        original = self.call("get_scene", scene_id=scene_id)["scene"]
        definitions = self.catalog()["project"]["object_definitions"]["definitions"]
        roles = {
            next(f["default"] for f in d["fields"] if f["name"] == blockout.ROLE): d["id"]
            for d in definitions
        }
        candidate = self.call(
            "edit_scene",
            **guards,
            dry_run=True,
            operations=[
                dict(op="place", definition_id=roles["solid"], x=0, y=112, width=256, height=16),
                dict(op="place", definition_id=roles["spawn"], x=16, y=104),
                dict(op="place", definition_id=roles["exit"], x=240, y=104),
                dict(op="place", definition_id=roles["one_way"], x=96, y=64, width=64, height=8),
            ],
        )["scene"]
        self.assertEqual(self.call("get_scene", scene_id=scene_id)["scene"], original)
        self.assertFalse(any(self.review(guards, candidate)))  # No artwork was invented.
        saved = self.call("save_scene", **guards, scene=candidate)
        self.assertEqual(saved["scene"], candidate)
        self.export_reopen(scene_id, candidate)

    def test_existing_assets_preserve_plan_connections_and_reject_stale_save(self):
        for factory, folder in ((bundle, "tiles"), (sprite_bundle, "sprites")):
            path, _ = factory(self.root / folder)
            self.project.artwork.import_atlas(path, self.catalog()["revision"])
        scene_id = self.create_plan()
        spawn = next(
            d
            for d in self.catalog()["project"]["object_definitions"]["definitions"]
            if d["name"] == "Player spawn"
        )
        placed = self.call(
            "edit_scene",
            **self.guards(scene_id),
            operations=[dict(op="place", definition_id=spawn["id"], x=16, y=104)],
        )
        spawn_id = placed["allocated_object_ids"][0]
        scene = self.call("get_scene", scene_id=scene_id)["scene"]
        camera_id = scene["layers"][-1]["objects"][0]["id"]
        world = dict(
            version=1,
            positions={scene_id: dict(x=0, y=0)},
            connections=[
                dict(
                    id=str(uuid4()),
                    name="Preserve",
                    direction="one-way",
                    source=dict(scene=scene_id, object=camera_id),
                    destination=dict(scene=scene_id, object=spawn_id),
                )
            ],
        )
        self.project.planning.save_world(
            world, self.catalog()["revision"], {scene_id: self.guards(scene_id)["scene_revision"]}
        )
        guards = self.guards(scene_id)
        catalog = self.catalog()["project"]
        candidate = self.call(
            "edit_scene",
            **guards,
            dry_run=True,
            operations=[
                dict(
                    op="paint_tiles",
                    layer_id=scene["layers"][0]["id"],
                    cells=[dict(x=2, y=3, tile="terrain/earth/0/0")],
                )
            ],
        )["scene"]
        candidate["layers"].append(
            dict(
                id=candidate["next_layer_id"],
                type="objectgroup",
                name="Props",
                visible=True,
                objects=[
                    dict(
                        id=candidate["next_object_id"],
                        asset="actors/idle",
                        x=40,
                        y=48,
                        origin=[8, 23],
                    )
                ],
            )
        )
        candidate["next_layer_id"] += 1
        candidate["next_object_id"] += 1
        rgba = self.review(guards, candidate)
        # Tile coordinates are cells (16,24 px); sprite top-left is (32,25 px).
        self.assertEqual(rgba[(24 * 256 + 16) * 4 + 3], 255)
        self.assertEqual(rgba[(29 * 256 + 36) * 4 : (29 * 256 + 36) * 4 + 4], bytes([255] * 4))
        self.assertEqual(candidate["layers"][1:-1], scene["layers"][1:])
        self.assertEqual(self.call("get_scene", scene_id=scene_id)["scene"], scene)
        # Simulate another writer moving the camera. The stale candidate must not replace it.
        self.call(
            "edit_scene",
            **guards,
            operations=[dict(op="update", object_id=camera_id, changes=dict(x=8))],
        )
        with self.assertRaises(Conflict):
            self.call("save_scene", **guards, scene=candidate)
        current = self.call("get_scene", scene_id=scene_id)["scene"]
        candidate["layers"][-2] = copy.deepcopy(current["layers"][-1])
        guards = self.guards(scene_id)
        self.review(guards, candidate)
        self.call("save_scene", **guards, scene=candidate)
        self.assertEqual(self.catalog()["project"]["world"], world)
        self.assertEqual(self.catalog()["project"]["atlases"], catalog["atlases"])
        self.export_reopen(scene_id, candidate)

    def test_plugin_created_artwork_scene_export_preflight_and_reopen(self):
        scene_id = self.create_plan()
        stale = self.guards(scene_id)
        candidate = self.call(
            "create_artwork",
            project_revision=stale["project_revision"],
            atlas_id="beacon",
            name="Beacon",
            kind="sprite",
            width=8,
            height=8,
            compact=True,
        )
        candidate = self.call(
            "edit_artwork_pixels",
            candidate=candidate,
            patch=dict(
                rectangle=dict(x=0, y=0, width=8, height=8),
                rgba=base64.b64encode(bytes([255, 180, 60, 255]) * 64).decode(),
            ),
        )
        review = self.call("review_artwork_candidate", candidate=candidate)
        self.call("commit_artwork", candidate=candidate, receipt=review["receipt"])
        catalog = self.catalog()
        region = catalog["project"]["atlases"]["beacon"]["manifest"]["regions"][0]
        loaded = self.call("get_scene", scene_id=scene_id)
        scene = copy.deepcopy(loaded["scene"])
        layer = next(layer for layer in scene["layers"] if layer["type"] == "objectgroup")
        layer["objects"].append(
            dict(
                id=scene["next_object_id"],
                asset=f"beacon/{region['name']}",
                x=40,
                y=48,
            )
        )
        scene["next_object_id"] += 1
        with self.assertRaises(Conflict):
            self.call("save_scene", **stale, scene=scene)
        guards = self.guards(scene_id)
        self.assertTrue(any(self.review(guards, scene)))
        self.call("save_scene", **guards, scene=scene)
        result = self.call("export_bundle", **self.guards(scene_id), scope="scene")
        encoded = self.session.read_artifact(result["resource"]["uri"])["blob"]
        destination = Project.create(self.root / "imported", "Reopen scene")
        revision = destination.catalog()["revision"]
        report = destination.imports.forge(encoded, revision)
        self.assertTrue(report["compatible"], report["errors"])
        imported = destination.imports.forge(
            encoded, revision, dry_run=False, confirmation=report["confirmation"]
        )
        reopened = Project(destination.root).scenes.load(imported["imported"][0])["scene"]
        self.assertEqual((reopened["width"], reopened["height"], reopened["grid"]), (32, 16, 8))
        self.assertEqual(
            [layer["id"] for layer in reopened["layers"]],
            [layer["id"] for layer in scene["layers"]],
        )
        props = next(layer for layer in reopened["layers"] if layer["type"] == "objectgroup")[
            "objects"
        ]
        self.assertEqual((props[0]["x"], props[0]["y"]), (40, 48))
        imported_id = imported["imported"][0]
        source_image = self.call("review_artwork", **self.guards(scene_id))
        imported_image = destination.scenes.review_artwork(
            imported_id,
            destination.catalog()["revision"],
            destination.scenes.load(imported_id)["revision"],
        )
        self.assertEqual(
            base64.b64decode(
                self.session.read_artifact(source_image["overview_resource"]["uri"])["blob"]
            ),
            imported_image["overview_png"],
        )
        for tool in ("place_stamp", "save_stamp", "diagnostics", "palette_report", "review_scene"):
            self.assertNotIn(tool, self.available)
            with self.assertRaisesRegex(ValueError, "unavailable"):
                self.session.call(tool, {"project": "project"})
