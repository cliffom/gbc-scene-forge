# Playwright migration coverage (#82)

Baseline: commit `a96eec2` (the merged #81 pilot). The twelve retired scripts
contained 649 explicit Node assertions. The
[line-addressed assertion inventory](browser-assertion-inventory.tsv) maps every
one to its new spec location, equivalent web assertion, or shared uncaught-error
fixture. Repeated helper assertions can map to multiple isolated scenarios.
All 358 readiness/race predicates are also mapped in the
[predicate inventory](browser-readiness-inventory.tsv). Lifecycle and first-use
retain the pilot's coverage.

| Retired suite | Assertions | Migrated scenarios and invariants |
| --- | ---: | --- |
| `layout-browser.ts` | 23 | Existing five viewport sizes, canvas/footer bounds, dropdown clearance, long stamp titles, command popovers, library category preservation, WAI keyboard tabs, modal focus, palette warning, stamp placement and guide navigation. New chooser scenario adds first/middle/last hover boundaries, full keyboard traversal, scrolling, narrow layout and 125% desktop zoom emulation. |
| `terrain-browser.ts` | 16 | Transition mask editor/undo, all-mask report, neighbor-aware painting/erase, undo/redo, persisted cells, reload and external metadata adoption retaining brush/tool. |
| `imports-browser.ts` | 12 | PNG slicing/preview, invalidation, dimensions and metadata, bounded Tiled preflight/import, error handling and reopen. |
| `blockout-browser.ts` | 32 | Artwork-free project, units, validation, presets, native drawing/resize/history, typed cameras, overview/camera reviews, unsaved export, saved planning objects, later artwork, accepted forest fixture, labels at four zooms/two DPRs, long caption selection and visible layer behavior. |
| `compositions-browser.ts` | 47 | Real keyboard clipboard operations, rotations/pixels, stable IDs/properties, stamp save/place, cross-scene paste and missing-layer rejection, atomic bounds failures, input shortcut protection, multi-object Shift selection, management/history, resize/crop/recovery, stale saves and compact layout. |
| `definitions-browser.ts` | 41 | Definition field authoring, inheritance and defaults, instance validation/navigation, overrides, deletion/recovery, retained extra fields and mismatched types, 128-field regression, shape/artwork defaults and compact layout. |
| `world-browser.ts` | 37 | Native map drag, exact coordinates, region/link authoring, source/target follow, hidden layers, save/discard/cancel, authored history, deleted endpoints/scenes, repair/navigation, reload and stale-save preservation. |
| `diagnostics-browser.ts` | 15 | Shared saved checks, required findings across scenes, read-only selection, unsaved navigation/cancel, movement assumptions, stale reports and unchanged project bytes. |
| `standalone-browser.ts` | 356 | Six isolated scenarios: launcher/switching/conflicts/restart; atlas picker/fallback/import/filters, canvas pixels, paint/fill/select/history and sprite placement; animation/directional mapping/transient movement/preferences; layers/drag/capture, shapes/properties, tile metadata/collision, export content, keyboard/focus/pan/wheel and moved-project persistence/conflicts; actual demo/Aseprite pixel comparison; palette conformance/profiles/contributors/held responses, reimport/stale guards and versioned hardware budgets. |
| `drafts-browser.ts` | 26 | Three isolated scenarios: independent tab checkpoints and save ownership, lost tabs/restart/move and restored Revert; deleted-checkpoint identity replacement, lost acknowledgements, disk-full retries, reload/save and transient preview coordinates; stale restore rejection, download bytes/revision, declined/confirmed discard and untouched saved file. |
| `mcp-browser.ts` | 12 | Real installed stdio SDK forest creation, overview/camera review, native browser edit/save, later imported artwork, concurrent MCP save, stale browser save, independent recovered draft content/download. |
| `refresh-browser.ts` | 32 | Real MCP saves/revision probes, view preservation, forms/dirty/hidden-tab protection, opt-out/manual checks, edits during held snapshots/artwork decode, reconnect/rapid writes, brush/tool/object/preset/stamp retention, animation/manual adoption, scene creation and external deletion. |

## Domain organization (#86)

At baseline `e91b136` (merged #85), discovery listed 22 regular scenarios in 13
files and two optional scenarios in two files. Moving them into the
[domain layout](BROWSER-TESTING.md#suite-ownership) preserves every scenario title
and basename exactly once in its original regular/optional selection. The two
review-mode scenarios added in #85 remain included in regular runs.

The TSV inventories retain the #82 migration's original source text and line
provenance: only destination paths are updated for #86. Destination line numbers
are historical migration references, not a regenerated assertion inventory;
formatting and later scenario additions can shift current lines. Retired-suite
names and original line columns still refer to `a96eec2`. The validation evidence
below also remains the historical #82 record.

Observed checks are recorded in [suite organization validation](VALIDATION.md#suite-organization-86-88).

## Consolidations and deliberate changes

No authored behavior assertion was dropped. Per-suite browser error-array checks
are consolidated into the shared page fixture, which observes every page and
attaches console output. Expected HTTP 400/409 console messages are retained;
uncaught JavaScript errors fail acceptance. Saved-data/geometry/pixel assertions
remain explicit. Simple control assertions use Playwright web assertions.

Browser/server/profile setup and protocol enable/attach calls were removed, not
recreated as a compatibility interface. Each scenario uses the shared server
fixture and Playwright page/context ownership. Secondary tabs use `newPage` and
`close`; the recovery sequences retain independent tab identities and actual
server restart/project move. File fallback uses a real Playwright file chooser.
Normal keyboard, pointer and form actions use native Playwright APIs. Deliberate
fetch/decode/capture/visibility fault injection remains in page evaluation, under
the unchanged CSP.

The moved-project stale-revision subcases explicitly opt out of automatic refresh
and establish an unsaved canvas before modifying its saved file. Otherwise a
correct clean automatic adoption can win the race before conflict injection,
particularly on slower CI machines. Real automatic adoption/protection remains
covered by the optional refresh suite.

Splitting standalone acceptance required explicit seeds: preview and layer
scenarios copy the synthetic portable project, clear River through the backend,
then place/save its sprite through native browser input to establish undo history.
The layer scenario has a separate persisted preview preference seed. No test
replays earlier acceptance scenarios as setup, depends on another test's output,
or shares its browser context. Draft retry and stale-revision scenarios each
start with their own two-scene fixture; the stale case uses its own valid draft
identity instead of borrowing a checkpoint from the retry case.

Screenshot names are retained under each scenario's output directory. The former
diagnostics copy into tracked `docs/screenshots/` is replaced by a report artifact;
tests no longer overwrite maintained documentation images. Chooser before/after
evidence temporarily restores the shipped outline offset through CSSOM, then
removes that rule without weakening CSP. Density/zoom emulation and the Retina capture that must preserve that emulation
are the only browser-specific CDP uses, documented at each call site. Every zoom
checks effective DPR, and the Retina PNG must contain 2880 × 2200 pixels while
retaining DPR 2. Popover bounds are checked after the native toggle handler
publishes its expanded state, rather than racing the earlier native open state.

## Historical #82 validation evidence

See [Playwright migration validation](VALIDATION.md#playwright-migration-82) for
local pass reports, environment, failure/cleanup audits and evidence limitations.
The [before](screenshots/project-chooser/chooser-before.png) /
[after](screenshots/project-chooser/chooser-after.png) review captures are retained.
