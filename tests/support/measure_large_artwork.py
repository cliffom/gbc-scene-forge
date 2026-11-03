"""Observational native-artwork timings; run with the installed project interpreter."""

import base64
import json
import platform
import random
import resource
import tempfile
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from gbc_scene_forge.artwork import editable
from gbc_scene_forge.artwork.drafts import ArtworkDrafts
from gbc_scene_forge.project.application import Project


def measure(width, height):
    with tempfile.TemporaryDirectory(prefix="forge-large-measure-") as temporary:
        project = Project.create(Path(temporary) / "project", "Measured card")
        art = project.artwork.documents
        times = {}

        def timed(name, work):
            start = perf_counter()
            result = work()
            times[name] = round((perf_counter() - start) * 1000, 1)
            times[name.replace("_ms", "_peak_rss")] = resource.getrusage(
                resource.RUSAGE_SELF
            ).ru_maxrss
            return result

        original = timed(
            "create_ms",
            lambda: art.create(
                "card", "Card", "sprite", width, height, project.catalog()["revision"]
            ),
        )
        # Deterministic incompressible channels exercise payload budgets, including
        # hidden RGB and all alpha values. Population is separate from edit timing.
        raw = random.Random(181).randbytes(width * height * 4)
        candidate = editable.seal(
            {
                **{k: v for k, v in original.items() if k != "revision"},
                "rgba": base64.b64encode(raw).decode(),
            }
        )
        candidate = timed(
            "edit_ms",
            lambda: art.edit(
                candidate, [{"x": width - 1, "y": height - 1, "rgba": [77, 88, 99, 0]}]
            ),
        )
        drafts = ArtworkDrafts(art)
        data = dict(
            id=str(uuid4()),
            owner=str(uuid4()),
            project_id=candidate["project_id"],
            original=original,
            candidate=candidate,
            name="Card",
            revision=None,
        )
        draft = timed("checkpoint_ms", lambda: drafts.write(data))
        recovered = timed("recover_ms", lambda: drafts.restore(data["id"], draft["revision"]))
        assert recovered["candidate"]["rgba"] == candidate["rgba"]
        report = timed("review_ms", lambda: project.artwork.reviews.review(candidate))
        acknowledgment = timed("save_ms", lambda: art.save(candidate, receipt=report["receipt"]))
        target = dict(document_id=candidate["document_id"], atlas_id="card", region="artwork")
        reopened = timed(
            "reopen_ms",
            lambda: Project(project.root).artwork.documents.open(
                target, acknowledgment["project_revision"], acknowledgment["artwork_revision"]
            ),
        )
        assert reopened["rgba"] == candidate["rgba"]
        exported = timed(
            "export_ms",
            lambda: project.export_bundle("project", acknowledgment["project_revision"]),
        )
        return dict(
            width=width, height=height, rgba_bytes=len(raw), zip_bytes=len(exported[0]), **times
        )


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "platform": platform.platform(),
                "python": platform.python_version(),
                "cases": [
                    measure(w, h) for w, h in ((375, 525), (822, 1122), (1500, 2100), (2048, 2048))
                ],
                "process_peak_rss_platform_units": resource.getrusage(
                    resource.RUSAGE_SELF
                ).ru_maxrss,
            },
            indent=2,
        )
    )
