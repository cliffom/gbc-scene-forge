"""Saved blockout decoration through bounded MCP intake and exact artwork views."""

import base64
import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from support.atlas_fixture import bundle, sprite_bundle

from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.scenes import rendering
from gbc_scene_forge.storage.transactions import Transactions


class ArtworkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.adapter = Adapter(self.root / "projects")
        created = self.adapter.call("create_project", dict(name="Art", starter="blockout"))
        self.loaded = self.adapter.call(
            "create_blockout_scene",
            dict(
                project="art",
                project_revision=created["revision"],
                name="Decorate",
                options=dict(width=128, height=64, grid=16, camera_width=32, camera_height=32),
            ),
        )
        self.project = Project(self.root / "projects/art")
        self.source, manifest = bundle(self.root / "input")
        # 16px tile made from four 8px palette cells, with asymmetric artwork.
        manifest["regions"] = [dict(name="floor", kind="tile", x=0, y=0, width=16, height=16)]
        manifest["animations"] = []
        manifest["cell_palettes"] = [0] * 4
        self.source.write_text(json.dumps(manifest))
        self.pixels = bytearray(bytes([0, 0, 0, 255]) * 256)
        self.pixels[0:4] = bytes([82, 82, 82, 255])
        self.pixels[4:8] = bytes([165, 165, 165, 255])
        (self.source.parent / "atlas.png").write_bytes(png.encode(16, 16, self.pixels))

    def upload(self, path=None):
        path = path or self.source
        return dict(
            name=path.name,
            manifest=path.read_text(),
            png=base64.b64encode((path.parent / "atlas.png").read_bytes()).decode(),
        )

    def guard(self):
        return dict(project="art", project_revision=self.project.catalog()["revision"])

    def scene_guard(self):
        return dict(
            **self.guard(),
            scene_id=self.loaded["id"],
            scene_revision=self.project.scenes.load(self.loaded["id"])["revision"],
        )

    def image(self, resource):
        return png.decode(
            base64.b64decode(self.adapter.read_artifact(resource["uri"])["blob"]), generic=True
        )

    def snapshot(self):
        return {
            str(p.relative_to(self.project.root)): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file()
        }

    def test_import_decorate_reopen_review_reimport_export(self):
        before = self.snapshot()
        original = self.project.scenes.load(self.loaded["id"])["scene"]
        preflight = self.adapter.call(
            "import_atlas", dict(**self.guard(), bundle=self.upload(), dry_run=True)
        )
        self.assertEqual(preflight["added"], ["floor"])
        self.assertEqual(before, self.snapshot())
        imported = self.adapter.call("import_atlas", dict(**self.guard(), bundle=self.upload()))
        self.assertEqual(imported["project_revision"], self.guard()["project_revision"])
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], original)
        self.assertEqual(
            imported["scene_revisions"][self.loaded["id"]], self.scene_guard()["scene_revision"]
        )
        path, _ = sprite_bundle(self.root / "sprites")
        self.adapter.call("import_atlas", dict(**self.guard(), bundle=self.upload(path)))
        scene = copy.deepcopy(original)
        # Preserve every typed blockout object, add canonical tiles and a sprite layer.
        scene["layers"][0]["cells"][0][0] = "terrain/floor/0/0#5"
        scene["layers"][0]["cells"][0][1] = "terrain/floor/0/0"
        scene["layers"].append(
            dict(
                id=scene["next_layer_id"],
                type="objectgroup",
                name="Actors",
                visible=True,
                objects=[
                    dict(
                        id=scene["next_object_id"],
                        asset="actors/idle",
                        x=40,
                        y=24,
                        origin=[8, 23],
                    )
                ],
            )
        )
        scene["next_layer_id"] += 1
        scene["next_object_id"] += 1
        self.adapter.call("save_scene", dict(**self.scene_guard(), scene=scene))
        reopened = Adapter(self.project.root, single_project=True)
        guards = {**self.scene_guard(), "project": "project"}
        loaded = reopened.call("get_scene", dict(project="project", scene_id=self.loaded["id"]))
        self.assertEqual(loaded["scene"], scene)
        reopened.call("review_artwork", guards)
        report = self.adapter.call("review_artwork", self.scene_guard())
        self.assertEqual(report["scene_revision"], guards["scene_revision"])
        self.assertTrue(report["overview_complete"])
        self.assertEqual(self.image(report["camera_resource"])[:2], (32, 32))
        w, h, pixels = self.image(report["overview_resource"])
        self.assertEqual((w, h), (128, 64))
        self.assertEqual(pixels[15 * 4 : 16 * 4], bytes([82, 82, 82, 255]))
        self.assertEqual(pixels[(5 * w + 36) * 4 : (5 * w + 36) * 4 + 4], bytes([255] * 4))
        metadata = dict(terrain="floor", solid=True, shapes=[], next_shape_id=1)
        self.project.artwork.set_metadata(
            "terrain", "16", "terrain/floor/0/0", metadata, self.guard()["project_revision"]
        )
        old = self.scene_guard()
        (self.source.parent / "atlas.png").write_bytes(
            png.encode(16, 16, bytes([255, 255, 255, 255]) * 256)
        )
        changed = self.adapter.call(
            "import_atlas", dict(**self.guard(), bundle=self.upload(), reimport=True, dry_run=True)
        )
        self.assertTrue(changed["artwork_changed"])
        self.adapter.call("import_atlas", dict(**self.guard(), bundle=self.upload(), reimport=True))
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], scene)
        entry = self.project.catalog()["project"]["atlases"]["terrain"]
        self.assertEqual(entry["metadata"]["16"]["terrain/floor/0/0"], metadata)
        with self.assertRaises(Conflict):
            self.adapter.call("review_artwork", old)
        exported = self.adapter.call("export_bundle", dict(**self.scene_guard(), scope="scene"))
        raw = base64.b64decode(self.adapter.read_artifact(exported["resource"]["uri"])["blob"])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertIn("assets/terrain/grid-16/0.png", archive.namelist())
            native = json.loads(archive.read(f"scenes/{self.loaded['id']}.tmj"))
            self.assertEqual(tiled.decode(native, self.project.catalog()["project"]), scene)

    def test_invalid_stale_and_oversized_imports_preserve_project(self):
        for update in (
            dict(name="../escape.atlas.json"),
            dict(png="invalid"),
            dict(manifest="{}"),
            dict(png="A" * (4 * 1024 * 1024)),
        ):
            before = self.snapshot()
            with self.assertRaises(ValueError):
                self.adapter.call(
                    "import_atlas", dict(**self.guard(), bundle={**self.upload(), **update})
                )
            self.assertEqual(before, self.snapshot())
        stale = self.guard()
        self.adapter.call("import_atlas", dict(**stale, bundle=self.upload()))
        before = self.snapshot()
        with self.assertRaises(Conflict):
            self.adapter.call("import_atlas", dict(**stale, bundle=self.upload(), reimport=True))
        incompatible = json.loads(self.source.read_text())
        incompatible["regions"][0]["name"] = "replacement"
        with self.assertRaisesRegex(ValueError, "Incompatible reimport"):
            self.adapter.call(
                "import_atlas",
                dict(
                    **self.guard(),
                    reimport=True,
                    bundle={**self.upload(), "manifest": json.dumps(incompatible)},
                ),
            )
        self.assertEqual(before, self.snapshot())
        with self.assertRaises(ValueError):
            self.adapter.call(
                "import_atlas", dict(**self.guard(), bundle=self.upload(), dry_run="yes")
            )

    def test_scene_race_at_commit_does_not_partially_import(self):
        before = self.snapshot()
        path = self.project.root / "scenes" / f"{self.loaded['id']}.tmj"
        original_apply = Transactions.apply

        def concurrent_write(transaction, *args, **kwargs):
            path.write_bytes(path.read_bytes() + b" ")
            return original_apply(transaction, *args, **kwargs)

        with patch.object(Transactions, "apply", concurrent_write), self.assertRaises(Conflict):
            self.adapter.call("import_atlas", dict(**self.guard(), bundle=self.upload()))
        after = self.snapshot()
        self.assertEqual(set(after), set(before))
        for name, data in before.items():
            self.assertEqual(
                after[name], data + b" " if name == f"scenes/{self.loaded['id']}.tmj" else data
            )

    def test_view_limits_conflicts_and_external_asset_edits(self):
        self.adapter.call("import_atlas", dict(**self.guard(), bundle=self.upload()))
        before = self.snapshot()
        for extra in (
            dict(overview=dict(x=0, y=0, width=1025, height=1)),
            dict(overview=dict(x=True, y=0, width=1, height=1)),
            dict(overview=dict(x=128, y=0, width=1, height=1)),
            dict(camera_id=999),
            dict(scene_revision="0" * 64),
            dict(project_revision=None),
        ):
            with self.assertRaises(ValueError):
                self.adapter.call("review_artwork", {**self.scene_guard(), **extra})
        self.assertEqual(before, self.snapshot())
        guards = self.scene_guard()

        def external(*args):
            path = self.project.root / "assets/terrain/atlas.png"
            path.write_bytes(b"changed")
            return b"png"

        with patch.object(rendering, "render", side_effect=external), self.assertRaises(Conflict):
            self.adapter.call("review_artwork", guards)
        self.assertFalse(self.adapter.artifacts)

    def test_bounded_overview_is_explicit_and_can_page(self):
        loaded = self.project.scenes.create("Large", 256, 64, 16, self.guard()["project_revision"])
        camera = copy.deepcopy(self.loaded["scene"]["layers"][-1])
        scene = loaded["scene"]
        scene["layers"] = tiled.scene_layers(scene)
        scene.pop("cells", None)
        scene.pop("objects", None)
        scene["next_layer_id"] = max(layer["id"] for layer in scene["layers"]) + 1
        camera["id"] = scene["next_layer_id"]
        scene["layers"].append(camera)
        scene["next_layer_id"] += 1
        scene["next_object_id"] = 2
        self.project.scenes.save(
            loaded["id"], scene, loaded["revision"], self.guard()["project_revision"]
        )
        self.loaded = loaded
        report = self.adapter.call("review_artwork", self.scene_guard())
        self.assertFalse(report["overview_complete"])
        self.assertEqual(report["overview"]["width"], 1024)
        report = self.adapter.call(
            "review_artwork",
            dict(**self.scene_guard(), overview=dict(x=1024, y=0, width=1024, height=1024)),
        )
        self.assertEqual(report["overview"]["x"], 1024)

    def mixed_scene(self):
        from gbc_scene_forge.planning import blockout

        self.adapter.call("import_atlas", dict(**self.guard(), bundle=self.upload()))
        source, _ = sprite_bundle(self.root / "sprites")
        self.adapter.call("import_atlas", dict(**self.guard(), bundle=self.upload(source)))
        model = self.project.scenes.load(self.loaded["id"])["scene"]
        model["layers"][0]["cells"][0][0] = "terrain/floor/0/0"
        definitions = self.project.catalog()["project"]["object_definitions"]["definitions"]
        for role, name, x in (
            ("solid", "Ground", 0),
            ("enemy", "Enemy start", 16),
            ("patrol", "Activity bounds", 32),
            ("note", "Design note", 64),
        ):
            definition = next(
                d
                for d in definitions
                if any(
                    f["name"] == "blockout_role" and f.get("default") == role for f in d["fields"]
                )
            )
            model, _ = blockout.place(
                model,
                self.project.catalog()["project"],
                definition["id"],
                x,
                32,
                name=name,
                layer_id=2,
            )
        objects = model["layers"][1]["objects"]
        for item in (
            dict(asset="actors/idle", x=8, y=24, name="Decoration"),
            dict(kind="point", x=20, y=20, name="Unclassified point"),
            dict(kind="rectangle", x=40, y=20, width=8, height=8, name="Unclassified rectangle"),
            dict(
                kind="rectangle",
                x=56,
                y=20,
                width=8,
                height=8,
                name="Custom bounds",
                properties=[dict(name="forge_view", type="string", value="gameplay")],
            ),
        ):
            objects.append(dict(id=model["next_object_id"], **item))
            model["next_object_id"] += 1
        # Mixed layers and arbitrary names must not influence classification.
        model["layers"][1]["name"] = "Everything together"
        model["layers"][2]["visible"] = False
        model["layers"][2]["objects"] = [
            dict(id=model["next_object_id"], kind="point", x=0, y=0, name="Authored hidden")
        ]
        model["next_object_id"] += 1
        return self.adapter.call("save_scene", dict(**self.scene_guard(), scene=model))["scene"]

    def test_combined_filters_labels_embedded_artwork_and_exact_read_only_identity(self):
        import itertools
        import xml.etree.ElementTree as ET

        from gbc_scene_forge.scenes import authoring, view_filters

        model = self.mixed_scene()
        original = copy.deepcopy(model)
        before = self.snapshot()
        expected = {
            "Ground": "geometry",
            "Enemy start": "gameplay",
            "Activity bounds": "gameplay",
            "Design note": "guides",
            "Unclassified point": "gameplay",
            "Unclassified rectangle": "geometry",
            "Custom bounds": "gameplay",
        }
        for combination in itertools.product((False, True), repeat=5):
            choices = dict(zip(view_filters.CATEGORIES, combination))
            with self.subTest(filters=choices):
                result = self.adapter.call(
                    "review_scene", dict(**self.scene_guard(), filters=choices)
                )
                self.assertEqual(result["snapshot_revision"], authoring.snapshot(model))
                self.assertEqual(result["filters"], choices)
                self.assertEqual(result["scale"], 1)
                self.assertEqual(result["scene_revision"], self.scene_guard()["scene_revision"])
                self.assertTrue(result["includes_planning_overlays"])
                svg = self.adapter.read_artifact(result["overview_resource"]["uri"])["text"]
                tree = ET.fromstring(svg)
                self.assertEqual((tree.attrib["width"], tree.attrib["height"]), ("128", "64"))
                for name, category in expected.items():
                    self.assertEqual(name in svg, choices[category], name)
                self.assertNotIn("Authored hidden", svg)
                image = tree.find("{http://www.w3.org/2000/svg}image")
                w, h, pixels = png.decode(
                    base64.b64decode(image.attrib["href"].split(",")[1]), generic=True
                )
                self.assertEqual((w, h), (128, 64))
                self.assertEqual(
                    pixels[:4], bytes([82, 82, 82, 255]) if choices["tiles"] else bytes(4)
                )
                # Sprite's native origin places white artwork at (4,5).
                start = (5 * w + 4) * 4
                self.assertEqual(
                    pixels[start : start + 4],
                    bytes([255] * 4)
                    if choices["sprites"]
                    else bytes([0, 0, 0, 255])
                    if choices["tiles"]
                    else bytes(4),
                )
                camera = ET.fromstring(
                    self.adapter.read_artifact(result["camera_resource"]["uri"])["text"]
                )
                self.assertEqual((camera.attrib["width"], camera.attrib["height"]), ("32", "32"))
        self.assertEqual(model, original)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.project.scenes.load(self.loaded["id"])["scene"], model)
        # Portable export still contains all categories and authored hidden content.
        exported = self.adapter.call("export_bundle", dict(**self.scene_guard(), scope="scene"))
        data = base64.b64decode(self.adapter.read_artifact(exported["resource"]["uri"])["blob"])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            decoded = tiled.decode(
                json.loads(archive.read(f"scenes/{self.loaded['id']}.tmj")),
                self.project.catalog()["project"],
            )
        self.assertEqual(decoded, model)

    def test_combined_candidate_stale_guards_limits_and_existing_review_contracts(self):
        from gbc_scene_forge.planning import blockout
        from gbc_scene_forge.scenes import authoring

        model = self.mixed_scene()
        guard = self.scene_guard()
        candidate = copy.deepcopy(model)
        candidate["layers"][1]["objects"][0]["name"] = "Candidate ground"
        before = self.snapshot()
        report = self.adapter.call(
            "review_scene", dict(**guard, scene=candidate, filters={"guides": False})
        )
        self.assertEqual(report["snapshot_revision"], authoring.snapshot(candidate))
        self.assertEqual(report["scene_revision"], guard["scene_revision"])
        self.assertEqual(self.snapshot(), before)
        for filters in ({"geometry": 1}, {"unknown": True}, []):
            with self.assertRaises(ValueError):
                self.adapter.call("review_scene", dict(**guard, filters=filters))
        with self.assertRaisesRegex(ValueError, "1024"):
            self.adapter.call(
                "review_scene", dict(**guard, overview=dict(x=0, y=0, width=1025, height=1))
            )
        oversized = copy.deepcopy(candidate)
        oversized["layers"][1]["objects"] *= 600
        # Isolate the SVG work bound from normal identity validation.
        with self.assertRaisesRegex(ValueError, "4096"):
            blockout.render_svg(oversized, self.project.catalog()["project"], artwork=b"")
        png_report = self.adapter.call("review_artwork", guard)
        self.assertFalse(png_report["includes_planning_overlays"])
        self.assertEqual(png_report["camera_resource"]["mimeType"], "image/png")
        blockout_report = self.adapter.call("review_blockout", guard)
        self.assertFalse(blockout_report["includes_artwork"])
        self.assertNotIn(
            "data:image/png",
            self.adapter.read_artifact(blockout_report["camera_resource"]["uri"])["text"],
        )
        path = self.project.root / f"scenes/{self.loaded['id']}.tmj"
        original = path.read_bytes()
        render = rendering.render

        def race(*args, **kwargs):
            path.write_bytes(original + b"\n")
            return render(*args, **kwargs)

        with patch.object(rendering, "render", race), self.assertRaises(Conflict):
            self.adapter.call("review_scene", dict(**guard, scene=candidate))
        with self.assertRaises(Conflict):
            self.adapter.call("review_scene", dict(**guard, scene=candidate))


