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
