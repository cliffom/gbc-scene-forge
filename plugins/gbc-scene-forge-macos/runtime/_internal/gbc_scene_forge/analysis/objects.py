"""Object-definition findings over canonical scene layers."""

from gbc_scene_forge.formats.tiled import scene_layers
from gbc_scene_forge.scene_objects.definitions import resolve


def report(scene, project, scene_id):

    definitions = project.get("object_definitions", {}).get("definitions", [])
    findings, instances = [], 0
    for layer in scene_layers(scene):
        for item in layer.get("objects", []):
            if "definition" not in item:
                continue
            instances += 1
            _, errors = resolve(item, definitions)
            for error in errors:
                findings.append(
                    {
                        "scene": scene_id,
                        "layer": layer["id"],
                        "object": item["id"],
                        "definition": item["definition"],
                        "severity": "error",
                        **error,
                    }
                )
    return {
        "version": 1,
        "status": "fail" if findings else "pass",
        "instances": instances,
        "findings": findings,
    }
