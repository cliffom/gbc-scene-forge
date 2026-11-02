# Everyday editor usability review (#117)

Recommend three focused changes, in order: match visible artwork names in search
[#123](https://github.com/cliffom/gbc-scene-forge/issues/123), clear corrected import
errors [#124](https://github.com/cliffom/gbc-scene-forge/issues/124), and name the
import entry for its existing artwork/map sources
[#125](https://github.com/cliffom/gbc-scene-forge/issues/125). Retain independent
pane collapse, Review scene, guarded import and conflict-aware recovery.

## Scope and method

Reviewed published 0.25.1 at
[`f85d3ae`](https://github.com/cliffom/gbc-scene-forge/commit/f85d3ae6e1edd033405a15c8e30ea584778ae99a)
on 2026-11-01 local time (2026-11-02 UTC): macOS 27.0.1 arm64, Python 3.13.13,
Node 24.22.1, Playwright 1.64.1 and Chromium 156.0.8078.4. The checkout's
development bundle identified itself as `0.25.1-f85d3ae`. This was a source-checkout
review, not an installed-wheel or production-bundle rerun.

An agent inspected the live editor's accessibility snapshots and the committed
screenshots below. Playwright drove pointer/keyboard interactions in disposable
sample and empty projects, measured viewport rectangles, and exercised existing
acceptance workflows. These are agent observations and synthetic interactions,
not human participant research. The initial insufficient-canvas-space report is
user-reported context from #116; the findings below were independently observed.

All 15 selected existing acceptance scenarios passed:

```sh
npm run build
npm run test:playwright -- editor/layout.spec.ts editor/panes.spec.ts editor/review.spec.ts project/first-use.spec.ts artwork/imports.spec.ts objects/compositions.spec.ts objects/definitions.spec.ts project/drafts.spec.ts
```

The local report was `2026-11-02T02-43-12.006Z-22211`; its ignored output is not
archived CI evidence. Selected screenshots and
[viewport/search observations](assets/usability-117/observations.json) are committed
here. Existing test sources make the functional workflows repeatable; the finding
steps below reproduce the additional review probes without a second test harness.

## Workflow and window coverage

The additional walkthrough used Riverside from a disposable sample project. At
each of the four sizes it toggled all four pane combinations with Enter, entered
Review scene, dragged to pan at 3×, used Fit scene, and exited with Escape,
checking restoration of pane choices. It then used Library arrow/Home navigation,
selected a tile, painted, switched to Select with S, selected content, saved,
switched to the object layer, placed a point, opened/cancelled its property form,
and undid placement. PNG source selection was inspected at every size.

| Window | Independently inspected evidence | Scope beyond the common walkthrough |
| --- | --- | --- |
| 1440×900 | [Expanded editor](assets/usability-117/1440x900-library-inspector.png) | Empty project creation, missing-file error, successful PNG import, scene creation, keyboard save/reload and draft restore; artwork search |
| 1024×768 | [Expanded editor](assets/usability-117/1024x768-library-inspector.png) | Wrapped controls and scrollable inspectors |
| 760×640 | [Expanded editor](assets/usability-117/760x640-library-inspector.png), [both panes hidden](assets/usability-117/760x640-no-library-no-inspector.png) | Corrected PNG preflight error; Tab reached the scrolled dialog's Cancel button at y=563–599 and Enter closed it |
| 1440×600 | [Short editor](assets/usability-117/1440x600-library-inspector.png) | Short-window canvas and inspector scrolling |

Measured authoring viewport widths, with pane states ordered as both shown,
Library hidden, Inspector hidden, both hidden:

| Window | Viewport widths (CSS px) |
| --- | --- |
| 1440×900 | 910 / 1170 / 1180 / 1440 |
| 1024×768 | 544 / 776 / 792 / 1024 |
| 760×640 | 352 / 548 / 564 / 760 |
| 1440×600 | 910 / 1170 / 1180 / 1440 |

The expanded 760×640 viewport was 160px high; hiding both panes yielded 244px as
toolbar wrapping reduced. This is measured space recovery, not a comfort rating.
Keeping both panes hidden is an existing editing option, separate from Review.

| Task/state | Observation and disposition | Supporting interaction evidence |
| --- | --- | --- |
| Open/create a project and scene | Empty state exposes Create scene; the optional guide does not author content. Retain. Import wording is F3. | [Empty project](assets/usability-117/empty-project.png); [first-use acceptance](../../tests/playwright/project/first-use.spec.ts) also creates a sample project, saves/reopens and exports |
| Import/select artwork | PNG preflight/import worked; unsupported Tiled content remains rejected. Visible-name search fails (F1); corrected error status is stale (F2). | [PNG preflight](assets/usability-117/png-preflight.png); [imports acceptance](../../tests/playwright/artwork/imports.spec.ts) checks rejected/accepted PNG slicing and Tiled preflight/import/reopen |
| Paint/select; layers/properties | Pointer paint, S selection, layer labels and object property access worked. Retain layer ordering and guarded hidden-layer behavior. | Common four-window walkthrough; [compact object form](assets/usability-117/760x640-object-properties.png); [definitions acceptance](../../tests/playwright/objects/definitions.spec.ts) edits typed instance fields and checks validation/conflicts |
| Objects/stamps | Point placement/property access worked at all four sizes. Stamp capture, repeat placement and cross-scene/layer behavior passed existing acceptance. Retain separate Objects/Stamps categories. | [Composition acceptance](../../tests/playwright/objects/compositions.spec.ts); [layout acceptance](../../tests/playwright/editor/layout.spec.ts) checks bounded long stamp names and keyboard Library tabs |
| Save/reopen/recover; disabled/conflict states | Keyboard save/reload and a fresh-context draft restore worked. Restore explains that content remains unsaved. Stale drafts retain download/discard without overwriting newer content. Retain those safeguards. | [Recovery](assets/usability-117/recovery.png); [draft acceptance](../../tests/playwright/project/drafts.spec.ts) checks stale-revision restore disabling, downloads, confirmed discard and retry behavior |
| Review/pan/zoom/Fit | All four pane combinations survived viewing transitions at every requested size. Retain current separation of viewing and editing. | Common walkthrough; [pane acceptance](../../tests/playwright/editor/panes.spec.ts) and [Review acceptance](../../tests/playwright/editor/review.spec.ts) also check history, dirty state, hidden Tab stops and focus restoration |

Stamp authoring, full typed property edits, Tiled import and revision conflicts
were exercised in the existing suites' own viewports, not repeated at every
matrix cell. First-use acceptance uses 1440×1000; the additional empty-project
walkthrough used 1440×900. No exhaustive workflow × viewport × input-method
cross-product is claimed.

## Prioritized findings

Effort estimates cover a focused implementation, useful browser coverage and
documentation, not a release. Impact is the agent's assessment; frequency and
human task-completion costs were not measured.

| Order | Finding / tracking | Authoring impact | Estimated effort |
| --- | --- | --- | --- |
| 1 | F1: displayed asset name does not match search — [#123](https://github.com/cliffom/gbc-scene-forge/issues/123) | Medium: finding known artwork requires internal naming syntax | Small, roughly half a day |
| 2 | F2: corrected preflight leaves a stale global error — [#124](https://github.com/cliffom/gbc-scene-forge/issues/124) | Medium: successful preview and footer give contradictory instructions | Small, roughly half a day |
| 3 | F3: import entry names only one supported source — [#125](https://github.com/cliffom/gbc-scene-forge/issues/125) | Low–medium: PNG/Tiled capability is hidden behind atlas-specific wording | Small, a few hours |

### F1: Search the displayed name

Open Riverside, leave Artwork filters at All atlases / All kinds, and type `hero`:
two sprites appear, including **hero idle**. Replace the query with `hero idle`:
the count becomes **0 / 14**. Replace it with `hero_idle`: **1 / 14** appears.
This was observed through live input and independently repeated in Playwright.

[Visible-name failure](assets/usability-117/search-hero-idle.png) and
[raw-ID match](assets/usability-117/search-hero_idle.png) capture the discrepancy.
The [artwork controller](../../frontend/artwork/editor-artwork.mts) replaces
underscores in labels but filters only the raw asset ID. Match visible names while
retaining raw-ID searches and existing atlas/kind filters; no fuzzy-search feature
is justified by this finding.

### F2: Correct a missing PNG input

Open the import dialog, choose PNG tilesheet, enter a fresh asset ID and use
Preview and check without a file. Both inline error and footer say **Choose a PNG
tilesheet.** Choose a valid 16×8 PNG at grid 8 and check again. The inline error
clears, the preview reports **2 tiles · 2 added · 0 changed**, and Import checked
content enables, but the footer still says **Choose a PNG tilesheet.**

This was observed at 1440×900 and repeated at 760×640;
[successful preview with stale footer](assets/usability-117/corrected-preflight.png)
is the compact evidence. Clear/replace feedback owned by the corrected preflight
without weakening confirmation invalidation or erasing unrelated errors. No
corruption or loss of edits was observed.

### F3: Find ordinary artwork/map import

In either an empty or sample project's Artwork Library, the entry is **Import
atlas…**. Opening it reveals **Import artwork or map**, with gbc-atlas bundle,
PNG tilesheet and Tiled JSON map choices. Empty-Library guidance also refers only
to an atlas. The entry/dialog mismatch was observed at all four sizes; see the
[empty state](assets/usability-117/empty-project.png) and
[compact PNG source](assets/usability-117/760x640-png-import.png).

Name the entry and related empty-state/guide wording for the existing sources.
The hypothesis is reduced discoverability for someone arriving with PNG/Tiled
files; no human failure rate or need for another importer was established.

## Retain decisions and duplicate check

Checked the existing open/closed issue title inventory before creating follow-ups, then
read completed #25, #26, #84 and #116 in detail. #25/#26 delivered generic intake
and onboarding; the new findings concern current matching/feedback/entry wording.
#84/#116 delivered Review scene and independent pane collapse. None of the three
findings duplicates an existing issue in that inventory.

Retain independently scrollable Library/Inspector panes, visible reopen controls,
keyboard Library tabs, and source-specific preflight plus explicit confirmation.
The compact object/import forms require scrolling, but keyboard focus revealed
the import Cancel action within the viewport. A screenshot's initially offscreen
action is not by itself evidence that the action is unreachable. The four-window
walkthrough did not justify docking/resizing panels, merging inspectors, a broad
visual redesign or another selection/stamp workflow.

## Limits

This is a bounded agent review of small sample/fixture projects. It does not
establish prolonged editing comfort, novice success rates, screen-reader behavior,
physical-device input quality, non-Chromium/Windows behavior, or suitability for
large real authoring libraries. Full draft/conflict and stamp workflows were
checked in their existing automated scenarios rather than every window size.
Outstanding maintained checks remain in
[Validation](../VALIDATION.md#remaining-checks).

Preliminary exploratory scripts stopped on hidden-radio targeting, a repaint
that matched saved content, and a recovery-prompt startup race. Using visible
layer labels, distinct paint content and an explicit recovery wait completed the
probes; these harness failures are not reported as product regressions. All 15
selected committed acceptance scenarios passed without retries. The three
observed product findings remain unresolved in their focused follow-up issues.
