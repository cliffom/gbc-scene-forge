# Create and edit pixel artwork

Choose **Create / edit pixels…** in the Artwork Library. For an existing scene
placement, select its tile cells or sprite and
choose **Edit artwork…** in the Selection inspector. Select the sprite's object
layer first. Both entry points open a separate artwork document; scene undo and
unsaved scene edits remain intact.

## Start a tile or sprite

Choose **Create blank artwork**, a name and a fresh lowercase asset ID (letters,
digits and underscores, beginning with a letter). Tiles are square 8, 16 or 32
pixels. Static sprites use multiples of eight up to 256 × 256, with origin 0, 0.
Choose **Duplicate as new artwork** to copy an existing tile cell or sprite.
Tile source column/row are zero-based within its region, using the chosen tile
size. Copies keep supported metadata and sprite origins.

Imported artwork stays under import/reimport control and must be copied before
pixel editing. Native artwork also offers **Edit shared artwork**: saving changes
every placement that refers to that asset. Duplicate first when you want independent
artwork. Ordinary copies appear in the Library after saving for separate placement.

## Make a variation for selected placements

Save the scene, switch to Select, and select matching tile cells or sprite objects
on one active layer with **Across layers** off. Open **Edit artwork…**, choose the matching source cell/sprite,
enter a fresh asset ID and choose **Create variation for selected placements**.
Every selected placement must use that source; tiles must use the chosen source
grid. Select at most 256 placements. Expand **Placements this variation will replace**
to inspect the captured scene/layer/cell or object locations.

Draw the variation, then review. The before image shows the original pixels;
the scene comparison shows the selected replacements without adding a temporary
placement. The reference count describes the original asset, and the replacement
count describes the selection. Other placements, reusable stamps and object
definitions keep the original. Saving commits the new artwork and selected
references together, preserving tile transforms, sprite origins and properties.
The saved scene reloads with fresh scene history so later saves retain replacements.

Unsaved scene work must be saved or reconciled before replacement. If another
writer changes a selected scene, review/save and recovery reject its stale base;
pixels and checkpoints remain available for download. Forge never applies a
variation to a different or newer selection automatically. Browser selections
come from the open saved scene; MCP may explicitly select locations across scenes.

## Draw and revise

The toolbar exposes Pencil, Eraser, Flood fill, Eyedropper, Line, Rectangle
outline, Select rectangle and Move selection directly as icons. Hover for names;
Tab reaches the selected tool and arrow keys choose adjacent tools. A pointer
choice returns focus to the canvas. History, clipboard and transforms use the
same icon style as scene commands; gold marks the selected drawing tool.

Color, Opacity and the checkerboard **Transparent** button sit together; Zoom and
Pixel grid form a separate view group. Shared-edit and selected-variation scope
remain available in a scrolling controls area when space is limited; save actions
stay beneath the canvas. Expand **Drawing & keyboard help** for occasional
instructions.

Drag a rectangular selection, then move it with the Move selection tool or arrow keys
while the canvas has focus. Copy/Paste uses the artwork's own clipboard and pastes
at the selection's top-left (or 0, 0 without a selection). Flip and clockwise
quarter-turn rotation affect the selection, or the whole artwork when deselected.
A rotated rectangle must fit without resizing the document; otherwise select a
smaller area or move it inside the bounds first.

Opacity supports exact alpha values from 0 (transparent) to 255 (opaque), including
partial transparency for PNG compositing. **Transparent** toggles alpha to zero
and changes to **Resume color**; click again to restore the previous nonzero
opacity. Choosing a color also resumes painting at that opacity. Eraser writes
transparent black. The eyedropper and the first 64 distinct artwork palette
swatches preserve exact RGBA, including hidden RGB
beneath transparency. GBC target profiles do not restrict these colors. Zoom uses
nearest-neighbor pixels; toggle the pixel grid as needed.

Each stroke, fill, paste, move or transform is one undo operation. Artwork keeps up
to 100 operations within a 16 MiB history budget, independently of scene history.
Use Undo/Redo or ⌘/Ctrl Z and Shift Z (Ctrl Y also redoes); ⌘/Ctrl C/V copies/pastes.
Escape during a stroke, pointer cancellation, lost capture or window blur cancels
that gesture. Escape otherwise returns to Scene after checkpointing unsaved work.
Keyboard shortcuts in text/color/number inputs retain their native behavior.

## Review, save and recover

**Review current pixels** compares the saved and proposed artwork and reports the
number of affected saved references across scenes, stamps and definitions. With
**Preview in the open scene** checked, the preview includes local unsaved scene
edits, within a 256 × 256 view. Expand **Scene preview position** to set pixel X/Y. Existing placements retain
their transforms and origins. New artwork is temporarily placed at that position;
a tile spanning several scene cells is reviewed in full when its size divides
into the scene grid. Temporary placement never changes the scene. Uncheck scene
preview for isolated review, including artwork incompatible with the open grid.

**Save reviewed artwork** commits the exact reviewed pixels against the project,
artwork and scene bases. Further pixel edits invalidate the review. Save adds or
updates artwork and reloads the Library/images without adding a scene undo item.
After a successful save, place new artwork from the Library separately. The save,
download and discard actions remain below the independently scrolling canvas and
review panel, including in short desktop windows.
If isolated artwork review finds that another writer changed the open scene,
the artwork can still save, but local scene edits retain their original conflict
guard. Reconcile the scene before saving it; artwork saves do not authorize
overwriting newer scene content.

