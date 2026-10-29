"""Portable planning services, revision safety and independent browser/MCP-ready fixtures."""

import copy
import io
import json
import tempfile
import threading
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from atlas_fixture import bundle
from blockout_fixture import opening_forest

from gbc_scene_forge import blockout, tiled
from gbc_scene_forge.documents import Conflict
from gbc_scene_forge.projects import MANIFEST, Project
from gbc_scene_forge.standalone import make_root_handler
from gbc_scene_forge.workspaces import ProjectRoot


class BlockoutTests(unittest.TestCase):
    def test_vector_labels_are_bounded_nonoverlapping_and_escape_full_captions(self):
        candidates = [
            (4, 10, 10, 100, 80, f"Dense <caption> & marker {i}", "#abcdef") for i in range(1000)
        ]
        candidates.append((1, 10, 10, 100, 80, "Camera priority", "#abcdef"))
        svg = (
            "<svg>"
            + "".join(blockout.svg_labels(candidates, dict(x=0, y=0, width=160, height=136)))
            + "</svg>"
        )
        root = ElementTree.fromstring(svg)
        labels = root.findall("g")
        self.assertEqual(labels[0].find("title").text, "Camera priority")
        self.assertGreater(len(labels), 1)
        self.assertLess(len(labels), 160)
        rects = []
        for label in labels:
            rect = label.find("rect")
            x, y, w, h = (float(rect.attrib[k]) for k in ("x", "y", "width", "height"))
            self.assertTrue(0 <= x <= 160 - w and 0 <= y <= 136 - h)
            self.assertTrue(
                all(
                    x + w + 4 <= ox or ox + ow + 4 <= x or y + h + 4 <= oy or oy + oh + 4 <= y
                    for ox, oy, ow, oh in rects
                )
            )
            rects.append((x, y, w, h))
        self.assertIn("Dense <caption> & marker", " ".join(root.itertext()))
        self.assertEqual(
            blockout.svg_labels(candidates, dict(x=500, y=500, width=160, height=136)), []
        )

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = Project.create(self.root / "plan", "Level plan", starter="blockout")

    def test_starter_and_scene_are_native_and_require_no_artwork(self):
        document = self.project.catalog()["project"]
        self.assertEqual(document["atlases"], {})
        definitions = document["object_definitions"]["definitions"]
        self.assertEqual(len(definitions), len(blockout.PRESETS))
        self.assertEqual(len({d["id"] for d in definitions}), len(definitions))
        loaded = self.project.create_blockout_scene(
            "Forest", {}, self.project.catalog()["revision"]
        )
        scene = loaded["scene"]
        self.assertEqual((scene["width"], scene["height"], scene["grid"]), (120, 34, 8))
        self.assertEqual(len(scene["layers"]), 5)
        self.assertEqual(scene["next_object_id"], 2)
        self.assertEqual(self.project.load_scene(loaded["id"])["scene"], scene)
        path = self.project.root / "scenes" / f"{loaded['id']}.tmj"
        native = json.loads(path.read_bytes())
        self.assertEqual(native["tilesets"], [])
        camera = native["layers"][-1]["objects"][0]
        props = {p["name"]: p["value"] for p in camera["properties"]}
        self.assertEqual(props[blockout.ROLE], "camera")
        self.assertTrue(props["scroll_x"])
        self.assertFalse(props["scroll_y"])

    def test_units_options_and_atomic_initialization_on_existing_projects(self):
        empty = Project.create(self.root / "empty", "Existing")
        before = (empty.root / MANIFEST).read_bytes()
        bad = [
            dict(width=True),
            dict(width=961),
            dict(width=8193),
            dict(units="tiles"),
            dict(grid=4),
            dict(units="cells", width=257),
            dict(camera_width=0),
            dict(camera_height=273),
            dict(scroll_y=1),
            dict(unknown=True),
            [],
        ]
        for settings in bad:
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                empty.create_blockout_scene("Bad", settings, empty.catalog()["revision"])
            self.assertEqual((empty.root / MANIFEST).read_bytes(), before)
        scene = empty.create_blockout_scene(
            "Cells", dict(units="cells", width=120, height=34), empty.catalog()["revision"]
        )
        self.assertEqual(scene["scene"]["width"], 120)
        self.assertIn("object_definitions", empty.catalog()["project"])
        self.assertEqual(
            blockout.options(
                dict(width=8192, height=8192, grid=32, camera_width=1, camera_height=1)
            )["width"],
            256,
        )

    def test_presets_and_camera_defaults_are_project_configurable(self):
        doc = self.project.catalog()["project"]
        camera = next(
            d for d in doc["object_definitions"]["definitions"] if d["name"] == "Camera frame"
        )
        camera["width"], camera["height"] = 128, 128
        next(f for f in camera["fields"] if f["name"] == "scroll_y")["default"] = True
        self.project.save_object_definition(camera, self.project.catalog()["revision"])
        loaded = self.project.create_blockout_scene(
            "Custom", {}, self.project.catalog()["revision"]
        )
        camera = loaded["scene"]["layers"][-1]["objects"][0]
        self.assertEqual((camera["width"], camera["height"]), (128, 128))
        report = self.project.blockout_review(
            loaded["id"], self.project.catalog()["revision"], loaded["revision"]
        )
        self.assertTrue(report["camera_properties"]["scroll_y"])
        document = self.project.catalog()["project"]
        before = copy.deepcopy(document)
        blockout.initialize(document)
        self.assertEqual(document, before)

    def test_shared_place_is_validated_and_preserves_identity_and_inputs(self):
        loaded = self.project.create_blockout_scene("Plan", {}, self.project.catalog()["revision"])
        document, original = self.project.catalog()["project"], copy.deepcopy(loaded["scene"])
        solid = next(
            d for d in document["object_definitions"]["definitions"] if d["name"] == "Solid ground"
        )
        changed, object_id = blockout.place(
            original, document, solid["id"], 8, 8, width=40, height=16
        )
        self.assertEqual(object_id, 2)
        self.assertEqual(original, loaded["scene"])
        self.assertEqual(changed["next_object_id"], 3)
        self.assertEqual(changed["layers"][1]["objects"][0]["class"], solid["name"])
        self.assertEqual(changed["layers"][1]["objects"][0]["definition"], solid["id"])
        for args in ((9999, 8, 40), (8, 8, 0), (8, 8, 9999)):
            with self.subTest(args=args), self.assertRaises(ValueError):
                blockout.place(original, document, solid["id"], args[0], args[1], width=args[2])
        self.assertEqual(original, loaded["scene"])
        edge, _ = blockout.place(original, document, solid["id"], 952, 264, layer_id=4)
        self.assertEqual(edge["layers"][3]["objects"][0]["width"], 8)
        self.assertEqual(edge["layers"][3]["objects"][0]["height"], 8)
        with self.assertRaises(ValueError):
            blockout.place(original, document, solid["id"], 0, 0, properties={"invalid": True})
        with self.assertRaises(ValueError):
            blockout.place(original, document, solid["id"], "0", 0)

    def test_opening_forest_review_is_read_only_and_portable_with_later_artwork(self):
        loaded, identities = opening_forest(self.project)
        before = {
            p.relative_to(self.project.root): p.read_bytes()
            for p in self.project.root.rglob("*")
            if p.is_file()
        }
        report = self.project.blockout_review(
            loaded["id"], self.project.catalog()["revision"], loaded["revision"]
        )
        self.assertEqual(
            (report["width"], report["height"], report["screens_x"], report["screens_y"]),
            (960, 272, 6, 2),
        )
        self.assertEqual(report["camera"]["y"], 136)
        self.assertFalse(report["includes_artwork"])
        ns = {"s": "http://www.w3.org/2000/svg"}
        overview, camera = (
            ElementTree.fromstring(report["overview_svg"]),
            ElementTree.fromstring(report["camera_svg"]),
        )
        self.assertEqual(camera.attrib["viewBox"], "0 136 160 136")
        text = " ".join(e.text or "" for e in overview.findall(".//s:text", ns))
        self.assertIn("Red pool", " ".join(overview.itertext()))
        self.assertIn("ENTRY", text)
        self.assertIn("EXIT", text)
        self.assertIn("full stage length remains undecided", " ".join(overview.itertext()))
        self.assertIn("X scroll", text)
        self.assertEqual(
            {
                p.relative_to(self.project.root): p.read_bytes()
                for p in self.project.root.rglob("*")
                if p.is_file()
            },
            before,
        )
        old_scene = copy.deepcopy(loaded["scene"])
        source, _ = bundle(self.root / "art")
        self.project.import_atlas(source, self.project.catalog()["revision"])
        self.assertEqual(self.project.load_scene(loaded["id"])["scene"], old_scene)
        payload, _ = self.project.export_bundle("project", self.project.catalog()["revision"])
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            exported = json.loads(archive.read(f"scenes/{loaded['id']}.tmj"))
            document = json.loads(archive.read(MANIFEST))
        self.assertEqual(tiled.decode(exported, document), old_scene)
        self.assertIn(
            identities["Red pool"],
            [o["id"] for layer in old_scene["layers"] for o in layer.get("objects", [])],
        )

    def test_review_conflicts_unsaved_snapshot_and_hidden_layers(self):
        loaded, _ = opening_forest(self.project)
        revision = self.project.catalog()["revision"]
        changed = copy.deepcopy(loaded["scene"])
        changed["layers"][1]["objects"][0]["name"] = "Unsaved landing"
        report = self.project.blockout_review(loaded["id"], revision, loaded["revision"], changed)
        self.assertIn("Unsaved landing", report["overview_svg"])
        saved = self.project.blockout_review(loaded["id"], revision, loaded["revision"])
        self.assertNotEqual(saved["snapshot_revision"], report["snapshot_revision"])
        self.assertEqual(report["scene_id"], loaded["id"])
        self.assertNotIn("Unsaved landing", json.dumps(self.project.load_scene(loaded["id"])))
        changed["layers"][1]["visible"] = False
        self.assertNotIn(
            "Unsaved landing",
            self.project.blockout_review(loaded["id"], revision, loaded["revision"], changed)[
                "overview_svg"
            ],
        )
        changed["layers"][-1]["visible"] = False
        with self.assertRaisesRegex(ValueError, "camera"):
            self.project.blockout_review(loaded["id"], revision, loaded["revision"], changed)
        for project_revision, scene_revision in (
            ("stale", loaded["revision"]),
            (revision, "stale"),
        ):
            with self.assertRaises(Conflict):
                self.project.blockout_review(loaded["id"], project_revision, scene_revision)
        with self.assertRaises(ValueError):
            self.project.blockout_review(loaded["id"], revision, loaded["revision"], camera_id=True)

    def test_review_escapes_text_and_bounds_dense_work(self):
        loaded = self.project.create_blockout_scene("Plan", {}, self.project.catalog()["revision"])
        scene = loaded["scene"]
        camera = scene["layers"][-1]["objects"][0]
        camera["name"] = '<script>&"\x00'
        camera["properties"].append(
            dict(name=blockout.COLOR, type="string", value='red" onload="evil')
        )
        report = blockout.review(scene, self.project.catalog()["project"])
        ElementTree.fromstring(report["overview_svg"])
        self.assertNotIn("<script>", report["overview_svg"])
        self.assertNotIn("onload", report["overview_svg"])
        self.assertIn("#83cfc1", report["overview_svg"])
        for index in range(4200):
            item = {**copy.deepcopy(camera), "id": index + 2}
            scene["layers"][1 + index // 2100]["objects"].append(item)
        scene["next_object_id"] = 4202
        with self.assertRaisesRegex(ValueError, "4096 visible"):
            blockout.review(scene, self.project.catalog()["project"])

    def test_retained_camera_override_is_not_reported_as_fixed(self):
        loaded = self.project.create_blockout_scene("Plan", {}, self.project.catalog()["revision"])
        scene = loaded["scene"]
        camera = scene["layers"][-1]["objects"][0]
        camera["properties"][0] = dict(name="scroll_x", type="string", value="undecided")
        report = blockout.review(scene, self.project.catalog()["project"])
        self.assertIn("X unverified", report["overview_svg"])
        self.assertEqual(report["camera_properties"]["scroll_x"], "undecided")

    def test_climb_endpoints_follow_resized_region(self):
        item = dict(x=16, y=32, width=24, height=64)
        self.assertEqual(blockout.endpoint(item, {}, "entry"), (28, 96))
        self.assertEqual(
            blockout.endpoint(item, {"exit_edge": "right", "exit_offset": 0.25}, "exit"), (40, 48)
        )
        item["height"] = 128
        self.assertEqual(blockout.endpoint(item, {}, "entry"), (28, 160))


class BlockoutHttpTests(unittest.TestCase):
    def test_guarded_workspace_starter_create_and_snapshot_review(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "projects"
            server = ThreadingHTTPServer(("127.0.0.1", 0), make_root_handler(root, "secret"))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}"

                def request(path, body=None, token="secret"):
                    with urlopen(
                        Request(
                            url + path,
                            data=None if body is None else json.dumps(body).encode(),
                            headers={"Content-Type": "application/json", "X-Scene-Token": token},
                        ),
                        timeout=5,
                    ) as response:
                        return json.load(response)

                request("/api/create-project", dict(name="Forest", starter="blockout"))
                prefix = "/projects/forest/api/"
                document = request(prefix + "project")
                self.assertEqual(document["project"]["atlases"], {})
                body = dict(name="Plan", options={}, project_revision=document["revision"])
                with self.assertRaises(HTTPError) as error:
                    request(prefix + "create-blockout-scene", body, token="bad")
                self.assertEqual(error.exception.code, 403)
                loaded = request(prefix + "create-blockout-scene", body)
                revision = request(prefix + "project")["revision"]
                report_body = dict(
                    scene_id=loaded["id"],
                    project_revision=revision,
                    scene_revision=loaded["revision"],
                    scene=loaded["scene"],
                )
                report = request(prefix + "blockout-review", report_body)
                self.assertEqual(report["screens_x"], 6)
                with self.assertRaises(HTTPError) as error:
                    request(prefix + "blockout-review", {**report_body, "scene_revision": "stale"})
                self.assertEqual(error.exception.code, 409)
                self.assertEqual(len(ProjectRoot(root).catalog()["projects"]), 1)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