class RasterTests(unittest.TestCase):
    def test_all_orthogonal_flags_visibility_order_and_alpha(self):
        pixels = bytes([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0])
        project = dict(
            atlases=dict(
                a=dict(
                    png="a.png",
                    manifest=dict(
                        regions=[dict(name="r", kind="tile", x=0, y=0, width=2, height=2)]
                    ),
                )
            )
        )
        view = dict(x=0, y=0, width=2, height=2)
        for flags in range(8):
            scene = dict(
                grid=2,
                width=1,
                height=1,
                layers=[
                    dict(
                        type="tilelayer",
                        visible=True,
                        cells=[[f"a/r/0/0#{flags}" if flags else "a/r/0/0"]],
                    )
                ],
            )
            result = png.decode(
                rendering.render(
                    scene, project, {"a.png": png.encode(2, 2, pixels)}.__getitem__, view
                ),
                generic=True,
            )[2]
            for y in range(2):
                for x in range(2):
                    dx, dy = (y, x) if flags & 4 else (x, y)
                    if flags & 1:
                        dx = 1 - dx
                    if flags & 2:
                        dy = 1 - dy
                    src, dst = (y * 2 + x) * 4, (dy * 2 + dx) * 4
                    self.assertEqual(result[dst : dst + 4], pixels[src : src + 4])
        layer = scene["layers"][0]
        layer["cells"] = [["a/r/0/0"]]
        scene["layers"].append(copy.deepcopy(layer))
        scene["layers"].append(dict(**{**layer, "visible": False}))
        result = png.decode(
            rendering.render(scene, project, {"a.png": png.encode(2, 2, pixels)}.__getitem__, view),
            generic=True,
        )[2]
        self.assertEqual(result[4:8], bytes([0, 255, 0, 192]))
        # Later visible layers cover earlier layers, including clipped sprite origins.
        project["atlases"]["a"]["manifest"]["regions"].append(
            dict(name="sprite", kind="sprite", x=0, y=0, width=2, height=2, origin=[1, 1])
        )
        scene["layers"].append(
            dict(type="objectgroup", visible=True, objects=[dict(asset="a/sprite", x=0, y=1)])
        )
        result = png.decode(
            rendering.render(scene, project, {"a.png": png.encode(2, 2, pixels)}.__getitem__, view),
            generic=True,
        )[2]
        self.assertEqual(result[:4], bytes([127, 128, 0, 255]))
        with (
            patch.object(rendering, "MAX_SOURCE_PIXELS", 0),
            self.assertRaisesRegex(ValueError, "source pixels"),
        ):
            rendering.render(scene, project, {"a.png": png.encode(2, 2, pixels)}.__getitem__, view)
        with (
            patch.object(rendering, "MAX_WORK", 1),
            self.assertRaisesRegex(ValueError, "composited"),
        ):
            rendering.render(scene, project, {"a.png": png.encode(2, 2, pixels)}.__getitem__, view)
