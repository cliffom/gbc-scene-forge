"""Version 1 of the local connector contract. No game or renderer dependencies."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

CONTRACT_VERSION = 1


@dataclass(frozen=True)
class Workspace:
    root: Path
    drafts: Path
    history: str = "assets/scenes/history"
    reviews: str = "build/review/scene-editor"


@dataclass(frozen=True)
class CheckStep:
    label: str
    command: tuple[str, ...]


@dataclass(frozen=True)
class BuildPlan:
    sources: tuple[str, ...]
    outputs: tuple[str, ...]
    artifacts: tuple[str, ...]
    checks: tuple[CheckStep, ...]
    review: dict
    approval: dict | None = None
    environment: dict = field(default_factory=dict)
    message: str = "Reviewed project files updated."


class Connector(Protocol):
    identity: str
    contract_version: int
    workspace: Workspace

    def catalog(self) -> dict: ...
    def load(self, target: str, *, template: bool = False) -> dict: ...
    def normalize(self, scene: dict) -> dict: ...
    def check_shape(self, scene: dict) -> None: ...
    def source_revision(self, target: str) -> str: ...
    def preview(self, scene: dict, light: str | None, state: str | None, frame: int) -> dict: ...
    def validate(self, scene: dict) -> dict: ...
    def compare(self, scene: dict) -> dict: ...
    def export(self, scene: dict) -> bytes: ...
    def asset(self, name: str) -> bytes: ...
    def input_files(self, root: Path) -> list[str]: ...
    def output_files(self, root: Path) -> tuple[str, ...]: ...
    def prepare(self, scene: dict, stage: Path, review_id: str) -> BuildPlan: ...
    def approve(self, plan: BuildPlan, stage: Path, review_id: str) -> None: ...
    def activity(self, text: str, fallback: str) -> str: ...
    def refresh(self) -> None: ...


def check_connector(connector):
    if connector.contract_version != CONTRACT_VERSION:
        raise ValueError("Unsupported scene connector contract version")
    if not isinstance(connector.identity, str) or not connector.identity:
        raise ValueError("A connector must have a stable identity")
    catalog = connector.catalog()
    if (
        catalog.get("contract_version") != CONTRACT_VERSION
        or catalog.get("connector") != connector.identity
    ):
        raise ValueError("Catalog does not match the connector contract")
    if not isinstance(catalog.get("capabilities"), dict) or not catalog.get("profiles"):
        raise ValueError("Connector must describe capabilities and at least one scene")
    for descriptor in catalog["profiles"].values():
        if descriptor.get("animation_frames") and (
            not isinstance(descriptor.get("animation_interval_ms"), (int, float))
            or descriptor["animation_interval_ms"] <= 0
        ):
            raise ValueError("Animated previews need a positive frame interval")
        if (
            type(descriptor.get("cell_size")) is not int
            or descriptor["cell_size"] <= 0
            or not descriptor.get("erase_cell")
            or not descriptor.get("lighting")
            or not descriptor.get("states")
        ):
            raise ValueError("Scene descriptors need cell size, erase cell and preview modes")
