"""Reproduce the original synthetic cleanup comparison and bounded scan timing.

Run from the checkout: python tests/support/measure_cleanup.py --output /tmp/cleanup-evidence
Output contains no saved project, source identities or external artwork.
"""

import argparse
import hashlib
import json
import platform
import tempfile
from pathlib import Path
from time import perf_counter

from cleanup_fixture import fixture

from gbc_scene_forge.artwork import cleanup, png, workshop
from gbc_scene_forge.project.application import Project


def measure(output):
    output.mkdir(parents=True, exist_ok=True)
    spec, raw = fixture()
    with tempfile.TemporaryDirectory() as root:
        project = Project.create(root, "Cleanup measurements")
        candidate = workshop.with_sources(
            project.artwork.documents.create(
                "motif", "Motif", "sprite", 16, 16, project.catalog()["revision"]
            ),
            {"composite": raw},
        )
        results = {}
        (output / "before.png").write_bytes(png.encode(16, 16, raw))
        for label, profile in (
            ("protected", spec["protected_profile"]),
            ("unprotected", {}),
            ("four-connected", {"connectivity": 4}),
        ):
            analysis = cleanup.analyze(candidate, profile)
            result = cleanup.preview(
                candidate, analysis["proposal"], [f["id"] for f in analysis["findings"]]
            )
            images = cleanup.images(candidate, result["candidate"], None, result["changes"])
            (output / (label + ".png")).write_bytes(images["after"])
            (output / (label + "-changes.png")).write_bytes(images["changes"])
            results[label] = dict(
                changed_pixels=result["changed_pixels"],
                changes=result["changes"],
                hard_checks=result["validation"]["hard_checks"],
            )
        large = project.artwork.documents.create(
            "uniform", "Uniform", "sprite", 1024, 1024, project.catalog()["revision"]
        )
        large = workshop.with_sources(large, {"composite": bytes([32, 24, 48, 255]) * 1024 * 1024})
        start = perf_counter()
        analysis = cleanup.analyze(large, {})
        elapsed = perf_counter() - start
        report = dict(
            python=platform.python_version(),
            platform=platform.platform(),
            implementation_sha256=hashlib.sha256(Path(cleanup.__file__).read_bytes()).hexdigest(),
            motif_rgba_sha256=hashlib.sha256(raw).hexdigest(),
            results=results,
            uniform_scan=dict(
                width=1024,
                height=1024,
                findings=analysis["total_findings"],
                seconds=elapsed,
                samples=1,
                includes="candidate validation and analysis",
            ),
            limits="Original synthetic opaque flat motif and one uniform maximum-area scan, one timing sample. No general artistic quality, worst-case latency or total-process memory claim. Generated art from the discussion is not redistributed.",
        )
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(
            json.dumps(
                {
                    "results": {k: v["changed_pixels"] for k, v in results.items()},
                    "uniform_scan": report["uniform_scan"],
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    measure(parser.parse_args().output)
