"""Typed revision envelopes around runtime-validated native JSON payloads.

Native scene/manifest dictionaries intentionally retain their existing validators;
these records type the cross-service identity and revision contract, not a second
wire schema or a promise that the entire package is a typed external library.
"""

from typing import Any, TypeAlias, TypedDict

NativeDocument: TypeAlias = dict[str, Any]


class SceneRecord(TypedDict):
    id: str
    name: str
    revision: str
    scene: NativeDocument


class ProjectCatalog(TypedDict):
    project: NativeDocument
    revision: str


class ProjectSnapshot(ProjectCatalog):
    scene: SceneRecord | None


class RevisionProbe(TypedDict):
    revision: str | None
    scene_revision: str | None
