# Scene rendering and history scalability (#78, #92, #93)

Measured 2026-11-01 UTC on Apple M4 Max, macOS 27.0.1 arm64, Node
24.22.1, Python 3.13.13 and Playwright 1.64.1 bundled headless Chromium.
Rendering uses a 1440×1000 viewport and production/minified bundles. Before is
`40d3374` (prepared 0.21.1); after is this working-tree implementation based on
that revision. These are local CPU observations, not GPU, presentation latency,
physical input, cross-platform performance or a promised frame rate.

The [data](scalability-data.json) retains raw repaint-matrix samples and history
results, plus summaries of the existing hover/paint/animation harness. The older
[repainting record](canvas-repainting.md) remains historical. Browser reports in
ignored `build/` directories are local diagnostics, not archived evidence.

## Method and reproduction

```sh
node tests/support/profile_history.mjs
FORGE_BUILD_MODE=production npm run build
FORGE_SCALABILITY_PROFILE=1 npx playwright test --config tests/playwright/playwright.config.ts scalability-profile.spec.ts
npx playwright test --config tests/playwright/playwright.config.ts rendering.spec.ts scalability.spec.ts
```

Set `FORGE_FOREST_PROJECT` to a Forest project directory to include the consumer
workload. The test copies it into a disposable directory before opening/editing.
Regular acceptance skips the two optional observational matrix cases; timings have
no CI thresholds. `tests/fixtures/rendering-baseline/` freezes the renderer,
viewport and model from `40d3374`, with their original relative imports resolved
against current sources by the browser harness. These are comparison fixtures,
not supported implementations or an additional application entry point. They
also allow shallow CI checkouts to run without historical Git objects.

The matrix compares the original renderer, visible-cell direct rendering with
caching disabled in the test bundle, and the shipped bounded chunk renderer.
It measures 30 synchronous control-triggered repaints at fit, 1× and 4×, at the
beginning, middle and far edge on both axes. Context save/restore brackets CPU
painting; this excludes most control rebuilding. Test-only source instrumentation
counts cells examined: direct traversal for the first two modes, cells copied and
serialized for visible chunks in the third. Image counts cover composition into
the scene canvas; separate raster counts cover rebuilding tile chunks. Samples
start after zoom/scroll has warmed the view, so cold raster cost is not hidden
inside the reported warm timing. The mutation workload below includes rebuilding.

Small synthetic scenes are 16×12/grid-8; large are 128×96/grid-8. Three tile
layers surround a sprite layer, with dense occupancy of 100%/25%/25%, or sparse
occupancy of 1/16 on every tile layer. An additional hidden layer is present in
the existing rendering harness, which measures real pointer strokes, coalesced
hover bursts and sprite animation/movement preview callbacks. Instrumentation
adds overhead; absolute timings across different harnesses are not comparable.

## Rendering results and decision

Middle-position warm medians in milliseconds; visited cells and scene-image
draws are per repaint. Fit and 1× expose the entire large scene in review layout.
The 4× large view occupies about 9.6% of scene area. Raw data includes all positions.

| Workload | Original visits / draws / ms | Culled direct visits / draws / ms | Cached visits / draws / ms |
| --- | --- | --- | --- |
| Large dense, fit | 36,864 / 18,433 / 24.75 | 36,864 / 18,433 / 24.00 | 36,864 / 37 / 0.40 |
| Large dense, 4× | 36,864 / 18,433 / 24.80 | 3,864 / 1,933 / 3.85 | 6,144 / 7 / 0.10 |
| Large sparse, fit | 36,864 / 2,305 / 5.35 | 36,864 / 2,305 / 5.45 | 36,864 / 37 / 0.30 |
| Large sparse, 4× | 36,864 / 2,305 / 5.40 | 3,864 / 241 / 0.20 | 6,144 / 7 / 0.10 |
| Forest, fit | 17,280 / 6,956 / 12.20 | 17,280 / 6,956 / 12.30 | 17,280 / 6,956 / 12.70 |
| Forest, 1× | 17,280 / 6,956 / 12.30 | 3,312 / 2,300 / 1.20 | 3,456 / 1,220 / 0.80 |
| Forest, 4× | 17,280 / 6,956 / 12.20 | 864 / 1,484 / 0.70 | 1,152 / 1,204 / 0.70 |

Small dense fit repaints reduce 289 scene-image draws to four; sparse reduces 37
to four. Their warm CPU medians are at or near timer resolution (0–0.2 ms), with
some small sparse samples slower after caching. All positions remain fully visible
at 1×/4× for these small scenes. Fit culls nothing when the scene is fully exposed.
Chunk overscan intentionally examines more cells than exact visible-cell traversal.

The existing 1× editing harness gives these per-dispatch/callback median timings;
painting contains 120 moves in one captured stroke. Animation contains 15 paints.
Only scene composition draws are counted in this table; chunk rebuilding occurs
on the side canvases and its CPU cost is included in timings.

