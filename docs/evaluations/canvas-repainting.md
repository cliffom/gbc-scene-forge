# Canvas repainting measurements (#76)

Measured on macOS 27.0.1 arm64, Node 24.22.1, Playwright 1.64.1's bundled
headless Chromium, 1440×1000 viewport, development bundle. Baseline is main
`c48ffd0` (0.17.1); after is the conditional-sizing and isolated-context change
in this PR. Both runs use the same instrumentation and fixture. These are local
CPU observations, not FPS, GPU/compositor measurements or promised speedups.

## Repeat the workload

```sh
npm run build
npx playwright test --config tests/playwright/playwright.config.ts rendering.spec.ts
```

To measure the old renderer, use the same test against the baseline renderer and
set `FORGE_RENDER_BASELINE=1` to disable only the new dimension-write assertions.
This flag is for comparison, not acceptance. The test attaches
`rendering-profile.json` to each Playwright result with raw timing samples,
background paint counts, backing dimension writes, CSS style mutations and
`drawImage` counts. Reports live under `build/reports/playwright/`.

Fixtures are native projects with 8px tiles, three visible tile layers (one dense,
two 25% populated), one hidden patterned layer, and one visible animated sprite
layer. The small scene is 16×12 cells (128×96px); large is 128×96 (1024×768px).
Zoom is 1×. Grid is enabled, metadata overlays are off. The renderer visits the
entire scene, including offscreen cells. No game-specific artwork is needed.

After one warmup, each of three hover trials sends six animation-frame-separated
bursts of 20 different-cell pointer moves. Painting repeats those 120 moves inside
one real captured pointer stroke. Timing brackets synchronous pointer dispatch,
including existing UI updates, not just tile traversal. Animation selects the
saved actor's two-frame `turn` sequence and runs until at least 12 paints; its
timing brackets animation callbacks that paint the scene (including preview work).
Play/pause can add paints outside those callback timings. Instrumentation counts
only the scene canvas, not the selection preview canvas. There are no timing
thresholds in CI. The per-image proxy and timer precision affect absolute times.

## Results

Times are median / p95 milliseconds per pointer dispatch or painting animation
callback. Hover pools 360 samples; painting has 120 samples. Animation has roughly
12–14 timed callbacks, so its tail is particularly noisy.

| Scene / workload | Before ms | After ms | Paints before → after | Backing writes before → after |
| --- | ---: | ---: | ---: | ---: |
| Small hover (each trial) | 0.50 / 0.60 | 0.50 / 1.90 | 120 → 120 | 240 → 0 |
| Small painting | 0.50 / 0.70 | 0.50 / 0.80 | 120 → 120 | 240 → 0 |
| Small animation | 1.30 / 1.50 | 0.70 / 1.50 | 15 → 15 | 30 → 0 |
| Large hover (each trial) | 27.40 / 28.70 | 28.70 / 31.90 | 120 → 120 | 240 → 0 |
| Large painting | 26.35 / 28.00 | 27.80 / 30.80 | 120 → 120 | 240 → 0 |
| Large animation | 26.35 / 29.70 | 22.75 / 23.00 | 16 → 16 | 32 → 0 |

Each paint issued exactly 289 image draws for small and 18,433 for large, before
and after. Hidden layers remained excluded. Observed CSS mutations were zero in
both runs: Chromium elides repeated identical CSS writes itself. The new code
also avoids issuing those writes. Backing-store assignments were eliminated on
ordinary repaints and zoom; a width-only resize issues one assignment, and undo
restores the previous width. New browser assertions cover those deterministic
properties, image smoothing, identical pixels after stroke undo, redo, save and
switch/reopen. Existing acceptance covers overlays, labels, preview movement,
review/zoom/pan, refresh and editor replacement.

Avoiding resets has a deterministic resource/state benefit; it does **not** show
a uniform timing gain here. Large hover and paint were slightly slower in this
sample, while animation was faster. Full tile traversal and rebuilding controls
remain substantial costs. More runs and real input traces would be needed to
attribute small timing differences.

## Scheduling and invalidation decision

The burst workload confirms that 20 synchronous redraw requests in a frame cause
20 paints. Coalescing could reduce that to one, which is worth investigating for
hover on dense scenes. However, these deliberately synthetic bursts do not
establish normal browser input frequency. Unconditional deferral would also
change the current contract that edits, selection and inspector updates are
visible when their event handler returns; animation already paints in its owned
animation frame. This patch keeps `draw()` and `draw(false)` synchronous and adds
no queued work, captured scene snapshots, cancellation paths or refresh gates.
A separate scheduling change should profile real input and distinguish transient
hover from authored/selection/control updates before changing that contract.

