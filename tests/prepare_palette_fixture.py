"""Create portable palette examples for real-browser acceptance and manual review."""

import argparse
from pathlib import Path

from gbc_scene_forge.project.application import Project


def prepare(root, artwork_root=None):
    project = Project.create(root, "GBC palette examples")
    fixtures = (
        Path(artwork_root) if artwork_root else Path(__file__).parent / "fixtures/palette-semantics"
    )
    for name in ("mixed", "bank", "reordered"):
        project.artwork.import_atlas(
            fixtures / name / f"{name}.atlas.json", project.catalog()["revision"]
        )
    project.reports.save_profile(
        {"version": 1, "bg_reserved": 0, "obj_reserved": 0}, project.catalog()["revision"]
    )
    for title, over in (("Eight background palettes", False), ("Nine background palettes", True)):
        loaded = project.scenes.create(title, 16, 4, 8, project.catalog()["revision"])
        scene = loaded["scene"]
        scene["cells"][0][:4] = [f"mixed/ground/{x}/{y}" for y in range(2) for x in range(2)]
        scene["cells"][1][:8] = [f"bank/strip/{x}/0" for x in range(8)]
        if over:
            scene["cells"][2][0] = "reordered/swapped/0/0"
        scene["objects"] = [
            {"id": 1, "asset": "mixed/actor_a", "x": 8, "y": 16},
            {"id": 2, "asset": "bank/actor", "x": 16, "y": 16},
        ]
        scene["next_object_id"] = 3
        project.scenes.save(loaded["id"], scene, loaded["revision"], project.catalog()["revision"])
    return project


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument(
        "--artwork-root", type=Path, help="Alternate root with mixed/bank/reordered bundles"
    )
    args = parser.parse_args()
    prepare(args.root, args.artwork_root)