| Scene | Painting ms before → after | Animation ms before → after | Scene draws per animation paint before → after |
| --- | --- | --- | --- |
| Small dense | 0.50 → 0.60 | 0.70 → 0.50 | 289 → 4 |
| Large dense | 26.40 → 2.45 | 26.20 → 3.50 | 18,433 → 37 |
| Small sparse | 0.40 → 0.40 | 0.50 → 0.50 | 37 → 4 |
| Large sparse | 6.40 → 1.40 | 1.90 → 0.90 | 2,305 → 37 |

Warm reuse performs zero tile raster draws, verified separately by instrumenting
real Canvas2D contexts. A changed chunk rerasterizes its cells; unchanged chunks
remain reusable even during an unfinished stroke. Hover keeps its existing
one-frame scheduling; authored and animation rendering stays synchronous.

Transparent per-layer chunks are justified by the dense transient workload and
bounded zoomed views. A single flattened scene cache cannot preserve a moving
object between tile layers. Whole-layer caching would need 9 MiB for three large
synthetic layers and 16.875 MiB for Forest's four tile layers, before the main
canvas; large permitted scenes/layer counts grow much further. Chunks cap retained
RGBA backing storage at 16 MiB per mounted editor, with LRU eviction and explicit
backing release. Edge chunks use their actual scene dimensions. Small scenes use
0.14 MiB for three layers; a fully warmed large synthetic scene uses 9 MiB.
Signatures, region references and browser/GPU overhead are additional, not included
in this bitmap accounting. The main full-scene canvas remains allocated.

If the conservative visible-chunk estimate exceeds 16 MiB, the renderer uses
culled direct drawing for that view. This avoids eviction/rebuild cycling: Forest
fit requires up to 30 MiB of padded chunks and deliberately retains the original
work/timing. Previously allocated entries remain bounded and reusable on zoom.
This trades a bounded cache for no fit-view speedup on that workload.

### Consumer provenance and limits

The local active Forest directory was empty. The test used its archived actual
`CURRENT - Mosslight Trail v4 - Full Artwork` scene, ID
`902e3936-b308-4f85-8a5b-dd57daeb7d13`, from
`wardner-gbc/assets/archive/forest-authoring-2026-10-31/planning/scene-forge/forest/`.
The checkout HEAD was `73acfe1add8b918e26dc27f3b7dd7a07129bea1f`; scene SHA-256
was `f548c5b343a03b409ea1745bd3e23563182e4536b28217acbb48c113c8cb3909`.
No consumer artwork or project files are copied into this repository.

This is the actual consolidated 480×9/grid-16 scene (7,680×144 pixels), with four
tile layers and ten interleaved object layers. At 1× the viewport exposes about
18–19% of its area; 4× exposes 4.6–4.7%. Beginning/middle/far-edge results have the
same work counts in their mode; cached 1× repaint medians are around 0.7–0.8 ms,
and 4× around 0.6–0.7 ms. The test also erases/undoes a background cell, makes a
selection and displays terrain/collision overlays in a disposable copy without
saving. This establishes automated interaction correctness, not a human judgment
that prolonged editing is comfortable. Current v5 authoring and consumer runtime
encounter behavior are outside this measurement.

All objects still traverse in layer order, including 1,196 Forest sprite draws.
Their measured residual CPU cost did not justify a spatial object index here.
Animated frames, movement positions, pivots and offscreen origins therefore retain
the original path and cannot be culled by an incorrect origin-only test. Browser
clipping handles their visible intersections. Object-heavy workloads may still
benefit from a separately measured object optimization.

## Cache and viewport contracts

`editor-rendering.mts` owns the cache for one mounted editor; editor replacement
clears it on the next draw and lifetime disposal releases all backing stores.
Each layer/chunk key includes layer ID, grid size and chunk coordinates. Every draw
compares current cell content (including transforms) and every referenced region
object, including missing regions. No cached authored revision or change counter
is trusted. Strokes, cancellation, undo/redo, resize, save/revert, recovery and
external adoption therefore either match current content or rebuild. Artwork
import/reimport/deletion replaces/removes derived regions and invalidates chunks
using them. Switching scenes creates a different editor and clears all chunks.
Hidden/deleted layers may leave bounded LRU entries until eviction/disposal;
layer visibility and order are read live during composition.

Grid, metadata, blockout geometry/labels, selection, hover and preview objects
remain uncached. Layer order, transparency and transformed artwork are preserved.
Scene bounds come from actual canvas/viewport client geometry, including borders,
scrollbars and fractional CSS scales, with one native pixel of overscan. The full
canvas is cleared to the background each draw before clipping: offscreen backing
pixels intentionally contain background, never stale authored content. A
lifetime-owned scroll listener synchronously redraws the newly exposed area;
resize observation redraws at all zooms. Fit, wheel zoom, review/layout changes
and authored changes retain their immediate controller draws. Canvas coordinates
and hit testing still use the full native scene extent. Portable exports render
from complete scene data on the server and do not read this display canvas.

