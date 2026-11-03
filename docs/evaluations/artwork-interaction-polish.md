# Artwork interaction polish (#173–#176)

Measured 2026-11-03 on macOS 27.0.1, Python 3.13.13, Node 24.22.1 and
Playwright 1.64.1 / Chromium 156.0.8078.4. The comparison uses the published
0.29.2 wheel in an independent plain environment and the prepared production
0.30.0 working tree on `milestone/20-artwork-polish`, both based on
`02aa30a43aeb5b1522618feae0cb08c8a00c2c9f`. These are working-tree observations,
not measurements on a later release tag. The baseline wheel SHA256 is
`cf73d2846c2a6ba16dbe8bd538823ea4fca81fffd9ddf7f44f25df1898b49080`.

## Layout method and results

`tests/playwright/artwork/navigation.spec.ts` creates a disposable 32×16 sheet
with two 16×16 frames, an animation and long names, plus a 256×256 document.
It measures controls, drawing viewport and footer in normal, expanded Animation,
Properties and Review states at four window sizes. The normal state keeps the
frame strip visible and Animation collapsed. The browser has no scene open.
Before and after use the same test/fixture and default 16× zoom. Raw observations
and displayed app versions are archived as [before](data/artwork-polish/before/measurements.json)
and [after](data/artwork-polish/after/measurements.json).

| Window | Toolbar before → after | Drawing height before → after | Reclaimed height |
| --- | --- | --- | --- |
| 1440×900 | 83.5 → 41.5 px | 376.5 → 418.5 px | 42 px |
| 1280×800 | 83.5 → 77.5 px | 252.5 → 258.5 px | 6 px |
| 800×640 | 83.5 → 77.5 px | 190.5 → 196.5 px | 6 px |
| 1440×600 | 83.5 → 41.5 px | 165 → 207 px | 42 px |

All 16 final states keep the fixed commands bounded, the save footer visible,
the artwork dialog free of page overflow and at least 150 px of drawing height.
Expanded short-window states reach the existing minimum; the 42 px gain does
not apply to every state. Palette swatches deliberately use a separate horizontal
scroller. Animation and side panels retain their own scrolling. The old 800 px
layout overflowed with this long heading; the action group now keeps its width
while the title wraps. The baseline records that failure without treating it as
a passing acceptance assertion.

Agent screenshot inspection covered [before desktop](../screenshots/artwork-polish/before-desktop.png),
[before compact](../screenshots/artwork-polish/before-compact.png),
[final desktop](../screenshots/artwork-polish/desktop.png),
[Properties at 1280×800](../screenshots/artwork-polish/properties.png),
[compact Review](../screenshots/artwork-polish/compact-review.png) and
[short-window Animation](../screenshots/artwork-polish/short-animation.png).
An initially clipped Zoom value was widened before final measurement.

## Targeting and navigation

Actual pointer/keyboard tests cover zoom 4×/16×/32×, offset frames, native scroll,
middle drag, Space+drag, Pan/arrow navigation, Fit, document restoration, capture
cancellation and blur. A panned 256×256 document at 32× writes exactly RGBA
`[204,119,68,73]` at (128,128), leaves its neighbor transparent and restores the
saved state through Undo. Space in numeric inputs keeps its default behavior.

Instrumentation sends 80 pointer moves before the next browser frame: one target
overlay mutation batch, zero `drawImage`/`putImageData` calls and zero mutations
to toolbar/sheet controls. Hover and chooser dismissal make no artwork API calls;
Undo remains disabled and the document stays Saved. This is a deterministic work
count, not a latency or sustained frame-rate benchmark. Navigation does not
introduce authored state, checkpointing or full-control redraw callbacks.

The target is legible over [light](../screenshots/artwork-polish/target-light.png),
[dark](../screenshots/artwork-polish/target-dark.png) and
[transparent](../screenshots/artwork-polish/target-transparent.png) pixels.
Selection uses a dashed rectangle, Eyedropper a gold outline, and Move selection
uses its cursor without a misleading writable-pixel cue.

## Document chooser and limits

The native modal dims and makes the background inert. Tests exercise keyboard
opening, focus containment, Escape, outside dismissal, return focus, current
state, retained long names and document switching without a scene. The
[640 px chooser capture](../screenshots/artwork-polish/documents.png) uses 125%
CSS zoom; additional coverage uses 1440 and 800 px windows. CSS zoom is a layout
stress test, not an operating-system display-scaling certification.

These synthetic fixtures and bounded agent visual inspections do not establish
independent human usability, touch behavior, Windows or non-Chromium support.
No format or MCP operations changed. Broader release checks and the sole list
of outstanding checks belong in the [validation record](../VALIDATION.md).
