# Import PNG artwork and existing Tiled maps

Open **Library → Import atlas…**, then choose **PNG tilesheet** or **Tiled JSON
map** in Source type. The existing gbc-atlas bundle workflow remains available.
These generic inputs need no gbc-atlas installation, manifest or GBC palette setup.

## PNG tilesheets

1. Choose a PNG and give it a project asset ID, such as `forest` (lowercase letters,
   digits and underscores, starting with a letter).
2. Set the square tile grid to **8, 16 or 32 px**. Margin is the border on all four
   sides; spacing is the gap between tiles. Both are whole pixels.
3. Click **Preview and check**. Magenta rectangles show exactly which pixels become
   tiles. The sheet must slice exactly; partial tiles or leftover borders are
   rejected. Fix settings and preview again if needed.
4. Click **Import checked content**. Forge copies the PNG and creates portable
   tile images/tilesets inside the project. Existing saved placements stay intact.
   Create or open a scene with the matching grid and paint from the Library.

PNG inputs may be 1–2048 pixels on each side, at most 4 MiB, and contain up to
255 tiles. Non-interlaced 8-bit RGB/RGBA and 1/2/4/8-bit indexed PNGs are supported.
Colors and transparency are preserved; no quantization or palette assignment is
performed. Smaller supported scene grids can subdivide imported tiles.

To replace artwork, select the updated PNG, use the **same asset ID and slicing
settings**, check **Update this existing PNG asset ID**, and preview again. The
report lists added/changed regions and artwork changes. Existing tile coordinates
retain their identities even when columns or rows are appended. Removing or
resizing existing tiles, changing slicing settings, changing input format, or
accidentally reusing an ID without explicit update is rejected. Forge-authored
terrain/collision metadata and saved placements survive compatible updates.

Generic artwork has no RGB5/index metadata. If GBC palette checks are enabled,
placed generic tiles produce **unverified** requirements rather than a claim of
hardware compatibility. Ordinary editing/export remains available.

## Tiled JSON maps

1. In Tiled, save/export a finite orthogonal map as JSON (`.tmj` or `.json`). Use
   sheet tilesets embedded in the map or external JSON tilesets (`.tsj`/`.json`).
2. Arrange the map, tilesets and PNGs in one source folder. Dependencies must be
   children of their referring file's folder; absolute paths and `..` references
   are rejected. Move/copy and update paths in Tiled before importing if needed.
3. Choose **Tiled JSON map**, select that source folder, select the map, enter a
   new scene name and an asset ID prefix, such as `forest_map`.
4. Click **Preview and check**. Review the layer/tile counts and the complete list
   of declared map/tileset/image dependencies. An incompatible map reports the
   unsupported setting or missing dependency; nothing has been copied yet.
5. Click **Import checked content**. Forge saves the new scene and all artwork in
   one guarded transaction and opens the imported scene. Asset IDs use the prefix
   plus tileset position (`forest_map_1`, `forest_map_2`, …). Existing IDs are never
   overwritten. For a second independent import, choose a new prefix.
   To update an imported sheet later, use PNG tilesheet import with its generated
   asset ID (for example, `forest_map_1`), original grid/margin/spacing and explicit
   update enabled. Map intake creates a new scene; it does not merge changes into
   an existing scene.

### Supported subset

- Finite, orthogonal, right-down maps, 1–256 cells per axis, square 8/16/32 px grid.
- 1–128 full-size tile layers; names, IDs, order and visibility are retained.
- JSON-array tile data, empty cells, horizontal/vertical/diagonal tile transforms.
- 1–16 PNG sheet tilesets with matching grid, margins and spacing. Each sheet has
  the same PNG and 255-tile limits described above.
- Persisted scenes must fit 4 MiB and the resulting project manifest 8 MiB.
  Preflight checks these serialized output limits as well as the source sizes.
- Up to 65 selected PNG/JSON/map/tileset files, with at most 7 MiB of encoded file
  content (the entire HTTP request must fit the existing 8 MiB limit).

Object/image/group layers, infinite chunks, compressed/base64 layer data, custom
properties/classes, background colors, offsets, parallax, opacity, tint, locked
layers, image collections, tile animations/collision/Wang data, transparent-color
keys and unknown fields are rejected. Empty/default values documented by the
importer may be accepted. Source editor version/name bookkeeping is normalized
into Forge-owned files. No unsupported authored content is silently discarded.
This is an external sheet-map importer; it is not a general Tiled project importer
or an importer for Forge's exported image-collection tilesets. Open an exported
Forge **project** directly to resume editing it instead.

The source folder remains unchanged and is not needed afterward. Move the whole
Forge project to keep dependencies portable. A project ZIP export can be extracted
and reopened in Forge; its maps/tilesets can also be opened in Tiled. Preflight
confirmation is bound to the selected input and project revision: if another
session changes the project, preview again before importing.

The supported JSON fields and tile IDs follow the official
[Tiled JSON format reference](https://doc.mapeditor.org/en/stable/reference/json-map-format/).

## Preview examples

![PNG slicing preview](../screenshots/imports/png-preview.png)

![Tiled compatibility and dependency report](../screenshots/imports/tiled-preflight.png)
