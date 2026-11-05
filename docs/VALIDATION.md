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

## Composed artwork palette (#240)

- **Scope:** Prepared 0.41.0 working tree on `issue-240-composed-palette`, based
  on `a5ec90a`, checked 2026-11-05 UTC on macOS arm64, Python 3.13.13,
  Node 24.22.1, Playwright 1.64.1 and Chromium 156.0.8078.4. Production bundles
  and the installed 0.41.0 wheel were checked; publication is separate.
- **Method:** Run `make lint test`, production `make build check-dist test-browser`,
  strict Poetry lock validation, `make test-mcp`, real MCP/browser handoff and
  refresh acceptance, and installed-wheel palette/first-use acceptance. Exercise
  visible composition/source scope, occlusion, opacity, exact partial alpha,
  transparent RGB, frame rectangles, sorting, limits, history, keyboard selection
  and empty states. Count shared-raster reads to verify closed/cached panels do
  not collect colors. Agent-inspect and archive [desktop composition](screenshots/composed-palette/composition-desktop.png),
  [compact composition](screenshots/composed-palette/composition-compact.png) and
  [selected layer](screenshots/composed-palette/selected-layer.png) at 1440 × 900
  and 800 × 640. Measure one uniform 4,194,304-pixel collector call in Node.
- **Result:** Lint, type checks, 490 Python tests, all TypeScript suites,
  documentation checks and lock consistency pass. Regular browser acceptance
  passes 192 cases with 12 optional-profile skips. All 121 MCP tests and 16
  real-MCP browser cases pass. Both distribution metadata checks, seven wheel
  smoke tests and four installed-wheel palette/first-use cases pass. Collection
  reads the shared snapshot once on opening and zero additional times for twenty
  unchanged redraws; closed panels also perform zero reads. The single uniform
  maximum-area Node scan took 38.4 ms. An initial focused resize assertion sampled
  before settled layout; bounded-layout polling passes. The first full run failed
  three older tests that assumed eagerly collected source colors; they now open
  the panel and select source scope explicitly, retaining their original checks.
  MCP acceptance then exposed the taller popover covering its own invoker;
  available-space placement and scroll bounds correct that failure. Full regular
  and MCP browser passes precede a final weak-reference-only cache ownership
  cleanup; final lint, rebuilt distributions and the four installed-wheel cases
  cover that cleanup and the archived captures.
- **Limits:** Synthetic automation and agent screenshot inspection do not
  establish independent-user discovery, accessibility conformance or physical-device
  comfort. The timing is one uniform Node scan, not layered browser latency or a
  worst-case performance claim. The palette deliberately bounds membership to
  the first 1,024 colors; usage ordering then covers that subset. Other optional
  performance profiles, official Tiled tools, non-Chromium browsers, Windows and
  Python 3.14 were not locally run. No CI or publication result is claimed here.

## Focused artwork setup and From agent (#237)

- **Scope:** Prepared 0.40.0 working tree on `issue-237-artwork-setup`, based on
  `961fb3c`, checked 2026-11-05 UTC on macOS 27.0.1 arm64, Python 3.13.13,
  Node 24.22.1 and Playwright 1.64.1 / Chromium 156.0.8078.4 with the production
  frontend. Release preparation is separate from publication.
- **Method:** Run `make lint test`, production `make build check-dist test-browser`,
  installed-wheel first-use acceptance, `poetry check --lock --strict`,
  `make test-mcp` and the real-MCP iteration/refresh browser profile. Focused setup
  cases cover keyboard tabs, side-effect-free preview/export, stale adoption,
  failure/retry, delayed dismissal, retained history, lazy thumbnails and refresh
  fencing. Agent-inspect captures at 1440 × 900, 1280 × 800 and 800 × 640;
  archive [creation](screenshots/artwork-setup/desktop-new-artwork.png),
  [existing artwork](screenshots/artwork-setup/desktop-existing-artwork.png),
  [gallery](screenshots/artwork-setup/desktop-agent-gallery.png),
  [preview](screenshots/artwork-setup/desktop-agent-preview.png),
  [compact gallery](screenshots/artwork-setup/compact-agent-gallery.png) and
  [compact preview](screenshots/artwork-setup/compact-agent-preview.png).
