# Artwork opening and layered visibility (#202, #207)

## Method and provenance

Measured locally on 2026-11-04, macOS 27.0.0 arm64 / Apple M4 Max,
Python 3.13.13, Node 24.22.1 and Playwright Chromium 156.0.8078.4 at
1440×1000. Baseline source is `4058c30` (production 0.33.2); the after result
uses the prepared 0.33.3 working tree based on that revision. Bundle SHA-256
values distinguish the exact assets in the [baseline](data/artwork-opening/baseline.json)
and [after](data/artwork-opening/after.json) records. This is local synthetic
agent evidence, not the user's running project or independently archived CI.

The shared [fixture](../../tests/playwright/support/artwork-opening-fixture.ts)
creates three generic, opaque/nonempty documents in a disposable project:
16×16 flat, 750×1050 flat, and 384×544 with three distinct full-canvas layers.
The [profile](../../tests/playwright/artwork/opening-profile.spec.ts) opens each
asset three times, explicitly closes the retained document after every open,
and reloads the page before changing fixture size. One Python server owns all
nine opens: the first small open includes cold native verification; later opens
can reuse the server's verification proof. Browser/resource caches are not
flushed. These are fresh document decodes, not retained-tab activation timings.

Selection-to-feedback is the first animation frame observing the visible loading
state. Selection-to-editable ends after controls become usable and a second
animation frame. Neither is a physical display measurement. Visibility samples
measure the synchronous checkbox dispatch and a double-animation-frame proxy,
six times after the previous checkpoint completes. CPU profiles are separately
attached to the local Playwright report; profiling output is ignored, not an
archived repository artifact. Timing thresholds are evaluation targets for this
fixture/environment, not CI assertions or hardware-independent guarantees.

With a production frontend already built, run the final measurements alone:

```sh
FORGE_PROFILE_OUTPUT=docs/evaluations/data/artwork-opening/after.json \
  npm exec -- playwright test --config tests/playwright/playwright.config.ts opening-profile.spec.ts
```

`FORGE_PROFILE_BUNDLE` can substitute a saved baseline bundle. Opening CPU
sampling is opt-in with `FORGE_OPENING_CPU=1`; neither timing record enables it.

## Findings and changes

The baseline reproduces #202: visibility handlers take 769–792 ms. Metadata
changes reached repeated layer copies, composition and decoded-baseline churn;
the two-entry cache could not hold three distinct sources. Dirty reads now check
the descriptor first, compare live layer sources without cloning/compositing,
and retain decoded baselines within 32 MiB and 18 entries per session (two maximum
aggregate documents). Equality itself remains uncached: pixel edits, direct byte mutation,
Undo, restored saved bases and hidden RGB still affect state. Layer sources plus
their descriptor determine the canonical composite. History/checkpoint snapshots
continue to own copies; this optimization does not expose live buffers to writers.

Opening also repeatedly called native verification through inventory, opening
and revalidation. Verification decoded every native PNG and recomposited layers,
including unrelated documents. The store now remembers one successful manifest
revision. It still hashes every declared file on every guarded check; an exact
manifest/digest match permits reuse of prior native semantic verification. A new
manifest forces verification, and failure never records a proof. Tests alter
bytes while preserving size/timestamps and supply a hash-consistent invalid
composite to distinguish content guards from stat caches and file hashes alone.

The workspace now paints a named loading surface before suspension/decoding,
with Cancel opening and actionable retry after failure. Source/copy setup appears
when requested or when an imported source needs copying. Reads are fenced by
operation and mount lifetime; selecting another asset supersedes the pending
read. Outgoing checkpoint writes complete before replacement and are never
aborted as if they were reads. Failed suspension leaves the document/history
available. Late reads cannot adopt inventory, documents or errors for another
operation.

## Results and targets

The exact samples remain in the linked JSON records. Final production-candidate
measurements, rounded to milliseconds:

| Interaction                                | Baseline 0.33.2 | Prepared 0.33.3 |
| ------------------------------------------ | --------------: | --------------: |
| Small first open, cold native verification |        1,254 ms |          369 ms |
| Small repeated opens                       |  1,245–1,293 ms |        75–79 ms |
| Large opens                                |  1,500–1,532 ms |      167–171 ms |
| Three-layer opens                          |  3,857–3,887 ms |      772–811 ms |
| Visibility handler, six samples            |      769–792 ms |        58–76 ms |
| Loading feedback, nine opens               |          Absent |         2–13 ms |

The visibility-handler median fell from 783 to 67 ms, about 91%. All nine after
opens showed loading feedback and never displayed the chooser; every baseline
open displayed the chooser. Small timing variation is expected.

Targets selected from these observations: loading feedback within 50 ms;
first small open under 500 ms, subsequent small opens under 150 ms, large opens
under 300 ms, layered opens under 1,000 ms; visibility handlers under 100 ms.
Stable CI regressions assert avoided decoding/composition, exact state, guarded
verification and asynchronous ownership rather than these machine-specific times.

## UI inspection and limits

The [desktop](../screenshots/artwork-opening/desktop.png) and
[760×640 compact](../screenshots/artwork-opening/compact.png) captures retain
an actual delayed loading state. The browser cases also inject failures,
checkpoint conflicts and late completions, preserve another document's Undo/Redo,
and verify keyboard-reachable cancellation. See the [validation record](../VALIDATION.md)
for final check results and remaining platform/human coverage.

No independent-user comfort, physical-display latency, Windows/non-Chromium or
maximum-budget layered-artwork performance claim is made. Layer composition,
recovery serialization and server decoding still have real costs. No published
package is represented by these working-tree measurements.