No viewport culling or layer cache is added. The dense fixture exposes traversal
cost, but this comparison does not isolate rasterization from controls/labels or
establish representative viewport occupancy. Any later cache must invalidate on
scene/editor replacement, undo/redo, artwork reimport, layer order/visibility,
tile/object edits, sprite frames/movement and overlay settings; labels and
selection/hover need their own invalidation. Culling must preserve those overlays
and offscreen sprite extents. That complexity is not needed to eliminate redundant
canvas resets.

The backing size is compared to the current scene pixel size on every synchronous
draw; CSS dimensions are compared to the current zoom/fit result. No second copy
of scene dimensions or zoom is retained. Smoothing is set after any backing
resize. Each repaint starts a new path and uses save/restore for drawing styles,
so it no longer relies on backing resets to clear styles. Layers and overlays use
the same traversal/order as before. Authored history, revision eligibility and
lifetime ownership remain with their existing owners.

## Validation

See [canvas sizing validation](../VALIDATION.md#canvas-sizing-and-repainting-76)
for the historical suite outcomes and their limits. The measurements and
reproduction method above remain the detailed benchmark record.

## Interaction efficiency (#77, #90, #91)

Measured 2026-11-01 UTC on Apple M4 Max, macOS 27.0.1 arm64, Python 3.13.13,
Node 24.22.1 and Playwright 1.64.1 bundled headless Chromium at 1440×1000.
Before is `5ddca60` (published 0.21.0); after is the working-tree interaction
implementation based on that revision, prepared for 0.21.1. Both measurements used
production bundles and the same small/large multilayer fixtures described above.
Profiling preceded the version bump, so both profiling bundles displayed 0.21.0;
subsequent release acceptance used the uninstrumented 0.21.1 build.
The earlier 0.17.2 measurements and scheduling decision remain historical.

### Method and provenance

The updated [rendering test](../../tests/playwright/editor/rendering.spec.ts)
records actual scene paints, native mouse-event arrivals, full UI updates via
mutations to the dirty indicator, authored-snapshot `JSON.stringify` calls/cost,
frame timestamps and time from the latest pointer-event listener to the scene's
outer context restore. This latency is CPU paint completion, not screen presentation.
Native input is 24 awaited Playwright mouse moves across adjacent cells; this is
browser-dispatched input driven by automation, not a physical-device measurement.
A separate synthetic burst dispatches 20 cell-changing events in one task. Three
additional hover trials each send six frame-separated bursts of 20 events;
painting sends those 120 moves during a real captured stroke. Sprite playback
runs until at least 12 paints. All samples remain observational without timing
thresholds. Each benchmark run performs the same per-image proxy work.

For the isolated timings below, temporary source instrumentation wrapped
`project-editor.mts:update`, `editor-state.mts:dirty`,
`editor-recovery.mts:checkpoint` and `editor-rendering.mts:repaint` with:

```ts
const start = performance.now();
try {
  // Original function body, including early returns.
} finally {
  performance.measure('forge-ui', { start, end: performance.now() });
}
```

The other names were `forge-dirty`, `forge-checkpoint` and `forge-canvas`.
The test collects those measures into its attached `interaction-profile.json`;
no source instrumentation ships. UI timings include dirty and checkpoint work,
so those columns must not be added together. `repaint` excludes sizing/layout,
control updates and outer draw preparation. The JSON wrapper's cost covers the
serialization itself; `forge-dirty` additionally includes equality comparison.
Independent refresh/checkpoint timers can add dirty calls outside a UI update.

Reproduction uses `FORGE_BUILD_MODE=production npm run build` followed by
`npx playwright test --config tests/playwright/playwright.config.ts rendering.spec.ts --grep 'small|large'`.
For a before comparison, use the baseline source and updated test with
`FORGE_RENDER_BASELINE=1`; this disables changed resource-count assertions only.
Temporary instrumentation is required only to reproduce the four isolated
function timings. Source/test harness development initially hit an invalid timing
variable in the test and a signature mismatch in the instrumentation script;
these failed attempts were corrected before the matching measurements below.
Local reports were `interaction-final-before` and `interaction-final-after`
under `build/reports/playwright/`; ignored reports are not archived evidence.

### Counts and isolated costs

Times are total CPU milliseconds across each workload, before → after. The hover
burst row is one task of 20 requests, distinct from the repeated trials. Checkpoint
counts include guarded returns during a stroke. Timers account for the extra
checkpoint return in the large after stroke; no draft writes occur mid-stroke.

| Scene / workload | Requests | Paints | UI updates / ms | Dirty calls / ms | Checkpoint calls / ms | Canvas ms |
| --- | ---: | ---: | --- | --- | --- | ---: |
| Small native hover | 24 | 24 → 24 | 24 / 8.8 → 0 / 0 | 168 / 1.5 → 0 / 0 | 24 / 0.6 → 0 / 0 | 5.5 → 5.5 |
| Large native hover | 24 | 24 → 24 | 24 / 88.4 → 0 / 0 | 168 / 80.2 → 0 / 0 | 24 / 11.6 → 0 / 0 | 551.8 → 538.9 |
| Small hover burst | 20 | 20 → 1 | 20 / 3.9 → 0 / 0 | 140 / 1.0 → 0 / 0 | 20 / 0.4 → 0 / 0 | 6.7 → 0.2 |
| Large hover burst | 20 | 20 → 1 | 20 / 72.3 → 0 / 0 | 140 / 66.4 → 0 / 0 | 20 / 9.6 → 0 / 0 | 518.5 → 22.4 |
| Small painting | 120 | 120 → 120 | 122 / 22.6 → 122 / 20.3 | 614 / 4.3 → 122 / 1.3 | 122 / 0.1 → 122 / 0.2 | 36.2 → 37.9 |
| Large painting | 120 | 120 → 120 | 122 / 299.5 → 122 / 85.1 | 614 / 262.4 → 122 / 53.6 | 122 / 2.8 → 123 / 1.7 | 3016.3 → 3002.5 |
| Small animation | 0 | 15 → 15 | 0 / 0 → 0 / 0 | 4 / 0.2 → 4 / 0.2 | 0 / 0 → 0 / 0 | 12.5 → 11.7 |
| Large animation | 0 | 15 → 15 | 0 / 0 → 0 / 0 | 4 / 1.7 → 4 / 1.4 | 0 / 0 → 0 / 0 | 391.7 → 401.6 |

Each of the three repeated hover trials fell from 120 paints to six, with zero
after UI updates or dirty/checkpoint calls. Large canvas totals were
3002.6/3007.7/3012.0 ms before and 145.1/138.5/139.1 ms after. Before dirty-call
counts were 842/843/843 including independent polling; after was zero. Small
canvas totals were 34.0/38.5/33.7 ms before and 0.9/1.0/1.4 ms after.
Full updates previously checked dirty state seven times at rest, five times
mid-stroke; both now compute it once, including the checkpoint consumer.

### Input timing and latency tradeoff

Values below are median / p95 ms. Frame intervals come from a parallel RAF monitor
in the native/single-burst profiles. Native event arrivals are also measured,
so different event throughput under load is visible rather than assumed equal.

| Scene / workload | Arrival interval before → after | Frame interval before → after | Latest-event CPU paint latency before → after |
| --- | --- | --- | --- |
| Small native | 16.70 / 17.60 → 16.70 / 17.30 | 16.70 / 16.70 → 16.70 / 16.70 | 0.70 / 0.80 → 0.60 / 0.70 |
| Large native | 35.10 / 48.50 → 33.40 / 34.30 | 16.70 / 33.40 → 16.70 / 16.80 | 26.75 / 27.40 → 22.60 / 23.10 |
| Small single burst | 0.60 / 3.60 → 0.00 / 0.10 | 16.70 / 16.70 → 16.70 / 16.70 | 0.55 / 3.60 → 2.30 / 2.30 |
| Large single burst | 29.60 / 32.40 → 0.00 / 0.10 | 16.65 / 583.40 → 16.60 / 16.60 | 30.05 / 32.40 → 25.10 / 25.10 |

There is just one after latency sample per single burst because only its latest
state paints. The before burst blocks the main thread repeatedly; after event
handlers return quickly and superseded states never paint. In the frame-separated
trials, small after latency medians were 15.85–16.00 ms (before 0.50 ms), and large
after medians 25.70–26.65 ms (before 28.65–28.70 ms). Queuing can add a frame of
waiting; it does not promise lower latency for every event. Canvas medians per
native paint were 0.20 → 0.20 ms small and 22.85 → 22.40 ms large. Whole-scene
rendering remains costly. Animation's large total increased in this sample;
there is no universal speedup or GPU/FPS claim.

### Ownership and decision

These results justify separating hover from UI work and coalescing redundant
transient requests. Real mouse input did not show a paint-count reduction in this
sample; the measured redundant-paint benefit belongs to the burst workloads.
Coordinates update synchronously, while one lifetime-owned frame paints current
hover/brush state. Any immediate authoring/control/selection draw or animation
draw cancels pending hover work. If hover runs first, later immediate work can
still paint in that frame. Scene identity/revision checks and disposal reject
stale callbacks; scene adoption and close synchronously supersede queued work.

Only one dirty result is reused within `update()`, including checkpoint
observation. No authored snapshot cache or mutation counter was introduced, so
there is no new cross-call invalidation obligation. Existing content-based dirty,
history, recovery, before-unload and refresh guards remain authoritative.
Further caching, culling and undo-memory work remain independently scoped.