Completed edits checkpoint after a short debounce into the project's
`.forge/artwork-drafts/` directory, separately from scene checkpoints. Checkpoints
capture completed edits; unfinished or canceled gestures are excluded. Close waits
for the current checkpoint; a failed checkpoint keeps the document open and offers
**Download work**. Leaving before a checkpoint finishes prompts the browser's
unsaved-work warning, including after Undo returns to the saved pixels while an
older checkpoint still needs updating. Disposing an editor preserves completed checkpoints.
If a checkpoint response is lost, the warning remains active until Forge checks
the owned checkpoint's stored revision and pixels. A later checkpoint or explicit
discard performs that check before writing or deleting; failed checks retain local work.

Choose New / open artwork to see recoverable records. **Recover copy** checks the
original saved base and opens unsaved pixels under a fresh draft identity; it
retains the original record. **Delete checkpoint** explicitly removes a listed
record; **Discard this draft** removes the current working record. Save and discard
of a recovered copy leave its original record available until explicitly deleted.
Recovery restores pixels and bases, without claiming a durable undo stack.

If another browser or MCP writer saves first, review/save or restoration rejects
the stale base. Local pixels and existing checkpoints remain available. Download
the work, inspect the latest saved asset, and reconcile explicitly; Forge never
rebases stale pixels or overwrites another writer automatically. Downloaded JSON
is an inspection/reconciliation record, not an automatic import format. Artwork
drafts are bounded to 64 records, 4 MiB each and 64 MiB total per project, and are
excluded from portable exports.

![Shared artwork review on desktop](../images/pixel-editor-133-desktop.png)

![Compact artwork dialog](../images/pixel-editor-133-compact.png)

For pixel/service limits and revision semantics, see the
[editable artwork contract](../EDITABLE-ARTWORK.md). The
[MCP authoring loop](../MCP.md#native-artwork-authoring) uses the same candidate and
save services. See the [mixed workflow evaluation](../evaluations/artwork-workflows.md)
for the exercised tasks, evidence and limits.

## Sheets, animations and the shared workbench

Use **New / open artwork** in the document bar, or **Open artwork** under a Library
thumbnail, even before creating a scene. Scene and artwork use the same main
workspace. **Return to scene** checkpoints artwork and retains its tab; selecting
that tab restores its history, selection, drawing tool, zoom and viewport.
A failed checkpoint keeps the current document open. Saving or discarding closes
its tab. Up to 16 artwork documents can remain open at once.

For a tile sheet or character sheet, set the overall Width/Height, then Frame
width/height and sprite origin, and choose **Create blank sheet**. Frame dimensions
must divide the sheet exactly; use at most 128 frames in a raster up to 256 × 256.
Choose **Copy entire sheet to native artwork** to migrate existing art without
resampling: complete source pixels, frames, origins and sequence timing are copied.
Unsupported dimensions/layouts reject the copy rather than changing the artwork.

In the Artwork inspector, expand **Sheet frames & animation**. The canvas initially
shows the whole sheet with frame boundaries and pink origin crosses. Select a
frame and check **Edit selected frame** to constrain pixel tools to it. Rename
frames for recognizable poses. Tile frames show a 3 × 3 repetition preview for
checking edges. Toggle frame editing off to work across the sheet again.

Create sequence IDs such as `idle`, `walk`, `jump` and `duck`. Choose a frame and
**Append selected frame**, adjust millisecond durations, reorder with Up/Down, and
set Loop. Sequence frames must share dimensions, kind and origin. Play toggles
Pause; Step advances one frame. Onion skin overlays the preceding sheet pose in
frame mode. **Generate animation review** produces a self-contained timed APNG
and enables saving the exact reviewed pixels and timing. Layout and pixel edits
share artwork Undo/Redo; changes require another review.

Saving a new sheet adds every frame to the Library. Paint tile frames onto tile
layers or place sprite frames on object layers. Existing scene animation preview
can select the saved sequences. The complete portable project retains all named
sequences; plain Tiled's one-loop-per-starting-tile limitation is reported during
export. Non-looping sequences retain their Forge definition without being changed
into looping Tiled animations.

Current workspace captures: [sheet overview](../images/unified-player-sheet.png),
[frame editing and timeline](../images/unified-player-frame.png), and
[800×640 layout](../images/unified-player-compact.png). The small stick-figure
fixture demonstrates poses and timing, not production artwork quality.
[Open its generated walk review](../images/native-player-walk.apng) in an
APNG-capable viewer; this sequence plays once with 180 ms and 120 ms frames.

## Change sprites into tile scenery

For the same pixels to serve both purposes, choose a sprite frame and **Add tile
representation of selected frame**. Both rectangles share pixels in that document;
editing either updates both. A copied sheet has independent pixels from its source.
Review and save the tile representation first.

Save the scene and select sprite objects on one object layer. Choose **Convert
selected sprites to tiles…**, select the matching saved tile region, explicitly
acknowledge static scenery, then **Review mapping**. Inspect the origin-adjusted
cell locations and before/after images. **Replace reviewed placements** updates
only that selection atomically, retaining unselected references, source artwork
and source animation sequences. Intervening object drawing order is preserved.

Target pixels and dimensions must match exactly, and origin-adjusted bounds must
align to the scene grid and fit inside it. Gameplay class/properties or definition
instances are rejected rather than discarded. This converts the selected pose to
static scenery; it does not silently convert animation timing into tile playback.
Stale scenes/assets reject review or commit without partial changes.

[Reviewed placement conversion](../images/sprite-tile-conversion.png) shows the
before/after scene and the explicit tile coordinates to replace.
