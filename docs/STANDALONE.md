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
project metadata. General layer authoring and playback are later milestones.

**Snap to grid** starts enabled. Sprite placement, asset drops and dragging snap
the sprite's declared origin to the nearest grid intersection inside the scene.
Hold Alt to temporarily bypass snapping, or turn the toggle off for free pixel
placement. Arrow keys always nudge sprites by one pixel. Selecting an existing
sprite leaves its position unchanged; toggling snapping does not move saved art.
Tiles always move in whole grid cells.

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

Open a saved `.tmj` directly in Tiled. The initial supported format is Tiled JSON
1.10: one finite orthogonal square-grid tile layer named `Ground`, ID 1, visible
and fully opaque, with uncompressed JSON-array GIDs, external image-collection
`.tsj` tilesets and PNG tiles. Default rendering order is right-down. Native-size
sprites use an optional `Sprites` object layer (ID 2, index draw order), with
unscaled, unrotated tile objects and stable atlas/region references. Forge converts
atlas origins to Tiled's bottom-left object coordinates and back. Other object
types, custom properties, fractional coordinates, rotation/flip flags, additional
layers, offsets, infinite maps, embedded tilesets and compressed/base64 tile data
are unsupported. Forge rejects
unsupported data before saving instead of dropping it. This is a supported subset
for Forge-created projects, not a general-purpose arbitrary Tiled-file importer.

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
per-session mutation token. Existing connector v1 launchers, `.scene.json`
documents, original snapshots, reviewed Apply and Undo Apply retain their current
formats and behavior. Standalone projects do not execute a connector or expose
game Apply operations. Automatic conversion between those document formats is
outside this milestone.

## Verification

`make lint test build check-dist` checks code, persistence, import validation,
Tiled round trips, revision conflicts, interrupted recovery and wheel contents.
`npm run test:standalone` launches its own disposable workspace and local Chrome,
then exercises create/import/paint/save, two scenes, reimport, restart, a directory
move and an external-edit conflict. Pass a Chrome executable after `--` on other
platforms. Screenshots are written under `build/reports/scene-editor/`.

With official Tiled binaries installed, also run:

```sh
poetry run python tests/tiled_interop.py --tiled /path/to/Tiled --rasterizer /path/to/tmxrasterizer
```

This opens and exports a Forge map with Tiled, reopens the exported data in Forge,
and verifies actual rasterized tile and empty pixels. Validated with Tiled 1.12.2.
