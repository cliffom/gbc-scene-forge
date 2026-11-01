"""Bounded wide scenes through native persistence, MCP, drafts and Tiled."""

import base64
import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from uuid import uuid4

from support.atlas_fixture import bundle, image, sprite_bundle

from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import png
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.planning import blockout
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.drafts import Drafts
from gbc_scene_forge.scenes.dimensions import check_dimensions


class SceneDimensionTests(unittest.TestCase):
    def test_boundaries(self):
        for grid in (8, 16, 32):
            for width, height in ((8192 // grid, 1), (1, 8192 // grid), (256, 256)):
                check_dimensions(width, height, grid)
            for width, height in ((8192 // grid + 1, 1), (1, 8192 // grid + 1)):
                with self.assertRaisesRegex(ValueError, "8192 pixels"):
                    check_dimensions(width, height, grid)
        for width, height in ((512, 129), (257, 256)):
            with self.assertRaisesRegex(ValueError, "65536 cells"):
                check_dimensions(width, height, 8)
        for width in (True, 0, -1, 1.5, "480", None):
            with self.assertRaises(ValueError):
                check_dimensions(width, 9, 16)
        for units, width, height in (("pixels", 7680, 144), ("cells", 480, 9)):
            self.assertEqual(
                blockout.options(
                    dict(units=units, width=width, height=height, grid=16, camera_height=136)
                )["width"],
                480,
            )

    def test_mcp_drafts_far_edge_and_portable_export(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = Project.create(root / "world", "Wide", starter="blockout")
            path, _ = sprite_bundle(root / "sprites")
            project.artwork.import_atlas(path, project.catalog()["revision"])
            tiles, manifest = bundle(root / "tiles")
            manifest.update(
                regions=[dict(name="floor", kind="tile", x=0, y=0, width=16, height=16)],
                animations=[],
                cell_palettes=[0] * 4,
            )
            tiles.write_text(json.dumps(manifest))
            (tiles.parent / "atlas.png").write_bytes(image(16, 16))
            project.artwork.import_atlas(tiles, project.catalog()["revision"])
            adapter = Adapter(project.root, single_project=True)

            def guard(loaded=None):
                return dict(
                    project="project",
                    project_revision=project.catalog()["revision"],
                    **(
                        dict(scene_id=loaded["id"], scene_revision=loaded["revision"])
                        if loaded
                        else {}
                    ),
                )

            loaded = adapter.call(
                "create_scene", dict(**guard(), name="Wide", width=480, height=9, grid=16)
            )
            scene = loaded["scene"]
            scene["cells"][8][479] = "terrain/floor/0/0#3"
            scene["objects"] = [
                dict(id=1, asset="actors/idle", x=7664, y=32, origin=[8, 23]),
                dict(
                    id=2,
                    kind="point",
                    name="Exit",
                    **{"class": "trigger"},
                    x=7679,
                    y=143,
                    properties=[],
                ),
            ]
            camera = blockout.new_scene(
                project.catalog()["project"], dict(width=480, height=9, units="cells", grid=16)
            )["layers"][-1]["objects"][0]
            camera.update(id=3, x=7504)
            scene["objects"].append(camera)
            scene["next_object_id"] = 4
            saved = adapter.call("save_scene", dict(**guard(loaded), scene=scene))
            self.assertEqual(
                Project(project.root).scenes.load(saved["id"])["scene"], saved["scene"]
            )
            # Resize via the MCP canonical candidate, preserving coordinates.
            candidate = copy.deepcopy(saved["scene"])
            candidate["width"] = 512
            for row in candidate["cells"]:
                row.extend([""] * 32)
            drafts = Drafts(project.store)
            draft_id = str(uuid4())
            record = drafts.write(
                dict(
                    id=draft_id,
                    revision=None,
                    project_id=project.catalog()["project"]["id"],
                    name="Wide",
                    scene_id=saved["id"],
                    scene_revision=saved["revision"],
                    project_revision=project.catalog()["revision"],
                    scene=candidate,
                )
            )
            restored = drafts.restore(draft_id, record["revision"])
            self.assertEqual(restored["scene"], candidate)
            resized = adapter.call("save_scene", dict(**guard(saved), scene=candidate))
            self.assertEqual(resized["scene"]["objects"], saved["scene"]["objects"])
            exported = adapter.call("export_bundle", dict(**guard(resized), scope="scene"))
            data = base64.b64decode(adapter.read_artifact(exported["resource"]["uri"])["blob"])
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                tmj = json.loads(archive.read(f"scenes/{saved['id']}.tmj"))
            self.assertEqual(tiled.decode(tmj, project.catalog()["project"]), resized["scene"])
            # Default overview stays bounded; a far-edge view uses absolute pixels.
            review = adapter.call(
                "review_artwork",
                dict(**guard(resized), overview=dict(x=7600, y=0, width=592, height=144)),
            )
            review_png = base64.b64decode(
                adapter.read_artifact(review["overview_resource"]["uri"])["blob"]
            )
            w, h, pixels = png.decode(review_png, generic=True)
            self.assertEqual((w, h), (592, 144))
            self.assertEqual(pixels[(20 * w + 64) * 4 : (20 * w + 64) * 4 + 4], bytes([255] * 4))
            default = adapter.call("review_artwork", guard(resized))
            self.assertFalse(default["overview_complete"])
            self.assertEqual(review["camera"]["x"], 7504)
            self.assertLessEqual(default["overview"]["width"], 1024)
            before = project.catalog()["revision"]
            for width, height in ((513, 9), (512, 129)):
                with self.assertRaises(ValueError):
                    adapter.call(
                        "create_scene",
                        dict(**guard(), name="Invalid", width=width, height=height, grid=16),
                    )
            self.assertEqual(project.catalog()["revision"], before)
