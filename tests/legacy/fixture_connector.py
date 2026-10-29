"""Independent connector with no game, imaging library or atlas dependency."""

import base64
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

from gbc_scene_forge.legacy.contract import BuildPlan, CheckStep, Workspace
from gbc_scene_forge.legacy.documents import check_document


def png(width, height, pixel):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    raw = b"".join(
        b"\0" + b"".join(bytes(pixel(x, y)) for x in range(width)) for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


class FixtureConnector:
    identity = "fixture-grid"
    contract_version = 1

    def __init__(self, root, *, initialize=True):
        root = Path(root).absolute()
        self.workspace = Workspace(
            root, root / ".workshop/drafts", history=".workshop/history", reviews=".workshop/jobs"
        )
        self.path = root / "levels/room.json"
        if initialize and not self.path.exists():
            self.path.parent.mkdir(parents=True)
            self.path.write_text(
                json.dumps({"cells": [["blank"] * 7 for _ in range(5)], "flag": False})
            )

    def catalog(self):
        entries = [
            dict(
                id=name,
                label=label,
                family="tiles",
                rect=dict(x=i * 4, y=0, width=4, height=4),
                profiles=["workbench"],
            )
            for i, (name, label) in enumerate((("blank", "Empty"), ("solid", "Stone")))
        ]
        return {
            "contract_version": 1,
            "connector": self.identity,
            "project": {
                "name": "INDEPENDENT FIXTURE",
                "label": "Fixture workshop",
                "source_label": "FIXTURE PREVIEW",
            },
            "capabilities": {"apply": True, "export": True, "templates": True, "references": False},
            "profiles": {
                "workbench": {
                    "label": "Workbench",
                    "type": "grid",
                    "width": 7,
                    "height": 5,
                    "cell_size": 4,
                    "erase_cell": "blank",
                    "lighting": ["neutral"],
                    "states": [{"id": "standard", "label": "Standard"}],
                    "animation_frames": 0,
                    "guide": None,
                }
            },
            "families": [{"id": "tiles", "url": "/art/tiles", "regions": []}],
            "entries": entries,
        }

    def source_revision(self, target):
        if target != "workbench":
            raise ValueError("Unknown fixture target")
        return hashlib.sha256(self.path.read_bytes()).hexdigest()

    def load(self, target, *, template=False):
        data = json.loads(self.path.read_text())
        cells = [["blank"] * 7 for _ in range(5)] if template else data["cells"]
        return {
            "scene": dict(
                version=1,
                connector=self.identity,
                id="fixture",
                name="Fixture",
                profile=target,
                source_digest=self.source_revision(target),
                width=7,
                height=5,
                cells=cells,
                references=[],
                flag=data["flag"],
            ),
            "locked": [[0, 0]],
            "constraints": [{"x": 0, "y": 0, "reason": "Fixture anchor"}],
            "markers": [{"x": 0, "y": 0, "label": "A"}],
            "revision": None,
        }

    def normalize(self, scene):
        if scene.get("connector", self.identity) != self.identity:
            raise ValueError("Wrong connector")
        scene = dict(scene, connector=self.identity)
        self.check_shape(scene)
        return scene

    def check_shape(self, scene):
        check_document(scene)
        if scene["profile"] != "workbench" or (scene["width"], scene["height"]) != (7, 5):
            raise ValueError("Unknown fixture scene")
        if any(cell not in ("blank", "solid") for row in scene["cells"] for cell in row):
            raise ValueError("Unknown fixture cell")

    def compare(self, scene):
        current = json.loads(self.path.read_text())
        return {
            "differs": scene["cells"] != current["cells"]
            or scene.get("flag", False) != current["flag"],
            "source_revision": self.source_revision(scene["profile"]),
        }

    def validate(self, scene):
        self.check_shape(scene)
        issues = []
        if scene["cells"][0][0] != "blank":
            issues.append(
                {
                    "code": "fixed_anchor",
                    "message": "Fixture anchor must remain empty",
                    "x": 0,
                    "y": 0,
                }
            )
        if scene["source_digest"] != self.source_revision(scene["profile"]):
            issues.append({"code": "stale_source", "message": "Fixture source changed"})
        return {
            "valid": not issues,
            "errors": [i["message"] for i in issues],
            "issues": issues,
            "warnings": [],
        }

    def image(self, scene):
        return png(
            28,
            20,
            lambda x, y: (
                (190, 120, 70) if scene["cells"][y // 4][x // 4] == "solid" else (35, 45, 60)
            ),
        )

    def preview(self, scene, light=None, state=None, frame=0):
        self.check_shape(scene)
        return {
            "png": "data:image/png;base64," + base64.b64encode(self.image(scene)).decode(),
            "collision": [[c == "solid" for c in r] for r in scene["cells"]],
            "comparison": self.compare(scene),
        }

    def asset(self, name):
        if name != "tiles":
            raise ValueError("Unknown fixture image")
        return png(8, 4, lambda x, y: (35, 45, 60) if x < 4 else (190, 120, 70))

    def export(self, scene):
        return json.dumps(scene).encode()

    def input_files(self, root):
        return ["levels/room.json"]

    def output_files(self, root):
        return ("compiled/room.bin",)

    def prepare(self, scene, stage, review_id):
        result = self.validate(scene)
        if not result["valid"]:
            raise ValueError("; ".join(result["errors"]))
        if not self.compare(scene)["differs"]:
            raise ValueError("No fixture changes")
        (stage / "levels/room.json").write_text(
            json.dumps({"cells": scene["cells"], "flag": scene.get("flag", False)})
        )
        code = "from pathlib import Path; import json; d=json.loads(Path('levels/room.json').read_text()); Path('compiled').mkdir(); Path('compiled/room.bin').write_bytes(bytes(c=='solid' for r in d['cells'] for c in r)); print('Fixture compilation complete')"
        before = (
            "data:image/png;base64,"
            + base64.b64encode(self.image(self.load("workbench")["scene"])).decode()
        )
        after = "data:image/png;base64," + base64.b64encode(self.image(scene)).decode()
        return BuildPlan(
            ("levels/room.json",),
            self.output_files(stage),
            self.output_files(stage),
            (CheckStep("Compile fixture", (sys.executable, "-c", code)),),
            {
                "target": "Workbench",
                "changed_cells": 1,
                "views": [{"label": "Neutral", "before": before, "after": after}],
                "note": "Independent connector fixture",
            },
        )

    def approve(self, plan, stage, review_id):
        pass

    def refresh(self):
        pass

    def activity(self, text, fallback):
        return text.strip().splitlines()[-1] if text.strip() else fallback
