# Drawing space, task entry and PNG downloads (#228–#234)

## Scope and method

Agent assessment of the prepared 0.39.0 working tree on `feat/milestone-24-p2`,
based on `a9df2dc`, on 2026-11-04 local time (2026-11-05 UTC). Environment:
macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1 and Playwright 1.64.1 /
Chromium 156.0.8078.4, production bundle, device scale factor 1 and default
browser zoom. Actual OS display scaling was not measured. The immutable
[original review](https://github.com/cliffom/gbc-scene-forge/blob/a9df2dc/docs/evaluations/usability-review-2026-11.md)
retains its own `98a33d8a` provenance, F1–F8 findings and proposed study protocol.

The [working-space cases](../../tests/playwright/editor/working-space.spec.ts)
use the sample project plus a native two-frame 32 × 16 sheet, independent Base
and Overlay layers, and another retained artwork. They exercise drawing →
animation disclosure → drawing, contextual letters, native PNG downloads,
Undo/Redo, scene switching, retained pane/dock choices and reviewed save access.
Python's standard-library zlib/CRC decoder compares whole-sheet bytes with the
live work snapshot and checks exact selected-frame dimensions, semitransparent
unsaved pixels and transparency. Work snapshots remain equal across export,
including after review. Separate cases use artwork/import/blockout project
starts at compact width and long-named sprite/marker selections at desktop and
laptop sizes, including actual preview play/pause without authored changes.

The complete regular browser suite supplies the combined #224 task coverage:
existing-scene open/paint/save/reopen, named-pose and deliberate Sheet editing,
shared/copy targeting, retained history, keyboard-created cross-layer stamps and
repeated placement, larger long-name Libraries, compact navigation, and existing
recovery/conflict/path/token boundaries. This is scripted coverage, not a
participant completion result. The contextual-panel suite additionally measures
normal/animation/properties/review with both panes visible at four sizes.

## Measured drawing space

All dimensions are CSS pixels. The following table uses
[contextual-panel raw bounds](../screenshots/working-space/canvas-space.json):
both panes visible, dock closed for drawing, dock/timeline open for animation,
and dock open with timeline closed for properties/review.

| Window | Drawing viewport | Animation viewport | Properties / review viewport |
| --- | --- | --- | --- |
| 1440 × 900 | 910 × 452 | 910 × 254 | 910 × 364 |
| 1280 × 800 | 750 × 352 | 750 × 160 | 750 × 264 |
| 800 × 640 | 392 × 158.5 | 392 × 150 | 392 × 150 |
| 1280 × 600 | 750 × 188.5 | 750 × 150 | 750 × 150 |

At 1280 × 800 the drawing default is taller than the original review's open-dock
default (271.5px), but shorter than its manually collapsed state (399.5px).
The now-visible frame/scope bar and additional commands consume space. Compact
drawing is also shorter than the original collapsed-dock 244px observation;
this change does not establish a general increase in available canvas space.
Keep the frame/scope context visible and use the existing pane toggles when
more room is needed. A separate Focus canvas mode is not justified by this
bounded assessment. Animation remains deliberately constrained in short windows.

The [workflow measurements](../screenshots/working-space/workflow-space.json)
record a different review state: Library hidden, Inspector visible, dock closed.
Its 491.5/391.5/208px heights must not be presented as a like-for-like increase
over drawing with both panes visible. Presentation changes remain outside Undo.

## Inspected states and observations

- Drawing: [desktop](../screenshots/working-space/drawing-1440.png),
  [laptop](../screenshots/working-space/drawing-1280.png),
  [compact](../screenshots/working-space/drawing-800.png).
- Explicit animation: [desktop](../screenshots/working-space/animation-1440.png),
  [laptop](../screenshots/working-space/animation-1280.png),
  [compact](../screenshots/working-space/animation-800.png).
- Review after pane changes: [desktop](../screenshots/working-space/review-1440.png),
  [laptop](../screenshots/working-space/review-1280.png),
  [compact](../screenshots/working-space/review-800.png).
- Ordinary selected-object controls precede secondary operations, with a long
  name wrapping inside the Inspector: [desktop](../screenshots/working-space/selection-1440.png)
  and [laptop](../screenshots/working-space/selection-1280.png). The latter also
  shows routine Scene opened feedback in the footer, clear of the drawing area.
- Compact goal routes: [new artwork after creation](../screenshots/working-space/start-artwork-800.png),
  [import dialog](../screenshots/working-space/start-import-800.png) and
  [blockout dialog](../screenshots/working-space/start-blockout-800.png).

Agent inspection confirms bounded controls and visible scope, ordinary edit
actions and status feedback in these states. Compact space remains tight;
these images do not establish prolonged drawing comfort. The fixed footer keeps
routine feedback arrival/expiry from changing viewport geometry. Existing native
pane toggles and the explicit animation action remain keyboard reachable.

## Failures and limits

Initial broad checks exposed compact toolbar overflow and footer-driven viewport
movement; placing PNG beside the tools and fixing footer height resolved them.
Final goal-dialog inspection also moved the project-opening hint into the quiet
status host and clears it when an explicit starting goal opens, so that it no
longer covers dialog headings or consumes their limited height.
Other failures were obsolete labels, recovery-disclosure synchronization,
animation profiles assuming an open outer dock, and new Inspector fixtures using
the wrong catalog/object fields. The final full run passed 181 cases with 12
optional profiles skipped. The corrected long-name fixture additionally asserts
the actual long text and enabled animation playback; both focused cases pass.
After the final startup-hint cleanup, all eight working-space cases pass against
the rebuilt production bundle, including the compact Create blockout button's
viewport assertion. The complete regular run preceded that last cleanup.
See the [validation record](../VALIDATION.md) for all check results.

Evidence is local synthetic automation plus agent screenshot inspection. It does
not establish independent discovery, accessibility conformance, physical-device
comfort, maximum-size PNG memory/latency, other-browser behavior or artistic
quality. Full optional profiling was skipped; official Tiled/rasterizer applications
were unavailable. Participant studies remain #165/#166 in
the [single remaining-check ledger](../VALIDATION.md#remaining-checks).
