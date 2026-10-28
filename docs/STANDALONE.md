# Standalone Scene Forge

Create or open projects without installing or supplying a game connector:

```sh
gbc-scene-forge /path/to/world --create "My world"
gbc-scene-forge /path/to/world --port 8777
```

The equivalent module command is `python -m gbc_scene_forge /path/to/world`.
For this checkout, prefix it with `poetry run` after `make setup`.
Without `--create`, a new or empty directory opens a creation form in the browser.
An existing project opens its saved scene list. The launcher selects one workspace
for the server session; stop and relaunch to open a different directory.

## Import and edit

1. Choose **Import atlas**, then **Browse folder…** to select an atlas folder.
   Choose a manifest if the folder contains several, then confirm with **Import
   atlas**. Its declared PNG is included automatically.
2. Choose **Create scene**, then enter a scene name, width and height (1–256 cells)
   and an 8, 16 or 32 pixel grid in the dialog.
3. Choose **Create scene**, select a tile region to paint or a sprite to place.
4. Use Erase, one-cell Fill, or Select. Drag a selection, then use arrow keys to
   move it or Delete to erase it. Undo/Redo retain up to 100 completed edits.
5. Choose **Save** or press Ctrl/⌘ S. Choose another saved scene and **Open scene**
   to switch. Unsaved changes prompt before being discarded. **Revert** restores
   the last opened/saved canvas. Ctrl/⌘ Z undoes; Ctrl/⌘ Shift Z or Ctrl/⌘ Y redoes.

Search the asset library or filter by atlas and kind. Drag an asset onto the
canvas to place it directly. Use S, P, F, E and H to switch Select, Paint, Fill,
Erase and Pan while editing the canvas. Pan drags the view without editing the
scene. The inspector shows scene dimensions, selection details and project
atlases; its **Update** action opens the atlas reimport dialog. Detailed import
results remain under **Last import** in the inspector.

Hovering over the canvas outlines the active grid cell (or a tile stamp's full
footprint). The footer shows `Cell column, row` and `Pixel X, Y`, both starting at
zero. A stamp extending beyond the scene gets a red outline. Hovering changes no
scene data; leaving the canvas clears the feedback.

Multiple scenes share imported art and persist independently. Tile regions larger
than one grid cell become multi-cell stamps. All atlas regions remain visible;
tile regions whose dimensions do not divide evenly into the scene grid are
disabled with an explanation. Sprites keep their native dimensions on any scene
grid. Click to place their declared origin. Select a sprite to drag it, move it
one pixel with arrow keys, or remove it with Delete. Sprite edits participate in
Undo/Redo, unsaved-change prompts and Save/Reopen. Existing imported sprite atlases
work without reimport; their portable sprite tilesets are created on the next
explicit project mutation. Palette assignments and animation timing remain in
project metadata. Sprite playback and movement preview follow in #15.

The **Layers** list shows the topmost layer first. Choose a layer to edit its
contents, rename it, move it **Up**/**Down**, or **Hide**/**Show** it. **+ Tile layer**
and **+ Object layer** add empty layers above the existing stack. **Delete layer**
removes that layer and its contents; Undo restores both. Keep at least one layer;
scenes support up to 128 layers. Layer IDs remain stable across rename/reorder/save.
Layer changes share the same undo history as painting and sprite edits. Save keeps
the current session's history; reopening starts a new history.

Tile painting, fill, erase and selection movement affect only the active tile
layer. Sprite placement, hit testing, dragging and deletion affect only the active
object layer. Hidden layers retain their contents but cannot be edited. Choosing
a brush of another kind activates the first visible compatible layer, if one
exists; create a compatible layer if needed. Selecting another layer clears the
canvas selection. The active layer is a session choice; reopening starts on the
first compatible layer chosen by the initial brush. Layer order and visibility
are saved in the map and retained through atlas updates.

**Snap to grid** starts enabled. Sprite placement, asset drops and dragging snap
the sprite's declared origin to the nearest grid intersection inside the scene.
Hold Alt to temporarily bypass snapping, or turn the toggle off for free pixel
placement. Arrow keys always nudge sprites by one pixel. Selecting an existing
sprite leaves its position unchanged; toggling snapping does not move saved art.
Tiles always move in whole grid cells.

## Objects and custom properties

