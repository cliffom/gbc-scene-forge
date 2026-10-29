"""Project creation and journal recovery before composing authoring services."""

import json
from pathlib import Path
from uuid import uuid4

from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.planning import blockout
from gbc_scene_forge.storage.paths import safe_path
from gbc_scene_forge.storage.transactions import Transactions

from .schema import MANIFEST, SCHEMA_VERSION, check_version


def recover(root):
    """Recover pending writes, including creation that may remove the manifest."""
    root = Path(root).absolute()
    # Refuse unknown schemas before recovery can write any files.
    manifest = safe_path(root, MANIFEST)
    if manifest.exists():
        with manifest.open("rb") as stream:
            data = stream.read(8 * 1024 * 1024 + 1)
        require(len(data) <= 8 * 1024 * 1024, "Project manifest exceeds 8 MiB")
        check_version(json.loads(data))
    Transactions(root, ".forge/history").recover()


def prepare_creation(root):
    """Accept empty folders or recover a journal from interrupted first creation."""
    root = Path(root).absolute()
    if not root.exists():
        return
    safe_path(root, MANIFEST)
    if root.is_dir() and not any(root.iterdir()):
        return
    if root.is_dir() and {item.name for item in root.iterdir()} == {".forge"}:
        store = Transactions(root, ".forge/history")
        records = store.records()
        if records and all(
            record.get("label") == "Create project"
            and set(record.get("files", {})) == {MANIFEST}
            and record.get("status") in ("applying", "restoring", "recovered")
            for record in records
        ):
            store.recover()
            return
    raise ValueError("Create a project in a new or empty directory")


def create(root, title, *, starter="empty"):
    require(starter in ("empty", "blockout"), "Choose an empty or blockout project")
    root = Path(root).absolute()
    title = name(title)
    # Creation only claims empty folders or its own recoverable creation journal.
    prepare_creation(root)
    require(not (root / MANIFEST).exists(), "A project already exists in this directory")
    root.mkdir(parents=True, exist_ok=True)
    safe_path(root, MANIFEST)
    document = {
        "version": SCHEMA_VERSION,
        "id": str(uuid4()),
        "name": title,
        "scenes": [],
        "atlases": {},
        "files": {},
        "preview": {"zoom": 3, "grid": True},
    }
    if starter == "blockout":
        blockout.initialize(document)
    Transactions(root, ".forge/history").apply(
        {MANIFEST: json_text(document).encode()}, {MANIFEST: None}, "Create project"
    )
    return root
