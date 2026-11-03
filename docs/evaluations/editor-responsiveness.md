# Editor responsiveness and retained resources

This evaluation covers [milestone 16](https://github.com/cliffom/gbc-scene-forge/milestone/16)
and issues #160–#164. Baseline revision:
`a268f271102e97fd9b31448b8721f0b07ddfc5ec` (published 0.29.1).
Measurements were collected on 2026-11-03 by the implementing agent on macOS arm64.
Exact runtime/browser/CPU details accompany the archived JSON under
[data/editor-responsiveness/](data/editor-responsiveness/).

## Reproduction and interpretation

Run from the repository root with installed development dependencies and Playwright
Chromium. Every fixture is disposable and uses legal native documents through the
supported Python services. The optional profiles never impose timing thresholds.

```sh
FORGE_BUILD_MODE=production npm run build
FORGE_RESPONSIVENESS_PROFILE=1 FORGE_PROFILE_LABEL=optimized FORGE_PROFILE_OUTPUT=build/performance/artwork npm run test:playwright -- responsiveness-profile.spec.ts
FORGE_SCENE_COST_PROFILE=1 FORGE_PROFILE_OUTPUT=build/performance/scene npm run test:playwright -- responsiveness-costs.spec.ts
FORGE_SCENE_COST_PROFILE=1 FORGE_COST_BASELINE=1 FORGE_PROFILE_OUTPUT=build/performance/reference npm run test:playwright -- responsiveness-costs.spec.ts
```

The scene reference bundle reads the pinned baseline revision from Git, including
its original frontend modules, and adds test-only boundary wrappers. It requires
that commit locally. The artwork profile serves the built production bundle;
`FORGE_PROFILE_BUNDLE` can serve a separately built reference bundle. Reproduce
that reference from the baseline revision in a separate checkout with the current
profile harness. Record build mode, source revision/variant and bundle digest.

Artwork workloads are saved 16²/1-frame, 128²/32-frame/8-step, 256²/128-frame,
and 256²/128-frame/256-step sprite sheets. Each uses frame and sheet views, collapsed
and expanded timelines when present, normal and 4× CDP CPU throttling, one warmup
and three measured strokes. Ordinary cases use 120 moves per stroke; the 256-step
case uses 24. Raw samples include release and Undo/Redo CPU time. The harness
preserves every synthetic pointer segment and changes color between strokes.

Canvas dimension setters, uploads, draws, `btoa`, and JSON serialization are
instrumented. Per-handler counts exclude asynchronous checkpoint work; aggregate
counts can include it during frame waits. Twelve frame waits per ordinary stroke
and three per near-limit stroke sample dispatch-to-next-rAF callback latency.
That callback precedes presentation: these are neither physical input latency nor
proof of input-to-photon timing. Handler samples exclude coordinate measurement;
frame samples include it. Checkpoint requests/payload bytes are recorded separately.

Scene profiles use minified bundles with test-only wrappers around dirty snapshots,
scene serialization, checkpoint comparison/preparation, object validation, controls
and drawing. Nested costs overlap and must not be added together. Workloads include
three tile layers (one hidden), 64/4,096 linked objects, 4/128 definitions, and
4/32 native sheets with 32 frames and eight animation entries each, plus imported
artwork. Ordinary dimensions are 16×12; the large mixed scene is 128×96. Separate
regular rendering scenarios cover the 1,023×64 cell budget and wide/tall scenes.

Resource samples force Chromium GC and report JS heap/backing storage, DOM/listener
counts and DOM canvas width×height×4 estimates. Canvas estimates exclude detached
surfaces, GPU allocation and browser-specific lazy allocation; they are not measured
resident memory. Retained document histories are intentional. Twelve switches and
three disposal/remount cycles characterize a bounded session, not hours of editing.

## Measurements and decisions

Raw measurements and variant digests are archived in
[provenance](data/editor-responsiveness/provenance.json), with result folders for
[baseline artwork](data/editor-responsiveness/baseline/),
[raster/control reuse](data/editor-responsiveness/raster-only/),
[byte comparison](data/editor-responsiveness/byte-comparison/),
[final artwork](data/editor-responsiveness/optimized/),
[original mixed sessions](data/editor-responsiveness/scene-reference/) and
[final mixed sessions](data/editor-responsiveness/scene-optimized/).
The earlier [scene baseline](data/editor-responsiveness/scene-baseline/) and
[checkpoint-only stage](data/editor-responsiveness/checkpoint-only/) used four
clean retained documents; compare the final mixed-session pair for history costs.

### Artwork interaction

All times below are **median / p95 milliseconds**, pooling the three measured
trials for each matching workload/view. Values below timer resolution can appear
as zero. Separate stages attribute gains without claiming that their medians add.

| Workload, frame view | Baseline handler | Final handler | Final release |
| --- | ---: | ---: | ---: |
| 16², 1 frame, normal CPU | 0.10 / 0.30 | 0.00 / 0.20 | 0.20 / 0.30 |
| 128², 32 frames, 8 steps, normal CPU | 1.20 / 1.60 | 0.10 / 0.20 | 1.20 / 1.40 |
| 128², 32 frames, 8 steps, CPU4 | 6.90 / 8.80 | 0.40 / 1.00 | 5.60 / 6.20 |
| 256², 128 frames, no sequence, normal CPU | 5.30 / 6.30 | 0.30 / 0.50 | 4.50 / 4.50 |
| 256², 128 frames, no sequence, CPU4 | 21.50 / 25.70 | 1.30 / 2.10 | 21.80 / 22.30 |
| 256², 128 frames, 256 steps collapsed, normal CPU | 11.20 / 12.50 | 0.40 / 0.50 | 7.60 / 9.10 |
| 256², 128 frames, 256 steps expanded, normal CPU | 592.30 / 643.90 | 2.60 / 3.70 | 8.50 / 8.50 |

| Isolated stage, 256² / 256 steps, normal CPU | Collapsed handler | Expanded handler |
| --- | ---: | ---: |
| Original | 11.20 / 12.50 | 592.30 / 643.90 |
| Raster/thumbnail reuse and unchanged disabled assignments | 7.80 / 8.90 | 12.35 / 14.00 |
| Also compare bytes instead of encoding dirty state | 6.30 / 7.00 | 10.40 / 12.60 |
| Also separate gesture painting from control synchronization | 0.40 / 0.50 | 2.60 / 3.70 |

For one measured 24-move expanded trial, backing-dimension assignments fell from
18,576 to zero, uploads from 48 to 18, crop draws from 9,264 to 96 and handler RGBA
encodes from 48 to zero. Collapsed final draws were 60. No-op pixels account for
fewer uploads than moves; unaffected thumbnails keep their stamps. The raster
retains exact bytes, including hidden RGB, while canvas pixels use browser alpha
semantics. Regular pixel assertions cover hidden timeline reveal, Undo, sequence
switches, document replacement and transparent clearing.

The original expanded 256-entry timeline exceeded 180 seconds with 120 moves.
With 24 moves its normal-CPU median was 592.3 ms in frame view and 531.1 ms in
sheet view. The original 4× run exceeded 600 seconds: no completed percentile is
claimed for that variant. Final 4× handler and scheduling samples remain separate:

| Final 256² / 256 steps / CPU4 | Handler | Release | Dispatch to next rAF |
| --- | ---: | ---: | ---: |
| frame, collapsed | 1.55 / 2.20 | 30.00 / 33.70 | 43.00 / 85.50 |
| frame, expanded | 16.00 / 18.20 | 41.20 / 45.20 | 157.00 / 206.10 |
| sheet, collapsed | 1.90 / 2.40 | 31.30 / 31.60 | 142.30 / 165.60 |
| sheet, expanded | 16.70 / 18.40 | 42.20 / 43.50 | 220.00 / 364.10 |

The remaining scheduling/presentation cost is material. At the default 16× zoom a
256² sheet uses a 4,096² display canvas (64 MiB by dimensions), in addition to
thumbnail surfaces. Faster handlers do not guarantee a 60 Hz frame. Retain the
current display/grid/selection raster contract in this pass: changing display
resolution or virtualizing timeline controls needs separate visual and physical-
device evidence. Long-task observations include cold setup, release, history and
browser painting; they are not attributed solely to pointer handlers.

### Scene controls and checkpoints

Original/final mixed-session profiles add 24 completed strokes plus review/save
for each of four retained artwork documents, then twelve switches and three
mount/dispose cycles. Scene workloads include real selection, a tile stroke,
checkpoint acknowledgment, pan/zoom, Undo/Redo and save. Library search, animation
playback and revision refresh run through supported controllers.

Keep exact dirty snapshots and object validation on control refresh. Their large-
scene medians are around 1 ms and 1.5–3 ms respectively; another persistent mutation
cache would introduce broad invalidation obligations for limited demonstrated gain.
Instead, immutable checkpoint JSON removes the second previous-scene encoding,
and the object selector compares labels/order/IDs before rebuilding options.

Scene cost tables below distinguish paint from control refresh; nested aggregate
costs remain overlapping. Library search/open phase times include Playwright and
server waits and are not pure input-handler CPU. Requests record payload sizes;
the largest mixed-session request was under 1 MiB. No new worker, virtualization,
spatial index, global event bus or mandatory dependency was introduced.

| Large mixed scene, median / p95 ms | Original | Final |
| --- | ---: | ---: |
| Dirty snapshot during tile stroke | 0.90 / 1.00 | 0.90 / 1.00 |
| Validation during tile stroke | 1.90 / 2.10 | 1.90 / 2.00 |
| Checkpoint comparison during selection | 1.00 / 1.10 | 0.50 / 0.60 |
| Controls during selection | 17.30 / 18.80 | 6.40 / 15.80 |
| Repaint during selection (includes viewport layout) | 24.60 / 27.30 | 8.00 / 27.20 |
| Draw including controls during selection | 43.60 / 44.90 | 15.70 / 44.40 |
| Controls during retained-document switching | 143.20 / 147.40 | 7.95 / 8.80 |

| Observational phase elapsed ms (one trial, includes automation/server/polling) | Ordinary original / final | Large original / final |
| --- | ---: | ---: |
| open | 110 / 85 | 699 / 649 |
| library-search | 57 / 40 | 182 / 143 |
| external-refresh | 1024 / 1505 | 2450 / 2540 |
| repeated-switch | 2430 / 1890 | 13253 / 5877 |

The external-refresh phase commits a guarded scene rename from a separate Python
process and waits for automatic browser adoption while the scene remains saved.
That elapsed time includes the external write and polling interval. The independent
MCP/browser suite also checks preservation of dirty and in-flight work.

### Retained resources

Four 128² documents with 24 history snapshots each intentionally retain about
6 MiB of pixel history, plus document/candidate pixels and at most two decoded
baselines per session. Final large-session typed-array/string backing storage grew
from approximately 0.55 MB to 7.64 MB while retained, then returned to approximately
0.58 MB on disposal. JS heap, embedder memory and backing storage are different
measurements and must not be added as a resident-memory estimate.

In the comparable large run, disposal reduced the DOM-canvas dimension estimate
from 12,121,728 bytes before this work to 6,043,488 bytes after it: about 6.08 MB
released, with 40 artwork thumbnails removed. Remaining surfaces belong to reused
host markup (scene/library/review), not active artwork sessions. Listener counts
returned to 30 in both variants. Canvas counts, backing storage and listeners
plateaued across the three disposed remounts. JS heap did not return to the initial
cold value; these bounded samples do not certify absence of all leaks.

Initial mixed fixtures with default-expanded properties exceeded the existing
4 MiB serialized scene bound. The final legal fixture uses required fields without
defaults. Earlier harness assertions needed corrected Library labels, visible
popover targeting and live descriptor geometry. These were harness/fixture failures,
not product-pass claims, and the material timeout/limit facts remain in provenance.

### Validation

- `make docs-check lint test`: passed, including 429 Python tests and all TypeScript suites.
- Final `make lint docs-check`: passed after the thumbnail and profiling changes.
- `FORGE_BUILD_MODE=production make build check-dist`: passed, including seven fresh installed-wheel checks.
- `FORGE_BUILD_MODE=production make test-browser`: 101 passed, 11 optional profile cases skipped, no retries.
- Installed-wheel first-use browser: one passed.
- Fresh wheel with optional MCP: 81 tests passed; all three MCP/browser refresh scenarios passed.
- Final optional artwork matrix: eight passed, including the 4× near-limit case.
- Comparable optional scene/resource matrix: original and final ordinary/large cases passed; exact raw samples are linked above.

Agent visual inspection of the production 0.29.2 [desktop view](data/editor-responsiveness/screenshots/desktop.png)
(1,440×1,000) and [compact view](data/editor-responsiveness/screenshots/compact.png)
(800×900) found rendered pixels, transparency/grid/selection and review output
consistent with the exercised workflows. These snapshots are agent inspection,
not independent user evidence or a complete visual matrix.

Official Tiled/rasterizer applications were unavailable. No Windows, non-Chromium,
human usability or physical-device latency check was performed. Unperformed checks
remain only in the [validation checklist](../VALIDATION.md#remaining-checks).

## Regression budgets and practical limits

The regular artwork count regression requires zero dimension assignments and zero
RGBA encodes inside warm pointer-move handlers, at most one raster upload per move,
and at most five crop draws per move for its affected-frame workload. No-op pixels
can reduce those counts further. These bounds derive from the owned source, main
view and affected thumbnail/preview consumers; timing is not a CI assertion.

A 16.7 ms frame and a 50 ms long-task boundary are useful interpretation references,
not guarantees or newly invented pass thresholds. Compare each workload with its
own baseline. CPU throttling approximates slower execution on this host; it does
not emulate a different GPU, display or memory subsystem. Other applications and
some independent validation runs shared the host, so small timing differences are
not evidence of an improvement or regression. No historical feature-growth regression
or human drawing comfort is established by these measurements.

## Artwork ownership extraction comparison (#168)

On 2026-11-03 the implementing agent compared production bundles from
`166eda046c4121452615e16048100ad48107e0d6` and the ownership-extraction working
tree based on that revision. The host reported Darwin 27.0.0 arm64, Apple M4 Max
(16 logical CPUs), Python 3.13.13, Node 24.22.1 and Chromium 156.0.8078.4.
Baseline bundle SHA-256:
`3f4a448edf288329f5f94578ca1e10f8f3130c1619e730a950e46a460d76e170`.
Extracted bundle SHA-256:
`91b8f89cc7ecc46bf862552b48aa0b2786714521e10a390fcb627fa353faf4c8`.

The unchanged [artwork profile](../../tests/playwright/artwork/responsiveness-profile.spec.ts)
ran all eight workloads before and after extraction, using the reproduction
procedure above. `FORGE_PROFILE_BUNDLE` selected a saved baseline bundle;
`FORGE_PROFILE_LABEL` identified each variant. Both runs passed. Exact
per-handler resize/upload/draw/encode counts matched across all 24 view/timeline
phases and 72 measured trials. Warm handlers retained zero dimension assignments
and RGBA encodes. For the 128² workload each 120-move trial retained 74 uploads
and 268 collapsed / 342 expanded crop draws in both frame and sheet views.

Frame-view handler times below are pooled **median / p95 milliseconds**, using
the lower order statistic at `floor((n - 1) × percentile)` across three measured
trials. Timeline state is collapsed unless indicated.

| Workload | Before extraction | After extraction |
| --- | ---: | ---: |
| 16² / 1 frame / CPU1 | 0.00 / 0.20 | 0.00 / 0.20 |
| 16² / 1 frame / CPU4 | 0.00 / 0.80 | 0.00 / 0.90 |
| 128² / 32 frames / 8 steps / CPU1 | 0.10 / 0.20 | 0.10 / 0.20 |
| 128² / 32 frames / 8 steps / CPU4 | 0.50 / 1.20 | 0.50 / 1.10 |
| 256² / 128 frames / no sequence / CPU1 | 0.30 / 0.50 | 0.30 / 0.50 |
| 256² / 128 frames / no sequence / CPU4 | 1.50 / 2.10 | 1.40 / 2.20 |
| 256² / 128 frames / 256 steps / CPU1 | 2.50 / 2.90 | 2.60 / 3.00 |
| 256² / 128 frames / 256 steps / CPU4 | 11.90 / 13.00 | 11.80 / 12.70 |
| 256² / 128 frames / 256 steps expanded / CPU1 | 6.70 / 7.90 | 7.00 / 8.50 |
| 256² / 128 frames / 256 steps expanded / CPU4 | 34.20 / 38.40 | 33.90 / 37.00 |

These are synthetic local observations. Other validation work shared the host
during part of the baseline; small timing differences do not establish a speed
change. The identical work counts support retaining the measured optimizations.
This comparison does not rerun or replace the earlier milestone-16 baseline,
scene/resource matrix or physical-device checks. Raw local JSON lives under
ignored `build/issue-168/{before,after}/` and is not an archived capture; the table,
digests and workload definition above are the committed comparison record.
