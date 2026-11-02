"""The SDK workshop must retain concurrent scene edits when placing new artwork."""

import asyncio
import importlib.util
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project.application import Project


@unittest.skipUnless(importlib.util.find_spec("mcp"), "Install optional MCP SDK")
class ArtworkWorkshopTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        example = Path(__file__).resolve().parents[3] / "examples/mcp/artwork_workshop.py"
        self.workshop = runpy.run_path(str(example))["workshop"]

    def args(self, name):
        return SimpleNamespace(
            root=self.folder / name / "projects",
            output=self.folder / name / "output",
            asset=None,
        )

    def test_seed_places_both_assets_after_artwork_map_reencoding(self):
        result = asyncio.run(self.workshop(self.args("normal")))
        project = Project(Path(result["project"]))
        layers = tiled.scene_layers(project.scenes.load(result["scene_id"])["scene"])
        self.assertEqual(layers[0]["cells"][0][0], "moss/artwork/0/0")
        self.assertEqual([o["asset"] for o in layers[1]["objects"]], ["lantern/artwork"] * 2)

    def test_competing_scene_save_or_map_edit_is_not_overwritten(self):
        from mcp import ClientSession

        call_tool = ClientSession.call_tool
        for race in ("saved", "map_only"):
            with self.subTest(race=race):
                args = self.args(race)
                winner = {}
                placement_responses = []

                async def competing_call(client, name, arguments, *positional, **kwargs):
                    response = await call_tool(client, name, arguments, *positional, **kwargs)
                    if name == "commit_artwork" and arguments["candidate"]["atlas_id"] == "lantern":
                        self.assertFalse(response.isError, response.content)
                        project = Project(args.root / arguments["project"])
                        scene_id = project.catalog()["project"]["scenes"][0]["id"]
                        loaded = project.scenes.load(scene_id)
                        if race == "saved":
                            model = loaded["scene"]
                            tiled.scene_layers(model)[0]["cells"][0][0] = ""
                            project.scenes.save(
                                scene_id, model, loaded["revision"], project.catalog()["revision"]
                            )
                        else:
                            # Simulate an external Tiled writer without a project revision change.
                            path = project.root / f"scenes/{scene_id}.tmj"
                            document = json.loads(path.read_bytes())
                            document["layers"][0]["data"][0] = 0
                            path.write_text(json.dumps(document))
                        winner.update(
                            project=project,
                            loaded=project.scenes.load(scene_id),
                        )
                    elif name == "save_scene" and winner:
                        placement_responses.append(response)
                    return response

                with patch.object(ClientSession, "call_tool", competing_call):
                    # The transport may wrap the workshop's error in an exception group.
                    with self.assertRaises(Exception):
                        asyncio.run(self.workshop(args))
                self.assertEqual(len(placement_responses), 1)
                response = placement_responses[0]
                self.assertTrue(response.isError, response.content)
                self.assertEqual(response.structuredContent["error"]["code"], "conflict")
                self.assertEqual(
                    winner["project"].scenes.load(winner["loaded"]["id"]), winner["loaded"]
                )
