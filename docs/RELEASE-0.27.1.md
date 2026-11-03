# Scene Forge 0.27.1

Prepared editor usability and visual polish for
[#144](https://github.com/cliffom/gbc-scene-forge/issues/144). Scene commands now
share a compact toolbar with consistent SVG icons, named tooltips, shortcut hints
and clear selected-tool treatment. Drawing, history, clipboard and selection
commands remain grouped. Zoom, review and fit retain their first row; narrower
canvases reveal secondary commands through an expand arrow instead of automatic
toolbar wrapping. At the smallest widths the trigger names the current drawing
tool and expands to expose drawing choices as well.
Management and save actions retain text labels; compact review uses a named eye icon.

Library and Inspector use persistent edge chevrons to collapse/reopen their panes.
Copy icons beside the project folder and its popover path provide direct copying,
success feedback and a selectable fallback when clipboard access is unavailable.

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
