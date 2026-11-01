# Standalone projects and saved scenes

Historical design for [#13](https://github.com/cliffom/gbc-scene-forge/issues/13),
the first milestone of [#12](https://github.com/cliffom/gbc-scene-forge/issues/12).
This is the initial implementation scope, not the current roadmap or feature limit.
Use [standalone usage](STANDALONE.md) for current behavior and
[the roadmap](ROADMAP.md) for open priorities.

## Decisions

- Forge owns standalone project storage, atlas import, rendering and Tiled files.
  Standalone projects are the supported direction. Connector v1 compatibility
  and game-specific Apply/build integration are no longer requirements.
- A version-1 `forge.project.json` records a persistent project UUID, display name,
  scene UUIDs and relative paths, imported atlas metadata and preview settings.
  The project directory is the declared workspace; imports are explicit inputs.
- Native maps are finite orthogonal `.tmj` files with one tile layer, unsigned
  JSON-array GIDs, external `.tsj` tilesets and project-local PNGs. Reject richer
  maps and unsupported fields before rewriting them. An optional `Sprites` object
  layer stores native-size sprite placements. General object/layer authoring,
  collision editing and animation playback belong to later milestones.
- Painting uses square grids of 8, 16 or 32 pixels. Tile regions divisible by
  the selected grid become stamps of cells. Stable references include atlas ID,
  region name and cell offset. All regions are shown in the palette. Sprites are
  placed independently of the grid at native size, anchored by their atlas origin;
  selection, dragging, deletion, undo/redo and persistence include sprites.
- Import requires a version-1 `*.atlas.json` and its declared PNG. Optional
  authoring/review files are not needed to paint; their metadata is retained as
  provenance. No atlas approval or generated game tile indices are required.
- External tilesets use image collections with cropped cell PNGs and persistent,
  append-only local tile IDs. Map GIDs are derived from those IDs; zero is empty.
  Atlas metadata and source PNGs remain available inside the portable project.
- Reimport is explicit. Unchanged imports preserve references. Artwork, palette,
  origin and animation changes are reported. Region removal or geometry/kind
  changes block replacement; resolving those changes is deferred. Moving a region
  within a sheet is compatible and updates its cropped images.
- Project mutations use filesystem locking, raw-byte revision guards and durable
  multi-file transactions. Recover interrupted operations before opening projects;
  preserve external edits when recovery encounters conflicts.
- Standalone rendering uses browser canvas and project-local images, with no
  runtime Python dependency. PNG import supports a documented, validated subset.

## Delivery and verification

Delivered behavior is recorded in the [0.2.0 release notes](RELEASE-0.2.0.md).
Historical observations and limitations are consolidated in
[initial standalone validation](VALIDATION.md#initial-standalone-projects-13).
The [original plan and progress record](https://github.com/cliffom/gbc-scene-forge/blob/5d0d98c939947f2dcdddcc7e49f96834679a08f0/docs/ISSUE-13-PLAN.md)
retains the detailed implementation history.

## Progress

The working-tree observations were recorded on 2026-10-27 before publication.
They are historical evidence, not a statement about current release status.
See the validation entry above, including the legacy connector boundary.
