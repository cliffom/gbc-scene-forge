# Scene Forge 0.21.2

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

This compatible patch addresses [#78](https://github.com/cliffom/gbc-scene-forge/issues/78),
[#92](https://github.com/cliffom/gbc-scene-forge/issues/92) and
[#93](https://github.com/cliffom/gbc-scene-forge/issues/93). It changes no project,
Tiled or draft formats, required runtime dependencies or installation procedure.
This release builds on 0.21.1's hover and dirty-state improvements. Tagging and
publication are separate from this prepared release.

See the [rendering/history evaluation](evaluations/scene-scalability.md) and
[validation](VALIDATION.md#scene-scalability-78-92-93) for observed results,
regressions, memory bounds and limitations.