- **Result:** Lint, type checks, 487 Python tests, all TypeScript suites and
  20 documentation-checker tests pass. The final regular browser run passes
  190 cases with 12 optional-profile skips. An earlier full run failed one obsolete
  browse-label assertion; the label assertion was corrected before the final run.
  All 118 MCP tests and 16 real-MCP browser cases pass. Distribution metadata,
  seven installed-wheel smoke cases, installed-wheel first use and strict lock
  consistency pass. Setup opens on creation despite seven drafts; preview and
  downloads preserve publication guards, and editing restores commands. Final
  screenshot review exposed inherited no-wrap clipping on long card names; the
  corrected CSS, layout assertion and refreshed captures pass all 17 focused
  setup/working-space cases, lint and rebuilt distribution checks. The full browser
  and MCP results above precede this final CSS-only presentation correction.
  The [first CI run on that correction](https://github.com/cliffom/gbc-scene-forge/actions/runs/42056662144)
  passed regular browsers and installed-wheel first use, then failed one MCP
  browser case when workshop read-only review encountered a transient busy response;
  compatibility jobs were consequently skipped. A bounded review-only retry now
  preserves the submitted candidate/scene bases; focused regression tests confirm
  exhaustion, unchanged arguments and no saved-write, conflict or transport retry.
  After that correction, local lint/documentation checks, all 121 MCP tests and
  all 16 real-MCP browser cases pass on the same macOS environment above.
- **Limits:** Synthetic local automation and agent screenshot inspection do not
  establish independent-user discovery, accessibility conformance or physical-device
  comfort; #165/#166 remain outstanding below. Other optional profiles, official
  Tiled tools, non-Chromium browsers, Windows and Python 3.14 were not locally run.
  Worst-case candidate memory and latency were not measured. MCP used the source
  environment; plain-wheel checks used an isolated installation. No CI-pass claim
  is made by this local record.

## Automatic candidate actions (#236 review correction)

- **Scope:** Prepared 0.39.0 review-fix working tree based on `0db3a40`, checked
  on 2026-11-05 UTC, macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1 and
  Playwright 1.64.1 / Chromium 156.0.8078.4 with the production frontend.
- **Method:** Reproduce the empty automatically opened candidate disclosure;
  run `make docs-check lint test`, rebuild with `FORGE_BUILD_MODE=production make
  frontend`, and run all ten working-space browser cases. The new cases cover
  initial candidate actions, inspection/download, refresh replacement/count,
  adoption and clearing stale cards on reentry. Inspect the
  [desktop and compact captures](evaluations/working-space.md#candidate-discovery-review-correction-236).
- **Result:** Required checks pass, including 487 Python tests, all TypeScript
  suites and 20 documentation-checker tests. All ten focused browser cases pass;
  available candidates have immediate Inspect/Adopt actions at 1440 × 800 and
  800 × 800. The list, count and availability indicator follow current inventory.
- **Limits:** Synthetic local coverage and agent UI inspection. The full browser,
  MCP, wheel and external-tool suites were not rerun for this focused frontend
  correction. Earlier broader results retain their original revision boundaries
  below; this entry makes no independent-user or accessibility claim.

## Drawing space and native PNG downloads (#228–#234)

- **Scope:** Prepared 0.39.0 working tree on `feat/milestone-24-p2`, based on
  `a9df2dc`, checked locally on 2026-11-04 (2026-11-05 UTC), macOS 27.0.1 arm64,
  Python 3.13.13, Node 24.22.1 and Playwright 1.64.1 / Chromium 156.0.8078.4,
  production frontend. Release preparation is separate from publication.
- **Method:** Run `make docs-check lint test`, production `make build check-dist
  test-browser`, installed-wheel first-use acceptance, `make test-mcp` and
  production `make test-mcp-browser`. Inspect desktop/laptop/compact captures,
  measure four contextual-panel sizes and exercise the integrated #224 routes.
  The [evaluation](evaluations/working-space.md) links archived raw bounds and
  screenshots, exact layered PNG decoding, state preservation and task methods.
- **Result:** Lint, all frontend suites, 487 Python tests, 20 documentation-checker
  tests, distribution metadata and seven installed-wheel smoke tests pass. The
  regular production browser run passes 181 cases (12 optional profiles skipped);
  installed-wheel first use, 118 optional MCP tests and 16 real-stdio MCP/browser
  cases pass. Both strengthened long-name Inspector cases pass separately.
  After the final startup-hint cleanup, a production rebuild, wheel smoke/first-use
  checks and all eight working-space cases pass; the full run precedes that cleanup.
  Initial runs exposed compact overflow and footer-induced viewport movement,
  corrected by PNG placement and stable footer geometry. Remaining failures were
  obsolete captions, recovery timing, hidden-dock profile assumptions and incorrect
  new fixture fields; focused reruns pass. Drawing/animation heights are 452/254px
  at 1440 × 900, 352/160px at 1280 × 800 and 158.5/150px at 800 × 640 with both
  panes visible. Compact space remains constrained; this is not a universal
  canvas-space improvement over the original review's manually collapsed states.
- **Limits:** Local scripted/service evidence and agent UI inspection, not a new
  independent-user, accessibility or CI claim. The optional MCP checks use the
  source environment; the first-use and smoke checks use the plain installed
  wheel. Full optional profiling, official Tiled/rasterizer, other browsers,
  physical devices, OS scaling and Python 3.14 were not checked locally.
  Maximum-size PNG memory/latency is unmeasured. The combined synthetic #224
  follow-up is complete within this scope; independent #165/#166 remain open.

## Release browser synchronization (#235)

- **Scope:** Prepared 0.38.0 at `7c20ee4`, GitHub Actions Ubuntu production build,
  and its test-only correction checked locally on 2026-11-04 (2026-11-05 UTC),
  macOS arm64 with bundled Playwright Chromium.
- **Method:** Inspect the failed
  [CI run](https://github.com/cliffom/gbc-scene-forge/actions/runs/41968986923)
  and its browser trace. Run the five discovery/scope acceptance cases against
  the production bundle after waiting for visible scene/artwork readiness before
  source selection and pixel download.
- **Result:** CI passed 172 browser cases and skipped 12 optional cases, but failed
  the named-pose case because source selection raced scene loading and its scope
  assertion matched a hidden retained control. All five corrected cases passed
  locally; their exact-pixel and retained-scope assertions remain intact.
- **Limits:** The local result covers the focused suite. Full CI must pass on the
  corrected revision before merging; this correction changes only test sequencing.

## Source metadata targeting (#235 review)

- **Scope:** Prepared 0.38.0 review-fix working tree based on `b1ac1c2`, checked
  locally on 2026-11-04 (2026-11-05 UTC), macOS arm64, Python 3.13, Node 24 and
  bundled Playwright Chromium, development frontend.
- **Method:** Run `make lint test`, rebuild the frontend and run the Library
  sources, discovery/scope, terrain and standalone browser suites. The new
  [regression](../tests/playwright/editor/library-sources.spec.ts) changes the
  filtered source while retaining a different scene brush, saves sprite and
  individual tile-cell metadata, then reads the project catalog. Inspect the
  resulting metadata dialog at 800 × 640.
- **Result:** Lint, documentation checks, 487 Python tests, all frontend suites
  and 16 browser cases pass. Metadata reaches the source named in the menu;
  unrelated metadata and the previous scene brush remain unchanged. Incompatible
  grids and empty results disable the command. The first new fixture rejected
  an unsupported rectangular tile; the corrected square fixture passes.
- **Limits:** Synthetic local browser/service evidence and agent UI inspection;
  no independent participant evidence. The full browser suite, installed-wheel
  checks, other browsers and Python 3.14 were not rerun locally for this fix.

## Editor discovery and drawing scope (#225–#227)

- **Scope:** Prepared 0.38.0 working tree based on `66b98c4`, checked locally on
  2026-11-04 (2026-11-05 UTC), macOS 27.0.1 arm64, Python 3.13.13,
  Node 24.22.1 and bundled Playwright Chromium, production frontend.
  The separately committed [baseline](https://github.com/cliffom/gbc-scene-forge/blob/66b98c4/docs/evaluations/usability-review-2026-11.md)
  retains its original `98a33d8a` environment and observations.
- **Method:** Run `make lint test`, production `make build check-dist`, all regular
  browser acceptance, then 17 focused layout/polish/discovery cases after the
  compact document-name adjustment and five final P1 evidence cases. Inspect
  desktop/laptop/compact captures. Reuse the demo plus the same two-pose 32 × 16
  native sheet (16 cards total); separately exercise 64 long-named poses, keyboard
  opening/source actions, filter retention, exact downloaded RGBA, Undo/Redo,
  reviewed save/reopen and retained scope. Existing regular cases exercise
  shared/copy, checkpoint, conflict, token/path and navigation guards.
- **Result:** Lint, all frontend suites, 487 Python tests, 172 regular browser
  cases (12 optional cases skipped), the 17 focused cases and five final evidence
  cases pass. Both distribution metadata checks and seven installed-wheel smoke
  checks pass. Same-fixture fully visible cards change from 4 → 6 at 1440 × 900,
  2 → 5 at 1280 × 800 and 0 → 3 at 800 × 640. Scene drawing bounds remain
  910 × 526.5 and 750 × 398.90625 at the two larger sizes; compact bounds change
  from 392 × 243.5 to 392 × 242 with the two-line Documents caption. Keep the
  existing 72px thumbnail cards and two-line names: disclosure recovers browsing
  space without another density mode. [Raw measurements](screenshots/editor-discovery-scope/measurements.json),
  [desktop](screenshots/editor-discovery-scope/scene-1440.png),
  [laptop](screenshots/editor-discovery-scope/scene-1280.png),
  [compact](screenshots/editor-discovery-scope/scene-800.png),
  [Open scene](screenshots/editor-discovery-scope/entry-1280.png),
  [frame scope](screenshots/editor-discovery-scope/frame-800.png) and
  [long-name source actions](screenshots/editor-discovery-scope/large-library-source.png)
  archive inspected states. Exact RGBA checks isolate Pose 1, then deliberately
  edit both poses in Sheet mode and preserve those pixels/identities on reopen.
  Earlier runs failed on old captions, an implicit Sheet assumption, compact
  recovery-label overflow and mixed version/assets; updated routes, explicit
  Sheet selection, wrapping and a production rebuild resolve them. New fixture
  drafts also required correcting an unsupported 1024px sheet and brush ID.
- **Limits:** These are synthetic browser/service checks and agent visual
  inspection, not participant discovery, prolonged comfort or accessibility
  conformance evidence. The 64-pose fixture is bounded, not a maximum-library
  benchmark. Real-stdio MCP/browser suites, optional profiling, external Tiled,
  other browsers and Python 3.14 were not run locally. The complete #224
  integrated follow-up after P2 work remains below; #165/#166 remain independent.
  Publication is separate; local logs are not archived CI evidence.

## Document-close queued-event review fix (#223)

- **Scope:** Review-fix working tree based on `78b53df`, checked on 2026-11-04
  (2026-11-05 UTC), macOS arm64, Python 3.13.13, Node 24.22.1 and bundled Chromium.
- **Method:** Bundle the actual close controller and editor lifetime into an
  isolated browser harness; dispose and reopen the static dialog in one task
  before the browser dispatches its native close event. Rebuild the frontend and
  run close, document-navigation and editor-lifetime browser suites, plus
  `make docs-check lint test`.
- **Result:** The regression fails before the fix: the visible replacement
  confirmation has already resolved to null. With the guard, it remains pending
  until Discard resolves it correctly. All 13 selected browser cases, documentation
  checks, lint, 487 Python tests and all frontend suites pass.
- **Limits:** The race reproduction exercises the controller's native browser
  events, rather than a full editor remount. Full browser, installed-wheel and
  MCP checks were not repeated for this fix; prior results below retain their
  original scope. Non-Chromium behavior was not checked.

## Explicit document closure (#222)

- **Scope:** Prepared 0.37.0 working tree based on `6d586e1`, checked locally on
  2026-11-04 (2026-11-05 UTC) with macOS arm64, Python 3.13.13, Node 24.22.1 and
  bundled Chromium. No tag or package publication was performed.
- **Method:** Run `make docs-check lint test`, production `make build check-dist`,
  regular browser acceptance and real-stdio MCP/browser acceptance. Inject failed
  saves, checkpoint writes and deletion responses; check recovery, retained
  histories, review confirmation, URL history, focus and final-document closure.
  Inspect and archive the close confirmation at
  [1440×1000](screenshots/document-close/close-confirm-desktop.png) and
  [800×640](screenshots/document-close/close-confirm-compact.png), artwork review at
  [1440×1000](screenshots/document-close/close-artwork-review-desktop.png) and
  [800×640](screenshots/document-close/close-artwork-review-compact.png), and the
  empty workspace at
  [1440×1000](screenshots/document-close/close-empty-desktop.png) and
  [800×640](screenshots/document-close/close-empty-compact.png).
- **Result:** Lint, 487 Python tests and all frontend suites pass. Regular browser
  acceptance passes 165 cases and all 16 MCP/browser cases pass. Initial checks exposed a hidden Cancel closing
  control and a scene wrapper-identity check that ignored valid close choices;
  both were corrected. Existing document-bar and dirty artwork-discard browser
  expectations were updated for the new controls. A separate regression reproduced
  stale scene save state after successful persistence followed by failed checkpoint
  cleanup; the editor now adopts the confirmed save revision before cleanup.
  After that fix and the already-reviewed artwork-confirmation guard, final lint,
  production distributions and seven installed-wheel smoke cases pass. All 23
  installed-wheel browser cases pass, including all 11 document-navigation cases,
  scene URL history, standalone save/reopen, recovery and first use.
- **Limits:** Twelve opt-in profiling cases were skipped. These are local synthetic
  checks and agent UI inspection, not independent-user usability evidence. The
  archived screenshots and full regular-browser pass precede the final save-revision
  and already-reviewed artwork-confirmation fixes. Python 3.14, Windows,
  non-Chromium browsers and official Tiled/rasterizer applications were not checked
  locally. Existing outstanding checks remain below.

## Artwork save status and checkpoint retirement (#221)

- **Scope:** Uncommitted 0.36.1 review fixes based on `832a5a4`, checked locally
  on 2026-11-04 with macOS arm64, Python 3.13.13, Node 24.22.1 and bundled
  Chromium. No publication was performed.
- **Method:** Reproduce both review findings with browser regressions before
  applying fixes. Run `make lint test`, rebuild the frontend and exercise local
  artwork saves, recovery, navigation and real-stdio MCP/browser acceptance.
  Inspect the saved-artwork UI at 1440×1000 with automatic refresh disabled.
- **Result:** Both regressions fail on the original code and pass with the fixes.
  New artwork remains Saved without a false deletion notice and retains Undo.
  A held checkpoint deletion response no longer allows the pending debounce to
  recreate discarded recovery work. Lint, 487 Python tests, frontend suites,
  53 focused artwork/recovery/navigation browser cases and all 16 MCP/browser
  cases pass.
- **Limits:** These are local synthetic checks and agent UI inspection. No
  package rebuild, installed-wheel checks, non-Chromium browsers or prolonged
  review sessions were exercised for these fixes. Existing outstanding checks
  remain below.

## Follow saved artwork updates (#220)

- **Scope:** Prepared 0.36.1 working tree based on `9d8951f`, checked locally on
  2026-11-04 with macOS arm64, Python 3.13.13, Node 24.22.1 and bundled Chromium.
  No tag or package publication was performed.
- **Method:** Run `make lint test`, production `make build check-dist`, regular
  browser acceptance and the complete real-stdio MCP/browser suite. After adding
  the checkpoint-retirement guard, rerun the ten artwork-iteration/document-
  navigation cases and all MCP/browser cases. Run installed-wheel first-use
  acceptance. Inspect the synthetic review UI at 1440×1000 and 800×640; archive
  [desktop following](screenshots/external-refresh/live-artwork-review.png),
  [compact following](screenshots/external-refresh/live-artwork-review-compact.png)
  and [paused updates](screenshots/external-refresh/paused-artwork-review-compact.png).
- **Result:** Lint, 487 Python tests and all frontend suites pass. Regular browser
  acceptance passes 159 cases; all 15 MCP/browser cases pass, including nine new
  following cases. Repeated commits converge, dirty edits and held gestures block
  adoption, valid view/frame/layer context survives, and old Redo history retires.
  Delayed checkpoint deletion guards new edits; transient errors remain quiet and
  persistent errors recover through inline Retry. All ten focused navigation
  cases, seven installed-wheel smoke cases and installed-wheel first-use pass.
  Initial failures exposed fixture identity/pixel-sampling assumptions, missing
  explicit-busy retries and old Undo/manual-focus expectations; these were
  corrected. Two initial build-identity failures came from mixed build modes and
  a concurrent bundle-writing test; the stable production browser run passes.
- **Limits:** Twelve opt-in profiling cases were skipped. These are local
  synthetic checks and agent UI inspection, not independent-user usability or
  artistic-quality evidence. Python 3.14, Windows, non-Chromium browsers and
  official Tiled/rasterizer applications were not checked locally. Unpublished
  candidates are not streamed; no new performance or prolonged-session claims
  are made. Existing outstanding checks remain below.

## Selective MCP pixel cleanup (#218)

- **Scope:** Prepared 0.36.0 working tree based on `decbee7`, checked locally on
  2026-11-04 with macOS arm64, Python 3.13.13, Node 24.22.1, bundled Chromium and
  official MCP SDK 1.30.0. No tag or package publication was performed.
- **Method:** Run `make lint test`, production `make build check-dist test-browser`,
  installed-wheel first-use acceptance and `make test-mcp` against a fresh optional-
  MCP wheel install. Exercise selected cleanup through the official stdio SDK,
  source/change PNG resources, independent actual-output validation, old-receipt
  rejection, fresh review/commit and exact saved-layer reopen. Reproduce the
  [synthetic comparison and bounded timing](evaluations/pixel-cleanup.md), and
  run the final implementation on a temporary copy of the user's grid-free card.
- **Result:** Lint, documentation checks, 486 Python tests and all frontend suites
  pass. Production distributions and seven installed-wheel smoke cases pass;
  118 installed-wheel MCP tests pass. All 159 regular browser cases and the
  installed-wheel first-use case pass, along with all six mixed MCP/browser
  refresh, handoff and conflict cases. The original MIT motif removes its two
  declared noise cells while preserving protected glint/diagonal pixels; removing
  protection loses the intentional glint, and four-connectivity removes the thin
  diagonal. A single maximum-area uniform scan took about 2.4 seconds. The user's
  temporary card produces 195 suggestions changing 232 cells with all hard checks
  passing and saved artwork untouched; scan-boundary exclusion leaves three
  prototype edits unapplied. Counts do not establish that edits improve the art.
- **Limits:** Twelve opt-in browser profile cases were skipped. Synthetic source
  PNGs, exact changes and implementation hash are archived with the evaluation;
  the private card and local command logs are not committed CI evidence. No
  independent-human quality assessment, adversarial worst-case latency or total-
  process memory measurement is claimed. Outline repair, semantic recognition
  and plane consolidation remain unsupported. Tiled/rasterizer applications
  were unavailable; existing interoperability and human checks remain below.

## Runtime policy ownership and boundaries (#172)

- **Scope:** Behavior-preserving working tree based on `9fd65ef`, checked locally
  on 2026-11-04 with macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1 and bundled
  Chromium. Package/runtime versions remain 0.35.0; no release was published.
- **Method:** Run `make lint test`, production `make build check-dist test-browser`,
  and `make docs-check`. Exercise fake-clock checkpoint debounce/cancellation,
  exact multi-request pixel synchronization, sparse-block and dense/count history
  eviction, actual cache canvas backing bytes, and retained-document slot reuse.
  See [runtime policy ownership](FRONTEND-ARCHITECTURE.md#runtime-policy-ownership)
  for units and memory-accounting boundaries.
- **Result:** Lint, 473 Python tests and all frontend suites pass. Scene debounce
  resets on later edits, explicit flush cancels its pending timer, and stopped or
  disposed owners cannot schedule writes. Synchronization sends two 8,000-write
  requests and the exact remainder using successive acknowledgments. Dense undo
  records evict before the count ceiling; retained undo/redo remains exact. All
  159 regular browser cases pass: cache estimates match full-chunk RGBA backing
  bytes at 16 MiB for grids 8/16/32, over-budget temporary canvases release, and
  the seventeenth artwork document is rejected until an existing slot is closed.
  Production source/wheel builds, metadata checks, seven installed-wheel smoke
  cases and documentation checks pass.
- **Limits:** Twelve opt-in browser profile cases were skipped; no new performance
  measurements, total-process memory bound or independent-user evaluation is
  claimed. Optional MCP browser acceptance, Tiled interoperability and Python 3.14
  were not run locally. Existing memory estimates exclude the additional buffers
  and runtime overhead documented by their owners; policy values, intervals,
  request/native formats and transport behavior remain unchanged.

## Shared authoring limit contracts (#171)

- **Scope:** Behavior-preserving working tree based on `6830fbe`, checked locally
  on 2026-11-04 with macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1 and installed
  Chromium. Package/runtime version remains 0.35.0; no release was published.
- **Method:** Run `make lint test`, production `make build check-dist test-browser`,
  and installed-wheel domain-limit/import-boundary discovery. Exercise the
  [shared corpus](../tests/fixtures/domain-limits.json) in Python and TypeScript;
  compare complete MCP tool schemas/artwork capabilities against the pre-refactor
  payload. See [policy ownership and units](DOMAIN-LIMITS.md).
- **Result:** Lint/docs checks, 473 Python tests and frontend suites pass. All 86
  shared lower/upper boundary cases pass in both languages; real scene/raster/
  candidate batches retain their bounds, atomic rejection and first-error order.
  Complete MCP schema/capability JSON remains identical. Production source/wheel
  builds, metadata checks, seven wheel smoke cases, four installed-wheel limit
  cases and six installed-wheel architecture cases pass. Regular Chromium
  acceptance passes 158 cases, including animation, near-limit layouts, large
  artwork, selected variations, scene dimensions, layers and recovery. The new
  scene-batch fixture initially assumed explicit layers; using the canonical layer
  accessor corrected that test failure before the successful full run.
- **Limits:** Twelve opt-in browser profile cases were skipped. These are synthetic
  contract/acceptance checks, not new capacity measurements or independent-user
  evaluation. Optional Tiled interoperability and Python 3.14 were not run locally.
  Broader schema bounds, service-only cross-field checks and distinct JSON byte
  measurement rules intentionally remain as documented in the inventory.

## MCP draft comparison, PNG inspection and archive plans (#211–#213)

- **Scope:** Prepared 0.35.0 working tree based on `12cf3fa`, checked on
  2026-11-04 with macOS 27.0.1 arm64, Python 3.13.13 and Node 24.22.1.
  This is local agent evidence using the installed Chromium browser.
- **Method:** Exercise full/owned candidate comparisons, identical and one-pixel
  edits, stale visual baselines, hidden-layer and hidden-transparent-RGB cases;
  decode PNG crops to check literal RGBA, nearest scaling and overlay alignment.
  Verify read-only archive grouping/evidence, stale-plan rejection, quota boundaries,
  explicit selection and exact archive recovery. Run the official SDK example
  from checkout and an isolated optional-MCP wheel install; inspect the generated
  [816×344 PNG sheet](evaluations/assets/illustration-draft-contact.png).
- **Result:** Required lint/docs checks, 469 Python tests and the TypeScript suites
  pass; the final focused illustration suite passes all 19 cases. Production
  wheel/source build, metadata and seven installed-wheel smoke cases pass.
  A fresh optional-MCP install passes 113 service/SDK tests and the 13-call
  illustration example, including inline PNG content, resource download,
  saved-layer fidelity, plan validation and archive SHA-256 verification.
  Regular Chromium acceptance passes 158 cases with 12 opt-in profile skips;
  all six MCP/browser coexistence cases pass; installed-wheel first-use acceptance
  passes one case. Initial archive integration
  exposed nested lock acquisition; session-based helpers removed that failure
  before successful regression checks. PNG labels, revisions and comparison cells
  were visually inspected at their native 816×344 output size.
- **Limits:** Synthetic technical fixtures and agent inspection do not establish
  artistic quality or independent-user usability. Hashes provide no ancestry or
  reliable supersession order; only exact saved matches receive archive
  recommendations. Estimates exclude the durable archive's disk usage. Composite
  overlays do not expose hidden layer-only edits. Official Tiled/rasterizer tools
  were unavailable; no non-Chromium or Windows check was performed. Publication
  remains separate; existing outstanding checks are retained below.

## MCP illustration production (#201)

- **Scope:** Prepared 0.34.0 working tree based on `a7721a8`, local agent checks
  on 2026-11-04, macOS 27.0.1 arm64 / Apple M4 Max, Python 3.13.13 and
  Chromium 156.0.8078.4. No independent-user observation is claimed.
- **Method:** Run the official-SDK static illustration example and identical-edit
  stdio measurements with three repetitions per route/size. Compare exact native
  sources and inspect the generated 900×520 contact-sheet capture. Exercise
  bounded input, stale receipt, archive interruption and partial release cases;
  run repository checks and installed-wheel verification. See the
  [evaluation, raw samples and screenshot](evaluations/illustration-production.md).
- **Result:** Lint/docs checks, 462 Python tests and the TypeScript suites pass.
  Production wheel/source build, metadata and seven installed-wheel smoke cases
  pass; regular Chrome acceptance passes 158 cases with 12 opt-in profile skips,
  and all six browser/MCP coexistence cases pass. The static fixture completes layered intake, resize, palette
  conversion, drawing, review, export, guarded publication, exact reopen and
  archive cleanup in 12 tool calls without an external image editor. Batched
  edits retain one result instead of four intermediates; at 256×256 local median
  edit latency was 182.24 ms versus 350.02 ms for compact steps. Compact payloads
  alone did not improve measured latency. Initial checks exposed a listing test
  that assumed name was its only descriptive field; it now extracts the explicit
  handle keys. The SDK example initially had a helper argument/name collision,
  corrected before the successful measured run.
- **Limits:** Synthetic technical fidelity only; no artistic or human-usability
  conclusion. Independent copies preserve original references; sheet preparation
  explicitly discards frame slicing/timing. Some alpha/layer budgets reject.
  Archive files are separate recovery copies outside the retained quota and project
  exports. Measurements exclude setup/export and do not profile CPU or memory.

## Artwork opening and layered visibility (#202, #207)

- **Scope:** Prepared 0.33.3 working tree based on `4058c30`, checked on
  2026-11-04 with macOS 27.0.0 arm64 / Apple M4 Max, Python 3.13.13,
  Node 24.22.1 and Chromium 156.0.8078.4. This is local agent evidence.
- **Method:** Compare production 0.33.2 and candidate bundles using disposable
  small, large and three-layer artwork; record first/repeated opens, visible
  feedback and synchronous visibility handlers. Inspect desktop/compact loading
  captures. Run `make lint test`, final production `make build check-dist`,
  full browser acceptance and installed-wheel first use. Check fresh optional-MCP
  installation, seven package smoke cases, 94 service cases and six browser cases.
  See the [evaluation and exact samples](evaluations/artwork-opening.md).
- **Result:** Required lint, documentation, 450 Python tests and TypeScript suites
  passed. Final regular browser acceptance passed 158 cases with 12 opt-in profile
  skips; the separate final profile passed. Visibility handlers fell from
  769–792 ms to 58–76 ms (about 91% at the median), layered opens from
  3,857–3,887 ms to 772–811 ms, and loading feedback appeared within 2–13 ms
  without the chooser in all nine candidate opens. Exact-source/direct-buffer
  checks, new-manifest verification, cancellation, superseding, retry and failed
  outgoing checkpoint coverage passed. Source/wheel metadata, seven plain-wheel
  smoke cases and installed first use passed; optional-MCP package/service/browser
  checks passed. The first complete browser run had 157 passes and one Documents
  keyboard failure: focusing a disabled control raced the loading transition.
  Waiting for the same control to become enabled fixed the test; the complete
  rerun passed. Final optional-MCP wheel smoke was repeated after the last frontend
  cancellation/cache-bound refinements; its service/browser matrix preceded those
  refinements, which the final source browser run covers.
- **Limits:** Synthetic fixtures and animation-frame proxies establish neither
  independent-user comfort nor physical display latency. First small opening
  includes cold server verification; larger fixtures reuse that proof. Ignored
  local build reports/CPU profiles are not archived CI evidence. No Windows,
  non-Chromium, maximum-budget artwork, official Tiled or human acceptance claim
  is made. Version 0.33.3 is prepared, not published.

## Browser worker concurrency (#206)

- **Scope:** Test infrastructure based on production 0.33.2 at `3b0cc3f`, checked
  on 2026-11-04 with local macOS arm64, Node 24.22.1, Python 3.13 and Chromium;
  the CI comparison used `430598b` on one four-CPU Ubuntu 24.04 runner.
- **Method:** Audit test-owned projects, input artwork, server logs, bundles and
  report paths; deliberately fail two parallel scenarios to inspect evidence and
  cleanup. Run required lint/Python/TypeScript/documentation checks, production
  build/package smoke checks, regular browser acceptance, installed-wheel first
  use and installed optional-MCP service/browser suites. Compare the identical
  original suite at one, two and four workers in the
  [CI run](https://github.com/cliffom/gbc-scene-forge/actions/runs/41859847523), with
  [measurements and resource limits](BROWSER-TESTING.md#worker-comparison-206).
- **Result:** Two CI workers passed 152 cases with 11 profile skips in 6:25.95,
  versus 10:38.36 at one worker; four workers had two navigation assertion failures.
  The selected policy uses half the available CPUs, capped at four. Final local
  four-worker acceptance passed 154 cases with 11 profile skips; all six MCP
  browser cases, installed-wheel first use, 94 MCP service tests, seven package
  smoke checks and required source checks passed. All 151 regular server scratch
  directories were distinct and removed, with 154 activity-log attachments retained.
  An intermediate fixture layout caused five project-creation failures; keeping
  the creation directory empty inside an owned scratch parent resolved them.
  Optional refresh status failures reproduced at both one and four workers before
  replacing obsolete direct status access with locator assertions/dismissal.
  A subsequent two-worker local run passed 152 cases and failed two immediate
  viewport/status reads; polling the same expected scroll coordinates and palette
  message passed both focused cases without relaxing their outcomes. The complete
  two-worker rerun then passed all 154 regular cases (11 profiles skipped), all
  six optional MCP cases and installed-wheel first use.
- **Limits:** The benchmark precedes final fixture isolation and the two added
  ownership tests; its installed-wheel/MCP steps were skipped. Final local reports
  are ignored build outputs, not archived CI evidence. The single CI sweep does
  not establish repeated-run variance or aggregate peak process memory. The two
  four-worker CI failures remain unexplained, so four is not the selected default
  for that runner. No Windows/non-Chromium or editor-performance claim is made.

## Notification acceptance timing (PR #205)

- **Scope:** Acceptance-test fixes based on `261a990`, checked locally on
  2026-11-04 in Chromium against production 0.33.2 assets.
- **Method:** Reproduced the paused-clock recovery and absent-status failures,
  then reran all four affected browser cases with explicit frame advancement
  and null-safe status polling. Also ran the complete standalone/notification
  suites, `make lint test` and `make docs-check`.
- **Result:** The local baseline had three failures and one pass; all four cases
  passed after the fixes, as did all nine standalone/notification cases and the
  general checks. The [original PR CI run](https://github.com/cliffom/gbc-scene-forge/actions/runs/41850248983)
  recorded all four failures, 148 passes and 11 optional skips, including a
  timing-dependent preview-settings failure that passed locally.
- **Limits:** Synthetic local Chromium checks. This focused result does not
  establish a passing full CI matrix or independent accessibility assessment.

## Artwork keyboard retry feedback (PR #205)

- **Scope:** Review fix based on `aecf539`, checked locally on 2026-11-04 in
  Chromium against rebuilt production 0.33.2 assets.
- **Method:** Repeated failed artwork review/save requests through Ctrl+S,
  followed by successful keyboard/button retries, plus the notification,
  artwork iteration and document-navigation Playwright suites.
- **Result:** The regression initially left two error cards after a successful
  review. With explicit operation keys, repeated failures coalesced and successful
  retries cleared them. All 13 browser cases passed.
- **Limits:** Synthetic local Chromium checks; no full browser matrix or
  independent human/accessibility assessment was repeated for this fix.

## Shared editor notifications (#204)

- **Scope:** Prepared 0.33.2 working tree based on `8ac63d1`, inspected locally
  on 2026-11-04 with macOS 27.0.1, Python 3.13.13, Node 24.22.1 and Chromium
  156.0.8078.4. The retained screenshots show synthetic fixtures in the production
  0.33.2 build before commit, not a published installation.
- **Method:** `make lint test`, production `make build check-dist`, affected
  Playwright suites and agent inspection of the [1440×1000 desktop](screenshots/notifications/desktop.png)
  and [760×640 compact](screenshots/notifications/compact.png) captures. The
  [notification suite](../tests/playwright/editor/notifications.spec.ts) combines
  real locked-layer/checkpoint/save workflows with a component harness and virtual
  time for expiry, hover/focus pauses, stale ownership, modal dismissal, canvas
  pointer passage and disposal.
- **Result:** Lint, documentation and Python/TypeScript checks passed, including
  448 Python tests. Production distributions passed metadata checks and seven
  installed-wheel smoke tests. All 35 affected browser scenarios passed; after
  the final feedback-generation refinement, the four notification/import cases
  passed again against rebuilt production assets. Earlier checks exposed passive
  cards being counted as command menus and hidden-viewport positioning; both were
  corrected. A pre-final full browser run had 147 passes, four failures and 11
  optional skips: card pointer interception, an obsolete permanent-footer fixture
  and two production/development build-setting mismatches. The affected rerun
  covers all four failures with the corrected component, fixture and environment.
- **Limits:** The full browser matrix was not repeated locally after those fixes;
  the final local browser claims are scoped to the affected suites. No independent
  human or screen-reader assessment, non-Chromium/Windows run or publication was
  performed. Screenshots establish the inspected layouts, not drawing comfort or
  accessibility conformance. Existing external-tool checks remain below.

## Library source actions and layer controls (PR #203)

- **Scope:** Prepared 0.33.1 working tree based on `a8d1c2e`, checked
  2026-11-03 local time (2026-11-04 UTC), macOS arm64, Python 3.13.13,
  Node 24.22.1 and Playwright Chromium; disposable projects.
- **Method:** Build production distributions, install the plain and optional-MCP
  wheels in fresh environments, run package smoke and installed-wheel first-use
  acceptance. Exercise layer flags, independent Undo/Redo, checkpoints, save/reopen,
  pending name/opacity entries and context changes. Inspect the committed
  [Library](screenshots/library-layer-controls/source-actions.png) and
  [layer](screenshots/library-layer-controls/hidden-layer.png) captures at 1440px.
- **Result:** Documentation, lint, 448 Python tests and frontend suites passed.
  Production build and strict distribution metadata checks passed; both installed
  wheels passed seven package smoke tests. Installed plain-wheel first use and
  all five production artwork-iteration browser cases passed. The optional-MCP
  installation passed all 94 protocol/service tests. The pending-field regression
  covers both flag paths without applying staged values, Apply normalization,
  Undo, and switching between layers and documents with identical layer IDs.
- **Limits:** Scoped local evidence, without a full-browser or CI-pass claim in
  this entry. Official Tiled/rasterizer applications are unavailable. Windows,
  non-Chromium browsers, physical-device drawing and independent-user evaluation
  were not assessed. The large-layer visibility delay remains open in
  [#202](https://github.com/cliffom/gbc-scene-forge/issues/202).

## Single-tile repetition preview cache (PR #200)

- **Scope:** Prepared 0.33.0 working tree based on `1e6dfab`, checked
  2026-11-03 local time (2026-11-04 UTC), macOS arm64, local production bundle
  and Playwright Chromium; disposable projects.
- **Method:** Extend contextual-panel acceptance to inspect all three repeated
  copies after painting, Undo, Redo and switching between equal-sized single
  tiles. Run the pixel and raster suites, including unaffected sheet frame stamps
  and the contextual dock's unchanged-thumbnail work counts.
- **Result:** The regression failed before the fix with the original color still
  visible after painting. An intermediate run reached document restoration but
  exposed an ambiguous test name selector, which was corrected. The final pixel
  and contextual-panel run passed all 44 cases; both direct raster cases passed.
  The production frontend build and `make lint test` passed (448 Python tests
  and all TypeScript suites), but formatting ran before the final selector edit.
  [CI at `75b4225`](https://github.com/cliffom/gbc-scene-forge/actions/runs/41783329047)
  then rejected that selector's formatting before compilation, tests or packaging;
  the selector was subsequently formatted with Prettier.
- **Limits:** Scoped local automation; no full-browser, installed-wheel, MCP or
  CI rerun is claimed for this follow-up. Earlier broader checks retain their
  revision boundary below; human verification of this fix remains unreported.

## Consolidated editor workflows (milestone 22)

- **Scope:** Prepared 0.33.0 product source at `0269aae` on `milestone/22`,
  #197–#199, checked 2026-11-03 local time (2026-11-04 UTC), macOS arm64,
  Python 3.13.13, Node 24.22.1 and Playwright Chromium. Disposable projects,
  production source bundle and separately installed production wheel.
- **Method:** Four new browser cases cover contextual Inspector/dock states,
  exact single-tile repetition, no-scene creation, named poses, explicit source
  actions and deletion during copy setup. Sixteen panel captures at 1440×900,
  1280×800, 800×640 and 1280×600 include real canvas dimensions, keyboard scrolling
  from playback into timing, document-action bounds and transient history checks.
  Agent inspection of the full capture grid and representative originals includes
  layered illustration and retained copy fields. The
  [integrated assessment](evaluations/unified-editor-ux.md#consolidated-editor-assessment-milestone-22)
  archives fixture provenance, captures, measurements and navigation work counts.
  Existing acceptance covers dirty scene/artwork round trips, shared references,
  imports, variations, exact RGBA/hidden RGB, origins/timing, guards, failed writes,
  recovery, remount/disposal and portable save/reopen/export. Real MCP/browser
  scenarios exercise saved discovery and unpublished handoff with independent owners.
- **Result:** `make lint test` passed (448 Python tests and all TypeScript suites).
  An early broad run was stopped during source review to move a new dock listener
  from redraw to mount scope. Focused checks then exposed unchanged frame-label
  text-node rebuilds and a rapid source-action click during pending native open;
  equal label writes are now skipped and source actions respect the shared busy gate.
  The first completed broad run passed 145 cases, failed one palette-position case
  and skipped 11 optional profiles. Palette position is now bounded before its
  first visible frame and updated while resizing an open popover; five focused
  repetitions passed. The final consistent production-mode `make test-browser`
  run passed all 146 regular cases and skipped the 11 optional profiles. All six
  real MCP/browser scenarios passed again. Production build/strict metadata,
  seven installed-wheel smoke tests and installed-wheel first-use authoring passed.
  Thirty-two frame switches produced zero thumbnail paints, subtree rebuilds,
  additional dock handlers or DOM canvas growth; the existing hover and remount
  cases passed. Documentation checks passed. The user accepted #196 at `d494519`;
  the user reported “verified. This is very nice” after the combined #197–#199
  walkthrough at local revision `86855bb`, recording acceptance of those increments.
- **Limits:** These synthetic checks and agent inspection do not complete #165's
  independent-user study or #166's findings-based remediation. Both panes plus an
  expanded dock leave only 150px drawing height in the compact/short captures;
  controls scroll inside the dock and collapsing it restores height. Work counts
  do not measure heap/GPU memory or sixteen maximum-size documents with full
  histories. Optional profiles, prolonged physical-device drawing, Windows,
  non-Chromium browsers and official Tiled interoperability were not tested.
  The integrated Electron review page stalled during image loading; the same
  review URL opened successfully in separate Chromium. No CI-pass claim is made
  for these checks. User acceptance does not constitute an independent-participant study.

## Active document commands and Save (#196, milestone 22)

- **Scope:** Prepared 0.33.0 working tree on `milestone/22`, based on
  `8d8f7b5fb25f758e89eefe21fbf01f99260b9888`, checked 2026-11-03 local time
  (2026-11-04 UTC), macOS arm64, Python 3.13.13, Node 24.22.1 and local
  Playwright Chromium. Disposable projects; source and installed production wheel.
- **Method:** Four new browser scenarios exercise shared pointer/keyboard commands,
  repeated document switches/remounts, independent dirty histories, clipboard,
  native form/modal focus, one Save location, receipt invalidation and saved-base
  Undo. A model regression checks exact Cut/Paste, hidden RGB and frame-offset bounds.
  Existing browser cases cover frame history, captured gestures, large-document
  zoom/Fit, atomic selected-placement saves, external conflicts, recovery and failed
  post-save adoption. Agent inspection at 1440×1000 and 800×640:
  [artwork review](screenshots/document-commands/artwork-review.png),
  [scene Save](screenshots/document-commands/scene-saved.png) and
  [compact review](screenshots/document-commands/artwork-compact-review.png).
- **Result:** `make lint test` passed (448 Python tests and all TypeScript suites).
  The initial development-mode broad run passed 134 cases, failed seven and skipped
  11 optional profiles. It exposed compact overflow, review-state refresh overwriting
  checkpoint status, a review-mode visibility override, pointer-command focus loss,
  and two obsolete dynamic artwork-button selectors. Those defects/fixtures were
  corrected; all 11 focused regression cases passed. An earlier retained-context
  test targeted a clipped pixel after the toolbar moved; it now chooses a visible
  drawing zoom. The final consistent production-mode full browser run passed all
  142 regular cases and skipped 11 optional profiles. Six real MCP/browser scenarios
  passed, including concurrent saved writes and refresh. Production build, strict
  distribution metadata, seven installed-wheel smoke tests and installed-wheel
  first-use authoring passed. Documentation checks passed. The user reported
  “Verified” for the shared-command and Save walkthrough at local revision
  `d494519`; this records acceptance of that increment.
- **Limits:** Synthetic automation and agent screenshot inspection do not establish
  independent usability, prolonged drawing
  comfort, physical-device scaling, Windows/non-Chromium support or official Tiled
  interoperability. Optional profiling matrices were not run. No CI or publication
  claim is made for this local increment.

## Shared document navigation (#195, milestone 22)

- **Scope:** Prepared 0.33.0 working tree on `milestone/22`, based on
  `a7e452c9444740f2f596ac1793014044afe31eff`, checked 2026-11-03 local time
  (2026-11-04 UTC), macOS arm64, Python 3.13.13, Node 24.22.1 and local
  Playwright Chromium. Disposable scene/artwork projects; source and installed wheel.
- **Method:** Five focused browser scenarios exercise retained layers, tools,
  selection, color, frame/sequence, zoom/scroll and independent history; exact
  canvas snapshots; failed/delayed checkpoints, duplicate navigation, project
  departure/recovery, separate saved-base warnings, captured pan and playback.
  Existing scene-history, targeted-frame, disposal, recovery and browser/MCP
  scenarios cover adjacent ownership contracts. Agent screenshot inspection at
  1440×1000 and 800×640: [artwork](screenshots/document-navigation/artwork.png),
  [chooser](screenshots/document-navigation/documents.png) and
  [compact chooser](screenshots/document-navigation/documents-compact.png).
- **Result:** Five focused navigation cases pass; the retained-context case also
  passes three repetitions after correcting a real hidden-surface scene-scroll
  reset. A captured-pan/playback test exposed ongoing artwork playback while the
  chooser opened; opening Documents now stops it. Rendering checks exposed a second
  scene serialization per painting update; navigation now reuses the already
  computed dirty state. Earlier broad checks also found obsolete hidden-heading
  targets, old name-only expectations and a frozen-renderer viewport interface;
  fixtures now use visible controls, kind labels and an interface-only adapter.
  A production rebuild during the initial development-mode run invalidated two
  build-label assertions; subsequent runs keep mode and bundle consistent.
  `make lint test` passed (448 Python tests and all TypeScript suites); final
  source changes passed lint again. The final production-mode broad browser run
  passed 137 cases, skipped 11 opt-in profiles and failed one obsolete assertion
  that the scene selector was inline beside Project. The assertion now checks the
  shared document button and chooser ownership; its complete launcher/switching/
  conflict/restart scenario passes separately, accounting for all 138 regular cases.
  The full suite was not repeated after that test-only correction. Six MCP/browser
  scenarios passed, including unpublished handoff and real external refresh.
  Production distribution build, strict metadata checks, seven installed-wheel
  smoke checks and installed-wheel first use passed.
  The user reported “verified” after the document-navigation walkthrough at
  local revision `7589b75`. This records acceptance of that increment, including
  clarification of the modified-scene replacement step; it does not establish
  independent usability or prolonged-use evidence.
- **Limits:** Synthetic tests and agent screenshot inspection do not establish
  independent-human acceptance, prolonged drawing comfort, physical-device scaling,
  Windows/non-Chromium behavior or official Tiled interoperability. The integrated
  Electron review page stalled awaiting image decoding; the same prepared review
  URL loaded its scene successfully in separate Chromium. Artwork Save and panel
  refinements remain subsequent milestone scope. No CI or publication claim is made.

## Shared editor shell (#194, milestone 22)

- **Scope:** Prepared 0.33.0 working tree on `milestone/22`, based on
  `0b90f839450ee4dfb3cb3a2eefacc86a2f6d4f5f`, checked 2026-11-03 local time
  (2026-11-04 UTC), macOS arm64, Python 3.13.13, Node 24.22.1 and local
  Playwright Chromium. Disposable native-artwork/scene projects; source-checkout
  production bundle and separately installed wheel.
- **Method:** Synthetic browser scene → selected source → pixel edit → review/save
  → scene return at 1440×900, 1280×800 and 800×640, independent saved-RGBA reads,
  scene history checks, artwork without a scene and repeated mount/dispose checks.
  Agent screenshot inspection covered scene return, drawing and review across
  those sizes. Archived captures: [desktop artwork](screenshots/shared-editor-shell/1440×900-artwork.png),
  [desktop review](screenshots/shared-editor-shell/1440×900-review.png),
  [desktop return](screenshots/shared-editor-shell/1440×900-scene.png),
  [1280 artwork](screenshots/shared-editor-shell/1280×800-artwork.png),
  [1280 review](screenshots/shared-editor-shell/1280×800-review.png),
  [1280 return](screenshots/shared-editor-shell/1280×800-scene.png),
  [compact artwork](screenshots/shared-editor-shell/800×640-artwork.png),
  [compact review](screenshots/shared-editor-shell/800×640-review.png) and
  [compact return](screenshots/shared-editor-shell/800×640-scene.png).
- **Result:** `make lint test` passed, including 448 Python tests and all
  TypeScript suites. Production build, strict distribution metadata and seven
  installed-wheel smoke checks passed. The full regular browser run passed 133
  scenarios, with 11 opt-in profiling scenarios skipped. Three MCP/browser scenarios passed,
  covering mixed artwork edits, conflicts and real external saves/refresh.
  Installed-wheel first use passed. The four new shared-shell scenarios passed.
  The user subsequently reported “That felt unified” and authorized proceeding;
  #194 was pushed in `a7e452c9444740f2f596ac1793014044afe31eff`. This is reported
  acceptance of the shell experience, not independent evidence for every automated
  workflow or prolonged use.
  Its [CI run](https://github.com/cliffom/gbc-scene-forge/actions/runs/41771598861)
  passed package checks and Python 3.13/3.14 compatibility; that result covers the
  pushed shell revision, separately from the local #195 work above.
  Initial focused runs exposed a disabled Inspector toggle during Save and clipped
  dense variation Save controls; direct layout-owner reveal and Inspector-hosted
  variation details corrected both. The initial no-scene test incorrectly used
  the project chooser; the corrected empty-project fixture passed.
- **Limits:** Local synthetic and agent-inspection evidence does not establish
  independent-human usability, prolonged drawing comfort, physical-device scaling,
  non-Chromium/Windows behavior or official Tiled interoperability. The shell
  increment retains the artwork Save footer, chooser and frame dock; later
  milestone issues own navigation, commands and panel refinements. No CI or
  publication result is claimed.

## PR #193 release-gate fixture contention

- **Scope:** Prepared 0.32.0 working tree based on
  `96b50aeace964511d2ce71f795e1a7ba902d5f80`, checked 2026-11-03 locally on
  macOS/Python 3.13/Chromium. The failed CI run used Ubuntu and Python 3.13.
- **Method:** Inspect the
  [failed release gate](https://github.com/cliffom/gbc-scene-forge/actions/runs/41761741620).
  The [refresh fixture](../tests/playwright/mcp/refresh.spec.ts) now uses the
  existing bounded busy-retry helper for project opening, catalog reads and its
  spare-atlas import, retaining the exact revision across import retries.
  Run the focused browser refresh case against the production bundle.
- **Result:** CI passed 129 browser cases, installed-wheel first use and 94 MCP
  tests, then passed five MCP/browser cases and failed the refresh fixture when
  browser polling held the project lock during a direct spare-atlas import.
  The corrected local refresh case passes, including brush preservation,
  unused-atlas deletion, animation refresh and scene deletion.
- **Limits:** The failure was a fixture setup contention error. The focused
  local pass does not establish a new Linux CI pass; Python compatibility jobs
  were skipped in that failed run. Existing independent acceptance gaps remain
  in the single list below.

## PR #193 first-source discovery controls

- **Scope:** Prepared 0.32.0 working tree based on
  `5bf80a5a94a3fe6da413ef08df6e7784d39c34e2`, checked 2026-11-03 in the local
  macOS/Python/Node/Chromium environment recorded under milestone 21 below.
- **Method:** The [discovery regression](../tests/playwright/artwork/iteration.spec.ts)
  opens Existing artwork in an empty project, saves the first artwork externally,
  checks enabled source/open/copy controls and preserved copy identity fields,
  then opens the saved source. It also deletes that source externally with
  auto-refresh disabled and checks manual refresh disables unavailable controls.
  Agent screenshot inspection covers the enabled source controls and retained
  copy name/asset ID at 1440×1000.
- **Result:** The regression fails before correction because the discovered
  source selector remains disabled. It passes after setup controls refresh when
  the eligible inventory is applied. All twelve focused production
  artwork/navigation browser cases pass. `make lint test` passes with 448 Python
  tests and all TypeScript suites; production build and documentation checks pass.
- **Limits:** These are local automated checks and agent desktop inspection,
  not a new CI result or a full browser suite rerun. Existing independent-human,
  physical-device and external-tool gaps remain in the single list below.

## PR #193 adopted-edit recovery and layer palette corrections

- **Scope:** Prepared 0.32.0 working tree based on
  `37ede339ed741df35af10cb558694032b98cc4c6`, checked 2026-11-03 in the local
  macOS/Python/Node/Chromium environment recorded under milestone 21 below.
- **Method:** The [real MCP/browser regressions](../tests/playwright/mcp/iteration-mcp.spec.ts)
  adopt new artwork and edits to saved layered artwork. The saved-edit case checks
  Modified state, separate saved and edited checkpoint sources after returning to
  Scene, recovery after reload, and exact saved layer pixels. Palette assertions
  switch sources in both directions without Undo or checkpoint writes; the
  [artwork regression](../tests/playwright/artwork/iteration.spec.ts) also switches
  sources after saving and reopening. Agent screenshot inspection covers the
  adopted Modified document, selected Red layer and its palette at 1440×1000.
- **Result:** Both production MCP/browser cases and all eleven focused
  artwork/navigation cases pass. `make lint test` passes with 448 Python tests
  and all TypeScript suites; final ESLint, formatting and documentation checks
  pass. The initial new test fixture
  supplied an inline candidate without retaining it, so it could not appear in
  candidate discovery; retaining it with compact mode corrected the fixture.
  Adopted saved edits retain their actual saved original and survive recovery;
  switching layers immediately shows the selected source's colors.
- **Limits:** These are local automated checks and agent desktop inspection;
  they do not establish a new CI result or complete the independent-human,
  physical-device and external-tool checks below.

## PR #193 MCP refresh harness correction

- **Scope:** Prepared 0.32.0 working tree based on
  `f000a63b9b3533f7f65f1c04a1897190eb8a7ee6`, checked 2026-11-03 in the local
  milestone 21 environment below. The linked CI run used Ubuntu 24.04.5 and
  merge revision `9739112dcb1929899253309fead75a73c8e69bf8`.
- **Method:** Inspect the
  [failed job](https://github.com/cliffom/gbc-scene-forge/actions/runs/41753764245/job/126324863546).
  The [refresh acceptance test](../tests/playwright/mcp/refresh.spec.ts) now
  separates JSON stdout from diagnostic stderr and waits for stream closure.
  It holds a real project lock until the MCP startup diagnostic arrives, then
  checks the successful JSON result. Rerun the five MCP/browser cases against
  the rebuilt production bundle and run `make lint` locally.
- **Result:** The CI job passed 127 production browser cases, installed-wheel
  first use and 93 optional MCP tests, then passed four MCP/browser cases and
  failed refresh because its helper parsed the combined diagnostic and JSON as
  JSON. The correction retains stderr for failure diagnostics while parsing only
  stdout. All five local production MCP/browser cases pass, including the forced
  startup-contention assertion; production build, lint and documentation checks
  also pass.
- **Limits:** The original CI failure is a harness parsing failure, not evidence
  of a failed MCP mutation. Local checks do not establish a new Linux CI pass or
  independently verify the remaining acceptance gaps below.

## PR #193 review corrections

- **Scope:** Prepared 0.32.0 working tree based on
  `f000a63b9b3533f7f65f1c04a1897190eb8a7ee6`, checked 2026-11-03 on the local
  macOS/Python/Node/Chromium environment recorded under milestone 21 below.
- **Method:** [Browser regressions](../tests/playwright/artwork/iteration.spec.ts)
  delay a real inventory response across a key interaction, then check discovery
  retries without another save; they also exercise trimmed and empty layer names,
  checkpoints, Undo/Redo, save and reopen. The
  [adoption regression](../tests/backend/adapters/test_mcp_iteration.py) changes a
  selected scene without changing the manifest revision and checks rejection
  before retaining a copy. Agent screenshot inspection covers desktop layers at
  1440×1000 and saved/reopened compact layers at 760×800.
- **Result:** All three regressions failed against the original implementation
  and pass after correction. `make lint test` passes with 448 Python tests and all
  TypeScript suites. Eleven focused artwork/navigation browser cases and the
  [real MCP/browser handoff case](../tests/playwright/mcp/iteration-mcp.spec.ts)
  pass against the rebuilt development bundle. Normalized layer names persist;
  rejected empty names leave the previous layer intact.
- **Limits:** These are local automated checks and agent inspection, not a full
  production browser rerun, installed-wheel verification or a new CI result.
  Existing physical-device, independent-human and external-tool gaps remain in
  the single Remaining checks list below.

## Unchanged artwork discovery after mounting (PR #193 CI)

- **Scope:** Prepared 0.32.0 correction based on `26290d4faedd072c0d603cba54b58c7b5f9f1f6e`,
  checked 2026-11-03 on the local macOS/Python/Node environment recorded below and
  an Ubuntu 24.04 GitHub runner in the linked CI run.
- **Method:** [Initial Linux CI](https://github.com/cliffom/gbc-scene-forge/actions/runs/41751708249)
  exercised the full production browser suite. The
  [navigation regression](../tests/playwright/artwork/navigation.spec.ts)
  now deliberately crosses a discovery interval before checking that unchanged
  navigation makes no artwork requests. Local focused production checks also
  exercise wheel/layer history and scene navigation; installed-wheel SDK/browser
  coverage distinguishes unchanged discovery from actual external saved changes.
- **Result:** The initial CI run passed 126 cases, skipped 11 opt-in profiles and
  failed one no-request assertion because the first discovery poll reloaded an
  unchanged inventory. Discovery now compares against the composition's loaded
  project revision until its first external adoption; it continues preserving
  original authoring bases. The ten focused production browser cases and seven
  rebuilt-wheel smoke checks pass.
- **Limits:** The focused local rerun does not itself replace a full Linux CI
  result. Independent human/physical-device, non-Chromium and external-tool
  boundaries remain those recorded below.

## Human–agent artwork iteration (milestone 21)

- **Scope:** Prepared 0.32.0 working tree on `milestone/21-artwork-iteration`,
  based on `c55fc8df32f3434438436f10f2a1e7d122bea00e`, checked 2026-11-03 on
  macOS 27.0.1 arm64 / Apple M4 Max, Python 3.13.13, Node 24.22.1,
  MCP SDK 1.30.0 and Playwright 1.64.1 / Chromium 156.0.8078.4.
- **Method:** Domain/SDK regressions exercise exact PNG/raster/layer bytes, source
  targeting, ownership, stale review/base guards, interrupted layered-save recovery,
  portable transfers and deletion. Browser automation covers layer history/save,
  anchored wheel zoom, separately owned unpublished exchange, saved continuation
  and discovery/deletion while another document stays dirty. Installed plain and
  optional-MCP wheels supply smoke, first-use and SDK/browser checks. Agent
  screenshot inspection covers desktop layers and unpublished return at 1440×1000
  and compact layers at 760×800. The [evaluation](evaluations/artwork-iteration.md)
  archives captures, deterministic equivalent-task methods and raw transport,
  latency, peak memory, retention, recovery and history observations.
- **Result:** `make docs-check lint test` passes with 447 Python tests and all
  TypeScript suites. Production build/distribution checks and seven installed-wheel
  smoke tests pass. Production browser acceptance passes 127 cases with 11 opt-in
  profiling cases skipped; installed-wheel first use, 93 optional MCP tests and
  five SDK/browser cases pass. The initial broad run exposed a dense short-window
  Confirm save obstruction; bounded layer sidebars and document actions correct
  it. An intermediate run mixed development expectations with rebuilt production
  assets and failed two version-label assertions; that run is excluded from product
  evidence. The final explicit production run passes both assertions. Review also
  corrected layer reads/counts to identify the original candidate revision and source
  layer, with regression assertions. In the fixed 375×525 task, tool calls drop
  from 12 to 5; large layered snapshots still have substantial working memory costs.
- **Limits:** These are local synthetic observations and agent inspection, not a
  new independent-human or CI result. The single measurement run does not establish
  general speed, artistic-quality parity, maximum-layer/low-memory suitability,
  physical wheel/trackpad comfort or non-Chromium behavior. Official Tiled and
  rasterizer applications were unavailable. Near-color/noise diagnostics and
  changed-pixel overlays remain explicitly deferred; existing participant-dependent
  acceptance remains open in the single Remaining checks list below.

## PR #183 maximum-axis artwork Fit correction

- **Scope:** Prepared 0.31.0 working tree based on
  `bb0f36c3308cdd2fee1fb37d8347aa5e6bb80b83`, checked 2026-11-03 on macOS 27.0.1
  arm64, Python 3.13.13, Node 24.22.1 and Playwright 1.64.1 / Chromium 156.0.8078.4.
- **Method:** [Browser regressions](../tests/playwright/artwork/large-artwork.spec.ts)
  check automatic and explicit Fit for 1,024 × 4,096 and 4,096 × 1,024 documents
  at 1440 × 800 and explicit Fit at 760 × 600, including returning from 32× zoom.
  Agent inspection covers the fitted tall document at 760 × 600 in the production bundle.
- **Result:** The tall-document regression fails against the previous bundle:
  automatic Fit falls back to 1×. After adding smaller zoom presets and using the
  smallest preset as the fallback, the production build and all ten large-artwork
  browser cases pass. `make docs-check lint test` passes with 435 Python tests
  and all TypeScript suites.
- **Limits:** Local Chromium automation and agent inspection do not establish
  non-Chromium or physical-device usability. These checks cover the artwork suite,
  not the full browser suite, installed-wheel behavior or new CI results.

## PR #183 candidate ownership and detail-review corrections

- **Scope:** Prepared 0.31.0 working tree on `feat/181-large-artwork`, based on
  `13164c0cef1393a6502964563996f0e7542a8eab`, checked 2026-11-03 on macOS 27.0.1
  arm64, Python 3.13.13, Node 24.22.1 and Playwright 1.64.1 / Chromium 156.0.8078.4.
- **Method:** [Candidate regression](../tests/backend/artwork/test_large_artwork.py)
  interleaves two browser owners and an MCP handle with identical content, checks
  shared quotas, restart listing/export and independent release. The
  [MCP sheet checks](../tests/backend/adapters/test_mcp_sheets.py) exercise owned
  handles through real stdio SDK export/edit/release and reject invalid owners. The
  [browser regression](../tests/playwright/artwork/large-artwork.spec.ts) switches
  from a large detail review to a new 16 × 16 tile, reviews/saves valid defaults,
  then verifies retained large-document settings. Agent inspection covers the
  small-document detail panel at 1440 × 1000 in the production bundle.
- **Result:** `make docs-check lint test` passes with 435 Python tests and all
  TypeScript suites; the production frontend build and all three focused MCP
  sheet checks pass. The large-artwork and
  pixel-editor browser run passes 49 cases and exposes one test-helper mistake:
  revealing a collapsed detail checkbox clicked Confirm save. The corrected test
  expands the detail section directly and passes its focused rerun.
- **Limits:** These are local synthetic checks, not a new CI, installed-wheel,
  non-Chromium or physical-device result. The entire browser suite was not rerun.
  Scoped candidate copies share the existing project quota; abandoned transfers
  remain discoverable for explicit export/release rather than expiring.

## Large illustrations and artwork palette (#181)

- **Scope:** Prepared 0.31.0 working tree on `feat/181-large-artwork`, based on
  `62b864c73d014ec5b8607e88020e3029d2a0c6f2`, checked 2026-11-03 on macOS 27.0.1
  arm64 / Apple M4 Max, Python 3.13.13, Node 24.22.1, Playwright 1.64.1 /
  Chromium 156.0.8078.4 and MCP SDK 1.30.0. Release preparation is not publication.
- **Method:** Synthetic service/frontend/browser tests exercise the six requested
  card sizes, exact RGBA including hidden RGB, bounded patches/reads/reviews,
  receipts, original-plus-copy recovery, stale bases, undo/redo, save/reopen and
  portable ZIP transfer. Separate plain and optional-MCP wheel environments
  exercise package smoke, first use and real stdio/browser workflows. Agent
  inspection covers production palette captures at 1440 × 900 and 760 × 900.
  The [evaluation and archived data](evaluations/large-artwork.md) record service
  timings, browser workflow timings, process peak RSS and screenshot provenance.
- **Result:** `make docs-check lint test` passes with 434 Python tests and all
  TypeScript suites, including final request-budget and expanded incompressible
  ZIP-transfer/recovery checks. Production
  build/metadata checks, seven plain wheel smoke tests, installed-wheel first use,
  81 optional MCP tests and all four installed MCP/browser workflows pass. The
  broad browser run passes 122 cases, skips 11 opt-in profiles and finds one stale
  transparency test that selected a collapsed swatch; its corrected focused
  rerun passes. All seven new card/palette cases pass in that broad run.
  Largest-card recovery initially exceeded the former 64 MiB draft quota; the
  separate 128 MiB quota permits original and recovered records, with regression
  coverage. Automatic Fit initially invoked a disabled button while opening;
  direct fitting after layout corrects it, and initial-zoom assertions pass.
- **Limits:** Local automation and agent image inspection do not establish
  independent human discovery, prolonged drawing comfort, lower-memory physical
  devices, non-Chromium/Windows or official Tiled application behavior. Official
  Tiled/rasterizer executables were unavailable. One raw raster is at most 16 MiB;
  cumulative service-process peak RSS reached 1,337,049,088 bytes. MCP artifacts
  retain their 16 MiB cap; larger ZIPs require browser download. Shared-host
  measurements are observations, not latency or total-memory guarantees. The
  full broad local suite was not rerun after its test-only dropdown correction;
  no CI pass is claimed here. Existing unperformed checks remain below.

## Artwork ownership extraction and asynchronous audit (#168, #169)

- **Scope:** Internal-refactor working tree on `milestone/18-artwork-ownership`,
  based on `166eda046c4121452615e16048100ad48107e0d6`, checked 2026-11-03 on
  Darwin 27.0.0 arm64 / Apple M4 Max, Python 3.13.13, Node 24.22.1 and Chromium
  156.0.8078.4. Package/runtime versions remain 0.30.1; no new release is prepared.
- **Method:** Existing browser cases exercise retained controls/viewports,
  exact pixels/layout/history, checkpoint uncertainty and guarded review/save.
  A focused extracted-gesture check replaces the model during capture, sends an
  unrelated pointer release and disposes with a stroke pending. The unchanged
  eight-case production profile compares all view/timeline phases against the
  source baseline; [methods, digests and measurements](evaluations/editor-responsiveness.md#artwork-ownership-extraction-comparison-168)
  identify the variants. The [asynchronous audit](evaluations/artwork-ownership.md)
  maps identity/queue/receipt/journal boundaries and adds lost-save-response,
  acknowledged-save/reopen-failure and late-read/disposal checks. Distribution
  checks inspect source-module inclusion, source maps and a fresh wheel installation.
- **Result:** `make docs-check lint test` passes, as do all 51 focused browser
  cases, production distribution/metadata checks and seven installed-wheel smoke
  checks. All eight profile cases pass before and after extraction; per-handler
  resize/upload/draw/encode counts match across 24 phases and 72 measured trials.
  The full plain installed-wheel browser run passes 113 cases with 11 opt-in
  profiles skipped; three final added async cases pass against that wheel, and
  all four real SDK/browser handoff/refresh cases pass using the source environment.
  Strict checking initially found a nullable canvas context in the extracted
  closure; retaining its draw-time guard corrected the build before browser runs.
  The first async download fixture targeted a closed disclosure; revealing it
  corrected that timeout. No additional product defect was verified by the audit.
- **Limits:** Synthetic local Chromium checks do not establish human usability,
  physical-device latency, Windows/non-Chromium or official Tiled application
  behavior. Shared-host timings are observations; local raw profile JSON is
  ignored rather than archived. The audit covers selected deterministic schedules,
  with UI busy gates and mounted cancellation as documented assumptions; it does
  not certify every endpoint/interleaving. Existing unperformed checks below remain.

## Workflow usability and browser/MCP outcomes (milestone 17)

- **Scope:** Prepared 0.30.1 working tree on `milestone/17-workflow-usability`,
  based on `0d3ab3c`, checked 2026-11-03 on macOS 27.0.1 arm64, Python 3.13.13,
  Node 24.22.1, Playwright 1.64.1 / Chromium 156.0.8078.4 and MCP SDK 1.30.0.
- **Method:** Synthetic browser/SDK checks compare identical saved-sheet baselines
  through browser-only, SDK-only and mixed pixel/timing edits; full RGBA (including
  hidden RGB), descriptor and looping are compared after saved reopen. Existing
  real stdio/browser cases exercise external refresh, conflicts and recovery.
  Installed-wheel checks cover first use, shared/new review at 1440×900 and 800×640,
  keyboard disclosure/focus, copy explanations, a 360-reference bounded page,
  clean review labels, Undo and lost checkpoint acknowledgments. Agent screenshot
  inspection and initial fixture failures are scoped in the
  [evaluation](evaluations/workflow-usability.md); the
  [outcome matrix](AUTHORING-OUTCOMES.md) distinguishes inherited coverage.
- **Result:** `make docs-check lint test` passes (429 Python tests and all
  TypeScript suites). Production distribution/metadata checks and seven plain
  installed-wheel smoke tests pass. Seven focused installed-wheel browser checks
  pass, including first use, new/shared review, 256-of-360 location disclosure,
  Undo protection and ambiguous checkpoint acknowledgment. The three-route
  comparison produces identical saved pixels and descriptors. Optional MCP
  service/SDK checks pass with 81 tests in a fresh wheel environment, followed by
  all four real SDK/browser workflows (including identical three-route content,
  external refresh and conflicts). The broad regular browser run passes 112
  cases with 11 opt-in performance profiles skipped.
- **Limits:** Synthetic automation and agent image inspection do not establish
  independent novice discovery, prolonged comfort, actual browser zoom/OS scaling,
  Windows, non-Chromium or official Tiled application behavior. No participants or
  participant observations were available; #165 and participant-dependent #166
  acceptance remain open. No new MCP authoring capability or browser candidate
  inbox is claimed. The broad browser run began before the final checkpoint-label
  correction; final affected states were rechecked with the installed wheel.
  Release preparation is separate from publication.

## Retained artwork viewport correction (PR #178)

- **Scope:** Prepared 0.30.0 feedback working tree based on `001ea19cbac6f195eddf286250cec27833e83c2d`,
  checked 2026-11-03 on macOS with production assets and Playwright Chromium,
  using a disposable project at 1440 × 1000.
- **Method:** Browser regressions pan and modify a retained sheet frame, return to
  Scene, then reopen through Documents or the Library. Assertions compare canvas
  position within 2 px and verify zoom, frame scope, color, Pan choice and Undo.
  Agent screenshot inspection checks the restored canvas through both routes.
- **Result:** The original Documents regression displaced the canvas by 620 px.
  Rejecting snapshots from unmeasurable viewports preserves the last visible
  presentation. All seven artwork navigation browser cases pass after the fix.
  `make lint test` passes with 429 Python tests and all TypeScript suites;
  `make docs-check` passes.
- **Limits:** Local automated Chromium checks and bounded agent inspection;
  other browsers, physical display scaling and independent human checks were
  not repeated. Previous release validation below predates this correction.

## Artwork interaction polish (#173–#176)

- **Scope:** Prepared production 0.30.0 working tree on `milestone/20-artwork-polish`,
  based on `02aa30a43aeb5b1522618feae0cb08c8a00c2c9f`, checked 2026-11-03 on macOS
  27.0.1, Python 3.13.13, Node 24.22.1 and Playwright 1.64.1/Chromium 156.0.8078.4.
  The [evaluation](evaluations/artwork-interaction-polish.md) archives baseline
  provenance, raw measurements and inspected screenshots.
- **Method:** Real pointer/keyboard browser checks cover sheet/frame coordinates,
  zoom/scroll/pan, exact partial-alpha writes, Undo, Fit, per-document restoration,
  cancellation, native radio focus and modal dismissal. Synthetic instrumentation
  counts hover raster/control work. Geometry checks cover four sizes and four
  panel states; chooser checks include long names, no scene and 125% CSS zoom.
  Agent screenshot inspection includes light/dark/transparent targets, desktop,
  compact Review, Properties, short Animation and modal focus/backdrop.
- **Result:** `make lint test` passed with 429 Python tests and all TypeScript
  suites. Production build/metadata and seven installed-wheel checks passed;
  installed-wheel first use, 81 optional MCP tests and three MCP/browser workflows
  passed. The broad browser run had 105 passes, 11 optional profiles skipped and
  two geometry-test failures from treating scrollable palette swatches as fixed
  commands. Corrected geometry checks passed: 18 other focused cases passed,
  followed by the corrected legacy artwork layout case and all seven navigation
  cases. Fixed commands fit in all 16 measured states. Normal drawing height grows
  by 42 px at 1440 px widths and 6 px at the tested narrower widths. Eighty hover
  moves produce one overlay update, no raster uploads/control mutations and no
  artwork API calls. Inspection also caught and corrected a clipped Zoom value.
- **Limits:** Local synthetic automation and bounded agent inspection, with the
  broad run preceding the final Zoom-width/lifetime guard adjustments; final
  affected cases were rerun. Work counts do not measure user-perceived latency.
  CSS zoom is not physical display scaling. No independent human, Windows,
  non-Chromium or official Tiled application checks were repeated; existing
  remaining checks below still apply. Release publication is separate.

## Library search and import usability (#123, #124, #125)

- **Scope:** Prepared 0.29.1 working tree on `milestone-13-usability`, based on
  `9c23b5f781f3ad175ffcdfaa97ed85fdb1746343`, checked 2026-11-03 on macOS 27.0.1,
  Python 3.13.13, Node 24.22.1 and Playwright 1.64.1/Chromium 156.0.8078.4.
  New Library flows run at 1440 × 900 and 760 × 640 with disposable sample/PNG/Tiled inputs.
- **Method:** Real pointer/keyboard controls exercise displayed/raw/case-varied
  names, atlas/kind filters, no-match/clear, selection, brush, layer, Undo/Redo and
  checkpoint preservation. Import checks cover missing PNG correction, Tiled
  incompatibility correction, explicit import, input/mode invalidation, delayed
  successful/failed responses and close/reopen confirmation invalidation.
  Agent visual inspection covers search ([desktop](screenshots/library-usability/search-1440.png),
  [compact](screenshots/library-usability/search-760.png)), entry/empty state
  ([desktop](screenshots/library-usability/entry-1440.png),
  [compact](screenshots/library-usability/entry-760.png)) and corrected PNG feedback
  ([desktop](screenshots/library-usability/corrected-1440.png),
  [compact](screenshots/library-usability/corrected-760.png)).
- **Result:** `make lint test` passed: 429 Python tests and all 21 TypeScript suites;
  documentation checks passed. Production build/metadata and all seven installed-wheel
  smoke checks passed. The initial broad browser run had 96 passes, two optional
  profiles skipped and two build-identity failures because production assets were
  tested with development expectations. With the production setting corrected,
  all 16 affected browser cases passed on the final implementation, as did installed-wheel
  first use and all three optional MCP/browser workflows. Initial compact test
  attempts targeted collapsed tools; opening the existing Tools menu resolved those
  test failures. Both visible-name and raw-ID queries find the same sprite; corrected
  previews agree with confirmation/footer feedback and changed inputs clear readiness.
- **Limits:** Synthetic local automation and bounded agent screenshot inspection;
  compact results/dialogs require their existing scrolling. The final browser rerun
  covered affected cases; the other broad-run cases preceded the final copy/feedback
  adjustments. No independent human, Windows, non-Chromium or official Tiled application
  checks were repeated. Existing remaining checks below still apply. Publication is separate.

## Saved representation history bounds (PR #158)

- **Scope:** Prepared 0.29.0 working tree based on `355582d`, checked
  2026-11-02 local time (2026-11-03 UTC), macOS, Node 24.22.1 and
  Playwright 1.64.1/Chromium at 1440 × 1000 with disposable synthetic artwork.
- **Method:** Model checks traverse Undo/Redo across valid states on both sides
  of oversized snapshots after saved-frame reconciliation. Browser automation
  removes five timing entries from a near-limit sheet, paints pixels, saves a
  tile representation, traverses retained history, checkpoints, switches documents
  and saves both earlier and redone work. Ran frontend build, `make lint test`,
  the complete pixel-artwork browser suite and `make docs-check`.
- **Result:** Before the fix, Chromium restored a 65,714-byte descriptor after
  Undo and Return to Scene failed with HTTP 400. The fixed model retains valid
  older states while removing snapshots that exceed document limits. All 36
  browser scenarios passed, including pixel Undo/Redo and reviewed saves without
  failed artwork requests. Lint, all frontend suites and 429 Python tests passed.
- **Limits:** Invalid history states are removed rather than altering their
  layout or pixels. Local source Chromium automation only; full browser,
  installed-wheel, MCP, remote CI and independent human usability checks were
  not repeated.

## Layout descriptor byte budget (PR #158)

- **Scope:** Prepared 0.29.0 working tree based on `9961110`, checked
  2026-11-02 local time (2026-11-03 UTC), macOS, Node 24.22.1 and
  Playwright 1.64.1/Chromium at 1440 × 1000 with disposable synthetic artwork.
- **Method:** Browser automation opens a saved sheet near the 64 KiB descriptor
  limit, including a Unicode document name. It attempts oversized animation
  creation, Unicode frame renaming, tile representation creation and frame
  appending, then exercises retained Undo/Redo, checkpointing, document switching
  and reviewed save. Ran frontend build, `make lint test`, the complete
  pixel-artwork browser suite and `make docs-check`.
- **Result:** All 35 browser scenarios passed, including rejection before any
  failed layout request, restoration of the selected sequence, and saving the
  previous valid layout. Lint, all frontend suites and 429 Python tests passed.
  The initial regression harness toggled an already-open Properties panel while
  revealing its nested Representations disclosure; opening that disclosure
  directly corrected the harness.
- **Limits:** Local source Chromium automation only; full browser, installed-wheel,
  MCP, remote CI and independent human usability checks were not repeated.

## Generated representation name bounds (PR #158)

- **Scope:** Prepared 0.29.0 working tree based on `41422ea`, checked
  2026-11-02 local time (2026-11-03 UTC), macOS, Node 24.22.1 and
  Playwright 1.64.1/Chromium at 1440 × 1000 with synthetic artwork.
- **Method:** Browser automation renames a sprite frame to 94, 95 and 100
  characters and tests a Unicode character at the truncation boundary. Each
  scenario adds a tile representation, checkpoints, performs Undo/Redo, switches
  documents, reviews/saves and reopens the exact saved descriptor. Ran frontend
  build, `make lint test` and `make docs-check`.
- **Result:** Before the fix, the 95-character scenario failed to checkpoint
  with HTTP 400. All four corrected scenarios passed, preserving the original
  frame name and a valid suffixed representation name. Initial test setup had
  duplicate titles and toggled the already-open Properties panel; unique labels
  and opening its visible Representations disclosure corrected the harness.
  Lint, all frontend suites, 429 Python tests and documentation checks passed.
- **Limits:** Local source Chromium automation only; full browser, installed-wheel,
  MCP, remote CI and independent human usability checks were not repeated.

## CI playback test timing (PR #158)

- **Scope:** Prepared 0.29.0 working tree based on `84eb2dc`, checked
  2026-11-02 local time (2026-11-03 UTC), macOS, Node 24.22.1 and
  Playwright 1.64.1/Chromium. The failed
  [Ubuntu CI job](https://github.com/cliffom/gbc-scene-forge/actions/runs/41582684705/job/125740894419)
  tested merge `210a0a8` containing that head.
- **Method:** Inspected the job log and paused the installed clocks in the
  scene/artwork replay tests so only explicit clock advances consume frame
  durations. Built with `FORGE_BUILD_MODE=production` and repeated each replay
  scenario ten times; ran `make lint test` and `make docs-check`.
- **Result:** CI reported 82 browser passes, two opt-in skips and one failure:
  the resumed scene preview had already returned to Play when Pause was asserted.
  Both corrected playback scenarios passed all 20 local production repetitions.
  Lint, all frontend suites, 429 Python tests and documentation checks passed.
- **Limits:** Local Chromium evidence only; the original Ubuntu scheduling race
  was identified from its log rather than reproduced on the CI runner. The full
  browser suite, installed-wheel/MCP checks and remote CI were not rerun for this
  test timing correction.

## Conversion review coverage (PR #158)

- **Scope:** Prepared 0.29.0 source working tree based on `84eb2dc`, checked
  2026-11-02 local time (2026-11-03 UTC), macOS, Node 24.22.1 and
  Playwright 1.64.1/Chromium. Disposable synthetic sheets and an 800 × 800 scene.
- **Method:** Browser acceptance selects two distant sprites beyond pixel 256,
  using an artwork origin and an object origin override at the scene edge.
  It samples opposite image corners of both sprites in their review views,
  compares before/after pixels, fails the second view, retries and commits.
  Compact checks cover 760 × 640; agent inspected the generic
  [two-view capture](images/conversion-selected-views.png) at 1440 × 1280.
  Model checks cover clustered selections, small scenes and every pixel of a
  sprite larger than one view. Ran frontend build, `make lint test`, the complete
  pixel-artwork browser suite and `make docs-check`.
- **Result:** All 30 pixel-artwork browser scenarios, lint, frontend suites,
  429 Python tests and 20 documentation-checker tests passed. A failed view kept
  confirmation disabled and hid stale images; retry covered both selected
  placements before commit. The initial browser attempt missed the second
  selection because it lay below the canvas viewport; explicit scrolling and a
  two-object selection assertion corrected the harness. Lint initially rejected
  test type/non-null assertions; runtime guards corrected those violations.
- **Limits:** Local source Chromium automation and agent image inspection only;
  full browser/MCP suites, installed-wheel, other browsers and independent human
  usability checks were not repeated for this viewport fix.

## Artwork selections across frame history (PR #158)

- **Scope:** Prepared 0.29.0 source working tree based on `84eb2dc`, checked
  2026-11-02 local time (2026-11-03 UTC), macOS, Node 24.22.1 and
  Playwright 1.64.1/Chromium at 1440 × 1000. Disposable synthetic sheets.
- **Method:** Browser pointer/keyboard acceptance reproduces Undo and Redo
  restoring a selection outside the active frame, then exercises Copy, transform,
  Paste and reviewed save. Separate scenarios verify retained selections within
  a frame and across frame boundaries in Sheet view through saved pixel values.
  Ran `npm run build`, `make lint test`, the complete pixel-artwork browser suite
  and `make docs-check`.
- **Result:** Both cross-frame scenarios failed before the fix with an uncaught
  Copy error and disabled Paste. After reconciliation, all 29 pixel-artwork
  browser scenarios passed, including four new history scenarios. Lint, all
  frontend suites, 429 Python tests and 20 documentation-checker tests passed.
- **Limits:** Local source Chromium automation only; full browser/MCP suites,
  installed-wheel, other browsers and independent human usability checks were
  not repeated for this selection fix.

## Artwork playback history and replay (PR #158)

- **Scope:** Prepared 0.29.0 source working tree based on
  [`f9d4608`](https://github.com/cliffom/gbc-scene-forge/commit/f9d4608ec8ffc183df03222c27ddc118b1c1a918),
  checked 2026-11-02 on macOS with Node 24.22.1 and Playwright 1.64.1/Chromium.
  Disposable synthetic artwork; no existing project data modified.
- **Method:** Reproduced the pending-timer failure with the real pixel model and
  mounted sheet controls. Added browser acceptance for Play → Undo shortening a
  sequence, Play → Redo restoring it, and resumed playback. Model and browser
  regressions distinguish completed non-looping replay from pausing on the last
  frame in Scene and Artwork, including single-frame sequences. Ran `make lint test`,
  `npm run build`, artwork/polish browser suites and `make docs-check`. Refreshed
  the [identity capture](images/artwork-name-identity.png) from the source sample
  fixture at 1280 × 800 with a generic artwork name; agent visually inspected it.
- **Result:** Before the fix, the timer threw while reading `duration_ms` from a
  removed frame and left Pause displayed. After the fix, both history directions
  stopped playback, restored first-frame status and allowed playback to restart.
  Completed sequences restarted at frame zero; paused sequences resumed their
  current pose. All 35 artwork/polish scenarios, the refreshed identity scenario,
  lint, frontend suites, 429 Python tests and 20 documentation-checker tests passed.
- **Limits:** Source Chromium automation only; installed-wheel packaging, the
  complete browser/MCP suites and independent human usability checks were not
  repeated for these playback fixes. Existing Remaining checks still apply.

## Saved artwork history, offline layout recovery and playback completion (PR #158)

- **Scope:** Prepared 0.29.0 working tree based on
  [`86efe41`](https://github.com/cliffom/gbc-scene-forge/commit/86efe4165338bae8fca2ee9b8b91001a4a90ac6d),
  checked 2026-11-02 local time (2026-11-03 UTC), macOS arm64, Python 3.13.13,
  Node 24.22.1 and Playwright 1.64.1/Chromium. Source and installed production
  wheel; disposable synthetic sheets and scenes.
- **Method:** Ran `make lint test`, `make build check-dist`, `make docs-check`,
  frontend model regressions and installed-wheel artwork/polish browser acceptance.
  Saved a new tile representation, undid earlier timing, switched documents,
  saved, redid and saved again. Simulated a layout HTTP 503 and inspected the
  downloaded live descriptor. Checked one- and two-frame non-looping scene
  playback completion. Agent visually inspected the
  [completed preview](images/non-looping-preview-complete.png), captured at
  1440 × 1000 from the installed-wheel one-frame scenario with transparent
  synthetic artwork.
- **Result:** Lint, all frontend suites, 429 Python tests and 20 documentation-
  checker tests passed. Distribution metadata and seven installed-wheel smoke
  tests passed. All three new source browser regressions passed. Installed-wheel
  artwork/polish: 33 passed, including all three new regressions. An initial offline-download test
  attempt inadvertently closed Properties through its disclosure helper; opening
  the visible Representations disclosure directly corrected the test setup.
- **Limits:** Local automated acceptance and agent screenshot inspection only.
  The complete browser suite, installed MCP suites, independent human usability,
  Windows/non-Chromium and official Tiled assessments were not repeated for
  these fixes. Downloaded JSON remains an inspection/reconciliation record, not
  an automatic import format. No version bump, tag or publication.

## Artwork setup and document restoration feedback (PR #158)

- **Scope:** Prepared 0.29.0 working tree based on
  [`3a13eb4`](https://github.com/cliffom/gbc-scene-forge/commit/3a13eb471337473c9474eede2abb05f6fd3e23fa),
  checked 2026-11-02 local time (2026-11-03 UTC), macOS arm64, Python 3.13.13,
  Node 24.22.1 and Chrome/Playwright 1.64.1. The updated
  [workflow evaluation](evaluations/unified-editor-ux.md#feedback-refinements)
  records screenshot scope.
- **Method:** Ran `make lint test`, `make docs-check`, production
  `make build check-dist`, installed-wheel artwork/polish browser acceptance and
  the actual optional-SDK/browser artwork handoff. New regressions use two saved
  sheets with shared frame/sequence IDs but distinct colors and timings: restore
  Walk after visiting Idle in the other sheet, change duration, save/reopen and
  verify only the intended sequence changed. Review checks clear both sheets'
  comparison/APNG output and regenerate the active sheet's review before saving.
  Checked complete Library label text at five viewport sizes, setup navigation,
  name normalization and manual ID overrides; inspected refreshed captures.
- **Result:** Lint and all frontend suites passed; 429 Python tests and 20
  documentation-checker tests passed. Production metadata and seven installed-
  wheel smoke tests passed. All 30 installed-wheel artwork/polish scenarios
  and the installed optional-SDK/browser artwork handoff passed. The first new restoration test attempted to
  select a sequence before opening the second document's collapsed animation
  dock; its next attempt raced the asynchronous document opening. Waiting for
  that document's heading before revealing its controls fixes the test setup.
- **Limits:** Scoped local synthetic acceptance and agent screenshot inspection;
  the complete browser suite was not rerun for this feedback. Its earlier
  76-scenario result below retains its revision boundary. Independent human,
  screen-reader, Windows/non-Chromium and official Tiled assessments remain
  unperformed. No new asset format, release version, tag or publication.

## Human artwork workflow redesign (milestone 15)

- **Scope:** Prepared 0.29.0 working tree on `milestone/15`, based on
  [`88f25d0`](https://github.com/cliffom/gbc-scene-forge/commit/88f25d0fe771ad66b5e5eb99f818f2125f0309df),
  checked 2026-11-02 local time (2026-11-03 UTC), macOS arm64, Python 3.13.13,
  Node 24.22.1 and Chrome/Playwright 1.64.1. The
  [design review and final captures](evaluations/unified-editor-ux.md) distinguish
  baseline observations from the delivered interface.
- **Method:** Ran `make docs-check lint test`, production `make build check-dist`,
  complete source browser acceptance, installed-wheel artwork/polish acceptance,
  and actual installed optional-SDK/browser artwork handoff. Inspected fresh
  Scene/New/Sheet/Frame/Animation/Review captures at 1440 × 900, 1280 × 800 and
  800 × 640. Exercised keyboard entry, progressive disclosure, recovery,
  requested-frame targeting, exact review, repeated saves, retained Undo/Redo
  against the new saved base, and manual/agent continuity. Rechecked resize,
  pixel equivalence, cache bounds and disposal against the final installed wheel.
- **Result:** Lint and all frontend suites passed; 429 Python tests and 20
  documentation-checker tests passed. Distributions/metadata and seven installed-
  wheel smoke tests passed. All 28 installed-wheel artwork/polish scenarios and
  the installed optional-SDK/browser artwork handoff passed. The initial full
  browser run had 75 passes, two optional profile skips and one resize-overview
  pixel failure caused by individually scaled tiles. Native chunk composition
  fixed the seams; its first targeted run exposed temporary canvas resources
  exceeding the retained-resource assertion. Explicitly releasing non-retained
  chunks fixes that failure, and all three final installed-wheel resize/cache
  scenarios pass. The complete source browser rerun passed
  76 scenarios with two optional scalability profiles skipped.
- **Limits:** Local synthetic acceptance and agent screenshot inspection do not
  certify human drawing comfort, independent novice success, accessibility,
  physical-device behavior or production art quality. The complete source browser rerun began before the final New/Existing
  heading correction; installed-wheel UI and SDK acceptance were rerun with
  that correction. Three installed-wheel rendering scenarios exercise the
  chunk-composition/resource fix. Historical
  milestone evidence below retains its original scope. Windows, non-Chromium,
  screen-reader and official Tiled/rasterizer assessments remain unperformed.
  No tag, release publication or independent human study is claimed.

## Native sheets and unified artwork workspaces (milestone 15)

- **Scope:** Prepared 0.29.0 working tree on `milestone/15`, based on
  [`bbdfb8a`](https://github.com/cliffom/gbc-scene-forge/commit/bbdfb8a69c20ceb740fd08977f431cbaf4ef5b44),
  checked 2026-11-02 local time (2026-11-03 UTC), macOS arm64, Python 3.13.13,
  Node 24.22.1, Playwright 1.64.1, Chromium and optional MCP SDK 1.30.0.
  Plain and optional-MCP production wheels were installed separately.
- **Method:** Ran documentation checks, lint, Python/frontend suites, production
  distributions and installed-wheel smoke tests; full browser acceptance and
  installed-wheel artwork/first-use acceptance; installed-MCP tests and actual
  SDK/browser handoff/recovery acceptance. The
  [evaluation](evaluations/native-authoring.md) maps scenarios and records scoped
  byte measurements. Retained [sheet overview](images/unified-player-sheet.png),
  [frame/timeline](images/unified-player-frame.png),
  [800×640 workspace](images/unified-player-compact.png),
  [conversion review](images/sprite-tile-conversion.png) and
  [generated APNG](images/native-player-walk.apng) come from synthetic pointer
  authoring; agent inspection covered the screenshots.
- **Result:** Lint and all frontend suites passed; 429 Python tests and 20
  documentation-checker tests passed. Production source/wheel metadata checks
  and seven installed-wheel smoke tests passed. Full browser acceptance passed
  75 scenarios with two optional scalability profiles skipped. After the final
  timeline binding fix, all 19 installed-wheel artwork/first-use scenarios passed,
  including exact saved 333 ms manual timing followed by another agent pixel edit
  and browser reopening. The three new installed-wheel workspace scenarios also
  passed after the final readable conversion-mapping presentation. All 81
  installed-MCP tests and three SDK/browser
  scenarios passed. Transparent tree/vine/rounded-edge composites, hidden RGB,
  origins/timing, migration, stable frame IDs, selected conversion and portable
  export/reopen passed their scoped assertions. A representative 16×32 candidate
  shrank from 3,339 to 293 structured JSON bytes; one-pixel edit arguments shrank
  from 3,418 to 372 bytes, with exact commit/reopen pixels.
- **Limits:** These are local synthetic results, not archived CI evidence, human
  usability certification or production art-quality claims. Earlier checks exposed
  canvas-height regressions, an asset-button selector assumption, an unsupported
  migration fixture and detached timeline callbacks after Undo/Redo; corrections
  and regression coverage are described in the evaluation. The full 75-scenario
  run preceded the final timeline fix; the installed-wheel artwork suite exercised
  that fix. Official Tiled/rasterizer applications, Windows, non-Chromium,
  screen-reader and physical-device workflows were not assessed. Plain Tiled
  animation skips and static, grid-aligned conversion limits remain explicit.
  Tagging and publication are separate.

## Mixed scene view filters and combined review (#140)

- **Scope:** Prepared 0.28.0 working tree based on
  [`ac83235`](https://github.com/cliffom/gbc-scene-forge/commit/ac83235), checked
  2026-11-02 on Darwin arm64, Python 3.13.13, Node 24.22.1 and Playwright Chromium.
  [Combined Review scene](screenshots/scene-views/combined.png),
  [artwork-only editing](screenshots/scene-views/artwork-only.png) and
  [390px review](screenshots/scene-views/narrow.png) are source-checkout captures.
- **Method:** Ran `make docs-check lint test`, production `make build check-dist`,
  full Chromium acceptance, focused World/filter regression acceptance, 78 optional
  MCP tests, three MCP/browser acceptance scenarios and installed-wheel first use.
  Synthetic mixed scenes exercise all 32 filter combinations, tile/sprite pixels,
  point/rectangle defaults, explicit categories, labels, native 1x camera sizes,
  authored hidden layers, selection, Undo/dirty/recovery neutrality, save/reopen,
  export and stale saved/candidate guards. Inspected browser captures at 1440px and
  390px and the actual embedded-artwork MCP SVG in Chromium with 4x CSS enlargement.
- **Result:** Lint, 415 Python tests, all TypeScript suites (including 7,655 domain
  contract cases), documentation, distribution metadata and seven plain installed-
  wheel smoke tests pass. Optional MCP tests, three MCP/browser scenarios and the
  installed-wheel first-use scenario pass. Browser development exposed a keyboard
  rectangle-delete path reaching filtered objects; guarded rectangle operations
  now pass. The first complete browser run had 71 passes, two optional profile
  skips and one World regression: following an authored hidden endpoint cleared
  its Inspector selection. Preserving that inspect-only selection fixes the
  regression; paired World/filter acceptance passes both scenarios. The repaired
  complete browser rerun passes 72 scenarios with the same two optional profile skips.
- **Limits:** Synthetic automation and agent visual inspection do not establish
  prolonged human authoring comfort, live gameplay behavior or runtime inclusion.
  Crowded captions may be suppressed while full SVG titles remain available.
  Official Tiled/rasterizer tools were not on PATH; no new interoperability result
  is claimed. Checks are local macOS/Chromium results; no remote CI pass, Windows,
  non-Chromium or publication result is claimed here.

## Layer pointer focus after sticky-header scrolling (PR #145 CI)

- **Scope:** Prepared 0.27.1 working tree based on
  [`ca90a5a`](https://github.com/cliffom/gbc-scene-forge/commit/ca90a5a9bf674656e3338f4b11457c49cf23c050),
  checked on 2026-11-02 in local Darwin/Python/Node/Chromium. Original Linux CI
  failure: [checks job](https://github.com/cliffom/gbc-scene-forge/actions/runs/41555546329/job/125653432137).
- **Method:** Inspected the failed job and its retained browser trace. The test
  scrolled the selected layer label to the Inspector's top and clicked its center
  at y=135, inside the sticky header. Checked the full standalone history,
  metadata, export, navigation and moved-project workflow locally. Added a pointer
  hit-test assertion before physical clicks so covered targets fail explicitly.
  Ran the complete `make test-browser` suite, targeted ESLint/format checks,
  `make docs-check` and `git diff --check`.
- **Result:** Original CI reported 67 passes, two skips and one failure: clicking
  the covered layer label did not return focus to the scene. The working tree's
  measured Inspector scroll padding and nested focus correction address that
  overlap; the previously failing standalone workflow passes locally. The complete
  browser run passed 71 scenarios with two optional scalability-profile skips.
  Targeted lint/format, documentation and whitespace checks passed.
- **Limits:** Local source-checkout result; no successful remote rerun is claimed.
  Installed-wheel checks were not repeated. The original CI failure remains
  linked above and is not superseded by a remote pass.

## Dense pixel controls, keyboard focus and opacity (PR #145 feedback)

- **Scope:** Prepared 0.27.1 working tree based on
  [`ca90a5a`](https://github.com/cliffom/gbc-scene-forge/commit/ca90a5a9bf674656e3338f4b11457c49cf23c050),
  checked on 2026-11-02 in local Darwin/Python/Node/Chromium.
  [Design and source-checkout captures](evaluations/editor-polish.md#dense-pixel-controls-inspector-focus-and-transparency).
- **Method:** Ran `make lint test`, frontend build and 24 pixel/polish browser
  scenarios, plus nine pane/layout/Review/editor-lifetime scenarios. Repeated the
  opacity scenario after adding exact-alpha swatch assertions and numeric-zero
  normalization. Checked a seven-placement, 64-color variation with expanded help
  and placement details at 1440×900, 760×640 and 1440×600; used physical Save
  activation and footer hit tests. Checked Inspector Tab/Shift+Tab visibility and
  hit testing at 760×640. Inspected dense desktop/compact and active transparency
  captures; saved/reopened pixels verify alpha 0 and 128 and restored drawing.
- **Result:** Lint, 413 Python tests, frontend checks, all 33 browser scenarios
  and the final extended opacity scenario passed. Upper controls scroll without
  clipping save actions; Inspector focus stays below its sticky header;
  transparency visibly toggles back to the previous nonzero opacity. Initial
  test setup placed the Inspector check outside the sample fixture group; it
  timed out before reaching the scenario. The corrected group and final run pass.
- **Limits:** Source-checkout Chromium only; full browser, distribution and
  installed-wheel checks were not repeated. Historical wheel evidence keeps its
  original scope. No independent human or other-browser usability check is
  claimed. Exact partial alpha remains supported; no artwork schema change or
  additional version bump was needed.

## Responsive focus and persistent Inspector header (PR #145 review)

- **Scope:** Prepared 0.27.1 working tree based on
  [`13537f9`](https://github.com/cliffom/gbc-scene-forge/commit/13537f9eb17113b621db01f92d3f6a173323312b),
  checked on 2026-11-02 in the Darwin/Python/Node/Chromium environment below.
  [Design and source-checkout captures](evaluations/editor-polish.md#persistent-inspector-header-and-responsive-focus).
- **Method:** Reproduced both review findings in Chromium, added synthetic
  keyboard and pointer regressions, ran `make lint test`, and ran 17 focused
  polish, pane, layout, Review and editor-lifetime browser scenarios. Inspected
  scrolled Inspector captures at 1440×900 and 760×640. Scroll/hit-test assertions
  cover five desktop sizes with and without selection, reopening at the same
  scroll offset, and actual pointer activation without automatic locator scrolling.
- **Result:** Lint, 413 Python tests, frontend checks and all 17 final browser
  scenarios passed. Responsive hiding now transfers toolbar focus to a visible
  command without disturbing external focus or explicit blur. The Inspector
  header remains visible above scrolling content, including reordered Selection.
  Initial regression-test attempts clicked a hidden disclosure and later an
  offscreen scene cell; conditional disclosure and Fit scene correct the test
  setup. The corrected final run passed together with the existing scenarios.
- **Limits:** Local source-checkout Chromium evidence. The full browser suite,
  distribution rebuild and installed-wheel checks were not repeated for these
  fixes. Earlier wheel evidence retains its original scope. No independent human,
  other-browser or actual OS/browser zoom validation is claimed. Version remains
  0.27.1; no tag or publication was performed.

## Save and export menus (#144 refinement)

- **Scope:** Prepared 0.27.1 working tree based on
  [`a9ed6a0`](https://github.com/cliffom/gbc-scene-forge/commit/a9ed6a0), checked
  on 2026-11-02 in the Darwin/Python/Node/Chromium environment recorded below.
  [Design and final installed-wheel captures](evaluations/editor-polish.md#save-and-export-menu-consolidation).
- **Method:** Agent screenshot inspection and synthetic keyboard/pointer input.
  Ran `make lint test`, production `make build check-dist test-browser`, then
  rebuilt the final wheel and ran six polish scenarios plus the corrected
  project first-use scenario against it. Checks exercise keyboard menu entry,
  Save/Export activation and dismissal, Control+S and Meta+S with menus closed,
  guide Save/Export actions, and the UI-only save/reload/download flow.
- **Result:** Lint, 413 Python tests, frontend checks, production build/metadata
  and seven wheel smoke tests passed. The full browser run passed 65 scenarios,
  skipped two opt-in profiles and failed one older first-use test that still
  clicked Save without opening its menu. Updated that test to use the shared
  visible-menu helper; its installed-wheel rerun passed. All six final wheel
  polish scenarios passed. Initial visual inspection caught dark inherited Save
  text; the final wheel uses accent text. Final captures show desktop and compact
  layouts, including a single document-bar row at 760×640.
- **Limits:** The full browser run began before the final Save color correction;
  final wheel checks/captures include it. The entire suite was not repeated after
  correcting the first-use test helper. Local agent/synthetic Chromium evidence
  does not certify independent human usability, actual OS/browser zoom or other
  browsers. Prepared version remains 0.27.1; no tag or publication was performed.

## Pane header controls (#144 refinement)

- **Scope:** Prepared 0.27.1 working tree based on
  [`9687665`](https://github.com/cliffom/gbc-scene-forge/commit/9687665b485094aec11b296a95968cb9d5b457ad),
  checked on 2026-11-02 in the same Darwin/Python/Node/Chromium environment as the
  follow-up below. [Design and installed-wheel captures](evaluations/editor-polish.md#pane-header-refinement).
- **Method:** Agent screenshot inspection and synthetic Chromium interaction.
  Ran `make lint test`, production `make build check-dist`, and 14 focused pane,
  toolbar, layout, review and editor-lifetime scenarios on source and the installed
  wheel. The final wheel run includes the final Inspector header placement and
  explicit focus assertions on both keyboard pane transitions. Geometry checks
  cover five desktop sizes, every pane combination, header content and direct
  pane/workbench adjacency.
- **Result:** Lint, 413 Python tests and frontend checks passed. Production build,
  metadata and seven wheel smoke tests passed. All 14 source scenarios and all 14
  final installed-wheel scenarios passed. Open panes no longer reserve arrow
  columns; both open recover 48px of canvas width. Captures inspected at 1440×900
  and 760×640 include expanded panes and closed handles.
- **Limits:** Focused regression evidence; the full browser suite was not rerun
  for this refinement. Source captures precede the final Inspector badge/arrow
  alignment; archived captures and final browser results use the final wheel.
  Local agent/synthetic Chromium checks do not certify independent human usability,
  actual OS/browser zoom or other browsers. No tag or publication was performed.

## Pane controls, path copy and responsive toolbar (#144 follow-up)

- **Scope:** Prepared 0.27.1 working tree based on
  [`6e8b7dd`](https://github.com/cliffom/gbc-scene-forge/commit/6e8b7ddf1a470ca89bbb4c6c068a7042dfb1cddd),
  checked on 2026-11-02 with Darwin 27.0.0, Python 3.13.13, Node 24.22.1 and
  Chromium 156.0.8078.4. [Decisions and archived captures](evaluations/editor-polish.md#pane-path-and-responsive-toolbar-refinements).
- **Method:** Agent code/screenshot inspection and synthetic browser input in
  disposable projects. Ran `make lint test`, production `make build check-dist test-browser`,
  focused toolbar/pane/review/layout scenarios, and all five polish/first-use
  scenarios against the installed wheel. Bounds checks include all five desktop
  sizes and pane combinations, collapsed/expanded toolbar states, fixed viewing
  controls, keyboard disclosure and current-tool synchronization. Clipboard
  success uses Chromium permissions; fallback injects a clipboard rejection.
- **Result:** Lint/docs, 413 Python tests and frontend checks passed. Production
  metadata/build and seven installed-wheel smoke tests passed. Full browser
  acceptance passed 65 scenarios; two opt-in scalability profiles were skipped.
  All five final focused scenarios and all five installed-wheel scenarios passed. Inspection
  caught stale copy-success feedback after failure, now reset per request. An
  older compact variation test initially clicked a newly hidden tool; its
  corrected flow explicitly opens the disclosure and passes.
- **Limits:** Local source and installed-wheel Chromium evidence, not independent
  human usability or non-Chrome certification. DPR emulation is not actual OS or
  browser zoom validation. The injected clipboard failure covers the fallback,
  not every platform's permission prompt. Original captures/results below retain
  their earlier working-tree scope. No tag or publication was performed.

## Editor toolbar and layout polish (#144)

- **Scope:** Prepared 0.27.1 working tree based on
  [`06ca6f8`](https://github.com/cliffom/gbc-scene-forge/commit/06ca6f8f1b9c2de2dea9dc303e3ce10d3f3bf6f1),
  checked on 2026-11-02 with Darwin 27.0.0, Python 3.13.13, Node 24.22.1 and
  Chromium 156.0.8078.4. [Task flows and archived comparisons](evaluations/editor-polish.md).
- **Method:** Agent code/visual inspection, baseline comparison and synthetic
  pointer/keyboard interaction in disposable projects. Ran `make lint test`,
  production `make build check-dist test-browser`, then the first-use and polish
  scenarios with `FORGE_TEST_PYTHON` pointing to the installed wheel. New bounds
  checks cover five desktop sizes, every pane combination, focus clearance,
  control alignment, long names, expanded help and representative 1.25 DPR
  emulation; the first-use flow creates/draws/places/saves/reopens/exports without
  the guide or MCP.
- **Result:** Lint, documentation, Python/TypeScript tests, distribution metadata
  and seven installed-wheel smoke tests passed. Full browser acceptance passed
  63 scenarios; two opt-in scalability profiles were skipped. All four selected
  installed-wheel browser scenarios passed. An intermediate narrow layout clipped
  Across layers; bounded wrapping and pairwise-control assertions resolve it.
  Initial new-test empty-project fixture assumptions failed and were corrected,
  as recorded in the evaluation. Save/recovery, selection variations, imports,
  sprite preview, layers, blockouts, stamps and export acceptance passed.
- **Limits:** Local source and installed-wheel evidence, not a linked CI claim or
  human usability certification. Chromium scaling emulation does not establish
  actual OS/browser zoom behavior. Recovery was exercised at representative sizes,
  not the full state/size cross product. Non-Chrome browsers, physical-device
  comfort and independent novice success remain unmeasured; the original reported
  screenshot environment was unspecified. No tag or publication was performed.

## Workshop placement conflict guards (PR #142 review)

- **Scope:** Prepared 0.27.0 working tree based on
  [`adbc257`](https://github.com/cliffom/gbc-scene-forge/commit/adbc257e807cae8d2212ce47f565f753b574539f),
  checked on 2026-11-02 with Darwin 27.0.0, Python 3.13.13 and Node 24.22.1.
- **Method:** Ran the [workshop regression tests](../tests/backend/adapters/test_mcp_artwork_workshop.py)
  over actual SDK stdio, injecting a competing Forge scene save or external map edit
  after artwork commit and before placement. Also ran `make lint test`.
- **Result:** Both race cases failed before the fix because the workshop accepted
  fresh guards and overwrote the competing edit. After the fix, both report conflicts
  and preserve the winner's exact scene/revision; normal creation/placement passes.
  Lint, documentation checks, all 413 Python tests and frontend suites passed.
- **Limits:** Synthetic local SDK races and source-checkout checks; no new browser,
  installed-wheel, human or external-platform validation was performed for this fix.

## Selected artwork variations and mixed authoring (#134, #135)

- **Scope:** Prepared 0.27.0 implementation contents committed as
  [`94bef74`](https://github.com/cliffom/gbc-scene-forge/commit/94bef74563d0151d0582db58fab793f09b841df9),
  checked on 2026-11-02; macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1,
  Playwright 1.64.1 and Chromium 156.0.8078.4. Production distributions were built
  from the frozen source tree; plain and optional-MCP wheels used separate venvs.
  The earlier source walkthrough retains its working-tree provenance in the
  [task evaluation](evaluations/artwork-workflows.md).
- **Method:** Ran `make docs-check lint test`, production `make build check-dist
  test-browser`, isolated optional-MCP wheel smoke checks and `make test-mcp`.
  Ran pixel/first-use acceptance with `FORGE_TEST_PYTHON` pointing to the plain
  installed wheel, then all three optional MCP/browser scenarios with both
  `FORGE_TEST_PYTHON` and `FORGE_MCP_PYTHON` pointing to the installed MCP wheel.
  Final focused variation checks also exercise adding/removing optional selections
  within an immutable draft. Domain/SDK coverage verifies transforms, metadata,
  origins, stamps/definitions, selected/unselected scenes, receipt/scene races,
  rollback and ZIP reopen. The evaluation separately records actual agent image
  inspection and agent-driven browser Pencil/Undo/Redo followed by SDK revisions,
  plus executable [mixed SDK/browser acceptance](../tests/playwright/mcp/artwork-mcp.spec.ts).
  Agent screenshot inspection covered the production variation dialog at
  [1440×1000](evaluations/assets/artwork-workflows/variation-desktop.png) and
  [800×900](evaluations/assets/artwork-workflows/variation-compact.png).
- **Result:** Documentation/lint/type checks, 411 Python tests, frontend suites
  (including 7,655 contract cases) and eight final focused variation tests passed.
  Both distributions passed strict metadata checks; plain and optional-MCP wheels
  each passed seven smoke checks, and the installed optional-MCP suite passed 74
  tests. Full Chromium acceptance passed 60 scenarios without retries; two opt-in
  observational profiles were skipped. The installed plain wheel passed all 13
  pixel scenarios and first use; the installed optional-MCP wheel passed all three
  browser scenarios, including mixed artwork authoring and conflict recovery.
  An initial missing required map-read budget
  message broke native saves and was fixed; two initial browser assertions assumed
  explicit layers after successful saves and were corrected for supported compact
  scenes. The [evaluation](evaluations/artwork-workflows.md) retains these failures,
  task outcomes, exact writes, observations and images.
- **Limits:** Small synthetic tasks, local automation and bounded agent visual
  assessment; no human participant, prolonged drawing/novice study or broad art
  quality claim. Not every workflow was repeated at both viewports. External
  PNG/gbc-atlas/Aseprite intake remains separate from native editing; no full layered
  round-trip or target conversion is claimed. No Windows, non-Chromium, screen-reader,
  physical-device or official Tiled/rasterizer assessment was performed. Ignored local
  reports/transcripts are not archived CI evidence. No package was published.

## Artwork checkpoint acknowledgment recovery (#141)

- **Scope:** Prepared 0.27.0 working tree based on
  `5835e0630c2ef34e5dfbac79d2e38f9b22d2a946`, on 2026-11-02; local macOS,
  Python 3.13, Node 24 and Playwright Chromium with the source server and rebuilt bundle.
- **Method:** Reproduced a committed checkpoint update with a lost response, followed
  by Undo and reload without a warning. Added [model regressions](../tests/frontend/artwork/pixels.ts)
  for unknown update outcomes, failed inspection, guarded correction, matching stored
  pixels without write replay, and explicit cleanup after lost acknowledgments.
  Added a [browser regression](../tests/playwright/artwork/pixels.spec.ts) that forwards
  the write to disk and aborts its response, dismisses the reload warning after Undo,
  then verifies corrected checkpoint bytes and reload. Ran `make docs-check lint test
  PYTHON=.venv/bin/python`, rebuilt the frontend and ran all ten artwork browser scenarios.
- **Result:** Unknown checkpoint outcomes retain unload protection even when current
  pixels equal an older acknowledged checkpoint. Subsequent checkpointing and cleanup
  inspect the owner and revision-guarded stored pixels before proceeding. Documentation,
  lint/type checks, 403 Python tests, frontend suites and all ten browser scenarios passed.
- **Limits:** Synthetic local fixtures and Chromium automation, including desktop
  reload and existing compact-view coverage; no human usability, Windows or
  non-Chromium assessment. Installed-wheel, packaging and full browser/MCP checks
  were not repeated; earlier evidence below retains its original scope. No package
  was published.

## Artwork Undo unload protection (#141)

- **Scope:** Prepared 0.27.0 working tree based on
  `a409651c26b591be8745a608599da1eb0e0bea4b`, on 2026-11-02; local macOS,
  Python 3.13, Node 24 and Playwright Chromium, using the source server and rebuilt bundle.
- **Method:** Review reproduced a checkpointed stroke surviving Undo and immediate
  reload without an unload warning. Added [model checks](../tests/frontend/artwork/pixels.ts)
  for pristine sessions, queued writes, Undo to the saved base and failed acknowledgments.
  Added a [browser regression](../tests/playwright/artwork/pixels.spec.ts) using a paused
  clock to dismiss the reload warning, finish the checkpoint, then reload, recover and
  download the exact saved pixels. Ran `make docs-check lint test PYTHON=.venv/bin/python`,
  rebuilt the frontend and ran all nine artwork browser scenarios at 1440×1000
  (including the existing compact-view scenario).
- **Result:** Undo retains unload protection until its pixels reach the durable
  checkpoint; pristine sessions remain clean. Once checkpointed, reload proceeds
  without a prompt and recovered pixels match the saved base. Documentation,
  lint/type checks, 403 Python tests, frontend suites and all nine browser scenarios
  passed. The first new browser test failed because the shared fixture had already
  accepted its dialog; the test now owns dialog handling so it can dismiss the warning.
- **Limits:** Synthetic local fixtures and Chromium automation; no human usability,
  non-Chromium or Windows assessment. Installed-wheel, full browser/MCP and packaging
  checks were not repeated for this follow-up; their earlier evidence retains its
  original revision scope below. No package was published.

## Artwork scene guards and completed checkpoints (#141)

- **Scope:** Prepared 0.27.0 follow-up working tree based on
  `04678f3d61340d7957ba9f20739e1aff0c8ce7f4`, on 2026-11-02; macOS 27.0.1 arm64,
  Python 3.13.13, Node 24.22.1 and Playwright Chromium 156.0.8078.4.
- **Method:** Review reproduced two failures in disposable browser projects:
  saving new artwork after isolated review advanced a stale local scene's revision,
  allowing its next save to erase another writer's cell; a pending debounce captured
  a later unfinished stroke and recovery retained it after cancellation. Added
  [browser regressions](../tests/playwright/artwork/pixels.spec.ts) for matching/stale
  scene bases and clock-controlled cancellation through recovery/save. Ran
  `make docs-check lint test PYTHON=.venv/bin/python`, production `make build check-dist`,
  and all eight artwork scenarios against source and the isolated installed wheel.
- **Result:** Stale scene saves now return 409 and preserve the saved scene bytes,
  local edits and undo history; matching scene bases remain saveable after adding
  artwork. Completed checkpoint snapshots exclude the canceled gesture through
  recovery and save. Documentation/lint/type checks, 403 Python tests, frontend
  suites, distribution checks, seven wheel smoke tests and both eight-scenario
  browser runs passed. An initial lint run rejected an untyped test JSON assignment;
  decoding it before assignment resolved that failure.
- **Limits:** Synthetic local fixtures and controlled clocks; no prolonged human
  usability, art-quality, Windows, non-Chromium or official Tiled assessment.
  The earlier broad browser/MCP evidence retains its original revision scope below;
  those full suites were not rerun locally for this follow-up. No package was published.

## Browser pixel artwork editing (#133)

- **Scope:** Prepared 0.27.0 at `cb5d5b3dfd0f5d0de8cc4224c4474e918e296b50`,
  on 2026-11-02; macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1 and
  Playwright Chromium 156.0.8078.4. Installed plain-wheel and optional-MCP runs
  used isolated environments built from that revision.
- **Method:** Ran a sequential frozen production `make lint test build check-dist
  test-browser PYTHON=.venv/bin/python`, then installed the wheel for `make test-mcp`,
  both MCP/refresh browser scenarios and all five pixel-editor browser scenarios.
  Model, HTTP and draft regressions cover exact RGBA, maximum-size batching,
  selection/history, cancellation, checkpoint races, stale bases and lost write
  acknowledgments. Browser fixtures exercise creation/copying, drawing/transforms,
  transparency, reviews/saves, scene history isolation, recovery and competing writes.
  Agent visual inspection checked the [1440×1000 desktop](images/pixel-editor-133-desktop.png)
  and [800×900 compact](images/pixel-editor-133-compact.png) editor and review states.
- **Result:** Documentation/lint/type checks, 403 Python tests, frontend suites,
  production distributions/metadata and seven installed-wheel smoke tests passed.
  Chromium passed 52 scenarios with two optional observational profiles skipped.
  The installed optional-MCP suite passed 74 tests and both browser scenarios;
  the installed plain wheel passed all five pixel-editor scenarios. An earlier
  browser run failed two build-identity assertions because its bundle was rebuilt
  concurrently as a development build; the frozen production rerun passed both
  assertions and the complete suite. Screenshots retain scripted fixture state.
- **Limits:** Local automation and agent screenshot inspection establish scoped
  behavior, not prolonged human usability or actual agent art quality. Selected-placement
  variations (#134) and integrated mixed-writer evaluation (#135) remain separate.
  No Windows, non-Chromium or official Tiled checks were run for this change;
  no package was published. Local ignored build logs are not archived CI evidence.

## Native artwork MCP authoring (#132)

- **Scope:** Prepared 0.27.0 issue-132 working tree based on milestone integration
  revision `a1e5ed418b2d6a54d4277581d7056669d549e94b`, on 2026-11-02; local macOS,
  Python 3.13 and Chromium. Source checks and isolated wheel/SDK checks are separate runs.
- **Method:** Synthetic [adapter and official-SDK regressions](../tests/backend/adapters/test_mcp_native_artwork.py)
  exercise discovery, transparent creation, imported/native duplication, exact RGBA
  reads, immutable edits, isolated/temporary-scene resource reads, revised-candidate
  receipt rejection, reviewed commit, placement, export/reopen, shared references,
  strict nested schemas, competing saves, held locks and a scene race at final commit.
  Ran `make docs-check lint test`, production `make build check-dist`, then
  `make test-mcp test-mcp-browser` with the wheel installed in an isolated MCP environment.
- **Result:** Required checks passed: 395 Python tests and frontend suites; production
  distributions/metadata and seven installed-wheel smoke tests passed. The installed
  optional-MCP suite passed 74 tests, including eight native-artwork regressions and
  the real stdio client loop. Both existing Chromium MCP/refresh scenarios passed,
  covering saved-state adoption, stale browser saves and retained recovery drafts.
  Native-artwork contention returns `busy`; conflicting candidates return `conflict`;
  failed batches/reviewed commits retain the original pixels and leave no partial files.
- **Limits:** Scripted fixtures/SDK calls establish transport and persistence behavior,
  not agent art quality or human usability. No drawing UI changed or was assessed.
  Mixed hand/agent editing, artwork drafts and selected-placement variations remain
  integrated milestone work (#133–#135). No Windows, non-Chromium or official Tiled
  interoperability check was performed for this change; no package was published.

## Captured-byte artwork review budget (#138)

- **Scope:** Local macOS working tree based on
  `c4a8b6b47c051d69f65c7d3d0dafd3e17f1218da`, on 2026-11-02.
- **Method:** Synthetic regressions grow five saved maps to 3,600,000 bytes each
  immediately before loading, and exercise exact-budget and one-byte-over-budget
  scans. Assert rejection before decoding the over-budget map, unchanged candidates
  and no project writes beyond the simulated external edits. Ran `make lint test`
  and `make docs-check` after updating this record.
- **Result:** All 18 artwork-review tests passed. The 18,000,000-byte growth case
  rejects against the production 16 MiB limit; an exact-budget scan returns a receipt.
  Lint, type/documentation checks, all 387 Python tests and frontend suites passed.
- **Limits:** Local service fixtures simulate external edits; no live editor,
  browser acceptance or installed-wheel checks were run for this correction.

## Native candidate artwork review (#131)

- **Scope:** Local macOS, Python 3.13.13 and Node 24.22.1, working tree based on
  `35ee452963f9b1a179d5cd2a57d13ca29ce73102`, on 2026-11-02; prepared 0.27.0.
- **Method:** Added 16 synthetic domain regressions covering exact isolated RGBA,
  nearest-neighbor enlargement, all tile transforms, sprite origin overrides,
  layer visibility/order, alpha compositing, temporary new-art scene candidates,
  shared scene/stamp/definition references, pagination, resource bounds, stale
  candidates, source drift and final unchanged-scene transaction guards. A
  further race regression reproduced re-encoding replacing an original review
  guard with a later map read; retaining and checking the original guard fixed it. Ran
  `make lint test PYTHON=.venv/bin/python`, production `make build check-dist`,
  and focused lint for the subsequently extended installed-wheel smoke regression.
- **Result:** All 16 review regressions and the full Python/TypeScript suites
  passed. Documentation, lint/type checks, production wheel/source build and
  strict metadata checks passed. All seven installed-wheel smoke tests passed,
  including reviewed save, export/reopen and temporary scene review. No inventory
  changes occurred in read-only comparison tests; stale dependencies rejected saves.
- **Limits:** Synthetic local evidence, without a linked CI run or human/art-quality
  review. The first sprite fixture used an out-of-scene position and failed
  validation; the corrected in-bounds fixture passed. No browser/HTTP/MCP surface
  changes or browser acceptance run for this issue. Drawing, MCP review transport,
  placement variations and integrated user/agent evaluation remain later work.

## MCP commit-lock contention in acceptance fixtures (#137)

- **Scope:** Local macOS/Python 3.13.13, MCP SDK 1.30.0 and bundled Chromium,
  working tree based on `584c837a8e8a6abeddce3781b7593ddc11abc700`, on 2026-11-02.
- **Method:** Inspected [failed Linux CI](https://github.com/cliffom/gbc-scene-forge/actions/runs/41488600838/job/125425350965):
  refresh acceptance stopped on the exact busy message wrapped as MCP `conflict`.
  Extended fixture retry regressions for both busy error codes, bounded exhaustion,
  unchanged revision arguments and a real revision conflict after contention.
  Ran production lint/build/installed-wheel smoke checks, then installed that wheel
  into an MCP environment and ran `make test-mcp test-mcp-browser`.
- **Result:** Three regression assertions failed before the helper fix; all 11
  fixture-retry tests passed afterward. Production lint/build and seven wheel smoke
  tests passed; the installed wheel passed 66 MCP tests and both browser scenarios.
  The helper retries only the two exact busy responses within its existing bound.
- **Limits:** Local reproduction and validation; this does not establish a passing
  Linux CI rerun. Runtime locking, MCP errors and automatic write-retry policy are
  unchanged. Other browser/platform evidence retains its original scope below.

## Reserved native format import rejection (#137)

- **Scope:** Local macOS/Python 3.13.13 working tree based on
  `584c837a8e8a6abeddce3781b7593ddc11abc700`, on 2026-11-02.
- **Method:** Reproduced an external gbc-atlas import declaring `forge-rgba` that
  returned success but left the project unreadable. Added fixture regressions for
  local import, upload and preflight, each with new-import and reimport variants;
  compare project bytes and reopen after every rejection. Ran
  `make docs-check lint test PYTHON=.venv/bin/python`.
- **Result:** The shared import service rejects the reserved format before writing;
  all six cases preserve project bytes and reopen successfully. Lint and all 369
  Python tests passed, including 22 native artwork tests; frontend model/API/build
  checks and 7,655 domain contract cases passed.
- **Limits:** Synthetic service fixtures; the rejection paths were not exercised
  through browser controls or external Tiled. Packaged MCP checks are scoped above.

## Native editable artwork services (#130)

- **Scope:** Prepared 0.27.0 issue-130 working tree based on
  `26c9cefa13f7c29b3e7f7d24d76a204e871a55f9` (`milestone/14`), local macOS
  27.0.1, Python 3.13.13, Node 24.22.1, Playwright 1.64.1 with bundled Chromium,
  optional MCP SDK 1.30.0, on 2026-11-02. The screenshot is the production UI.
- **Method:** `make docs-check lint test`, followed by final `make lint test-python`
  after stricter native inventory/batch validation. Domain fixtures cover blank
  tiles/sprites, imported/native duplication, exact hidden RGB/partial alpha,
  malformed/oversized batches, immutable candidates, stale project/artwork/source
  bases, destination collisions, metadata/origin/local-ID preservation, map range
  re-encoding, exact acknowledgments, injected write failure and interrupted-save
  recovery. Both ZIP scopes transfer native tiles/sprites; extracted project ZIPs
  reopen for editing. Production `make build check-dist test-browser`, existing
  SDK MCP/refresh browser acceptance, and native/first-use browser tests against
  the isolated installed wheel exercise packaging and existing browser consumption.
  An agent inspected [native Library/placement/save state](images/native-artwork-130.png)
  at 1440×1000; this is a solid-color synthetic fixture.
- **Result:** Lint/docs/type/model checks and 368 Python tests passed, including
  21 native-artwork and 17 transfer regressions. Production distributions passed
  metadata checks and seven installed-wheel checks. Regular Chromium acceptance
  passed 47 scenarios, with two optional observational scalability profiles skipped;
  both existing SDK/browser coexistence scenarios and both installed-wheel
  native/first-use scenarios passed. Exact transparent RGB and sprite origins
  survived native export, transfer and reopen; pixel-only saves left maps unchanged.
- **Limits:** Local automated fixture evidence; ignored reports under `build/`
  are not archived CI evidence. The broad browser run preceded the final native
  inventory/batch-only tightening; final domain/package and installed-wheel
  browser checks include it. Browser inspection covers the existing scene UI,
  not pixel drawing controls. Native MCP commands, reviewed commits, artwork drafts,
  shared-reference review and selected-placement variations remain subsequent
  milestone issues. No human drawing/art-quality evaluation, integrated agent
  pixel workflow, official Tiled/rasterizer, Windows or non-Chromium check is claimed.

## Legacy sprite artwork in scene transfer (#128)

- **Scope:** Local 0.26.0 follow-up working tree based on `eafa61addfaf3949b55491729743216c231beb93`,
  macOS, Python 3.13.13 and Node 24.22.1 on 2026-11-01.
- **Method:** Added mixed tile/sprite legacy-project regressions to the transfer
  suite, then ran `make docs-check lint test`. Checked both export scopes,
  preflight without writes, generated sprite mappings/images, reopen/re-export,
  unchanged source files and rejection of missing declared dependencies.
- **Result:** The new roundtrip regression failed for both export scopes before
  the fix; all 17 transfer tests passed afterward. Full validation passed lint,
  347 Python tests and the TypeScript model/API/build checks.
- **Limits:** Synthetic local fixtures; browser, installed-wheel and official Tiled
  checks were not repeated for this backend-only follow-up. Earlier scene-transfer
  evidence below describes its own revision and validation boundaries.

## Forge scene transfer (#127)

- **Scope:** Prepared 0.26.0 issue branch based on `bdbef389f8b082d3b52ea99686bf0c566edd4264`,
  local macOS 27.0.1 on 2026-11-01, Python 3.13.13, Node 24.22.1 and Playwright
  1.64.1 with bundled Chromium. Screenshots show the working-tree production UI.
- **Method:** `make docs-check lint test`, production `make build check-dist test-browser`,
  then a final production rebuild/installed-wheel smoke and import/first-use browser
  scenarios with `FORGE_TEST_PYTHON` pointing to the isolated wheel environment.
  Backend fixtures exercise A → B save/reopen/re-export, shared and unpainted
  dependencies, transforms, sprites/objects/properties, definitions, terrain rules,
  name/identity collisions, rename/skip, invalid ZIP/dependencies, stale revisions
  and rollback after a simulated disk-write failure. Browser checks cover scene
  list accuracy, invalid input, renamed/skipped selections, stale confirmation,
  dirty-work cancellation, scene-only intake and real downloads.
- **Result:** Final lint/model checks and 345 Python tests passed. Production build,
  metadata and six installed-wheel smoke checks passed. The full regular browser
  run passed 46 scenarios with two optional observational scalability profiles
  skipped; final installed-wheel runs passed ZIP intake, generic intake and first
  use. Reviewed [scene selection at 1440 × 1000](screenshots/imports/forge-preflight.png)
  and [scrollable confirmation at 760 × 640](screenshots/imports/forge-compact.png).
  Early browser failures were fixture assumptions about initial scene selection,
  scrolling, dialog resets and default export scope; those were corrected before
  the passing runs.
- **Limits:** The full regular browser run preceded final additional malformed-input
  and duplicate-destination-name guards; final Python and installed-wheel import
  checks exercised the completed implementation. This is local synthetic evidence,
  not a CI-pass claim or an official Tiled/physical-device review. Other desktop
  browsers and Windows were not checked. Intake deliberately omits world links,
  project preferences and unplaced stamps, rejects inconsistent externally edited
  files, and requires re-export for older scene-only ZIPs; see the
  [supported workflow and limits](user/import-artwork.md#forge-export-zips).

## Domain response-contract foundation (#75)

- **Scope:** Prepared 0.25.1 working tree, local macOS 27.0.1 on 2026-11-01;
  original frontend `6f637da74e5378eaab6d1a1ae03c57585ff6da3b`, candidate `6842b05`
  plus release/documentation edits. Python 3.13.13, Node 24.22.1, esbuild 0.28.2,
  pinned Valibot 1.5.0, Chromium 156.0.8078.4 and MCP SDK 1.30.0. Release edits
  do not change the measured frontend modules.
- **Method:** Reproducible original/candidate corpus, normal project/Tiled Courtyard
  smoke and fixed-label full-editor production measurements, detailed in the
  [adoption evaluation](evaluations/valibot-pilot.md#bounded-domain-adoption-75).
  `make docs-check lint test`, `FORGE_BUILD_MODE=production make build check-dist`,
  the full regular Playwright suite, plain installed-wheel first use, optional-MCP
  installed-wheel smoke/protocol checks and both MCP/refresh Playwright scenarios.
- **Result:** 7,655 cases compared identical normalized outputs and first-error
  messages, with unchanged inputs on acceptance/rejection. Courtyard catalog, tile
  layers, sprite/point/rectangle objects and custom properties loaded successfully.
  Full-editor cumulative cost is +1,285 minified bytes / +308 gzip bytes (0.42%);
  five affected source modules grow by 34 lines / 1,208 bytes while replacing eight
  independent output declarations and four decoder bridges. Initial candidate
  parsing exposed absent-field rejection with `v.exactOptional` under shared
  projection; `v.optional` plus explicit omission resolves it and the corpus pins
  the corrected behavior. All final source/documentation checks passed, including
  330 Python tests. Plain and MCP installed wheels each passed six smoke checks;
  installed MCP passed 66 protocol/service checks. Production Chromium passed 45
  regular scenarios, plain-wheel first use and both MCP/refresh scenarios, including
  definitions, terrain, budgets, preview, world, disposal and stale adoption.
  [Initial Linux CI](https://github.com/cliffom/gbc-scene-forge/actions/runs/41370634062)
  passed regular browsers and all 64 then-existing MCP checks but failed the refresh
  fixture when `ProjectStore.commit` wrapped a busy lock in `Conflict`. The test-only
  helper now retries that explicit `TransactionBusy` cause within its existing bound,
  preserving revision arguments. Added regressions reject genuine conflicts,
  unrelated causes and unknown outcomes; the affected installed-MCP refresh scenario
  passed again locally. Production locking/error behavior is unchanged.
- **Limits:** Synthetic compatibility probes cover JSON plus explicit undefined and
  non-finite numeric boundaries, not sparse arrays/getters/custom prototypes. No
  runtime speedup or source-size reduction is claimed. Two opt-in scalability
  profiling scenarios were skipped. Official Tiled/rasterizer tools were unavailable;
  non-Chromium/Windows, Python versions other than 3.13 and human usability checks
  were not run locally. Local ignored build output is not an archived CI artifact.
  Publication is separate.

## Initial standalone projects (#13)

- **Scope:** Working-tree implementation reported on 2026-10-27 before publication; initial
  standalone scope preceding 0.2.0. Exact tested revision, OS and Chrome version were not recorded.
- **Method:** `make lint test build check-dist`, disposable-project Chrome acceptance, official
  Tiled 1.12.2 load/export/rasterization and read-only intake of the owner's private atlas. Repository
  evidence includes [the Tiled helper](../tests/support/tiled_interop.py), [historical
  plan](ISSUE-13-PLAN.md) and [project capture](screenshots/standalone-project.png).
- **Result:** Reported 61 Python regressions, TypeScript model/API/deadline/build checks and four
  installed-wheel smoke checks passed. Browser create/import/reimport/paint/fill/select/history, two
  scenes, production CLI restart after a project move and removal of original inputs, stale-revision
  protection, sprite thumbnails/origins/drag/nudge/delete/save, and tall-canvas focus coordinates
  passed. Modal errors, canceled discard, search/filter, asset drops, pan, selection inspector and
  980×760 no-overflow layout were checked; desktop/compact captures were reported inspected. Tiled
  round trips and expected tile/transparent/native-sprite pixels passed. All 13 private-atlas sprite regions
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
  Owner product review remained separate. The owner-provided source is private and is not a reusable public
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

## MCP acceptance lock contention

- **Scope:** 0.21.2 release verification on merged PR #107 revision `8233204`,
  2026-11-01 UTC; Ubuntu Actions and local macOS 27.0.1 arm64, Python 3.13.13.
- **Method:** Inspected the [failed post-merge run](https://github.com/cliffom/gbc-scene-forge/actions/runs/41280901613)
  and guarded project/MCP call paths. Added nine deterministic fixture regressions
  for bounded busy retries, unchanged revision arguments, conflict/error propagation,
  lost acknowledgments and invalid bounds. Ran `make docs-check lint test`,
  production `make build check-dist`, and optional-MCP protocol/browser acceptance.
- **Result:** Ordinary browser and wheel checks passed in the failed run, but
  optional refresh acceptance failed when its MCP writer received the explicit
  nonblocking project-busy error during concurrent browser polling. The writer
  previously treated that transient response as a terminal failure. Test-only
  helpers now retry that exact response and single busy fixture operations within
  a finite bound; other errors still fail, revisions are not refreshed, and
  partially completed setup batches are not replayed. Local lint, 291 Python tests,
  TypeScript suites, distributions, six wheel checks, 27 MCP/fixture protocol tests
  and both MCP/browser scenarios passed after correction.
- **Limits:** Runtime APIs, locking and persistence behavior are unchanged. Busy
  exhaustion, stale revisions and transport failures remain failures. The failed
  revision was not tagged or published; the release candidate remains 0.21.2.
  Local passes are not independently archived CI evidence.

## MCP tile and layer authoring (#109, #110)

- **Scope:** Prepared 0.22.0 on local branch `feat/mcp-tile-layer-authoring`, based
  on `e1cf30e`, 2026-11-01. Darwin 27.0.0 arm64, Python 3.13.13, Node 24.22.1,
  MCP SDK 1.30.0 and Playwright Chromium 156.0.8078.4. Synthetic disposable
  projects and freshly installed production wheels; no consumer project was edited.
- **Method:** `make docs-check lint test`; targeted tile/layer regressions;
  `poetry check --lock`; production `make build check-dist test-browser`;
  installed-wheel first-use acceptance; fresh optional-MCP wheel installation
  with `make test-mcp test-mcp-browser`. The real stdio SDK workflow creates,
  renames/hides, reorders, paints, reviews a dry-run candidate, erases and deletes
  a layer, including stale revision and malformed-schema rejection.
- **Result:** Lint, docs and frontend suites passed; the full Python run passed
  300 tests before one additional wrong-grid/no-op case was added. The final
  targeted tile/layer suite passed all 10 cases and installed-MCP discovery
  passed all 37 cases. Regression checks cover atomic rejection, cell budgets,
  transformed references, flat scenes, final-layer protection, stable IDs,
  layer limits, linked-object deletion, project/scene conflicts and bounded
  summaries. Production source/wheel metadata and six plain-wheel smoke tests
  passed. Regular browser acceptance passed 41 cases with two opt-in profiling
  scenarios skipped; installed-wheel first use passed one case, and installed
  MCP/browser draft-conflict and refresh acceptance passed both cases.
- **Limits:** These are local automated observations, not archived CI evidence
  or human usability assessment. External Tiled and its rasterizer were not
  installed, so official-application interoperability was not rerun. Semantic
  terrain brushes, stamp placement, browser drafts and Undo are outside these
  MCP operations. Tagging and package publication were not performed.

## Empty Sprites layer identity (PR #114 review)

- **Scope:** Prepared 0.22.0 review fix based on `cfb1bbb`, 2026-11-01,
  Darwin 27.0.0 arm64, Python 3.13.13, Node 24.22.1, MCP SDK 1.30.0 and
  Playwright Chromium 156.0.8078.4. The user-provided review identified an empty
  visible `Sprites` group disappearing from a Ground-only scene.
- **Method:** Added a failing regression before changing the shared Tiled
  decoder. Checked dry-run/save responses, reopened scene content, targeting ID 2
  and allocating the following layer as ID 3. Ran `make docs-check lint test`,
  source and fresh-wheel `make test-mcp`, production `make build check-dist`,
  full regular browser acceptance and the corrected artwork/sprite scenario.
- **Result:** The regression reproduced the disappearing layer before the fix;
  all 11 tile/layer regressions then passed. Full Python discovery passed 302
  tests and frontend suites passed; source and fresh-wheel MCP discovery passed
  38 checks, including the new real stdio SDK reproduction. Distribution
  metadata and all six fresh plain-wheel smoke tests passed. The initial
  regular browser run passed 40 cases, skipped two opt-in profiles and failed
  the artwork/sprite case because its assertion expected flat tile cells after
  saving an empty Sprites layer. Updating that assertion to verify
  both the tile cells and the retained empty group made the complete affected
  scenario pass on its scoped rerun; other scenarios were not repeated.
- **Limits:** Local automated evidence only; the earlier PR CI result applies
  to `cfb1bbb`, not this fix. No human usability or official Tiled/rasterizer
  check was performed. The prepared version remains 0.22.0; no tagging or
  publication occurred.

## MCP startup contention (#115)

- **Scope:** Prepared 0.22.1 on `fix/mcp-startup-contention`, based on `ed2e44a`,
  2026-11-01, local macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1,
  Playwright 1.64.1 and MCP SDK 1.30.0. Fresh plain and optional-MCP wheels
  were installed separately. The reported trigger occurred in prior 0.22.0 CI
  at `ed2e44a`; its environment is bounded by the linked run.
- **Method:** Reviewed the reported [failed startup attempt](https://github.com/cliffom/gbc-scene-forge/actions/runs/41315682506/attempts/1)
  and [unchanged successful retry](https://github.com/cliffom/gbc-scene-forge/actions/runs/41315682506/attempts/2).
  Ran deterministic held-lock tests, required docs/lint/Python/frontend checks,
  production distribution builds and fresh installed-wheel smoke/SDK checks.
  Installed-wheel Chromium acceptance included explicit startup contention with
  a live browser, releasing only after its stderr diagnostic, and refresh/stale
  saves. Inspected the recovery/download screenshot at 1440×1100.
- **Result:** The historical failure occurred before tool submission; existing
  post-initialization busy handling could not recover that startup. All 308 local
  Python tests and frontend suites passed. All six focused startup tests and
  44 installed-MCP checks passed, including immediate non-busy failure after
  contention, bounded exhaustion, unchanged declared alias/pre-session journal,
  exactly one saved transaction and explicit stale-revision rejection. Production
  metadata and six smoke tests passed for each fresh wheel installation.
  Installed-wheel browser acceptance passed 41 regular and both MCP/refresh
  scenarios, including startup recovery, stale saves, independent drafts/Undo
  and lost-acknowledgment recovery. Two opt-in profiling cases were skipped.
- **Limits:** New results are local synthetic automation and screenshot inspection,
  not archived CI evidence or human usability certification. Retry bounds cover
  21 openings and two seconds of delays, plus opening time. Official Tiled and
  rasterizer commands were absent from PATH; no interoperability rerun, physical
  device evaluation or non-Chromium check is claimed. No tagging/publication
  occurred; prior CI results apply only to their linked 0.22.0 revision.

## MCP reusable stamp placement (#111)

- **Scope:** Prepared 0.23.0 working tree on `feat/mcp-stamp-placement-0.23.0`,
  based on `92f9d7e`, on 2026-11-01, macOS, Python 3.13.13, Node 24.22.1,
  Playwright 1.64.1 Chromium and official MCP SDK 1.30.0.
- **Method:** `make docs-check lint test`, production `make build check-dist
  test-browser`, and first-use acceptance with `FORGE_TEST_PYTHON` pointing at
  the fresh plain wheel environment. Installed the production wheel plus its
  MCP extra in a fresh environment and ran `make test-mcp test-mcp-browser` with
  `FORGE_MCP_PYTHON` selecting that interpreter, including real SDK stdio calls.
  [Stamp tests](../tests/backend/adapters/test_mcp_stamps.py) exercise repeated
  multi-slot tile/object/sprite placement, PNG/SVG candidate resources, canonical
  saving/export, malformed input, ID exhaustion, scene/project conflicts and
  deterministic concurrent-write injection at preparation and commit.
- **Result:** Documentation/lint, all 319 Python tests, frontend suites,
  production distribution metadata and six smoke checks for each plain/MCP wheel
  environment passed. All 55 installed-MCP checks passed, including 11 stamp
  checks and the SDK placement/review/reopen flow. Chromium passed 41 regular
  scenarios, both installed-MCP scenarios and installed plain-wheel first use.
  Dry runs and reviews preserved saved bytes; repeat placements allocated
  disjoint IDs and stale writes were rejected. The
  [browser refresh regression](../tests/playwright/mcp/refresh.spec.ts) placed a
  saved stamp while a camera draft was dirty, preserved the draft and Undo, and
  rejected its subsequent stale browser save at 1440×1100.
- **Limits:** Local working-tree logs are not archived CI evidence. Two optional
  scalability profiling scenarios were skipped. Official Tiled and rasterizer
  tools were unavailable; non-Chromium/Windows and human usability checks were
  not performed. Release preparation is separate from tagging/publication.

## MCP project lifecycle (#112, #113)

- **Scope:** Prepared 0.24.0 working tree on `milestone-11-mcp-lifecycle`, based
  on `a80dc57`, on 2026-11-01, local macOS, Python 3.13.13, Node 24.22.1,
  Chromium 156.0.8078.4 and official MCP SDK 1.30.0. Plain and optional-MCP
  production wheels were installed in separate environments.
- **Method:** Required documentation/lint/Python/frontend checks, production
  distribution builds and installed-wheel smoke checks; `make test-mcp` against
  the installed optional-MCP wheel. The [lifecycle regressions](../tests/backend/adapters/test_mcp_lifecycle.py)
  use byte comparisons, deterministic concurrent-write injection and a real SDK
  stdio session for rename/copy/delete, concrete world-link acknowledgment,
  referenced definitions, unknown/mismatched retained overrides, actual stamp
  placements and strict schemas. Chromium ran regular acceptance, installed
  plain-wheel first use and installed-MCP browser/refresh acceptance.
- **Result:** Required checks, production metadata and six smoke checks in each
  environment passed. The final installed-MCP suite passed 64 checks, including
  nine lifecycle tests and the SDK workflow. Previews left saved files unchanged;
  stale/invalid requests and preparation/commit races were rejected without
  partial writes. Rename retained bytes/identity, duplication preserved native
  content, acknowledged deletion retained concrete broken connections, and library
  cleanup preserved unrelated entries and explicit instance overrides. All five
  lifecycle acknowledgments retained their own committed catalog despite a later
  writer. Chromium passed 41 regular scenarios, both MCP/refresh scenarios and
  installed-wheel first use, including existing browser scene management,
  definition deletion, world-link guards and independent draft recovery.
- **Limits:** These are local synthetic automated results, not archived CI
  evidence or human usability certification. Two opt-in scalability profiling
  scenarios were skipped. Official Tiled/rasterizer commands were unavailable;
  no interoperability rerun, Windows/non-Chromium check or physical-device
  evaluation is claimed. Definition reference reporting requires readable valid
  saved scenes. Tagging and package publication remain separate from preparation.

## Collapsible editor panes (#116)

- **Scope:** Prepared 0.25.0 working tree on `issue-116-collapsible-panes`, based
  on `50e022d`, on 2026-11-01, local macOS, Python 3.13.13, Node 24.22.1,
  Chromium 156.0.8078.4 and MCP SDK 1.30.0. Plain and optional-MCP production
  wheels were installed in separate environments.
- **Method:** Required documentation/lint/Python/frontend checks, production
  distributions, installed-wheel smoke checks and installed-MCP tests.
  [Pane acceptance](../tests/playwright/editor/panes.spec.ts) exercises all four
  combinations at 1440×900, 1024×768 and 760×640 with real pointer/keyboard input,
  viewport measurements, draft comparisons, camera/pointer coordinates, Undo/Redo,
  scene navigation and Review scene. Browser acceptance also checks remount,
  endpoint navigation with Inspector hidden, installed-wheel first use and
  installed-MCP/browser refresh. Screenshots are linked from
  [layout guidelines](UI-DESIGN.md#collapsible-panes).
- **Result:** Required checks passed 328 Python tests and all frontend suites.
  Both distributions passed metadata checks; each installed wheel passed six
  smoke checks and optional MCP passed all 64 tests. The full production browser
  run passed 44 regular scenarios and exposed a lifecycle-test measurement race;
  the corrected lifecycle rerun and all four final pane tests passed. Installed
  first use and both MCP/refresh scenarios passed. Viewport width grew by the
  measured pane widths; focus, hidden-control Tab order, guided reveal, world
  navigation, dirty content, brushes, category, layer, selection and checkpoints
  were preserved. One Undo reverted the sole authored change; pointer erasing
  saved the expected cell. Agent inspection covered the committed expanded,
  one-pane, both-pane and compact screenshots.
- **Limits:** These are local synthetic automated results, not archived CI
  evidence or human usability certification. The lifecycle test initially counted
  a legitimate focus-triggered refresh during its dynamic import; the corrected
  measurement starts immediately before disposal. Two opt-in scalability profiles
  were skipped. Tiled/rasterizer tools were unavailable; non-Chromium/Windows and
  physical-device checks were not run. Tagging/publication remain separate.

## Everyday editor usability review (#117)

- **Scope:** Published 0.25.1 at `f85d3ae`, reviewed on 2026-11-01 local time
  (2026-11-02 UTC), macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1,
  Playwright 1.64.1 and Chromium 156.0.8078.4. Source-checkout development bundle;
  disposable sample/empty projects.
- **Method:** Agent inspection of live accessibility snapshots and screenshots,
  synthetic pointer/keyboard walkthroughs at 1440×900, 1024×768, 760×640 and
  1440×600, and 15 existing import/layout/pane/Review/first-use/composition/
  definition/draft browser scenarios. The [evaluation](evaluations/editor-usability.md)
  records per-workflow coverage, reproduction steps, measured pane widths and
  committed screenshots.
- **Result:** All 15 selected scenarios passed without retries. All four pane
  combinations restored through Review transitions at each requested size.
  Independent findings established visible-name search failure (#123), stale
  corrected-preflight status (#124) and atlas-specific wording for broader
  import sources (#125), in recommended order. Existing guarded import,
  recovery and pane/viewing behavior were retained; implementations are separate.
- **Limits:** Agent/synthetic evidence is not human usability certification or
  archived CI evidence. Full stamp, typed-property, Tiled and revision-conflict
  workflows were not repeated at every matrix cell. Preliminary exploratory
  scripts required corrections for hidden-control targeting, a no-op repaint
  and a recovery-prompt wait; these were harness failures, not product findings.
  No installed-wheel, production-mode, Windows/non-Chromium, screen-reader,
  prolonged large-project or physical-device review was performed.

## Editor responsiveness and resource measurements (#160–#164)

- **Scope:** Agent measurements on 2026-11-03, macOS arm64, baseline
  `a268f271102e97fd9b31448b8721f0b07ddfc5ec` (0.29.1) and the milestone 16
  working tree preparing 0.29.2. Exact browser/runtime/CPU and bundle variants
  accompany [archived measurements](evaluations/editor-responsiveness.md).
- **Method:** Synthetic production-bundle pointer, release and history profiles;
  normal/4× CPU comparison; test-only scene boundary instrumentation; GC-assisted
  bounded switching/remount samples; agent inspection at 1,440×1,000 and 800×900.
  Functional source, browser and package checks are recorded in the evaluation.
- **Result:** Measurements demonstrated repeated full-raster uploads, RGBA encoding,
  hidden-thumbnail drawing, unchanged disabled assignments, object-option rebuilding
  and retained artwork surfaces. Changes target those paths while preserving exact
  content, history, receipts and recovery. Source checks passed (429 Python tests
  and all TypeScript suites), as did lint/docs, production build, seven wheel smoke
  checks, 101 regular browser scenarios (11 optional profiles skipped), installed-
  wheel first use, 81 installed MCP tests and three MCP/browser refresh scenarios.
  The eight-case final artwork profile and all four original/final scene-resource
  cases passed, including automatic adoption after actual external writes.
  The original expanded timeline exceeded
  180 seconds at 120 moves and 600 seconds under 4× CPU at 24 moves; these failures
  and the corrected legal mixed-fixture boundary remain in the evaluation.
- **Limits:** Synthetic handler and next-rAF timings do not establish physical input
  presentation latency, human drawing comfort, historical feature-growth regression,
  non-Chromium/Windows behavior or hours-long resource stability. Forced-GC heap and
  canvas estimates do not measure total resident/GPU memory. Timing is observational;
  deterministic work counts provide regression guards. No new CI-pass or publication
  claim is made by this local record.

## Remaining checks

### Editor discovery, scope and working space (#224)

- [x] Complete the combined synthetic workflow assessment after P2 work: see
  [methods, bounds and captures](evaluations/working-space.md). Independent
  participant observations remain under #165/#166 below.


### Selective pixel cleanup (#218)

- [ ] Assess cleanup suggestions with independent users on varied generated art,
  including intentional glints, diagonal outlines, textured regions and protected
  details. The [synthetic comparison](evaluations/pixel-cleanup.md) and agent card
  inspection establish bounded behavior, not general artistic quality.

### Human–agent artwork iteration (milestone 21)

- [ ] Assess prolonged layered drawing, wheel/trackpad comfort and unpublished handoff discovery with independent users on physical devices, including lower-memory hardware. The [synthetic workflow and resource evaluation](evaluations/artwork-iteration.md) establishes bounded automated outcomes, not human usability or external-tool art-quality parity.

### Existing workflow usability (milestone 17, #165–#167)

- [ ] Run the independent novice/experienced sessions in the [workflow protocol](evaluations/workflow-usability.md), recording consent-appropriate task observations, discovery time, assistance, actual browser zoom/OS scaling and prolonged comfort (#165). Earlier human-check groups below retain their original scope; one session may provide evidence for several groups when explicitly recorded.
- [ ] Select and retest participant-supported remediation after those observations are available (#166). The bounded agent-observed save-scope fixes and synthetic three-route comparisons do not complete independent-human acceptance.

This is the single maintained validation checklist. Issue state was checked on
2026-11-02; closing issues or publishing packages does not satisfy these checks.
Current automated procedures remain in [releasing](RELEASING.md) and
[browser testing](BROWSER-TESTING.md). Add scoped evidence above when completing a
check, retaining actual revision, environment, attribution, failures and limits.

### Editor usability (#144)

- [ ] Have independent users assess icon discovery, an unguided first-use flow and prolonged scene/pixel editing; check actual browser zoom and OS display scaling on physical devices. Automated task success and Chromium DPR emulation do not establish those outcomes.

### Native artwork (milestone 14)

- [ ] Have human participants assess prolonged drawing and novice success with integrated new-tile, sprite-variation and mixed authoring workflows; the bounded agent visual assessment and automated SDK/browser checks for #135 do not establish human usability or broad art quality.

### Unified sheet and animation authoring (milestone 15)

- [ ] Have independent users assess prolonged sheet drawing, timeline editing, animation review and manual/agent handoffs; synthetic acceptance and agent screenshot inspection do not establish drawing comfort or production art quality.

### Scene scalability (#78, #92, #93)

- [ ] Have a human assess prolonged painting, panning and selection on the current consumer Forest project; automated archived-v4 measurements do not establish physical-device editing comfort (#93).

### Editor responsiveness (milestone 16)

- [ ] Have independent users assess prolonged drawing and scene navigation on ordinary and slower physical devices with actual browser zoom/display scaling; synthetic next-rAF/CPU-throttle samples and bounded GC cycles do not establish input-to-present latency or hours-long stability (#160–#164).

### Platform, interoperability and publication gaps

- [ ] Verify large native illustrations in official Tiled/rasterizer applications, including odd dimensions, full-size sprites and portable scene export (#181).

- [ ] Run the optional official Tiled/rasterizer interoperability checks for the prepared 0.29.0 baseline, including native RGBA sheets/animations, scene-transfer, object/definition, mixed-scene classification properties and tile metadata compatibility, when those applications are available (#75, #109, #110, #111, #112, #113, #127, #130, #140, #149).

- [ ] Record non-Chromium desktop-browser and Windows runtime results with exact versions and workflows; these are outside the automated browser matrix.
- [ ] Configure the TestPyPI trusted publisher and verify an upload if that channel is needed; the historical 0.1.4 attempt failed with `invalid-publisher`. Local wheel checks and PyPI publication are separate evidence.
