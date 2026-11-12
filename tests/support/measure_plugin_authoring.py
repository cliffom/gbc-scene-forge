"""Staged Forge-only authoring baseline; see docs/evaluations/plugin-authoring-quality.md.

Run with the checkout interpreter. Each phase writes previews and stops for actual
agent inspection. This uses the current PluginSession with a synthetic directory
grant, NOT an installed-client/model benchmark. No optional SDK is required.
"""

import argparse
import base64
import hashlib
import io
import json
import platform
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from uuid import UUID

from gbc_scene_forge.adapters.plugin.selection import Selection
from gbc_scene_forge.adapters.plugin.session import PluginSession
from gbc_scene_forge.artwork import png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.project.application import Project

REPO = Path(__file__).resolve().parents[2]
CASES = ("lantern", "beacon", "grass", "island", "room", "scope")
INK = [24, 34, 57, 255]
GOLD = [255, 190, 75, 255]
GREEN = [57, 106, 79, 255]
SKETCH = str(UUID(int=3))


def encoded(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


class Canvas:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.raw = bytearray(width * height * 4)

    def rect(self, x, y, width, height, color):
        for row in range(y, y + height):
            for col in range(x, x + width):
                assert 0 <= col < self.width and 0 <= row < self.height
                offset = (row * self.width + col) * 4
                self.raw[offset : offset + 4] = bytes(color)

    def patch(self):
        return dict(
            rectangle=dict(x=0, y=0, width=self.width, height=self.height),
            rgba=base64.b64encode(self.raw).decode(),
        )


def sources(names):
    return [
        dict(id=str(UUID(int=i + 1)), name=name, visible=True, opacity=255, locked=False)
        for i, name in enumerate(names)
    ]


def fixture(case):
    """Fixed first passes. Refinements are separately recorded, never folded in."""
    if case == "lantern":
        metal, light, sketch = (Canvas(32, 32) for _ in range(3))
        metal.rect(11, 3, 10, 2, INK)
        metal.rect(10, 5, 2, 5, INK)
        metal.rect(20, 5, 2, 5, INK)
        metal.rect(8, 10, 16, 3, INK)
        metal.rect(8, 13, 3, 13, INK)
        metal.rect(21, 13, 3, 13, INK)
        metal.rect(8, 26, 16, 3, INK)
        metal.rect(9, 29, 3, 2, INK)
        metal.rect(20, 29, 3, 2, INK)
        metal.rect(9, 11, 14, 1, [64, 86, 116, 255])
        light.rect(11, 13, 10, 13, [185, 101, 46, 255])
        light.rect(13, 14, 6, 11, GOLD)
        light.rect(15, 16, 2, 7, [255, 239, 167, 255])
        sketch.rect(0, 0, 1, 1, [91, 82, 73, 0])
        layers = sources(("Metal", "Light", "Sketch"))
        layers[2]["visible"] = False
        return 32, 32, layers, [metal, light, sketch]
    if case == "beacon":
        canvas = Canvas(64, 16)
        for frame, radius in enumerate((2, 3, 4, 3)):
            x = frame * 16
            canvas.rect(x + 5, 11, 6, 3, INK)
            canvas.rect(x + 7, 7, 2, 4, [64, 86, 116, 255])
            canvas.rect(x + 8 - radius, 6 - radius, radius * 2, radius * 2, GOLD)
            canvas.rect(x + 7, 5, 2, 2, [255, 239, 167, 255])
        return 64, 16, None, [canvas]
    if case == "grass":
        canvas = Canvas(32, 8)
        for frame in range(4):
            x = frame * 8
            canvas.rect(x, 0, 8, 8, GREEN)
            canvas.rect(x + 2, 2 + frame % 2, 1, 2, [104, 151, 92, 255])
            canvas.rect(x + 5, 5 - frame % 2, 2, 1, [39, 78, 64, 255])
            canvas.rect(x, 0, 8, 1, [104, 151, 92, 255])
        return 32, 8, None, [canvas]
    if case == "island":
        sky, island, detail = (Canvas(160, 96) for _ in range(3))
        sky.rect(0, 0, 160, 48, [42, 42, 74, 255])
        sky.rect(0, 48, 160, 48, [50, 70, 96, 255])
        sky.rect(116, 12, 12, 12, [235, 213, 173, 255])
        for x, y in ((12, 12), (47, 19), (88, 8), (143, 33)):
            sky.rect(x, y, 1, 1, [184, 176, 174, 255])
        for y in range(53, 83):
            inset = abs(y - 64) * 2
            island.rect(25 + inset, y, 110 - inset * 2, 1, [68, 64, 64, 255])
        for y in range(49, 65):
            inset = abs(y - 57) * 3
            island.rect(29 + inset, y, 102 - inset * 2, 1, GREEN)
        detail.rect(55, 37, 5, 18, [91, 68, 65, 255])
        detail.rect(45, 28, 25, 16, [39, 78, 64, 255])
        detail.rect(50, 23, 15, 9, [39, 78, 64, 255])
        detail.rect(103, 44, 8, 15, INK)
        detail.rect(105, 46, 4, 6, GOLD)
        detail.rect(101, 42, 12, 3, INK)
        return 160, 96, sources(("Sky", "Island", "Details")), [sky, island, detail]
    raise ValueError(case)


class Run:
    def __init__(self, output, case, phase):
        self.output, self.case, self.phase = output, case, phase
        self.started = perf_counter()
        output.mkdir(parents=True, exist_ok=True)
        self.trace = output / "calls.jsonl"
        project_path = output / "project"
        if not project_path.exists():
            Project.create(project_path, "Authoring baseline")
        self.project = Project(project_path)
        bundle = output / "synthetic-bundle"
        bundle.mkdir(exist_ok=True)
        selection = Selection(bundle, settings=output / "settings", cache=output / "cache")
        self.session = PluginSession(selection, chooser=lambda _: project_path)
        self.call("plugin_status", project=False)
        self.call("plugin_choose_location", project=False, mode="project")
        self.capabilities = self.call("capabilities", project=False)
        if not (output / "environment.json").exists():
            commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
            ).strip()
            paths = sorted((REPO / "plugin/skills").rglob("*.md"))
            self.write(
                "environment.json",
                dict(
                    source_commit=commit,
                    utc=datetime.now(timezone.utc).isoformat(),
                    platform=platform.platform(),
                    python=sys.version,
                    runtime_version=__import__("gbc_scene_forge").__version__,
                    plugin_manifest=json.loads((REPO / "plugin/plugin.json").read_text()),
                    method="source PluginSession; synthetic chooser; agent-inspected staged replay",
                    installed_client=None,
                    model="GPT-6 family per session instructions; exact model/build unavailable",
                    tokens=None,
                    cost=None,
                    peak_memory=None,
                    external_image_services=0,
                    skills={str(p.relative_to(REPO)): digest(p.read_bytes()) for p in paths},
                    tool_inventory=self.capabilities["tools"],
                ),
            )

    def write(self, name, value):
        (self.output / name).write_text(json.dumps(value, indent=2) + "\n")

    def log(self, value):
        with self.trace.open("a") as stream:
            stream.write(json.dumps(dict(case=self.case, phase=self.phase, **value)) + "\n")

    def call(self, tool, project=True, **args):
        arguments = dict(project="project", **args) if project else args
        start = perf_counter()
        try:
            result = self.session.call(tool, arguments)
        except Exception as error:
            self.log(
                dict(
                    tool=tool,
                    request_bytes=len(encoded(arguments)),
                    response_bytes=None,
                    milliseconds=round((perf_counter() - start) * 1000, 3),
                    error=f"{type(error).__name__}: {error}",
                )
            )
            raise
        self.log(
            dict(
                tool=tool,
                request_bytes=len(encoded(arguments)),
                response_bytes=len(encoded(result)),
                milliseconds=round((perf_counter() - start) * 1000, 3),
                error=None,
            )
        )
        return result

    def resource(self, resource, name):
        start = perf_counter()
        data = self.session.read_artifact(resource["uri"])
        raw = base64.b64decode(data["blob"]) if "blob" in data else data["text"].encode()
        (self.output / name).write_bytes(raw)
        self.log(
            dict(
                tool="resources/read",
                request_bytes=len(encoded(dict(uri=resource["uri"]))),
                response_bytes=len(encoded(data)),
                decoded_bytes=len(raw),
                sha256=digest(raw),
                file=name,
                milliseconds=round((perf_counter() - start) * 1000, 3),
                error=None,
            )
        )
        return raw

    def revision(self):
        return self.call("get_project")["revision"]

    def state(self):
        return json.loads((self.output / f"{self.case}-state.json").read_text())

    def store(self, **state):
        self.write(f"{self.case}-state.json", state)

    def preview(self, candidate):
        label = f"{self.case}-{self.phase}"
        review = self.call("review_artwork_candidate", candidate=candidate, scale=8)
        self.write(label + "-review.json", review)
        # Resource names are taken from the actual response, not inferred file paths.
        for group in ("before", "after"):
            if review[group] is not None:
                for key in ("native_resource", "enlarged_resource"):
                    self.resource(review[group][key], label + "-" + group + "-" + key + ".png")
        full = self.call("export_artwork_candidate", candidate=candidate)
        self.write(label + "-candidate.json", full)
        width, height = full["descriptor"]["width"], full["descriptor"]["height"]
        rectangles = [dict(x=0, y=0, width=width, height=height)]
        if self.case == "beacon":
            rectangles = [dict(x=x, y=0, width=16, height=16) for x in range(0, 64, 16)]
            animation = self.call(
                "review_artwork_animation", candidate=candidate, sequence_id="pulse", scale=8
            )
            self.resource(animation["animation_resource"], label + ".apng")
        contact = self.call(
            "inspect_artwork_candidate",
            candidate=candidate,
            rectangles=rectangles,
            format="png",
            scale=3 if self.case == "island" else 8,
            changed_overlay=True,
        )
        self.resource(contact["resource"], label + "-contact.png")
        self.write(label + "-contact.json", contact)
        if self.case == "grass":
            raw = base64.b64decode(full["rgba"])
            repeated = bytearray()
            for y in range(32):
                for x in range(64):
                    tile = ((x // 8) + (y // 8) * 3) % 4
                    at = ((y % 8) * 32 + tile * 8 + x % 8) * 4
                    repeated.extend(raw[at : at + 4])
            # A deterministic arrangement aid, not a Forge preview or extra tool call.
            (self.output / (label + "-repeat.png")).write_bytes(png.encode(64, 32, repeated))
        return review, full

    def initial(self):
        if self.case == "room":
            return self.room_initial()
        if self.case == "scope":
            return self.scope_initial()
        width, height, layers, canvases = fixture(self.case)
        args = dict(
            project_revision=self.revision(),
            atlas_id=self.case,
            name=self.case.title(),
            kind="tile" if self.case == "grass" else "sprite",
            width=width,
            height=height,
            compact=True,
        )
        if self.case in ("beacon", "grass"):
            size = 16 if self.case == "beacon" else 8
            args["frames"] = [
                dict(
                    id=f"pose_{i}",
                    name=f"Pose {i}",
                    kind=args["kind"],
                    x=i * size,
                    y=0,
                    width=size,
                    height=size,
                    origin=[8, 14] if self.case == "beacon" else [0, 0],
                )
                for i in range(4)
            ]
            args["sequences"] = (
                []
                if self.case == "grass"
                else [
                    dict(
                        id="pulse",
                        name="Pulse",
                        loop=True,
                        frames=[
                            dict(frame_id=f"pose_{i}", duration_ms=duration)
                            for i, duration in enumerate((120, 160, 240, 160))
                        ],
                    )
                ]
            )
        candidate = self.call(
            "create_artwork_sheet" if "frames" in args else "create_artwork", **args
        )
        if layers:
            candidate = self.call("edit_artwork_layers", candidate=candidate, layers=layers)
        for index, canvas in enumerate(canvases):
            target = dict(layer_id=layers[index]["id"]) if layers else {}
            candidate = self.call(
                "edit_artwork_pixels", candidate=candidate, patch=canvas.patch(), **target
            )
        if self.case == "lantern":
            layers[2]["locked"] = True
            candidate = self.call("edit_artwork_layers", candidate=candidate, layers=layers)
        self.preview(candidate)
        self.store(candidate=candidate, correction_loops=0)

    def refine(self):
        state = self.state()
        candidate = state["candidate"]
        if self.case == "grass":
            if state["correction_loops"] == 0:
                writes = [dict(x=x, y=0, rgba=GREEN) for x in range(32)]
            else:
                # The first inspection also exposed identical variants 0/2 and 1/3.
                writes = [
                    dict(
                        x=frame * 8 + x,
                        y=2 + frame % 2 + dy,
                        rgba=GREEN if x == 2 else [104, 151, 92, 255],
                    )
                    for frame in (2, 3)
                    for x in (2, 3)
                    for dy in (0, 1)
                ]
            candidate = self.call("edit_artwork_pixels", candidate=candidate, writes=writes)
        elif self.case == "island":
            # Separate the island's dark shore from the dark sea with a narrow rim.
            writes = [dict(x=x, y=65, rgba=[171, 146, 104, 255]) for x in range(50, 110)]
            candidate = self.call(
                "edit_artwork_pixels",
                candidate=candidate,
                layer_id=str(UUID(int=2)),
                writes=writes,
            )
        else:
            raise ValueError("No observed correction recipe for this case")
        self.preview(candidate)
        self.store(candidate=candidate, correction_loops=state["correction_loops"] + 1)

    def save(self):
        state = self.state()
        candidate = state["candidate"]
        if self.case == "room":
            result = self.call("save_scene", **state["guards"], scene=candidate)
            assert result["scene"] == candidate
            saved = self.call("get_scene", scene_id=result["id"])
            assert saved["scene"] == candidate
            self.export_project(result["id"], candidate)
            return
        review, before = self.preview(candidate)
        if self.case == "grass":
            raw = base64.b64decode(before["rgba"])
            tiles = [
                b"".join(raw[(y * 32 + x) * 4 : (y * 32 + x + 8) * 4] for y in range(8))
                for x in range(0, 32, 8)
            ]
            assert len(set(tiles)) == 4, "Four distinct variants were requested"
            for tile in tiles:
                for x, y in [
                    (x, y) for y in range(8) for x in range(8) if x in (0, 7) or y in (0, 7)
                ]:
                    assert tile[(y * 8 + x) * 4 : (y * 8 + x + 1) * 4] == bytes(GREEN)
        if self.case == "island":
            self.store(**state, unpublished=True)
            assert not any(
                d["target"]["document_id"] == before["document_id"]
                for d in self.call("list_artwork", project_revision=self.revision())["documents"]
            )
            return
        if self.case == "scope":
            original = json.loads((self.output / "scope-before.json").read_text())
            assert original["descriptor"] == before["descriptor"]
            assert (
                original["layer_rgba"][str(UUID(int=1))] == before["layer_rgba"][str(UUID(int=1))]
            )
            assert original["layer_rgba"][SKETCH] == before["layer_rgba"][SKETCH]
            light = str(UUID(int=2))
            old, new = (base64.b64decode(item["layer_rgba"][light]) for item in (original, before))
            for offset in range(0, len(old), 4):
                expected = (
                    bytes([126, 223, 236, 255])
                    if old[offset : offset + 4] == bytes(GOLD)
                    else old[offset : offset + 4]
                )
                assert new[offset : offset + 4] == expected
            try:
                self.call("commit_artwork", candidate=candidate, receipt=state["stale_receipt"])
            except Conflict:
                pass
            else:
                raise AssertionError("Stale review was accepted")
            assert self.call("get_project")["project"] == state["project_before"]
        self.call("commit_artwork", candidate=candidate, receipt=review["receipt"])
        inventory = self.call("list_artwork", project_revision=self.revision())
        target = next(
            d for d in inventory["documents"] if d["target"]["document_id"] == before["document_id"]
        )
        reopened = self.call(
            "open_artwork",
            target=target["target"],
            project_revision=inventory["project_revision"],
            artwork_revision=target["artwork_revision"],
            compact=True,
        )
        after = self.call("export_artwork_candidate", candidate=reopened)
        for key in ("rgba", "layer_rgba", "descriptor", "document_id"):
            if key in before:
                assert before[key] == after[key], key
        self.write(f"{self.case}-saved.json", after)
        self.store(**state, saved_candidate=reopened, exact_reopen=True)
        if self.case == "scope":
            room = json.loads((self.output / "room-state.json").read_text())
            assert (
                self.call("get_scene", scene_id=room["guards"]["scene_id"])["scene"]
                == room["candidate"]
            )
            self.export_project(room["guards"]["scene_id"], room["candidate"])

    def scope_initial(self):
        inventory = self.call("list_artwork", project_revision=self.revision())
        item = next(d for d in inventory["documents"] if d["target"]["atlas_id"] == "lantern")
        candidate = self.call(
            "open_artwork",
            target=item["target"],
            project_revision=inventory["project_revision"],
            artwork_revision=item["artwork_revision"],
            compact=True,
        )
        before = self.call("export_artwork_candidate", candidate=candidate)
        self.write("scope-before.json", before)
        stale = self.call("review_artwork_candidate", candidate=candidate)["receipt"]
        raw = base64.b64decode(before["layer_rgba"][str(UUID(int=2))])
        writes = [
            dict(x=i // 4 % 32, y=i // 4 // 32, rgba=[126, 223, 236, 255])
            for i in range(0, len(raw), 4)
            if raw[i : i + 4] == bytes(GOLD)
        ]
        changed = self.call(
            "edit_artwork_pixels", candidate=candidate, layer_id=str(UUID(int=2)), writes=writes
        )
        self.preview(changed)
        self.store(
            candidate=changed,
            correction_loops=0,
            stale_receipt=stale,
            project_before=self.call("get_project")["project"],
        )

    def room_initial(self):
        loaded = self.call(
            "create_blockout_scene",
            project_revision=self.revision(),
            name="Lantern room",
            options=dict(
                units="pixels", width=256, height=128, grid=8, camera_width=128, camera_height=128
            ),
        )
        scene_id = loaded["id"]
        loaded = self.call("get_scene", scene_id=scene_id)
        guards = dict(
            scene_id=scene_id,
            project_revision=loaded["project_revision"],
            scene_revision=loaded["revision"],
        )
        catalog = self.call("get_project")["project"]
        definitions = catalog["object_definitions"]["definitions"]
        roles = {
            next(f["default"] for f in d["fields"] if f["name"] == "blockout_role"): d["id"]
            for d in definitions
        }
        grass = catalog["atlases"]["grass"]["manifest"]["regions"]
        self.write("room-inventory.json", catalog)
        tiles = [f"grass/{region['name']}/0/0" for region in grass]
        operations = [
            dict(op="place", definition_id=roles["solid"], x=0, y=112, width=256, height=16),
            dict(op="place", definition_id=roles["spawn"], x=16, y=104),
            dict(op="place", definition_id=roles["exit"], x=240, y=104),
            dict(op="place", definition_id=roles["one_way"], x=96, y=64, width=64, height=8),
            dict(
                op="paint_tiles",
                layer_id=loaded["scene"]["layers"][0]["id"],
                cells=[
                    dict(x=x, y=y, tile=tiles[(x + y * 3) % 4]) for y in (14, 15) for x in range(32)
                ],
            ),
        ]
        candidate = self.call("edit_scene", **guards, operations=operations, dry_run=True)["scene"]
        region = catalog["atlases"]["lantern"]["manifest"]["regions"][0]
        candidate["layers"].append(
            dict(
                id=candidate["next_layer_id"],
                type="objectgroup",
                name="Lanterns",
                visible=True,
                objects=[
                    dict(
                        id=candidate["next_object_id"] + i,
                        asset=f"lantern/{region['name']}",
                        x=x,
                        y=82,
                        origin=[16, 0],
                    )
                    for i, x in enumerate((48, 208))
                ],
            )
        )
        candidate["next_layer_id"] += 1
        candidate["next_object_id"] += 2
        assert self.call("get_scene", scene_id=scene_id)["scene"] == loaded["scene"]
        art = self.call("review_artwork", **guards, scene=candidate)
        plan = self.call("review_blockout", **guards, scene=candidate)
        assert art["snapshot_revision"] == plan["snapshot_revision"]
        assert art["overview_complete"]
        self.resource(art["overview_resource"], "room-initial.png")
        self.resource(plan["overview_resource"], "room-initial.svg")
        self.store(candidate=candidate, guards=guards, correction_loops=0)

    def export_project(self, scene_id, expected):
        exported = self.call("export_bundle", project_revision=self.revision(), scope="project")
        raw = self.resource(exported["resource"], f"{self.case}-project.zip")
        destination = self.output / f"{self.case}-reopened"
        # Only this newly generated local archive is extracted; reject unexpected paths.
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            assert all(
                not Path(n).is_absolute() and ".." not in Path(n).parts for n in archive.namelist()
            )
            archive.extractall(destination)
        reopened = Project(destination)
        assert reopened.scenes.load(scene_id)["scene"] == expected
        for path in self.project.catalog()["project"]["files"]:
            if path.endswith(".png"):
                assert (destination / path).read_bytes() == (self.project.root / path).read_bytes()
        self.write(
            f"{self.case}-export.json", dict(sha256=digest(raw), exact_scene=True, exact_pngs=True)
        )

    def finish(self):
        storage = self.call("list_artwork_candidates")
        self.write(f"{self.case}-{self.phase}-storage.json", storage)
        self.log(dict(stage_wall_seconds=round(perf_counter() - self.started, 3)))
        rows = [json.loads(line) for line in self.trace.read_text().splitlines()]
        groups = []
        for case in CASES:
            calls = [r for r in rows if r["case"] == case and "tool" in r]
            if calls:
                groups.append(
                    dict(
                        case=case,
                        tool_calls=sum(r["tool"] != "resources/read" for r in calls),
                        resource_reads=sum(r["tool"] == "resources/read" for r in calls),
                        request_bytes=sum(r["request_bytes"] for r in calls),
                        response_bytes=sum(r["response_bytes"] or 0 for r in calls),
                        measured_service_ms=round(sum(r["milliseconds"] for r in calls), 3),
                        failed_calls=[r for r in calls if r["error"]],
                        stage_wall_seconds=round(
                            sum(r.get("stage_wall_seconds", 0) for r in rows if r["case"] == case),
                            3,
                        ),
                    )
                )
        self.write(
            "summary.json",
            dict(
                cases=groups,
                retained_count=storage["used_count"],
                retained_bytes=storage["used_bytes"],
            ),
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case", choices=CASES, required=True)
    parser.add_argument("--phase", choices=("initial", "refine", "save"), required=True)
    parser.add_argument("--iteration", type=int, default=1)
    args = parser.parse_args()
    output = args.output.resolve()
    # Refuse accidental replay over existing stage evidence (including failed runs).
    if args.iteration < 1 or (args.iteration != 1 and args.phase != "refine"):
        parser.error("--iteration > 1 is only valid for a refinement")
    phase = args.phase if args.iteration == 1 else f"{args.phase}-{args.iteration}"
    marker = output / f"{args.case}-{phase}.started"
    output.mkdir(parents=True, exist_ok=True)
    with marker.open("x") as stream:
        stream.write(datetime.now(timezone.utc).isoformat() + "\n")
    run = Run(output, args.case, phase)
    try:
        getattr(run, args.phase)()
    finally:
        run.finish()


if __name__ == "__main__":
    main()
