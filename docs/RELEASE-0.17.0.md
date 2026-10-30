# Scene Forge 0.17.0

Review scene opens a larger canvas by hiding the authoring library, inspectors,
project header and editing controls. Pan is the only pointer tool in review mode.
Zoom, Fit scene, grid, terrain and collision overlays remain available, together
with a clear Return to editing button. Escape from the canvas also returns to
editing.

Reviewing preserves unsaved work, selection, brushes, the editing tool and undo
history. Authoring shortcuts and artwork drops cannot modify the scene in this
mode. Fit scene follows the expanded viewport and window resizing.

See the [review mode guide](user/review-mode.md). This compatible feature prepares
minor release 0.17.0. Existing projects, draft and portable Tiled formats remain
unchanged, and no Python runtime dependency is added.
