"""Versioned object definitions and deterministic, read-only instance validation."""

import copy
from uuid import UUID

from gbc_scene_forge.core.validation import require
from gbc_scene_forge.scene_objects.model import check_properties


def identity(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


def check_library(library, sprites):
    require(
        isinstance(library, dict)
        and set(library) == {"version", "definitions"}
        and type(library["version"]) is int
        and library["version"] == 1,
        "Unsupported object definition library version",
    )
    definitions = library["definitions"]
    require(
        isinstance(definitions, list) and len(definitions) <= 128, "Use at most 128 definitions"
    )
    seen = set()
    for definition in definitions:
        require(isinstance(definition, dict), "Expected an object definition")
        require(
            {"id", "name", "kind", "fields"} <= set(definition)
            and not set(definition) - {"id", "name", "kind", "fields", "asset", "width", "height"}
            and identity(definition["id"])
            and definition["id"] not in seen,
            "Invalid or duplicate definition identity",
        )
        seen.add(definition["id"])
        require(
            isinstance(definition["name"], str)
            and 1 <= len(definition["name"]) <= 100
            and definition["name"].strip(),
            "Definition name must contain 1..100 characters",
        )
        kind = definition["kind"]
        require(kind in ("point", "rectangle", "sprite"), "Choose point, rectangle or sprite")
        geometry = set(definition) & {"asset", "width", "height"}
        require(
            geometry
            == (
                {"asset"}
                if kind == "sprite"
                else {"width", "height"}
                if kind == "rectangle"
                else set()
            ),
            "Invalid definition geometry",
        )
        if kind == "sprite":
            require(
                isinstance(definition["asset"], str) and definition["asset"] in sprites,
                "Choose an imported sprite asset",
            )
        if kind == "rectangle":
            require(
                all(
                    type(definition[key]) is int and 1 <= definition[key] <= 8192
                    for key in ("width", "height")
                ),
                "Invalid definition rectangle size",
            )
        fields = definition["fields"]
        require(isinstance(fields, list) and len(fields) <= 128, "Use at most 128 fields")
        names = set()
        for field in fields:
            require(
                isinstance(field, dict)
                and {"name", "type", "required"} <= set(field)
                and not set(field)
                - {"name", "type", "required", "default", "min", "max", "choices"},
                "Unsupported definition field",
            )
            require(type(field["required"]) is bool, "Required must be a boolean")
            kind = field["type"]
            require(kind in ("string", "int", "float", "bool"), "Unsupported field type")
            probe = {
                "name": field["name"],
                "type": kind,
                "value": field.get(
                    "default", {"string": "", "int": 0, "float": 0, "bool": False}[kind]
                ),
            }
            check_properties([probe])
            require(field["name"] not in names, "Duplicate definition field name")
            names.add(field["name"])
            for key in ("min", "max"):
                if key in field:
                    require(kind in ("int", "float"), "Bounds require a numeric field")
                    check_properties([{**probe, "value": field[key]}])
            require(
                "min" not in field or "max" not in field or field["min"] <= field["max"],
                "Minimum must not exceed maximum",
            )
            if "choices" in field:
                require(
                    kind == "string"
                    and isinstance(field["choices"], list)
                    and 1 <= len(field["choices"]) <= 128
                    and all(isinstance(v, str) and len(v) <= 4096 for v in field["choices"])
                    and len(set(field["choices"])) == len(field["choices"]),
                    "Choices must be unique strings for a string field",
                )
            if "default" in field:
                require(not value_errors(field, probe), "Default violates field constraints")


def value_errors(field, prop):
    errors = []
    if prop["type"] != field["type"]:
        return ["type"]
    value = prop["value"]
    if field["required"] and value == "":
        errors.append("required")
    if "min" in field and value < field["min"]:
        errors.append("min")
    if "max" in field and value > field["max"]:
        errors.append("max")
    if "choices" in field and value not in field["choices"]:
        errors.append("choices")
    return errors


def resolve(item, definitions):
    """Return effective typed properties and findings without mutating authored overrides."""
    overrides = {prop["name"]: copy.deepcopy(prop) for prop in item.get("properties", [])}
    if "definition" not in item:
        return list(overrides.values()), []
    definition = next((d for d in definitions if d["id"] == item["definition"]), None)
    if definition is None:
        return list(overrides.values()), [{"field": "", "code": "missing-definition"}]
    findings = []
    if item.get("kind", "sprite") != definition["kind"]:
        findings.append({"field": "", "code": "kind"})
    fields = {field["name"]: field for field in definition["fields"]}
    effective = {}
    for key, field in fields.items():
        prop = overrides.get(key)
        if prop is None and "default" in field:
            prop = {"name": key, "type": field["type"], "value": field["default"]}
        if prop is None:
            if field["required"]:
                findings.append({"field": key, "code": "required"})
        else:
            effective[key] = prop
            findings.extend({"field": key, "code": code} for code in value_errors(field, prop))
    for key in sorted(overrides.keys() - fields.keys()):
        effective[key] = overrides[key]
        findings.append({"field": key, "code": "unknown-field"})
    return [effective[key] for key in sorted(effective)], findings
