# Selective pixel cleanup (#218)

This evaluation covers the 0.36.0 working tree based on `decbee7`, measured on
2026-11-04 with Python 3.13.13 on macOS arm64. The implementation hash and exact
environment are recorded in the [archived measurement](../../tests/fixtures/pixel-cleanup/results/report.json).
It evaluates deterministic structural behavior, not general artistic quality.

## Reproducible inputs and results

The original MIT [synthetic motif](../../tests/fixtures/pixel-cleanup/motif.json)
declares a seven-cell diagonal line, a pale region with an intentional glint,
and two nearby-color noise pixels. Its expected protected changes were specified
independently of the algorithm. No user-supplied generated artwork is redistributed.
The attachment experiment and its limits are described in
[#218](https://github.com/cliffom/gbc-scene-forge/issues/218).

Run from the checkout with the development environment:

```sh
python tests/support/measure_cleanup.py --output /tmp/cleanup-evidence
python examples/mcp/pixel_cleanup.py --output /tmp/cleanup-sdk
```

The second output directory must be fresh. The first command archives PNGs and a
JSON report, including implementation and source-RGBA hashes. The second uses the
official stdio SDK, reads PNG resources, explicitly selects the two known noise
findings, validates, rejects a stale receipt, reviews/commits, and compares every
saved/reopened source byte. Its selection is a technical fixture expectation,
not an automated judgment about an unknown image.

| Variant | Changed native cells | Observed implication |
| --- | ---: | --- |
| Default eight-connectivity, protected glint | 2 | Removes the declared noise; preserves glint and diagonal |
| Default eight-connectivity, no protection | 3 | Also removes the intentional glint: a known artistic failure |
| Four-connectivity, no protection | 10 | Also removes all seven diagonal-line cells: a structural failure |

Inspect the archived [before](../../tests/fixtures/pixel-cleanup/results/before.png),
[protected output](../../tests/fixtures/pixel-cleanup/results/protected.png),
[protected edits](../../tests/fixtures/pixel-cleanup/results/protected-changes.png),
[unprotected output](../../tests/fixtures/pixel-cleanup/results/unprotected.png) and
[four-connected damage](../../tests/fixtures/pixel-cleanup/results/four-connected.png).
The JSON records all exact changed coordinates and hard-check outcomes.

## Bounded runtime and correctness checks

A single 1,024×1,024 uniform opaque source scan, including candidate validation
and analysis, took approximately 2.4 seconds and returned zero findings. This is
one local sample at the maximum scan area, not a worst-case or interactive-latency
guarantee. It does not measure large-layer composition, PNG encoding, peak process
memory or adversarial texture. Admission work and storage bounds are documented
in the [MCP contract](../MCP.md#selective-pixel-cleanup).

[Domain regressions](../../tests/backend/artwork/test_cleanup.py) cover exact
expected changes, deterministic ties, diagonal structure, protected pixels and
regions, scan boundaries, partial alpha/hidden RGB, locks, other layers,
palette/count constraints, stale plans, pagination and limit rejection.
[MCP regressions](../../tests/backend/adapters/test_mcp_cleanup.py) cover compact
recovery, source PNGs, exact native change maps, unsampled overview edit markers,
independent actual-output validation, saved-layer fidelity and stale receipts.

The tool exposes no semantic feature protection or quality score. It cannot infer
which glints, stars, textured regions or silhouette choices are intentional.
Connected-plane consolidation and outline repair remain separate design work.
Current execution results and remaining checks belong in the
[validation record](../VALIDATION.md).