Choose **Spawn point** or **Trigger area** in the library, then click the canvas.
These create ordinary point/rectangle objects with initial classes `spawn` and
`trigger`; the classes are labels for your project and execute no game logic.
An object layer is required. If a tile layer is active, choosing an object brush
activates the first visible object layer. Markers need no imported artwork.
Rectangles start one grid cell wide/high (clipped to the scene edge).

Use Select to pick and drag objects on the active layer, or choose one in the
inspector's object list. The list also selects objects covered by other artwork.
Arrow keys nudge one pixel. Erase, Delete or **Remove selected object** removes
the selected/hit object. Points and rectangles follow the same snap/Alt rules as
sprites. Rectangle movement stays within the scene. Hiding a layer disables its
object editing without removing its contents.

**Edit selected object** opens a dialog for its stable, read-only ID, name, class,
pixel position and custom properties. Rectangles also expose width and height;
sprites expose an optional per-instance origin measured from their image's top
left. **Use atlas origin** starts checked; clear it to override that instance
without editing shared artwork. Overrides can reach image edges. Points use their
exact position as the anchor; rectangles use their top-left corner. Positions and
rectangle dimensions use whole pixels; rectangle bounds must stay in the scene.
Sprite artwork can extend beyond the scene while its anchor remains inside.

Add/remove property rows and choose `string`, `int`, `float` or `bool`. Boolean
values use checkboxes; numbers remain typed numbers, including whole-valued
floats. Integer values must be safe JavaScript integers (±9,007,199,254,740,991);
floats must be finite and within that range. Names must be nonblank, unique per
object and at most 100 characters; strings can contain up to 4096 characters.
Each object supports 128 properties and each layer up to 4096 objects. Maps must
fit within 4 MiB after serialization; oversized saves leave existing files intact. Changing a
property's type resets its draft value; enter the desired value before applying.
Property order is insignificant and saved properties are sorted by name.

**Apply object changes** validates and commits the whole dialog as one undoable
edit. An error keeps the dialog and scene intact; **Cancel** discards the dialog's
changes. Object creation, movement, deletion and metadata editing share layer
undo/redo and survive Save/Reopen, atlas reimport and moving the project directory.
Save preserves session history; reopening starts a new history.

## Terrain and tile collision

Choose a tile or sprite brush, then **Tile terrain & collision…**. For multi-cell
regions, select the cell to edit. Metadata belongs to that tile in that grid's
shared tileset: all scene instances share it, while 8/16/32px grids have separate
classifications and collision footprints. Sprite tiles use native image sizes.

Enter a free-form **Terrain classification** such as `grass`, `water` or `wall`.
This is a custom classification, not a Tiled Wang set or automatic terrain brush.
**Solid** without custom shapes uses the full tile bounds. **Add shape** supports
rectangles, ellipses and polygons. Edit rectangle/ellipse X/Y/width/height in
whole pixels from the image's top-left. Polygon coordinates are `x,y` pairs
separated by spaces, such as `0,8 8,8 8,0` for an 8px slope. Points may reach the
image edges. Polygons must have 3–32 unique vertices, nonzero area, no redundant
collinear vertices and no self-intersections. Each tile supports 32 shapes.
Shape IDs survive edits; removing a shape retains the next-ID counter.

