# Scene Forge 0.4.0

Release preparation for issue [#20](https://github.com/cliffom/gbc-scene-forge/issues/20).

- Copy, cut, paste and duplicate tile, multi-object and mixed visible-layer selections
  within and across compatible scenes in the same project.
- Preserve relative positions, layer relationships, properties, sprite origins and
  stable asset references, with fresh object IDs for copied placements.
- Flip and rotate tiles, points and rectangles with atomic bounds checks. Tile
  artwork, collision overlays and preview collision use the same transforms. Sprite
  transforms report an error before changing content.
- Save named project stamps and place them repeatedly. Library updates use project
  revision guards; each scene operation shares undo/redo and unsaved draft recovery.
- Preserve tile orientation in portable Tiled exports and save/reopen/reimport.

See the [composition guide](STANDALONE.md#clipboard-and-reusable-stamps) for selection,
layer mapping, origins, shortcuts, supported transforms and compatibility details.

The Python package remains dependency-free at runtime. Existing version 1 projects
open without migration. Projects with stamps need Forge 0.4.0 or later; keep a backup
before upgrading. This PR prepares the next release; publication uses the separately
reviewed tag and workflow described in [RELEASING.md](RELEASING.md).
