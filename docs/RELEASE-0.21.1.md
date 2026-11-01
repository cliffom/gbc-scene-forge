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

Large zoomed-in scenes now draw visible tile chunks and reuse unchanged artwork
across hover, selection and sprite-preview repaints. Transparent per-layer chunks
preserve objects between tile layers. The editor bounds retained tile bitmaps to
16 MiB, falls back to direct visible-cell drawing when a view exceeds that budget,
and refreshes newly exposed content on pan, zoom and layout changes. Fit views
that expose the complete scene may have little culling benefit.

Undo retains changed values or subtrees instead of 100 repeated full scenes.
Atomic strokes, cancellation, no-op behavior, stable IDs, dirty-state equality,
layer context and the 100-operation bound remain intact. A transaction still
clones the scene, and large structural changes can still retain large payloads.

This compatible patch release addresses [#90](https://github.com/cliffom/gbc-scene-forge/issues/90),
[#77](https://github.com/cliffom/gbc-scene-forge/issues/77),
[#91](https://github.com/cliffom/gbc-scene-forge/issues/91),
[#78](https://github.com/cliffom/gbc-scene-forge/issues/78),
[#92](https://github.com/cliffom/gbc-scene-forge/issues/92) and
[#93](https://github.com/cliffom/gbc-scene-forge/issues/93). It changes no project,
Tiled or draft formats, required runtime dependencies or installation procedure.
It extends the already-prepared, unpublished 0.21.1 patch; tagging and publication
are separate from this preparation.

See the [interaction measurements](evaluations/canvas-repainting.md#interaction-efficiency-77-90-91),
[rendering/history evaluation](evaluations/scene-scalability.md) and
[validation](VALIDATION.md#scene-scalability-78-92-93) for observed results,
regressions, memory bounds and limitations.
