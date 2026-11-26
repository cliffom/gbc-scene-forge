"""Versioned draft envelopes and atomic, conflict-checked local storage."""

import copy
import hashlib
import json
import os
import re
import tempfile
import unicodedata
from threading import Lock

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.storage.paths import reject_symlinks

SAVE_LOCK = Lock()
RESERVED = {"version", "connector", "id", "name", "profile", "source_digest"}


def decode_document(data, connector):
    if not isinstance(data, dict):
        raise ValueError("Expected a scene document")
    if type(data.get("version")) is not int:
        raise ValueError("Scene document needs an integer version")
    if data["version"] == 2:
        if data.get("connector") != connector.identity:
            raise ValueError("Draft belongs to another connector")
        content = data.get("content")
        if not isinstance(content, dict) or RESERVED.intersection(content):
            raise ValueError("Invalid document content")
        if set(data) != {
            "version",
            "connector",
            "id",
            "name",
            "target",
            "source_revision",
            "content",
        }:
            raise ValueError("Unrecognized envelope fields; refusing to discard document data")
        data = dict(
            content,
            version=1,
            connector=data["connector"],
            id=data["id"],
            name=data["name"],
            profile=data["target"],
            source_digest=data["source_revision"],
        )
    elif data["version"] != 1:
        raise ValueError("Unsupported scene document version")
    scene = connector.normalize(copy.deepcopy(data))
    check_document(scene)
    return scene


def check_document(scene):
    if not isinstance(scene, dict):
        raise ValueError("Expected a scene document")
    if not isinstance(scene.get("id"), str) or not re.fullmatch(
        r"[a-z][a-z0-9-]{0,63}", scene["id"]
    ):
        raise ValueError("Invalid draft id")
    if not isinstance(scene.get("name"), str) or not 1 <= len(scene["name"].strip()) <= 100:
        raise ValueError("Draft name must contain 1–100 characters")
    for key in ("connector", "profile", "source_digest"):
        if not isinstance(scene.get(key), str) or not scene[key]:
            raise ValueError(f"Missing document {key}")
    if any(type(scene.get(key)) is not int or scene[key] <= 0 for key in ("width", "height")):
        raise ValueError("Invalid grid dimensions")
    grid = scene.get("cells")
    if (
        not isinstance(grid, list)
        or len(grid) != scene["height"]
        or any(
            not isinstance(row, list)
            or len(row) != scene["width"]
            or any(not isinstance(cell, str) for cell in row)
            for row in grid
        )
    ):
        raise ValueError("Invalid cell grid")
    if not isinstance(scene.get("references"), list):
        raise ValueError("Invalid composition references")


def encode_document(scene):
    check_document(scene)
    return dict(
        version=2,
        connector=scene["connector"],
        id=scene["id"],
        name=scene["name"],
        target=scene["profile"],
        source_revision=scene["source_digest"],
        content={key: value for key, value in scene.items() if key not in RESERVED},
    )


