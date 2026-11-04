# Unified Scene and Artwork editor

Implementation contract for [milestone 15](https://github.com/cliffom/gbc-scene-forge/milestone/15)
and [#149](https://github.com/cliffom/gbc-scene-forge/issues/149). The
[static artwork contract](EDITABLE-ARTWORK.md) still governs version-1 documents,
exact pixels, review receipts and conflict-aware checkpoints. This document adds
sheets, sequences, document navigation, compact candidates and conversion.
Observed results belong in [Validation](VALIDATION.md).

## Shared editor shell consolidation

[Milestone 22](https://github.com/cliffom/gbc-scene-forge/milestone/22) consolidates
the delivered document contexts around the scene editor layout. The initial
[#194](https://github.com/cliffom/gbc-scene-forge/issues/194) increment contributes
both canvases to one workbench and their contextual panels to one collapsible
Inspector. The artwork title lives in the document bar; opening artwork no longer
replaces the workbench with a nonmodal dialog. Setup remains a focused creation/
source surface inside the shared workbench.

Controllers keep distinct scene/pixel models and histories. Shell contributions
supply presentation nodes and a focus callback; active-document state fences
scene commands, focus and refresh. Leaving artwork retains its existing guarded
checkpoint and scene-return behavior. One Documents control retains editing context;
one command strip and document-bar Save route explicit capabilities to the active
owner. Common shortcuts respect native text editing and modal focus. Artwork Save
opens its exact review and requires confirmation; no duplicate footer Save remains.
Richer contextual panel interaction is subsequent milestone scope; the bounded
frame/animation dock remains.

## Foundation and ownership

A project is one world: scenes reference a shared library of tiles and sprites.
The Scene workspace arranges those references alongside geometry and gameplay
objects. The Artwork workspace edits their reusable pixels. Both interfaces use
the same domain services; manual, agent and mixed workflows require no third-party
external artwork tools or gbc-atlas preparation. Existing imports remain optional.

One native sheet owns one PNG raster, not a collection of independently writable
frame images. Frame rectangles address that source. Overlapping sprite and tile
rectangles intentionally share pixels: editing either representation changes
both. Copying an entire sheet creates an independent raster and document identity.
There is no implicit cross-document pixel sharing or repacking.

`artwork/sheets.py` owns layout validation and derivation; `documents.py` owns
saved-base validation and transactions; `animation_review.py` owns bounded APNG
encoding. `candidates.py` owns recoverable immutable candidate handles and
`conversion.py` owns selected sprite-to-tile placement conversion. Transports
forward these services. Browser sheet controls and playback belong to
`artwork/sheet-editor.mts`; pixel history and serial checkpoints remain separate
from scene state.

## Native version-2 sheet contract

Project/atlas manifest versions remain 1. An editable descriptor may use version
1 (one static region) or 2 (one sheet with explicit frames/sequences). Version 2
retains all version-1 fields and adds `frames` and `sequences`. Its root `region`
identifies a primary frame of the root `kind`; root origin is `[0,0]`. Per-frame
origins control placement. No automatic migration rewrites existing static assets.
Older Forge versions cannot read version-2 documents; use 0.29.0 or newer.

```json
{
  "frames": [
    {"id":"idle","name":"Idle","kind":"sprite","x":0,"y":0,"width":8,"height":16,"origin":[3,12]},
    {"id":"step","name":"Step","kind":"sprite","x":8,"y":0,"width":8,"height":16,"origin":[3,12]},
    {"id":"idle_tiles","name":"Idle tiles","kind":"tile","x":0,"y":0,"width":8,"height":16,"origin":[0,0]}
  ],
  "sequences": [
    {"id":"walk","name":"Walk","loop":true,"frames":[
      {"frame_id":"idle","duration_ms":120},
      {"frame_id":"step","duration_ms":240}
    ]}
  ]
}
```

This fragment supplements the existing identity, name, raster dimensions,
provenance and pixel-format fields; it is not a complete descriptor.

- Sheet axes: multiples of eight, 8..256; literal straight RGBA8, including hidden
  RGB beneath alpha zero. No resampling, color quantization or palette conversion.
- Frames: 1..128, unique immutable lowercase IDs. Rectangles start on eight-pixel
  boundaries and have dimensions divisible by eight, entirely inside the sheet.
  Sprite origins are integer pixels inside each frame; tile origins are `[0,0]`.
- Sequences: 0..64 unique IDs, 1..256 timed entries each, at most 1,024 entries
  total. A duration is an integer 1..65,535 ms; looping is an explicit boolean.
  Repetition and order are literal. Referenced frames must share kind, dimensions
  and origin. Sequence names and IDs do not implicitly bind gameplay actions.
- Existing saved frame IDs, geometry, origin and kind cannot change or disappear.
  Rename/reorder and append are supported. Create an independent copy/variation
  for incompatible layout changes. Sequence edits retain normal revision guards.
- Descriptors retain their 64 KiB limit; candidates use the shared 24 MiB
  [native-artwork budget](EDITABLE-ARTWORK.md#pixels-and-bounds). Bounds reject the whole
  operation. No clipping, partial writes or truncation.

The native atlas manifest embeds the complete descriptor as `sheet`, plus derived
regions (frame ID as region name) and animations (sequence ID as animation name).
Validation checks both representations. External scene references remain
`atlas/frame` for sprites and `atlas/frame/x/y` for grid-sliced tiles. Existing
local Tiled IDs survive frame rename/reorder; additions append IDs. No separate
scene identity system is introduced.

Portable project ZIPs include source PNG, descriptor, atlas metadata, exact frame
IDs/origins/sequences, derived tilesets and maps. Transfers remap the embedded
sheet identity together with its descriptor and generated assets. Plain Tiled
can express one looping sequence per starting tile. Non-looping sequences and
ambiguous shared starting frames are reported as skipped, never silently changed
to looping playback; their complete definitions remain in Forge metadata.

## Document navigation and editing

The existing context bar contains an active-document switcher for Scene and up
to 16 retained artwork documents, without a separate permanent tab row. The Library
separates New artwork from opening existing assets. Select then Edit artwork, or
double-click a thumbnail; without a scene, a thumbnail opens artwork directly.
Imported assets open a focused copy flow. Scene placement remains the ordinary
single-click behavior when a scene is open. Opening a frame selects that frame
in a whole-sheet overview, including in an already-open document.

Documents remains available in scene, artwork and setup contexts. Its button
shows the active name and kind; local Saved/Modified/New state and a separate
detected-external-change warning remain visible beside it. The chooser also
contains the saved-scene selector. Creation IDs follow normalized names while
preserving manual overrides.

Switching checkpoints outgoing changed artwork and retains its local model,
Undo/Redo, selection, pixel tool, frame/sequence controls, zoom and scroll.
Restoration rebuilds timeline callbacks after restoring sequence selection.
Timeline rebinding stops pending playback before replacing sequence state,
including Undo/Redo, so timers cannot advance frames from a retired descriptor.
Comparison images, reference summaries, generated animation reviews and receipts
are cleared on restoration; saving requires a fresh document-specific review.
Checkpoint failure blocks switching and retains local work. Scene history remains
owned by its existing session. Saving retains the document, history and viewport while adopting the exact
acknowledged saved base; Undo then compares with that new base. History
snapshots preserve every acknowledged frame identity and geometry while
allowing earlier pixel, name and sequence edits to be undone. Representation-only
history entries which become no-ops are removed. Offline work downloads contain
the live descriptor and RGBA snapshot alongside the last synchronized candidate
and original base, without requiring successful synchronization. Close/discard
removes it; choosing the scene in Documents retains it. A failure during post-save adoption retires
the submitted candidate and reports the committed save rather than making it
editable against a stale base. Dirty inactive documents keep their original saved bases;
external changes do not silently rebase them. Explicit reopen/recovery follows
the existing conflict contract.

Artwork offers whole-sheet overview, frame boundaries and origin crosses,
selected-frame editing, repetition preview for tiles, named sequences,
order/duration/loop editing, Play/Pause/Step, onion skinning and generated APNG
review. Frame mode bounds drawing/fill/selection/transforms to that rectangle.
Frame thumbnails and a bounded animation dock sit below the canvas; properties
and change review are separate optional surfaces. Saved, Modified and New reflect
the document's actual state. Save opens exact-change review and requires explicit
confirmation; an animation receipt alone does not bypass that human confirmation.
Pixel/layout changes share one document history and invalidate review receipts.
Scene and Artwork playback distinguish completion from pausing: Play restarts
completed non-looping sequences at frame zero and resumes paused sequences in place.
The [user guide](user/pixel-artwork.md) describes the controls.

## Lossless migration and representation changes

Copy entire sheet to native artwork / `duplicate_artwork_sheet` copies the full
declared PNG, frame geometry/origins and sequence order/durations/looping. It
retains native frame/sequence display names and copies supported tile metadata
under the new atlas prefix. Source assets and placements stay intact. Sources
outside native size/alignment/sequence bounds are rejected, with no silent crop,
padding, rounding or timing loss. Single-cell/static copies remain available.

Add tile representation overlaps the selected sprite frame using a fresh frame
ID and origin `[0,0]`; pixels remain shared. Save/review this representation before
replacing placements. Merely adding it changes no sprite placements.

Explicit placement conversion uses an already saved target tile region with
identical dimensions and exact RGBA. Select 1..64 sprite objects on one saved
object layer; provide the exact project and scene revisions, destination
`atlas/frame`, object IDs and `acknowledge_static=true`. Each object's effective
origin is subtracted from its position; that top-left must align to the scene
grid, with the entire rectangle inside the scene. The region slices into complete
scene-grid cells, preserving semantic tile identities. No implicit shifting or
padding is permitted.

Conversion reads at most 16 MiB of serialized map input and produces at most
1,048,576 tile cells across output layers, subject to the normal scene bounds.

Review returns mapping locations and before/after PNGs; commit recomputes and
compares the hash-bound plan against the same saved project/assets/scene before
one durable transaction. Object layers split at each selected sprite to retain
exact compositing order, including intervening unselected objects. Unselected
object IDs, source art, sequences and other scenes remain. Class/properties and
reusable-definition instances are rejected rather than losing gameplay metadata.
The required acknowledgment explicitly converts selected poses to static scenery;
source animation timing remains available and is not transferred onto tiles.
Animations of scenery can instead be authored explicitly as tile sequences.

## Compact candidates and animation reviews

MCP create/open/duplicate/edit tools accept optional `compact=true`. Full candidate
envelopes remain supported. Handle input keeps edit output compact. A handle has
`handle` (candidate SHA-256), `revision`, `project_id` and `project_revision`.
Immutable canonical JSON sidecars under `.forge/artwork-candidates/` retain full
pixels, descriptors, dependencies and guards across server restarts. Limits are
256 records and 64 MiB per project, without automatic expiration or eviction.
A full limit rejects new retention while existing records remain exportable.

List recovers handles; export returns the exact full envelope even against a
stale saved base; retain restores an exported envelope; release explicitly removes
one record. Export before release or moving projects: sidecars are excluded from
portable project exports. Missing/corrupt/wrong-project handles reject operations.
No automatic rebasing or replay of an ambiguous save occurs. Exact rectangle reads
remain available without exporting every pixel. HTTP/browser checkpoints remain
independently owned; handles do not mutate browser drafts.

`review_artwork_animation` emits a self-contained APNG resource bound to an exact
candidate and commit review receipt. It uses full RGBA frames, SOURCE blending,
nearest-neighbor scale 1..16, literal millisecond timings and finite/continuous
loop count. Output limits: 1,024 pixels per axis, 4,194,304 total frame pixels and
16 MiB. Review artifacts retain the existing session cache lifetime; candidate
sidecars retain recovery independently. Request a smaller scale/sequence if bounds
are exceeded. Browser review uses the same service.

## Boundaries

Editable pixel layers, automatic interpolation/rigging, third-party document-format
round-tripping, hardware binaries and runtime physics are outside this contract.
No claims of human artistic quality or external Tiled validation follow from the
automated fixtures. See [Validation](VALIDATION.md) for scoped checks and limits.
