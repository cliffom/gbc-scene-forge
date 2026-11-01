# Scene Forge 0.21.1

Moving between cells or leaving the canvas now updates hover feedback without
refreshing unrelated authoring controls, inspectors or draft checkpoints.
Coordinates remain immediate; redundant hover requests share one animation-frame
paint of the latest state. Painting, erasing, selection, cancellation, controls
and sprite animation retain immediate drawing.

A control refresh reuses one content-based dirty result, including for checkpoint
observation. No persistent dirty cache is introduced: no-op edits, undo back to
saved content, in-progress strokes, recovery and external-refresh protection keep
their existing semantics. Queued hover work belongs to the mounted editor and is
cancelled by immediate drawing or disposal and rejected across scene replacement.

This compatible patch release addresses [#90](https://github.com/cliffom/gbc-scene-forge/issues/90),
[#77](https://github.com/cliffom/gbc-scene-forge/issues/77) and
[#91](https://github.com/cliffom/gbc-scene-forge/issues/91). It changes no project,
Tiled or draft formats, required runtime dependencies or installation procedure.
Tagging and publication are separate from this prepared release.

See the [before/after measurements](evaluations/canvas-repainting.md#interaction-efficiency-77-90-91)
for scoped timings, call counts and latency tradeoffs, and
[validation](VALIDATION.md#editor-interaction-efficiency-77-90-91) for checks and limits.
