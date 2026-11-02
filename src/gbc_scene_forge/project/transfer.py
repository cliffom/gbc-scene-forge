"""Selection-aware scene transfer, prepared without writes and committed atomically."""

import copy
import json
from uuid import NAMESPACE_URL, uuid5

from gbc_scene_forge.artwork import atlas, png
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import tiled, transfer
from gbc_scene_forge.project.schema import validate
from gbc_scene_forge.storage.files import digest


def prepare(store, document, encoded, selection, fingerprint):
    source, files = transfer.read_bundle(encoded)
    validate(source, store.root)
    require(selection is None or isinstance(selection, dict), "Expected scene selection and names")
    known = {item["id"] for item in source["scenes"]}
    require(selection is None or set(selection) <= known, "Selection contains an unknown scene")
    selection = (
        selection if selection is not None else {s["id"]: s["name"] for s in source["scenes"]}
    )
    rows, selected, needed_assets, needed_defs = [], {}, set(), set()
    checked_assets = {}
    existing_names = {}
    for saved in document["scenes"]:
        existing_names.setdefault(saved["name"].strip().casefold(), []).append(saved)
    proposed = {}
    for value in selection.values():
        if isinstance(value, str):
            proposed[value.strip().casefold()] = proposed.get(value.strip().casefold(), 0) + 1
    errors = []
    if not selection:
        errors.append("Select at least one scene.")
    for item in source["scenes"]:
        key = item["id"]
        chosen = key in selection
        row = {
            "id": key,
            "source_name": item["name"],
            "name": selection.get(key, item["name"]),
            "selected": chosen,
            "assets": [],
            "definitions": [],
            "errors": [],
            "conflicts": [],
        }
        try:
            encoded_scene = json.loads(files[item["path"]])
            scene = tiled.decode(encoded_scene, source)
            assets, definitions = transfer.dependencies(scene, source, encoded_scene["tilesets"])
            row.update(assets=assets, definitions=definitions)
            if chosen:
                row["name"] = name(row["name"])
                normalized = row["name"].casefold()
                for other in existing_names.get(normalized, []):
                    row["conflicts"].append(
                        f"Existing scene: {other['name']} ({other['id']}). Rename or skip."
                    )
                if proposed.get(normalized, 0) > 1:
                    row["conflicts"].append("Duplicate incoming name. Rename or skip one scene.")
                for asset in assets:
                    if asset not in checked_assets:
                        checked_assets[asset] = transfer.authoring_assets(
                            source["atlases"][asset], files
                        )
                selected[key] = scene
                needed_assets.update(assets)
                needed_defs.update(definitions)
        except (ValueError, KeyError, TypeError) as error:
            row["errors"].append(str(error))
        row["status"] = "error" if row["errors"] or row["conflicts"] else "ready"
        if chosen:
            errors.extend(f"{item['name']}: {error}" for error in row["errors"] + row["conflicts"])
        rows.append(row)
    notes = [
        "Every selected scene is a new copy with a new UUID.",
        "Required atlases and definitions are copied once per selection with new identities; existing content is never reused or overwritten.",
        "World positions and connections are omitted, including links between selected scenes and links to unselected scenes.",
        "Project settings, preview preferences and the stamp library are not imported. Ordinary typed property strings are retained literally.",
    ]
    report = {
        "compatible": not errors,
        "errors": errors,
        "scenes": rows,
        "notes": notes,
        "assets": [],
        "definitions": [],
        "confirmation": fingerprint,
    }
    if errors:
        return report, {}, {}

    def new_uuid(kind, key):
        return str(uuid5(NAMESPACE_URL, f"forge-transfer:{fingerprint}:{kind}:{key}"))

    assets = {
        key: "transfer_" + new_uuid("asset", key).replace("-", "")[:20]
        for key in sorted(needed_assets)
    }
    definitions = {key: new_uuid("definition", key) for key in sorted(needed_defs)}
    changes, expected = {}, {}
    for key, target in assets.items():
        require(
            target not in document["atlases"]
            and not any(p.startswith(f"assets/{target}/") for p in document["files"]),
            "Generated asset identity exists; run preflight again after changing the selection",
        )
        entry = checked_assets[key]
        entry["manifest"]["id"] = target
        entry["png"] = f"assets/{target}/atlas.png"
        for mapping in entry["tiles"].values():
            updated = {transfer.remap_asset(k, assets): v for k, v in mapping.items()}
            mapping.clear()
            mapping.update(updated)
        for group, records in entry.get("metadata", {}).items():
            entry["metadata"][group] = {
                transfer.remap_asset(k, assets): v for k, v in records.items()
            }
        image = files[source["atlases"][key]["png"]]
        width, _, pixels = png.decode(image, generic=True)
        rebuilt, generated = atlas.build_assets(entry["manifest"], image, width, pixels, entry)
        document["atlases"][target] = rebuilt
        changes.update(generated)
        report["assets"].append({"source": key, "destination": target, "decision": "copy"})
    library = document.setdefault("object_definitions", {"version": 1, "definitions": []})
    existing_defs = {d["id"] for d in library["definitions"]}
    for definition in source.get("object_definitions", {}).get("definitions", []):
        key = definition["id"]
        if key not in definitions:
            continue
        candidate = copy.deepcopy(definition)
        candidate["id"] = definitions[key]
        require(
            candidate["id"] not in existing_defs, "Generated definition identity already exists"
        )
        if "asset" in candidate:
            candidate["asset"] = transfer.remap_asset(candidate["asset"], assets)
        library["definitions"].append(candidate)
        report["definitions"].append(
            {"source": key, "destination": candidate["id"], "decision": "copy"}
        )
    for row in rows:
        if not row["selected"]:
            continue
        key = row["id"]
        target = new_uuid("scene", key)
        require(
            all(s["id"] != target for s in document["scenes"]),
            "Generated scene identity already exists",
        )
        path = f"scenes/{target}.tmj"
        row["destination_id"] = target
        scene = transfer.remap_scene(selected[key], assets, definitions)
        changes[path] = json_text(tiled.encode(scene, document)).encode()
        expected[path] = None
        document["scenes"].append({"id": target, "name": row["name"], "path": path})
    try:
        validate(document, store.root)
        store.prepare_commit(copy.deepcopy(document), dict(changes))
    except (ValueError, KeyError, TypeError) as error:
        report["compatible"] = False
        report["errors"].append(str(error))
        return report, {}, {}
    return report, changes, expected