class DraftStore:
    def __init__(self, connector):
        self.connector = connector
        self.root = connector.workspace.drafts
        self.workspace = connector.workspace.root

    def original_path(self, target):
        if target not in self.connector.catalog()["profiles"]:
            raise ValueError("Choose a supported scene")
        self.path("check")
        key = hashlib.sha256((self.connector.identity + "\0" + target).encode()).hexdigest()
        path = self.root / ".originals" / (key + ".scene.json")
        reject_symlinks(path, self.root)
        return path

    def has_original(self, target):
        path = self.original_path(target)
        if path.exists() and not path.is_file():
            raise ValueError("Original scene snapshot must be a file")
        return path.is_file()

    def capture_original(self, target):
        """Preserve live game content, never the edited draft or a template."""
        path = self.original_path(target)
        if self.has_original(target):
            return
        current = decode_document(self.connector.load(target)["scene"], self.connector)
        if current["profile"] != target:
            raise ValueError("Current scene does not match the requested original")
        if current["source_digest"] != self.connector.source_revision(target):
            raise Conflict("Project changed while capturing the original. Restart the editor.")
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = type(path)(stream.name)
            stream.write(json_text(encode_document(current)).encode())
            stream.flush()
            os.fsync(stream.fileno())
        try:
            # Publish complete bytes exclusively, including across server processes.
            # An existing baseline is never replaced by a later save.
            os.link(temporary, path)
        except FileExistsError:
            pass
        finally:
            temporary.unlink(missing_ok=True)

    def load_original(self, target):
        scene = decode_document(json.loads(self.original_path(target).read_bytes()), self.connector)
        if scene["profile"] != target:
            raise ValueError("Original scene does not match its target")
        # The layout is historical; export/apply must validate against today's sources.
        scene["source_digest"] = self.connector.source_revision(target)
        return {"scene": scene, "original": True, "revision": None}

    def path(self, scene_id):
        if not isinstance(scene_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", scene_id):
            raise ValueError("Invalid draft id")
        reject_symlinks(
            self.root, self.workspace if self.root.is_relative_to(self.workspace) else self.root
        )
        path = self.root / (scene_id + ".scene.json")
        reject_symlinks(path, self.root)
        return path

    def load(self, scene_id):
        data = self.path(scene_id).read_bytes()
        scene = decode_document(json.loads(data), self.connector)
        if scene["id"] != scene_id:
            raise ValueError("Draft id does not match its filename")
        return {"scene": scene, "revision": hashlib.sha256(data).hexdigest()}

    def list(self):
        self.path("check")
        items = []
        for path in sorted(self.root.glob("*.scene.json")):
            try:
                data = self.load(path.name.removesuffix(".scene.json"))
                items.append(
                    dict(
                        {key: data["scene"][key] for key in ("id", "name", "profile")},
                        revision=data["revision"],
                    )
                )
            except (ValueError, OSError):
                continue
        return items

    def save(self, scene, saved_id=None, revision=None, *, explicit_id=False):
        scene = decode_document(scene, self.connector)
        with SAVE_LOCK:
            if explicit_id:
                saved_id = scene["id"]
            if saved_id is not None:
                if not explicit_id and not revision:
                    raise Conflict("Load the saved draft again before updating it.")
                scene["id"] = saved_id
            else:
                if revision is not None:
                    raise ValueError("A new draft cannot have a saved revision")
                name = unicodedata.normalize("NFKD", scene["name"].lower())
                name = name.replace("'", "").replace("’", "").encode("ascii", "ignore").decode()
                base = re.sub(r"[^a-z0-9]+", "-", name).strip("-") or "draft"
                if not base[0].isalpha():
                    base = "draft-" + base
                base = base[:64].rstrip("-")
                scene["id"] = base
                suffix = 2
                while self.path(scene["id"]).exists():
                    ending = f"-{suffix}"
                    scene["id"] = base[: 64 - len(ending)].rstrip("-") + ending
                    suffix += 1
            path = self.path(scene["id"])
            current = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
            if current != revision:
                raise Conflict(
                    "This draft changed on disk. Load it again, or use Save as new draft."
                )
            self.capture_original(scene["profile"])
            self.root.mkdir(parents=True, exist_ok=True)
            data = json_text(encode_document(scene)).encode()
            with tempfile.NamedTemporaryFile(dir=self.root, delete=False) as stream:
                temporary = type(path)(stream.name)
                stream.write(data)
            try:
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
            return {
                "id": scene["id"],
                "revision": hashlib.sha256(data).hexdigest(),
                "path": str(path.relative_to(self.workspace))
                if path.is_relative_to(self.workspace)
                else str(path),
            }

    def delete(self, items):
        if not isinstance(items, list) or not items:
            raise ValueError("Select at least one draft")
        with SAVE_LOCK:
            paths = []
            for item in items:
                if not isinstance(item, dict):
                    raise ValueError("Expected draft id and revision")
                path = self.path(item.get("id"))
                if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != item.get(
                    "revision"
                ):
                    raise Conflict(
                        "A selected draft changed on disk. Reopen Delete drafts and try again."
                    )
                if path not in paths:
                    paths.append(path)
            for path in paths:
                path.unlink()
        return {"deleted": [path.name.removesuffix(".scene.json") for path in paths]}
