# Scene Forge 0.29.0

Prepared for [milestone 15](https://github.com/cliffom/gbc-scene-forge/milestone/15).
Tagging, publication and deployment are separate actions.

## Artwork in the main editor

Scene and Artwork documents share the main workbench and Library. Open native
artwork directly without a scene; retain unsaved pixels, history, selection and
viewport while switching documents. Scene composition and pixel editing expose
contextual tools. Creation and existing-artwork copying use separate flows;
frames and animation occupy a dock beneath the canvas, with optional Properties
and focused change review. The active document uses the existing context bar.
Opening a pose selects it; saving retains the document and Undo/Redo against its
new saved base. Setup omits document navigation until artwork is retained;
asset IDs follow normalized names with optional manual overrides. Returning to
a document rebinds its selected timeline and clears review output from other
assets. Saved frame identities remain in retained Undo history so earlier pixel
and animation edits stay checkpointable. Offline work downloads include live
layout edits, and scene preview controls refresh when non-looping playback ends.
Existing version-1 static artwork remains supported.

Create tile and sprite sheets with stable frames, origins and named timed
sequences. Use frame editing, tile repetition review, onion skinning, playback,
frame stepping and generated APNG reviews. Pixel and sequence changes share
artwork Undo/Redo and conflict-aware checkpoints. Native manual, agent and mixed
workflows require no third-party external artwork tools or gbc-atlas preparation.

## Agent authoring and representation changes

MCP exposes sheet creation/copying/layout editing, exact pixel reads, frame reviews
and APNG animation reviews. Optional compact candidate handles avoid repeating
full raster envelopes; project-local sidecars survive restarts and support explicit
list/export/retain/release recovery. Limits are 256 records/64 MiB with no automatic
expiry. Export candidate envelopes before moving projects or releasing handles.

Copy complete existing artwork into native sheets without resampling or losing
hidden RGBA, frame origins or sequence timing. Overlapping sprite/tile frames can
share the same source pixels. Explicit selected-placement conversion reviews an
exact static sprite-to-tile mapping, preserves drawing order and unselected
references, and commits atomically. Non-grid-aligned bounds, differing pixels or
gameplay metadata reject conversion rather than silently changing the scene.

Scene resize overviews compose tiles before scaling to avoid fractional-scale
seams; temporary raster resources are released immediately.

Creating unused native artwork retains unrelated saved scene bytes/revisions.
Reviewed scenes remain guarded against competing writers, including unchanged maps.

## Compatibility and upgrade

Project manifest version stays 1; sheets use editable descriptor version 2.
Older Forge versions cannot read these new sheets. Keep using 0.29.0 or newer once
they are saved. Portable project exports retain exact pixels, frame identities,
origins and all sequence definitions. Plain Tiled supports one looping sequence
per starting tile: non-looping or ambiguous sequences are reported as skipped,
with their complete Forge metadata retained. Static pose conversion explicitly
retains source animations rather than transferring their timing onto scenery.

See the [sheet contract](UNIFIED-EDITOR-DESIGN.md), [pixel guide](user/pixel-artwork.md),
[MCP reference](MCP.md) and [validation record](VALIDATION.md).
