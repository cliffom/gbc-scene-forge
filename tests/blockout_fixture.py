"""Independent opening-forest planning example, using only public standalone services."""

from gbc_scene_forge import blockout


def opening_forest(project):
    loaded = project.create_blockout_scene("Opening forest", {}, project.catalog()["revision"])
    document = project.catalog()["project"]
    definitions = {
        next(f["default"] for f in definition["fields"] if f["name"] == blockout.ROLE): definition[
            "id"
        ]
        for definition in document["object_definitions"]["definitions"]
    }
    scene = loaded["scene"]
    scene["layers"][-1]["objects"][0]["y"] = 136
    placements = [
        ("solid", "Forest floor west", 0, 240, 320, 32),
        ("water", "Red pool", 320, 240, 64, 32),
        ("solid", "Forest floor east", 384, 240, 576, 32),
        ("climb", "Short vine", 208, 192, 16, 48),
        ("one_way", "Vine landing", 176, 192, 64, 8),
        ("climb", "Upper vine", 448, 160, 16, 80),
        ("one_way", "Upper landing", 416, 160, 64, 8),
        ("spawn", "Player spawn", 16, 232, None, None),
        ("enemy", "Forest patrol", 96, 232, None, None),
        ("patrol", "Patrol activity", 64, 208, 96, 32),
        ("approach", "Optional bat approach", 560, 96, 128, 112),
        ("enemy", "Possible swooping bat", 608, 112, None, None),
        ("reward", "Visible reward", 224, 184, None, None),
        ("hidden_reward", "Hidden reward", 456, 152, None, None),
        ("detour", "Optional upper route", 400, 104, 112, 88),
        ("checkpoint", "Midpoint checkpoint", 480, 232, None, None),
        ("boss_entrance", "Dragon approach", 736, 232, None, None),
        ("arena", "Grounded dragon arena", 768, 136, 192, 136),
        ("exit", "Stage exit proposal", 944, 232, None, None),
        ("section", "Opening forest", 0, 104, 320, 168),
        ("note", "Stage pacing", 32, 64, None, None),
    ]
    identities = {}
    for role, name, x, y, width, height in placements:
        props = []
        if role == "note":
            props = [
                dict(
                    name="design_note",
                    type="string",
                    value="960px is the starting forest; full stage length remains undecided.",
                )
            ]
        if role == "water":
            props = [dict(name=blockout.COLOR, type="string", value="#cf7777")]
        scene, identity = blockout.place(
            scene,
            document,
            definitions[role],
            x,
            y,
            width=width,
            height=height,
            name=name,
            properties=props,
        )
        identities[name] = identity
    return project.save_scene(
        loaded["id"], scene, loaded["revision"], project.catalog()["revision"]
    ), identities
