"""Standalone project composition root; domain services own authoring operations."""

from pathlib import Path

from gbc_scene_forge.analysis.service import ReportService
from gbc_scene_forge.artwork.service import ArtworkService
from gbc_scene_forge.core.identities import name
from gbc_scene_forge.core.records import NativeDocument, ProjectCatalog
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.formats import exporting
from gbc_scene_forge.planning.service import PlanningService
from gbc_scene_forge.scene_objects.service import ObjectService
from gbc_scene_forge.scenes.service import SceneService
from gbc_scene_forge.storage.paths import safe_path

from . import lifecycle
from .intake import IntakeService
from .schema import MANIFEST
from .store import ProjectStore


class Project:
    """Compose services around one declared project and durable transaction store."""

    def __init__(self, root: str | Path, *, recover: bool = True) -> None:
        self.root = Path(root).absolute()
        safe_path(self.root, MANIFEST)
        require(self.root.is_dir(), "Project directory does not exist")
        if recover:
            lifecycle.recover(self.root)
        self.store = ProjectStore(self.root)
        self.store.read()
        self.transactions = self.store.transactions
        self.scenes = SceneService(self.store)
        self.artwork = ArtworkService(self.store)
        self.imports = IntakeService(self.store)
        self.objects = ObjectService(self.store)
        self.planning = PlanningService(self.store)
        self.reports = ReportService(self.store)

    @classmethod
    def create(cls, root: str | Path, title: str, *, starter: str = "empty") -> "Project":
        if starter == "sample":
            return cls.from_sample(root, title=name(title))
        return cls(lifecycle.create(root, title, starter=starter))

    @classmethod
    def from_sample(
        cls, root: str | Path, *, reset: bool = False, title: str | None = None
    ) -> "Project":
        """Copy/reset the bundled project, then compose normal authoring services."""
        from .sample import prepare

        return cls(prepare(root, reset=reset, title=title))

    @staticmethod
    def recover(root: str | Path) -> None:
        lifecycle.recover(root)

    @staticmethod
    def prepare_creation(root: str | Path) -> None:
        lifecycle.prepare_creation(root)

    def read(self) -> tuple[NativeDocument, str]:
        return self.store.read()

    def catalog(self) -> ProjectCatalog:
        return self.store.catalog()

    def export_bundle(
        self,
        scope: str,
        revision: str,
        scene_id: str | None = None,
        scene: NativeDocument | None = None,
        scene_revision: str | None = None,
    ) -> tuple[bytes, str]:
        return exporting.export_bundle(self.store, scope, revision, scene_id, scene, scene_revision)
