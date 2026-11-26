"""Versioned, engine-independent world layout and object endpoint diagnostics."""

from uuid import UUID

from gbc_scene_forge.core.validation import integer, require
from gbc_scene_forge.formats.tiled import scene_layers
from gbc_scene_forge.scene_objects.definitions import resolve


def empty():
    return {"version": 1, "positions": {}, "connections": []}


def identity(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


def check(value):
    require(
        isinstance(value, dict)
        and set(value) == {"version", "positions", "connections"}
        and type(value["version"]) is int
        and value["version"] == 1,
        "Unsupported world format; expected version 1",
    )
    require(
        isinstance(value["positions"], dict) and len(value["positions"]) <= 4096,
        "Use at most 4096 world positions",
    )
    for scene, position in value["positions"].items():
        require(
            identity(scene)
            and isinstance(position, dict)
            and set(position) == {"x", "y"}
            and all(integer(position[k], -100000, 100000) for k in ("x", "y")),
            "World positions need a scene UUID and whole coordinates within -100000..100000",
        )
    require(
        isinstance(value["connections"], list) and len(value["connections"]) <= 4096,
        "Use at most 4096 world connections",
    )
    seen = set()
    for link in value["connections"]:
        require(
            isinstance(link, dict)
            and set(link) == {"id", "name", "source", "destination", "direction"}
            and identity(link["id"])
            and link["id"] not in seen,
            "Invalid or duplicate connection identity",
        )
        seen.add(link["id"])
        require(
            isinstance(link["name"], str) and 1 <= len(link["name"].strip()) <= 100,
            "Connection name must contain 1..100 characters",
        )
        require(link["direction"] in ("one-way", "two-way"), "Invalid connection direction")
        for key in ("source", "destination"):
            endpoint = link[key]
            require(
                isinstance(endpoint, dict)
                and set(endpoint) == {"scene", "object"}
                and identity(endpoint["scene"])
                and integer(endpoint["object"], 1, 2147483646),
                "Connection endpoints need a scene UUID and positive object ID",
            )
        require(link["source"] != link["destination"], "Choose two distinct endpoints")


def references(value, scene_id):
    return [
        link
        for link in value["connections"]
        if any(link[key]["scene"] == scene_id for key in ("source", "destination"))
    ]


def removed_links(value, scene_id, before, after):
    def ids(scene):
        return {o["id"] for layer in scene_layers(scene) for o in layer.get("objects", [])}

    removed = ids(before) - ids(after)
    return [
        link["id"]
        for link in references(value, scene_id)
        if any(
            link[key]["scene"] == scene_id and link[key]["object"] in removed
            for key in ("source", "destination")
        )
    ]


def report(document, scenes):
    """Report both endpoints, including hidden layers, in stored connection order."""
    definitions = document.get("object_definitions", {}).get("definitions", [])
    objects = {}
    summaries = []
    for entry in document["scenes"]:
        loaded = scenes[entry["id"]]
        scene = loaded["scene"]
        markers = []
        for layer in scene_layers(scene):
            for item in layer.get("objects", []):
                marker = {
                    "id": item["id"],
                    "name": item.get("name", ""),
                    "layer": layer["id"],
                    "visible": layer["visible"],
                    "x": item["x"],
                    "y": item["y"],
                    "definition": item.get("definition"),
                    "errors": (
                        [{"code": "missing-definition", "field": ""}]
                        if "definition" not in item
                        else resolve(item, definitions)[1]
                    ),
                }
                objects[(entry["id"], item["id"])] = marker
                markers.append(marker)
        summaries.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "revision": loaded["revision"],
                "width": scene["width"],
                "height": scene["height"],
                "grid": scene["grid"],
                "objects": markers,
            }
        )
    scene_ids = {s["id"] for s in document["scenes"]}
    findings = []
    for link in document.get("world", empty())["connections"]:
        for key in ("source", "destination"):
            endpoint = link[key]
            marker = objects.get((endpoint["scene"], endpoint["object"]))
            codes = (
                [{"code": "missing-scene", "field": ""}]
                if endpoint["scene"] not in scene_ids
                else [{"code": "missing-object", "field": ""}]
                if marker is None
                else marker["errors"]
            )
            for error in codes:
                findings.append(
                    {
                        "connection": link["id"],
                        "endpoint": key,
                        **endpoint,
                        "layer": marker["layer"] if marker else None,
                        "severity": "error",
                        **error,
                    }
                )
    return {
        "version": 1,
        "status": "fail" if findings else "pass",
        "scenes": summaries,
        "findings": findings,
    }
