# Scene Forge 0.27.1

Prepared editor usability and visual polish for
[#144](https://github.com/cliffom/gbc-scene-forge/issues/144). Scene commands now
share a compact toolbar with consistent SVG icons, named tooltips, shortcut hints
and clear selected-tool treatment. Drawing, history, clipboard and selection
commands remain grouped while wrapping within the available canvas width.
Management and save/review actions retain text labels.

The pixel editor exposes all eight drawing/selection tools directly, keeps
Color/Alpha/Transparent aligned, and groups zoom/grid separately. Setup/recovery
share a padded scroll surface, an empty source selector explains its unavailable
state, and the drawing canvas/review column scroll independently above the save
footer. Drawing help and preview-position settings use contextual disclosures;
shared-edit scope, review and save feedback remain visible.

This compatible patch changes presentation and input wiring, with no project,
Tiled, MCP or artwork schema migration and no new runtime dependencies. Scene and
artwork histories, receipt-required saves and conflict-aware recovery retain their
existing contracts. Existing native artwork still requires Forge 0.27 or newer.

See the [layout guide](UI-DESIGN.md), [pixel workflow](user/pixel-artwork.md) and
[scoped evaluation](evaluations/editor-polish.md). Actual checks and limitations
belong in [validation](VALIDATION.md). Tagging and publication are separate.
