# Scene Forge 0.5.0

Scene management for issue [#21](https://github.com/cliffom/gbc-scene-forge/issues/21),
implemented in [PR #40](https://github.com/cliffom/gbc-scene-forge/pull/40).

- Rename scenes while preserving scene identity, map paths, and unsaved edits.
- Duplicate the saved scene or explicitly include the current unsaved canvas.
  Copies have independent scene identities and share project artwork.
- Resize or crop scenes with nine anchors, a visual preview, and a list of affected
  objects. Confirm removed tiles and removed or clipped objects before applying.
- Resize all layers together, including hidden layers, while preserving properties,
  object identities, sprite sizes, and origins. Undo/redo and draft recovery include
  dimension changes; Save persists them to portable Tiled maps.
- Guard scene management against stale project/map revisions and recover interrupted
  transactions without overwriting external changes.

See the [scene management guide](STANDALONE.md#scene-management) for details.

The Python package remains dependency-free at runtime and supports Python 3.10+.
Existing version 1 projects open without migration. Publication follows
[RELEASING.md](RELEASING.md).
