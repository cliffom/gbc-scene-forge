# Scene dimensions

Scenes can be wide, tall or square. Creation, resize, saved drafts, native Tiled
round trips and external Tiled intake share these limits:

- Positive whole-cell width and height; an 8, 16 or 32px grid.
- At most **65,536 cells** (`width × height`) per scene footprint.
- At most **8,192 pixels per axis** (`cells × grid`).

| Grid | Maximum cells on either axis | Example at the cell budget |
| --- | --- | --- |
| 8px | 1,024 | 1,024 × 64 |
| 16px | 512 | 512 × 128 |
| 32px | 256 | 256 × 256 |

A 7,680×144px scene uses **480×9 cells at grid 16**, or 4,320 cells.
Choose **Scene actions → Create scene…**, enter those cell dimensions and select
16px. Blockout creation also accepts 7,680×144 in pixel units. Cameras must fit
inside the scene. **Resize / crop** uses the same limits and preserves the chosen
anchor; undo/redo restores the complete edit, including objects on hidden layers.
Use zoom, pan and horizontal/vertical scrolling to reach the far edge.

The cell budget applies to the footprint; existing layer, object, input-byte,
export-byte and image-work budgets still apply independently. Many dense layers
cost more to render and retain in undo history. The editor currently repaints the
whole scene; large scenes can feel slower on modest hardware. See the
[editing measurements](../evaluations/wide-scenes.md).

Native tiles, sprite anchors, gameplay objects and camera coordinates remain in
scene cells/pixels without page offsets. Portable Tiled exports retain full scene
dimensions and absolute object coordinates. Artwork PNG review stays bounded to
1,024px per axis and 1,048,576 output pixels per view. Its default overview shows
the top-left bounded region; request an explicit overview origin to inspect the
far edge. Planning SVG review and portable ZIP exports keep their existing limits.

Existing projects need no migration. Scenes within the old limits still open in
older Forge versions; scenes beyond 256 cells on either axis require 0.20.0 or later.