def import_scenes(store, encoded, revision, *, selection=None, dry_run=True, confirmation=None):
    require(type(dry_run) is bool, "dry_run must be boolean")
    require(
        isinstance(revision, str) and len(revision) == 64,
        "Reopen the destination project to obtain its current revision",
    )
    with store.read_session(revision, verify_assets=True) as session:
        document = session.document
        fingerprint = digest(
            json_text({"zip": encoded, "selection": selection, "revision": revision}).encode()
        )
        try:
            report, changes, expected = prepare(store, document, encoded, selection, fingerprint)
        except (
            ValueError,
            KeyError,
            TypeError,
            IndexError,
            RecursionError,
            StopIteration,
        ) as error:
            report = {
                "compatible": False,
                "errors": [str(error) or "A referenced sprite region or dependency is missing."],
                "scenes": [],
                "notes": [],
                "assets": [],
                "definitions": [],
            }
            changes, expected = {}, {}
    if dry_run:
        return {**report, "dry_run": True}
    require(report["compatible"], "; ".join(report["errors"]))
    if confirmation != fingerprint:
        raise Conflict("Import inputs changed. Run preflight again before importing.")
    store.commit(document, revision, changes, expected, "Import Forge scenes")
    return {
        **report,
        "dry_run": False,
        "imported": [row["destination_id"] for row in report["scenes"] if row["selected"]],
    }
