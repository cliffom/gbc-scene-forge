# Scene Forge 0.20.0

Create and resize wide or tall native scenes, including 480×9 cells at grid 16
(7,680×144px). Browser and MCP authoring, saved draft recovery, native Tiled round
trips and external Tiled intake share a 65,536-cell footprint budget and an
8,192px maximum on either axis. Validation happens before allocating new cell arrays.

Far-edge tiles, native sprites, gameplay objects and camera frames retain their
absolute coordinates through save/reopen, resize, undo/redo and portable export.
Artwork camera/overview PNGs retain their existing bounded output budgets.
See [scene dimensions](user/scene-dimensions.md) and
[editing measurements](evaluations/wide-scenes.md).

This compatible authoring feature warrants a minor release. Project, Tiled and
draft formats and required runtime dependencies are unchanged. Existing projects
need no migration; scenes exceeding 256 cells on an axis require Forge 0.20.0 or
later. Release preparation does not tag or publish packages.