The preview shows the artwork under the classification tint and collision
geometry. **Undo draft edit**/**Redo draft edit** work within this dialog;
**Cancel** discards the draft. Save or undo changes before choosing another cell.
**Save shared tile metadata** commits the tileset and project inventory together.
It preserves an unsaved scene and its scene undo history. Main-canvas Undo/Redo
controls scene edits; it does not reverse saved shared tileset changes. Reopen
the dialog to edit saved metadata. A conflict leaves the draft available for
review; cancel and reopen the scene to refresh project revisions before retrying.

The canvas **Terrain** and **Collision** toggles display metadata on visible tile
layers and sprite instances. Terrain colors are deterministic per label. Custom
collision shapes define the displayed footprint even if **Solid** is unchecked;
with no shapes, the flag supplies the full-tile fallback. Sprite collision is
translated by each instance's actual origin, including overrides. These are
editing overlays; no movement or collision simulation runs in this milestone.

Forge authors and validates this data. gbc-atlas supplies artwork, regions and
animation metadata; it does not generate structured terrain or collision.
Authored metadata is recorded separately as each project atlas entry's `metadata`
(by grid and semantic tile ID), then serialized into external `.tsj` files as
`forge:terrain` (string), `forge:solid` (bool) and `forge:next_shape_id` (int) tile
properties. Shapes use Tiled tile `objectgroup` geometry. A solid tile with no
custom shapes materializes a full-bounds rectangle in Tiled. Imported atlas
manifests, PNGs and provenance stay unchanged. Compatible artwork reimports
preserve metadata through stable tile identities, including sprite metadata.
Generated tilesets remain managed project assets: direct external edits produce
revision conflicts rather than being overwritten. Whole-project moves retain the
data and relative image references.

To remove a scene, choose it in the scene list and select **Delete scene**. The
confirmation identifies the scene and warns if deleting it will discard its
unsaved edits. **Keep scene** cancels without changing anything. Confirming removes
that scene's map and listing together; shared atlases and other scenes remain.
Deleting a different scene preserves the open canvas and its unsaved changes.
Deleting the open scene returns to the empty workspace. A scene or project that
changed since review produces a conflict instead of silently deleting newer data.
Scene deletion cannot be undone with the editor's Undo button; interrupted
deletion uses the same conflict-aware transaction recovery as other project writes.

Each atlas under **Project assets** has **Update** and **Delete** actions.
Deleting confirms the atlas ID and removes only its managed project copies;
original source files and undeclared files in its asset folder stay untouched.
Saved scenes using its tiles or sprites block deletion and are named in the error.
Remove those placements and save the affected scenes first. Unsaved placements
in the open canvas also block deletion. If undo/redo history could restore this
atlas, the dialog warns that those histories will be cleared; current edits using
other atlases remain intact. Deletion rewrites remaining maps' tileset references
and removes the asset inventory together in a revision-checked transaction.
Atlas deletion cannot be undone with the editor's Undo button.

Atlas selection uses the browser's folder picker. Choose the folder containing
one or more `*.atlas.json` manifests and their declared PNGs. Forge lists the
manifests it finds; a single manifest is selected automatically. Files in nested
folders are supported. Choose a focused atlas folder: discovery is limited to
4096 entries and eight directory levels, and ignores hidden folders.

The browser requests read access only. Until you confirm **Import atlas**, Forge
only lists filenames. On confirmation it reads and uploads the selected manifest
and its declared PNG, then the server performs the same validation and atomic
project update used for path imports. Other source files are not uploaded.
There are no native helper processes, Tk requirements or picker polling routes.
Browsers without `showDirectoryPicker` use a standard directory-upload input.
Cancelling preserves the previous selection. **Enter a manifest path instead**
remains available for direct local path imports.

## Atlas bundle compatibility

The required files are a version-1 gbc-atlas manifest and its declared PNG, with
relative paths contained in the manifest directory. Atlas IDs and region names
must be lowercase C-style identifiers beginning with a letter, up to 64 characters.
The importer validates duplicate region/animation names, references, palettes,
origins, region coverage, overlapping kinds, sprite pairs and pixel colors.

PNG support covers non-interlaced 8-bit RGB/RGBA and indexed PNGs with 1, 2, 4 or
8-bit indices. Dimensions must be multiples of eight within 8–256 pixels, with at
most 256 eight-pixel cells. Tiles are opaque; sprites allow binary transparency.
Unsupported encodings, corrupt PNGs and out-of-palette pixels fail before project
data is changed. Manifest inputs are limited to 1 MiB and PNGs to 4 MiB.

Optional `source`, `preview` and `review_images` files need not be present. Their
declarations and other original metadata are retained as provenance in the project
manifest, while the copied runtime atlas manifest refers only to the copied PNG.
Approval metadata is retained; importing art does not require approval or generate
game code. Absolute paths, escaping paths and symlinks in bundle declarations are
rejected. Imports read explicitly selected files; output stays inside the project.

## Reimport

Importing an existing atlas ID requires checking **Replace this atlas ID**.
An unchanged reimport preserves all asset identities and placements. Compatible
artwork, palette, origin, animation and sheet-position changes update shared assets
and produce a change report. New regions receive new tileset IDs. Removed regions
or changes to an existing region's dimensions or tile/sprite kind reject the
entire reimport. Keep the previous bundle or use a separate atlas ID while those
changes are unresolved. Renaming an atlas ID creates a separate import.

Cells use `(atlas ID, region name, column offset, row offset)` identities.
External tileset local IDs are append-only. Map GIDs are derived from those local
IDs, with zero representing an empty cell. Import/reimport updates all maps in the
same transaction when new tileset ranges are needed; no generated GBC tile indices
are involved. A scene open in another tab may therefore need to be reopened after
an import before it can be saved.

## Project and Tiled files

```text
world/
  forge.project.json
  scenes/<scene-uuid>.tmj
  assets/<atlas-id>/atlas.png
  assets/<atlas-id>/<atlas-id>.atlas.json
  assets/<atlas-id>/grid-8.tsj       # also grid-16.tsj and grid-32.tsj
  assets/<atlas-id>/grid-8/<id>.png  # cropped tile images
  assets/<atlas-id>/sprites.tsj     # independent native-size sprite tiles
  assets/<atlas-id>/sprites/<id>.png
  .forge/history/                  # transaction records and recovery backups
```

The version-1 Forge manifest records project identity/name, scene UUIDs/names and
relative paths, original atlas metadata, persistent tileset identity mappings,
asset byte revisions and preview defaults. The project UUID and scene UUIDs survive
directory moves. Map tileset paths are relative to each map; image paths are
relative to each tileset. Move or back up the entire directory, including `.forge`.

Open a saved `.tmj` directly in Tiled. The supported format is Tiled JSON 1.10:
finite orthogonal square-grid maps, 1–128 named tile/object layers in bottom-to-top
file order, boolean layer visibility, full opacity and zero layer offsets. Tile
layers use uncompressed JSON-array GIDs and external image-collection `.tsj`
tilesets with PNG tiles. Default tile rendering order is right-down. Empty cells
use GID zero; cells on upper layers leave lower artwork visible when empty.

Object layers use index draw order and support native-size sprite tile objects,
point objects (`point: true`, zero width/height) and positive-size rectangles.
Names map to Tiled `name`, classes to Tiled `type`, and custom properties to
Tiled typed property arrays. Sprite references use stable atlas/region identities.
Object IDs are unique across the whole map; layer IDs are unique and their next-ID counters are retained after deletion.
Sprite origins use whole pixels relative to their image. For an origin `(ox, oy)`
and sprite height `h`, Forge writes Tiled's bottom-left object coordinates as
`(x - ox, y - oy + h)` and reverses that conversion on reopen. Tile coordinates
are zero-based columns/rows; tile selections move in grid cells. Original
Ground/Sprites maps remain readable without migration. A sprite origin override
is stored as two reserved integer properties, `forge:origin_x` and
`forge:origin_y`. Forge reverses the same coordinate conversion using those values
on reopen. User property names starting with `forge:` are reserved. Without an
override, an atlas origin update changes the artwork anchor while preserving the
instance's scene position. Point/rectangle coordinates map directly to Tiled X/Y.

Polygons, polylines, ellipses, text, templates, per-object hiding, fractional
coordinates, rotation/flip flags, file/object/color/class property types,
group/image layers, offsets, infinite maps, embedded tilesets and compressed/base64
tile data are unsupported. Forge rejects unsupported data before saving instead
of dropping it. Layer, object, terrain/collision and portable export authoring
complete #14;
sprite playback and movement preview follow in #15.
This is a supported subset for Forge-created projects, not a general-purpose
arbitrary Tiled-file importer. See the
[Tiled JSON format reference](https://doc.mapeditor.org/en/stable/reference/json-map-format/)
for the native field definitions. Tile collision object groups support the
rectangle, ellipse and simple-polygon subset described above; other collision
geometry and arbitrary tile properties are not imported from external tilesets.

## Portable export

Choose **Export…** to download a ZIP, then choose **Open scene** or **Whole
project**. The source project and editor undo/redo history stay unchanged.

- **Open scene** exports the open scene and the external `.tsj` tilesets and PNGs
  referenced by its map. Other scenes, original atlas bundles, Forge history and
  unrelated workspace files are excluded. A map can reference unused tilesets;
  those sets and all their tile images are kept to preserve the map's references.
- **Whole project** exports every saved scene, all managed assets and
  `forge.project.json`. After extraction, open any `scenes/*.tmj` in Tiled, or
  launch Forge on the extracted directory to continue authoring. This snapshot
  includes artwork/provenance and metadata for all grids, including unused assets.
  Transaction history and undeclared workspace files are excluded.

When the open scene has unsaved changes, **Include unsaved edits from the open
scene** starts checked. It replaces only that scene's map in the downloaded
snapshot, in either export scope. Uncheck it to export the saved version. The
canvas remains unsaved either way; export never calls Save. Other scenes use
their saved on-disk contents. A saved scene is required for scene export; whole
projects can be exported before creating any scenes.

Extract the ZIP and keep `assets/` alongside `scenes/`. Move the entire extracted
directory to preserve relative paths: map tilesets resolve relative to each map,
and tile PNGs relative to each tileset. Single-scene exports are Tiled bundles;
only whole-project exports include a Forge project manifest. No original import
folder, connector, running server or network access is needed to open exported
maps in Tiled. Grid, terrain and collision view overlays are not baked into art;
terrain/collision properties and geometry remain editable in the tilesets.

Every ZIP contains `EXPORT.md` with offline usage/subset notes and `export.json`
with scene names/IDs, source byte revisions, canvas-override flags and SHA-256
checksums for every other exported file. Asset paths and ZIP entry order are
stable; identical snapshots produce identical ZIP bytes with fixed entry times.
Scene/layer/object IDs, ordering, visibility, typed properties, sprite origins,
terrain classifications and collision metadata retain their supported semantics.

Export validates maps and follows their dependency closure using declared
workspace assets. Missing/undeclared dependencies, unsafe paths, unsupported map
or tileset features, invalid images and dimension mismatches stop the download
with an error identifying the affected path. Restore missing assets or reopen
and review changed files before retrying; unsupported Tiled features must be
removed or represented in the documented subset. External asset edits and stale
project/canvas revisions produce conflicts. Files are captured under the project
transaction lock and checked again before archiving; a detected direct external
edit stops the download. Exports are limited to 256 MiB of
uncompressed file data; choose one scene or reduce imported assets for larger
projects. Export never repairs, rewrites or deletes source files.

## Conflicts and recovery

Saves and imports check manifest, scene and asset byte revisions under a shared
filesystem transaction lock. Files are published by atomic replacement, with
durable before/after records for coordinated updates. Restarting recovers an
interrupted transaction. If recovery detects a later external edit, it stops and
preserves that edit instead of overwriting it. Retain the workspace and backups
while resolving such a conflict.

If a scene changes externally, saving shows a conflict and leaves unsaved edits
in the browser. Preserve those changes before choosing **Open scene** to reload.
Externally changed managed assets block mutations; restore those files and use
explicit atlas reimport for artwork updates. Do not edit generated tilesets or
identity mappings manually.

The server binds only to loopback, validates the Host header and requires a
per-session mutation token. Standalone projects are the supported product
direction. Connector v1 launchers, `.scene.json` documents and game Apply/build
integrations are legacy code, with no compatibility guarantee for new work.
The standalone editor does not execute a connector or expose game Apply operations.

## Verification

`make lint test build check-dist` checks code, persistence, import validation,
Tiled round trips, revision conflicts, interrupted recovery and wheel contents.
`npm run test:standalone` launches its own disposable workspace and local Chrome,
then exercises create/import/paint/save, layers, generic objects, typed properties,
origin overrides, terrain/collision editing and overlays, reimport, restart, a
directory move, scene/project ZIP downloads (including unsaved snapshots), and
external-edit conflicts. Pass a Chrome executable after `--` on other
platforms. Screenshots are written under `build/reports/scene-editor/`.

With official Tiled binaries installed, also run:

```sh
poetry run python tests/tiled_interop.py --tiled /path/to/Tiled --rasterizer /path/to/tmxrasterizer
```

This opens and exports a Forge map with Tiled, reopens the exported data in Forge,
and verifies generic objects/properties/origin overrides, terrain properties and
collision geometry in exported tilesets, plus rasterized layer, sprite, tile and
empty pixels. It also extracts and moves scene/project ZIPs, removes the original
workspace/imports, then verifies the exported maps and dependencies with Tiled.
Validated with Tiled 1.12.2.
