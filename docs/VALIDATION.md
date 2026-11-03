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

## Remaining checks

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

### Platform, interoperability and publication gaps

- [ ] Run the optional official Tiled/rasterizer interoperability checks for the prepared 0.29.0 baseline, including native RGBA sheets/animations, scene-transfer, object/definition, mixed-scene classification properties and tile metadata compatibility, when those applications are available (#75, #109, #110, #111, #112, #113, #127, #130, #140, #149).

- [ ] Record non-Chromium desktop-browser and Windows runtime results with exact versions and workflows; these are outside the automated browser matrix.
- [ ] Configure the TestPyPI trusted publisher and verify an upload if that channel is needed; the historical 0.1.4 attempt failed with `invalid-publisher`. Local wheel checks and PyPI publication are separate evidence.
