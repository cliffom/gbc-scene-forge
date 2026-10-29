"""Launch an editable copy of the checked-in Aseprite → gbc-atlas → Forge demo."""

import json
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4

from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.serialization import json_text
from gbc_scene_forge.formats import tiled
from gbc_scene_forge.project import lifecycle
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.storage.files import digest, read_optional
from gbc_scene_forge.storage.paths import safe_path


def template_path():
    """Use wheel data when installed, or the canonical assets in a development checkout."""
    packaged = Path(__file__).resolve().parents[1] / "demo_project"
    if (packaged / MANIFEST).is_file():
        return packaged
    return Path(__file__).resolve().parents[3] / "assets" / "demo" / "project"


def _snapshot(project):
    document, revision = project.read()
    paths = {MANIFEST, *document["files"], *(s["path"] for s in document["scenes"])}
    files = {name: safe_path(project.root, name).read_bytes() for name in sorted(paths)}
    if digest(files[MANIFEST]) != revision:
        raise Conflict("Demo template changed while copying")
    for asset_path, expected in document["files"].items():
        if digest(files[asset_path]) != expected:
            raise Conflict(f"Demo template asset changed: {asset_path}")
    for scene in document["scenes"]:
        tiled.decode(json.loads(files[scene["path"]]), document)
    return document, revision, files


def prepare(root, *, reset=False, title=None):
    """Copy the template once, or restore its declared files in a recoverable reset."""
    root = Path(root).absolute()
    if title is not None:
        title = name(title)
        if (root / MANIFEST).exists():
            raise ValueError("A project already exists in this directory")
    source = template_path().resolve()
    # Never allow a demo launch to overwrite the canonical template or its parents.
    if root.resolve().is_relative_to(source) or source.is_relative_to(root.resolve()):
        raise ValueError("Demo directory must be separate from the bundled template")
    safe_path(root, MANIFEST)
    if (root / MANIFEST).exists() and not reset:
        return root
    template = ProjectStore(source)
    template_document, _, files = _snapshot(template)
    if (root / MANIFEST).exists():
        lifecycle.recover(root)
        project = ProjectStore(root)
        document, revision = project.read()
        # Accept the old generated sample too, so existing .demo folders migrate.
        if document["id"] != template_document["id"] and not (
            document["name"] == "Scene Forge demo" and "sample" in document["atlases"]
        ):
            raise ValueError("Reset is only supported for a Scene Forge demo project")
        old_paths = {MANIFEST, *document["files"], *(s["path"] for s in document["scenes"])}
        changes = {name: files.get(name) for name in sorted(old_paths | files.keys())}
        expected = {
            name: digest(read_optional(safe_path(root, name))) if name in old_paths else None
            for name in changes
        }
        expected[MANIFEST] = revision
        project.transactions.apply(changes, expected, "Reset demo project")
        return root
    lifecycle.prepare_creation(root)
    root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".forge-sample-", dir=root.parent) as folder:
        staging = Path(folder) / "project"
        shutil.copytree(source, staging, ignore=shutil.ignore_patterns(".forge"))
        if title is not None:
            manifest = staging / MANIFEST
            document = json.loads(manifest.read_bytes())
            document["name"] = title
            document["id"] = str(uuid4())
            manifest.write_text(json_text(document), encoding="utf-8")
        _snapshot(ProjectStore(staging))
        lifecycle.prepare_creation(root)
        if root.exists():
            root.rmdir()
        staging.rename(root)
    return root