Pixel tests compare full/reference rendering at viewport edges, fractional review
fit, multiple pan/zoom positions and 1440×1000/980×760 layouts. Independent real
Canvas2D cases cover all tile transforms, transparency, interleaved dynamic
geometry, cancelled/undone cells, region replacement/deletion, order changes,
cache bypass, eviction and disposal. The eviction sweep measured 16,769,024 retained
bitmap bytes against the 16,777,216-byte limit, then zero after disposal; cold
rasterization drew 2,731 tiles and an unchanged repaint drew zero. Pan tests compare pixels at a canonical
camera because offscreen backing pixels now deliberately vary by viewport.

## History results and decision

`profile_history.mjs` runs each mode/workload in a separate Node process with
explicit GC after warmup. Scenes have three small layers or eight large/wide
layers and one editable object. Each sample retains 100 operations: one changed
cell, a stroke changing up to 1,000 cells (192 for small), or an object name.
Memory is heap growth across those operations after GC, excluding the initial
scene and warmup; allocator/JIT/GC differences remain possible. JSON payload sizes
and edit p95 are in the data file. Undo/redo timings are means across 100 operations;
edit timing is median per complete transaction, including its initial clone.

| Scene / operation | Heap MiB before → after | Edit ms before → after | Undo ms before → after | Redo ms before → after |
| --- | --- | --- | --- | --- |
| Small / cell | 3.00 → 0.15 | 0.062 → 0.060 | 0.043 → 0.002 | 0.047 → 0.001 |
| Small / stroke | 2.66 → 1.37 | 0.063 → 0.107 | 0.043 → 0.014 | 0.052 → 0.013 |
| Small / property | 3.00 → 0.15 | 0.063 → 0.062 | 0.042 → 0.002 | 0.047 → 0.001 |
| Large / cell | 454.32 → 0.15 | 9.168 → 6.893 | 6.627 → 0.002 | 6.886 → 0.001 |
| Large / stroke | 452.55 → 4.01 | 8.966 → 7.118 | 6.438 → 0.067 | 6.772 → 0.065 |
| Large / property | 454.33 → 0.15 | 9.620 → 7.197 | 6.866 → 0.002 | 7.076 → 0.001 |
| Wide / cell | 158.81 → 0.15 | 3.190 → 2.485 | 2.237 → 0.002 | 2.349 → 0.001 |
| Wide / stroke | 157.03 → 4.37 | 3.249 → 2.590 | 2.265 → 0.074 | 2.357 → 0.070 |
| Wide / property | 158.81 → 0.15 | 3.212 → 2.532 | 2.292 → 0.002 | 2.325 → 0.001 |

Bidirectional changed-path records substantially reduce repeated retained scene
data while retaining the simple mutable authoring API. String rows use a size
heuristic to avoid allocating many individual cell paths; dense array subtrees
coalesce when their replacement serializes smaller. Array-length changes and
object key/order changes replace a subtree. Both before/after values are cloned,
including when replayed, so no history payload shares mutable authored data.
Absent and undefined optional fields remain equivalent no-ops. Objects whose keys
change must preserve insertion order because the existing
dirty baseline compares JSON; regression coverage checks exact serialization.

One complete scene clone still exists during a transaction for cancellation and
comparison. Entries are bounded to 100 operations, not a fixed byte budget.
Structural edits replacing large subtrees can retain both old and new payloads;
worst-case history can approach twice snapshot payload storage plus path overhead.
This design targets common repeated small edits, not every possible operation.
The small dense-stroke median regresses by about 0.04 ms; no universal speedup is
claimed. Initial clone/comparison time still scales with scene size. Commands
would avoid that cost but would require every mutation site to adopt a new API;
structural sharing would require preventing the existing in-place mutations.
Neither broader rewrite was justified for this storage reduction.

No-ops retain redo; new edits invalidate it. Begin/end/cancel preserve operation
boundaries for strokes/fills/moves/stamps/layers/resize. Layer selection remains
outside authored dirty state, but undo/redo retain its historical snapshot context,
including a selection change made between operations. Stable IDs and next-ID
counters replay with scene changes. The rare atlas-deletion history check walks
reconstructed snapshots one at a time rather than retaining those snapshots.
Persistent scene, Tiled and draft formats are unchanged.

## Validation boundaries

See [scalability validation](../VALIDATION.md#scene-scalability-78-92-93) for actual
suite outcomes and remaining checks. Early profiling found oversized cell deltas
and repeated ancestor serialization; row selection and touched-child checks fixed
those costs before the recorded history run. An early browser run found an object
key-order dirty regression; subtree replacement and serialization tests fixed it.
Early test-harness runs also used invalid tile flag syntax and assumed a reload
would clear a scene link; corrected runs are the recorded matrix/pixel results.
