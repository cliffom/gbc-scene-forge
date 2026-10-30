# Scene Forge 0.17.2

Scene repainting now changes backing canvas dimensions only when the scene's
pixel dimensions change. Zoom and fit update CSS dimensions only as needed,
without clearing the backing store. Drawing styles and paths are isolated between
frames; pixel art retains disabled image smoothing after resizing.

Hover, painting and sprite animation retain synchronous feedback, layer order,
overlays, labels and the existing preview/history/lifetime contracts. No redraw
scheduler, viewport culling or layer cache is introduced. See the
[repeatable measurements and scheduling assessment](evaluations/canvas-repainting.md).
The measurements do not promise a speedup for every scene.

This patch prepares 0.17.2. Existing projects, portable Tiled maps, drafts and
runtime dependencies are unchanged. Publication is a separate step.
