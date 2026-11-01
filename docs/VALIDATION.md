# Validation record

This record consolidates historical local reports; it does not rerun or upgrade
them. No specific CI-run artifacts were linked by the source records. Ignored
`build/` paths describe where evidence was written, not an archived capture.
See [documentation policy](DOCUMENTATION.md), [browser procedures](BROWSER-TESTING.md)
and [release procedures](RELEASING.md) for new work.

The originals at revision
[`5d0d98c939947f2dcdddcc7e49f96834679a08f0`](https://github.com/cliffom/gbc-scene-forge/tree/5d0d98c939947f2dcdddcc7e49f96834679a08f0)
preserve the pre-consolidation records, including the
[#13 plan](https://github.com/cliffom/gbc-scene-forge/blob/5d0d98c939947f2dcdddcc7e49f96834679a08f0/docs/ISSUE-13-PLAN.md),
[browser coverage](https://github.com/cliffom/gbc-scene-forge/blob/5d0d98c939947f2dcdddcc7e49f96834679a08f0/docs/BROWSER-COVERAGE.md),
[test organization](https://github.com/cliffom/gbc-scene-forge/blob/5d0d98c939947f2dcdddcc7e49f96834679a08f0/tests/README.md)
and [rendering checks](https://github.com/cliffom/gbc-scene-forge/blob/5d0d98c939947f2dcdddcc7e49f96834679a08f0/docs/evaluations/canvas-repainting.md).
Dates, revisions and environments missing from the originals remain unknown.

## Initial standalone projects (#13)

- **Scope:** Working-tree implementation reported on 2026-10-27 before publication; initial
  standalone scope preceding 0.2.0. Exact tested revision, OS and Chrome version were not recorded.
- **Method:** `make lint test build check-dist`, disposable-project Chrome acceptance, official
  Tiled 1.12.2 load/export/rasterization and read-only intake of the owner's Dover atlas. Repository
  evidence includes [the Tiled helper](../tests/support/tiled_interop.py), [historical
  plan](ISSUE-13-PLAN.md) and [project capture](screenshots/standalone-project.png).
- **Result:** Reported 61 Python regressions, TypeScript model/API/deadline/build checks and four
  installed-wheel smoke checks passed. Browser create/import/reimport/paint/fill/select/history, two
  scenes, production CLI restart after a project move and removal of original inputs, stale-revision
  protection, sprite thumbnails/origins/drag/nudge/delete/save, and tall-canvas focus coordinates
  passed. Modal errors, canceled discard, search/filter, asset drops, pan, selection inspector and
  980×760 no-overflow layout were checked; desktop/compact captures were reported inspected. Tiled
  round trips and expected tile/transparent/native-sprite pixels passed. All 13 Dover sprite regions
  retained placement, native pixels and save/reopen. Recovery regressions included interrupted
  import/initial creation/deletion and preservation of external edits. Later fixes in this record
  covered locked coherent scene/artwork reads and save/create acknowledgements of their own
  committed bytes, with deterministic race regressions. Scene/atlas deletion checks covered
  dependencies, confirmations, stale revisions, GID remapping, dirty-canvas preservation,
  source/undeclared-file retention and interrupted recovery; folder-upload checks covered
  cancellation, nested selection, path/size validation and mutation-token enforcement.
  Snap/Alt/nudge/clamp browser checks passed. Legacy connector acceptance also reportedly passed at
  that time.
- **Limits:** These are historical local reports, not retained test logs or current suite counts.
  Owner product review remained separate. The Dover source is private and is not a reusable public
  fixture. Legacy connector/Apply results do not create a supported compatibility requirement. Later
  object/layer/preview behavior exceeds the initial plan; use current usage and release notes for
  supported behavior.

## Playwright migration (#82)

- **Scope:** Local macOS production-bundle checks around 0.16.3, one worker and zero retries;
  retired-suite source baseline `a96eec2` (merged #81). Exact run date and tested head were not
  recorded.
- **Method:** [649 assertion mappings](browser-assertion-inventory.tsv), [358 readiness
  mappings](browser-readiness-inventory.tsv), ordinary/installed-wheel/MCP acceptance and temporary
  failure/cleanup audits. [Coverage provenance](BROWSER-COVERAGE.md) describes deliberate
  consolidations, seeds, CSP fault injection and display-density exceptions.
- **Result:** Reported `make lint test` passed 248 Python tests (one optional SDK skip) and all
  TypeScript suites; production `make build check-dist` passed both distributions and six
  fresh-wheel smoke checks. Regular acceptance passed 20 scenarios in 1.9 minutes; installed first
  use passed one; fresh 0.16.3 `[mcp]` passed 12 protocol tests and two optional browser scenarios
  (38.7 seconds). Temporary audits deliberately failed after chooser load and when serving a regular
  file: they retained traces/server/browser output and the loaded-page screenshot, removed
  workspaces and left servers unreachable. A third audit verified SIGKILL after the five-second
  grace period for a process ignoring SIGINT, process exit and workspace cleanup.
  [Before](screenshots/project-chooser/chooser-before.png) /
  [after](screenshots/project-chooser/chooser-after.png) review captures remain in the repository.
- **Limits:** The local run was not a controlled speed comparison or a cross-browser check. Audit
  specs were removed after the exercise. `build/reports/playwright/fixture-failure-audit/` is an
  ignored local output location, not archived evidence. Inventory destination lines are historical
  references; later formatting/additions shift lines. Source text and provenance remain tied to
  `a96eec2`, not current test discovery.

## Suite organization (#86, #88)

- **Scope:** Local production 0.17.1 suite moves. Browser baseline `e91b136` (merged #85); Python
  organization baseline `62cced6` (Playwright move in PR #87). Exact local run dates/heads were not
  recorded.
- **Method:** Before/after discovery and source/inventory comparison, ordinary and installed-wheel
  suites, public selectors, support-script help entry points, fresh optional MCP wheel and
  report-path inspection. See [browser domain
  organization](BROWSER-COVERAGE.md#domain-organization-86) and [test
  ownership](../tests/README.md).
- **Result:** All 15 moved browser specs matched originals after path substitutions/formatting.
  Discovery retained 22 regular scenarios in 13 files and two optional scenarios in two files,
  unchanged titles/basenames and no duplicates; the two #85 review scenarios remained regular. All
  649 assertion and 358 readiness source entries retained provenance. Python discovery retained all
  248 IDs after removing `backend.<domain>` prefixes, including legacy/optional cases; all 15
  TypeScript suite basenames remained. Reported `make lint test`, `poetry check --lock`, production
  `make build check-dist test-browser`, six wheel smoke checks, installed first use and fresh 0.17.1
  MCP protocol/browser checks passed (12 protocol and two optional scenarios). Installed-wheel
  Python discovery passed 248 cases with one plain-environment SDK skip. Standalone/draft selectors
  retained six/three scenarios; representative model/contracts selectors and support-script help
  passed. HTML reports resolved under `build/reports/playwright/`, the CI upload path. Installed
  first use and MCP browser checks reused the production bundle with `make -o frontend`.
- **Limits:** Official Tiled interoperability was not rerun because external binaries were absent.
  Local reports are not retained CI-run evidence. Counts describe these organization baselines;
  later rendering/wide-scene additions change discovery. Prior Tiled 1.12.2 observations remain
  scoped to #13.

## Canvas sizing and repainting (#76)

- **Scope:** macOS 27.0.1 arm64, Node 24.22.1, Playwright 1.64.1 headless Chromium, 1440×1000;
  development benchmark baseline `c48ffd0` (0.17.1) versus the conditional-sizing/isolated-context
  change released in 0.17.2. Exact measurement date/head were not recorded.
- **Method:** Same synthetic small/large multilayer hover, pointer-stroke and animated-sprite
  fixtures on both renderers. [Detailed methods and before/after
  table](evaluations/canvas-repainting.md) retain timing, draw counts and scheduling/invalidation
  decisions; samples attach as `rendering-profile.json` under local Playwright reports.
- **Result:** Backing assignments fell from two per paint to zero on ordinary repaints/zoom, with
  expected single-dimension resize and undo behavior. Image draws stayed 289/18,433 per small/large
  paint, hidden layers excluded; observed CSS mutations were zero in both runs because Chromium
  already elided identical values. Timings did not uniformly improve: large hover median 27.40→28.70
  ms and painting 26.35→27.80 ms regressed in this sample; animation 26.35→22.75 ms improved.
  Reported `make lint test` passed 248 Python tests (one SDK skip) and 15 TypeScript suites;
  production build/wheel checks and 24 regular browser scenarios, installed first use, fresh 0.17.2
  MCP protocol plus both optional browser scenarios and lockfile check passed. Rendering scenarios
  ran independently on both implementations.
- **Limits:** Synchronous dispatch/callback timings include UI work and per-image proxy overhead,
  excluding FPS/GPU/compositor performance. Animation tails had only about 12–14 callbacks.
  Synthetic bursts establish redundant paints, not real input frequency. No uniform speedup,
  viewport culling, static layer cache or scheduling change was established. Local report
  attachments are not archived benchmark evidence; later work must retain immediate authored
  feedback and owned cancellation/disposal behavior.

## Frontend response schemas (#69)

- **Scope:** Valibot 1.5.0 pilot and world/catalog/scene migration included in 0.16.1. Comparison
  refs `2c023fe52e39576ca9115bfed49422bc6a192c25` and `1890a98d370024ead89f2d95cf18f098ccf2a671`;
  Node 24.22.1, esbuild 0.28.2, fixed 0.16.0 build label. Exact date and final comparison head were
  not recorded.
- **Method:** [Evaluation and reproducible bundle measurements](evaluations/valibot-pilot.md),
  identical build options and gzip level 9, original/new decoder compatibility corpus for JSON
  payloads plus non-finite-number rejection.
- **Result:** The corpus reportedly passed both implementations. Seven schema-derived types replaced
  duplicated structure declarations. Complete adoption added 2,784 gzip bytes (3.23%) to the
  then-normal bundle or 1,950 (2.90%) minified; extension beyond the pilot added 335/387 gzip bytes.
  The original 56-line/1,466-byte decoder became 56 lines/1,968 bytes in the pilot, so source
  reduction was not demonstrated. The bundled MIT notice and compatibility behavior are documented
  with the evaluation.
- **Limits:** No runtime speedup was claimed. Sparse arrays and arbitrary JavaScript objects with
  side effects were outside the corpus. Listed validation gates in the evaluation are procedures,
  not an additional pass report. The original normal build was unminified; production minification
  began in 0.16.2. Remaining domain decoders and infrastructure assessment are open #75/#67 work.

## Inventory discovery (#98)

- **Scope:** Local development measurements on 2026-10-31 for discovery released in 0.19.1. Ten
  temporary empty projects and 100 default blockout scenes; exact revision, Python version and host
  details were not recorded.
- **Method:** `perf_counter` around one cold and 100 unchanged calls to `root.catalog()` and
  `Updates(project.store).choices()`, same process/local filesystem. [Detailed results and
  reproduction](evaluations/inventory-discovery.md) retain the workload and metadata-cache behavior.
- **Result:** Root catalog cold 9.188 ms, warm median/p95 0.589/0.637 ms, 1,049-byte response. Scene
  choices cold 895.237 ms, warm median/p95 3.523/3.764 ms, 6,721-byte response. Backend regression
  coverage rejects warmed manifest reads including cached invalid results; that coverage description
  alone is not a fresh pass report.
- **Limits:** Service timings exclude HTTP/browser/network overhead and are not latency guarantees.
  Work grows with inventory size; changed manifests can revalidate all maps. Scene snapshot/artwork
  adoption is separate. Raw timing logs were not linked or archived in the source record.

## Wide scenes (#99)

- **Scope:** Apple M4 Max, macOS arm64, Node 24, Playwright 1.64.1 headless Chromium, production
  0.20.0, 1440×1000. The feature is present at consolidation baseline
  `5d0d98c939947f2dcdddcc7e49f96834679a08f0`; the measurement's exact head/date were not recorded.
- **Method:** [Wide/tall/near-budget measurements](evaluations/wide-scenes.md), synchronous pointer
  dispatch including UI/render work, multilayer grid-8 fixtures, plus a separate 480×9 grid-16
  far-edge authoring workflow. Raw samples attach as `rendering-profile.json` in local reports.
- **Result:** The 1,023×64 fixture expanded to the exact 65,536-cell budget and passed
  authoring/history checks. Hover medians were 151.2/150.2/150.55 ms, p95 152.8–155.1 ms, visibly
  slow with whole-scene repainting. Separate grid-16 far-edge trials had medians 6.3/6.3/6.2 ms, p95
  9.5/9.6/9.4 ms, and checked erase/history, recovered draft, expansion to 512×9 and exact
  tile/object save/reopen coordinates. The [far-edge capture](images/wide-scene.png) remains.
  Detailed tables retain small/large, wide/tall, painting and animation comparisons. Backend
  coverage includes MCP/native creation/resize, draft and Tiled/export coordinates, wide/tall
  intake, bounded PNG views and rejected-request revision preservation; coverage description is not
  a separate full-suite pass claim.
- **Limits:** These are local CPU observations, not GPU/compositor time or CI timing thresholds.
  Grid-16 used fewer layers and no drawImage proxy, so it is a separate workload. The
  65,536-cell/8,192px limits retain prior maximum allocation bounds, not interactive-speed
  guarantees; one maximum RGBA backing buffer alone is 256 MiB, excluding browser overhead.
  Layers/history/byte/export budgets can bind earlier. Viewport culling remains #93; no uniform
  large-scene performance claim follows from accepting wide scenes.

## Middle-button scene panning (#103)

- **Scope:** 2026-11-01 UTC; production 0.21.0 working tree based on `7855135`;
  macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1, Playwright 1.64.1 bundled
  headless Chromium. New interaction captures were inspected at 1440×900.
- **Method:** [Pan acceptance](../tests/playwright/editor/pan.spec.ts) uses native
  middle-button mouse input over the sample scene, comparing canvas pixels,
  selected tool, dirty status and undo/redo availability. Cancellation, blur and
  hidden-tab events are deliberately injected; capture loss uses the native
  release API. [Editing](screenshots/middle-pan/editing.png) and
  [review](screenshots/middle-pan/review.png) captures are retained in the repository.
- **Result:** Both scenarios passed: all five tools, clean/dirty content and redo
  retention, editing/review pan, horizontal/vertical scrolling, outside release,
  button chords, pointer cancellation/capture loss, Space-key independence,
  blur/hidden tabs and disposal/remount. Native middle-button pointerdown and
  auxiliary-click defaults were prevented. `make docs-check lint test` passed
  20 checker regressions, 282 Python tests and all 15 TypeScript suites. All 38
  regular browser scenarios passed. Production distributions and six installed-wheel smoke checks passed; installed-wheel
  first use and fresh 0.21.0 optional MCP protocol/browser checks also passed.
- **Limits:** Headless mouse automation and inspected captures do not establish
  physical-device or non-Chromium/Windows behavior. Cancellation/visibility event
  injection is distinct from a human OS interaction. Ignored Playwright reports
  and local logs are not archived evidence. Official Tiled tools were not rerun;
  project/Tiled/draft formats are unchanged. Release preparation is not publication.

## Editor interaction efficiency (#77, #90, #91)

- **Scope:** 2026-11-01 UTC; 0.21.1 implementation based on `5ddca60`, macOS
  27.0.1 arm64, Apple M4 Max, Python 3.13.13, Node 24.22.1, Playwright 1.64.1
  bundled headless Chromium, production acceptance bundle at 1440×1000. Isolated
  profiles preceded the version bump and displayed 0.21.0 in both builds.
- **Method:** Matching before/after native mouse and synthetic burst workloads,
  temporary function timing and browser serialization/UI/paint counters in the
  [rendering suite](../tests/playwright/editor/rendering.spec.ts). Detailed
  [methods, counts, timings and failed harness attempts](evaluations/canvas-repainting.md#interaction-efficiency-77-90-91)
  distinguish CPU paint completion from screen presentation. Deterministic
  [scheduler tests](../tests/frontend/editor/hover-paint.ts) cover coalescing,
  current state, cancellation, replacement identity/revision and disposal. The
  [hover capture](screenshots/hover-feedback.png) was inspected at 1440×1000: latest
  cell outline/coordinates, saved status, disabled Save and unchanged layer controls.
- **Result:** Both small/large before and after scenarios passed; native hover
  kept 24 paints with UI updates/dirty calls falling from 24/168 to zero.
  Twenty-request bursts fell from 20 paints to one; 120 authored moves retained
  120 immediate paints, with 614 dirty checks reduced to 122. Focused session and
  scheduler tests passed. Browser checks confirmed leave pixels, synchronous
  cancellation/control drawing, cancelled queued work and immediate coordinates.
  `make docs-check lint test` passed, including all 16 TypeScript suites. Production
  build/metadata and all six installed-wheel smoke checks passed. All 38 regular
  browser scenarios passed, covering render/preview/history, lifecycle, review/pan,
  scene switching, draft retries/recovery and save conflicts. Installed-wheel first
  use passed; a fresh optional-MCP wheel install passed 18 protocol tests and both
  MCP/browser-refresh scenarios, including dirty/form/hidden protection, in-flight
  edit races, animated adoption and disposal. The later
  [post-merge run at `40d3374`](https://github.com/cliffom/gbc-scene-forge/actions/runs/41276478554)
  passed 37/38 browser scenarios: the large-profile immediate assertion observed
  one independent background dirty check between profile reset and burst dispatch.
  Release preparation changed that assertion to compare counters within the same
  synchronous task, preserving aggregate profiling counts and the zero-hover-work
  requirement. Isolated lint/unit checks and both small/large rendering profiles
  passed after correction. Tagging/publication were held while correcting the test isolation.
- **Limits:** Measurements are one local automated sample with intrusive profiling,
  not physical-device input, GPU/compositor timings or universal speedups.
  Queuing can add a frame of hover latency. Whole-scene canvas traversal remains
  expensive. Ignored local reports are not archived evidence. Official Tiled tools
  were unavailable and were not rerun; non-Chromium and physical-device behavior
  remain unverified. No data formats changed; tagging and publication remain separate.

## Scene scalability (#78, #92, #93)

- **Scope:** Local working-tree implementation based on `40d3374`, prepared 0.21.2,
  measured 2026-11-01 UTC on Apple M4 Max/macOS 27.0.1 arm64, Node 24.22.1,
  Python 3.13.13 and Playwright 1.64.1 bundled headless Chromium. Consumer provenance
  and exact workload boundaries are in the [evaluation](evaluations/scene-scalability.md).
  Profiling preceded the version bump from 0.21.1; release package acceptance uses 0.21.2.
- **Method:** Original/culled-direct/cached repaint matrix at fit/1×/4× and three
  pan positions for small/large dense/sparse mixed layers and a disposable actual
  archived Forest v4 copy. Separate 100-operation history processes measured heap,
  edit/undo/redo costs. [Data](evaluations/scalability-data.json) retains matrix samples,
  interaction summaries and history/resource results. Pixel comparisons use the frozen
  original renderer and real Canvas2D contexts. Checks used `make docs-check lint test`,
  production `make build check-dist test-browser`, final affected rendering/pan/lifecycle
  acceptance, installed-wheel first use, a fresh optional-MCP wheel, and official
  Tiled 1.12.2/tmxrasterizer interoperability. Visually inspected the synthetic
  1440×1000 editing capture and sample review at 1440×900/760×640; the
  [desktop review capture](screenshots/scalability/review-1440.png) is retained.
- **Result:** 282 Python tests and all TypeScript suites passed; both distributions
  and six installed-wheel checks passed. Regular Chrome acceptance passed 40 scenarios
  with two optional profiling cases skipped; explicit synthetic/Forest profiling passed
  both cases. Final affected acceptance passed ten cases, including fractional review
  fit, viewport-edge/full-render equivalence, transformed transparent interleaving,
  mutation/reimport/deletion/eviction and disposal. Installed-wheel first use passed;
  a fresh optional-MCP wheel passed 18 protocol tests and both MCP/refresh scenarios,
  including animation, dirty/form protection, external adoption and disposal.
  After the 0.21.2 version bump, lint/unit, production packaging, six plain-wheel
  checks, rendering/first-use/review, installed-wheel first use, six fresh optional-MCP
  wheel checks and 18 fresh optional-MCP protocol checks passed. The 0.21.2 MCP browser
  case passed; its first refresh run hit `TransactionBusy` during direct Python
  animation-fixture setup while browser polling held the project lock. An isolated
  rerun with the fresh 0.21.2 optional-MCP environment passed the full refresh case.
  Large dense warm fit repaint reduced 18,433 scene-image draws to 37; zoomed Forest
  repaint reduced CPU cost substantially while its over-budget fit view retained direct
  drawing. History reduced repeated small-edit retention; small dense strokes regressed
  by about 0.04 ms in the observed sample. An initial full run failed two pan assertions
  that assumed identical offscreen backing pixels and one definition workflow because
  undo changed object key order. Canonical-camera comparisons and shape-preserving
  history replacements corrected these; targeted checks and the full rerun passed.
  Official Tiled verified complete moved scene/project exports and rasterized layers;
  macOS emitted sandbox-extension messages, but the tool exited successfully.
- **Limits:** Local CPU/heap measurements with intrusive automation do not establish
  GPU/presentation performance, prolonged human editing comfort or cross-platform
  behavior. The Forest sample is archived actual v4, not current v5. Objects still
  traverse; the main full-scene canvas remains allocated. Retained tile bitmaps are
  bounded to 16 MiB, with additional signature/browser memory. History remains bounded
  by 100 operations rather than bytes; large structural changes can retain both old
  and new subtrees, and each transaction still clones the scene. No persistent formats
  changed. Tagging and publication remain separate; local reports are not CI evidence.

## Full-scene resize overview (PR #107 review)

- **Scope:** 2026-11-01 UTC, 0.21.2 review fix based on `2fffac2`, macOS 27.0.1
  arm64, Python 3.13.13, Node 24.22.1 and Playwright 1.64.1 bundled Chromium.
- **Method:** [Resize-overview regression](../tests/playwright/editor/resize-overview.spec.ts)
  against a temporary bundle of the pre-fix revision and the working-tree fix;
  native project with red/blue artwork, 1×/2×/8× zoom, three scroll positions,
  crop masks, unsaved fill/undo and display-canvas invariance. `make lint test`,
  production `make build check-dist test-browser`, and `make docs-check`.
  Visually inspected the [1440×1000 crop dialog](screenshots/scalability/resize-overview.png).
- **Result:** The pre-fix bundle returned background `[36, 40, 32, 255]` where
  offscreen blue artwork should appear. The fix renders the entire authored scene
  directly into the preview, without another full-size canvas or transient feedback.
  All viewport variants produced identical overview/crop pixels; unsaved edits and
  undo remained current, and overview generation preserved the display canvas.
  Lint, 282 Python tests, TypeScript suites, both distributions, six wheel checks,
  and 41 regular browser cases passed; two optional profiling cases were skipped.
  The initial fixture attempt modified a declared PNG directly and correctly failed
  its asset-integrity guard; the regression fixture now uses normal atlas reimport.
- **Limits:** Automated Chromium plus one desktop visual inspection; no new
  cross-browser or physical-device claim. Whole-scene overview traversal occurs
  on resize-dialog changes; ordinary viewport paints remain culled/cached. Local
  reports are not archived CI evidence. The prepared version remains 0.21.2.

## Remaining checks

This is the single maintained validation checklist. Issue state was checked on
2026-10-31; closing issues or publishing packages does not satisfy these checks.
Current automated procedures remain in [releasing](RELEASING.md) and
[browser testing](BROWSER-TESTING.md). Add scoped evidence above when completing a
check, retaining actual revision, environment, attribution, failures and limits.

### Scene scalability (#78, #92, #93)

- [ ] Have a human assess prolonged painting, panning and selection on the current consumer Forest project; automated archived-v4 measurements do not establish physical-device editing comfort (#93).

### Contracts and infrastructure (#75, #67)

- [ ] Compare each remaining response-decoder migration against its original output/error/normalization corpus and record bundle cost and adopt/retain/defer decisions (#75, #67).

### Platform, interoperability and publication gaps

- [ ] Record non-Chromium desktop-browser and Windows runtime results with exact versions and workflows; these are outside the automated browser matrix.
- [ ] Configure the TestPyPI trusted publisher and verify an upload if that channel is needed; the historical 0.1.4 attempt failed with `invalid-publisher`. Local wheel checks and PyPI publication are separate evidence.
