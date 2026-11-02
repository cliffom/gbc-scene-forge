# Editable artwork contract

This is the implementation contract for [#129](https://github.com/cliffom/gbc-scene-forge/issues/129)
and [milestone 14](https://github.com/cliffom/gbc-scene-forge/milestone/14).
The shared native service and portable format are implemented by #130 in the
prepared 0.27.0 milestone branch. The browser still creates artwork through import.
Review, MCP, hand editing/drafts and placement variations remain planned behavior
for #131–#134; #135 owns integrated workflow evaluation. This contract itself is
not product-validation evidence; observed checks belong in [Validation](VALIDATION.md).

## Ownership and identities

An editable document owns one static tile or sprite and one RGBA image. It uses
the existing atlas machinery as a one-region atlas, rather than introducing a
second scene reference system. The atlas ID, region name, document UUID and
project UUID are immutable. Display names may change independently. Document IDs
are canonical UUID strings; atlas/region IDs use the existing identifier validator.
New IDs and paths must be unused, including on disk, at commit time.

Use explicit targets: `{document_id, atlas_id, region}` for a native document;
tile-cell references additionally carry `{grid, x, y}` with cell offsets relative
to the region. Saved tiles remain `atlas/region/x/y`, resolved with the scene grid;
sprites remain `atlas/region`. Never infer the target from an active window,
selection, list position, display name or an unqualified local Tiled ID. An
imported copy operation supplies a source atlas/region and, for tiles, an explicit
grid/cell. Documents have one implicit raster, with no layer/frame selectors in
version 1; future layered formats must introduce explicit selectors.

Editing a native document changes every reference to it, including other grid
views of the tile. Creating a variation allocates a new document UUID and atlas
ID, leaving the original and its references intact. Duplication alone never
replaces placements. Placement replacement is a separate guarded operation.

## Pixels and bounds

The authoritative pixels are straight RGBA8 in sRGB byte space, row-major from
top left, four unsigned bytes per pixel. Alpha accepts 0..255, including partial
transparency. Preserve RGB beneath alpha zero in exact reads and saves; rendering
does not reveal it. No palette index, reserved transparency index, RGB5 rounding,
quantization or color-space conversion is implicit. Swatches select literal RGBA
values; changing a swatch does not recolor existing pixels. GBC constraints remain
optional analysis/conversion, owned separately from generic editing and gbc-atlas.

| Input/work | Version-1 bound |
| --- | --- |
| New or duplicated tile | One square of 8, 16 or 32 pixels |
| New or duplicated static sprite | Each dimension a multiple of 8 within 8..256; origin an integer pixel inside its rectangle |
| Decoded native raster | At most 65,536 pixels / 262,144 RGBA bytes |
| Exact pixel read | One in-bounds rectangle, at most 65,536 pixels |
| Pixel batch | At most 65,536 unique coordinate writes and 1 MiB decoded JSON |
| Source PNG / descriptor | At most 4 MiB / 64 KiB respectively |
| Serialized candidate or draft | At most 4 MiB; includes guards and metadata |
| Reference scan/review dependency set | At most 64 saved scenes and 16 MiB total serialized map input; at most 256 detailed locations per response |
| Artwork drafts per project | At most 64 records and 64 MiB total, separate from scene draft quotas |

Coordinates, dimensions and channels must be integers (booleans are invalid).
Reject duplicate coordinates, out-of-bounds writes, invalid colors, excess work
and unknown fields before changing any candidate. Never clip a batch or accept
its valid prefix. Blank creation fills every pixel with `[0,0,0,0]`. New sprites
default to origin `[0,0]`; duplication retains the source sprite origin.
Pixel edits cannot resize, repack, rename identities, change kind or change origin.
Selection moves, fill, shapes and transforms must obey the same final raster and
work bounds; quarter-turn rotation of a nonsquare selection must fit the fixed
document. A stroke/compound operation is one undo item and cancels as a unit.

## Saved format and derived assets

Retain project manifest version 1 and introduce an optional atlas-entry field:
`"editable": {"id": "<document UUID>", "path": "assets/<atlas_id>/editable.json"}`.
Projects without this field retain their existing interpretation. Validate the
exact field shape, one-to-one document/atlas relationship and declared paths.
Older Forge releases reject this unknown field; native projects with editable
artwork require a release that implements this contract. The implementation retains this optional field; never silently downgrade editable documents.

The descriptor has exactly these fields (nullable provenance is explicit):

```json
{
  "version": 1,
  "id": "c8042875-7819-4939-a38d-a24791d409c7",
  "atlas_id": "grass_variant",
  "region": "artwork",
  "name": "Grass variation",
  "kind": "tile",
  "width": 16,
  "height": 16,
  "origin": [0, 0],
  "pixel_format": "rgba8",
  "provenance": null
}
```

Tile origin is always `[0,0]`. The PNG at `assets/<atlas_id>/atlas.png` is the
editable pixel source as well as the browser's scene-facing sheet; there is no
second writable pixel copy. Decode PNGs to the exact RGBA contract. Native saves
encode non-interlaced RGBA8 PNGs with the existing encoder. Metadata stays in the
descriptor, atlas entry and existing tile-metadata structure, not PNG chunks.
The native atlas manifest uses `version: 1`, `source_format: "forge-rgba"`,
`png: "atlas.png"`, the immutable atlas ID, one region at `[0,0]` matching the
descriptor's region/kind/size/origin, and `animations: []`. No palette assignments,
slicing declaration or external source path is active on native artwork.

Generate cropped cell PNGs, grid tilesets, sprite PNGs/tilesets and the normalized
atlas manifest through the existing asset builder. Existing native edits pass
the previous entry to retain append-only local IDs and all terrain, adjacency,
collision geometry/shape IDs and other supported metadata. Regenerate every grid
view, even when the edit targeted a larger cell. Sprite object origins/overrides,
transforms, placement IDs, layers and properties do not change with pixel edits.
When copying a tile cell, inherit its metadata for the selected grid under the
new key; other generated grid views start with default metadata. Copy supported
sprite metadata and origin, but no animation sequences or unrelated tile rules.

Declare the descriptor, source and all generated files in `project.files` with
raw-byte SHA-256 digests. Source, descriptor, derived files, manifest and any
necessary map re-encoding commit in one existing durable transaction. Do not
write intermediate source or derived files into project inventory.

Project export includes editable descriptors and source bytes, so extract/reopen
retains editing. Scene export/transfer must include the descriptors for retained
atlases in authoring metadata, validate them and remap document UUIDs, atlas IDs,
descriptor paths and reference keys when importing into a different project.
Use the native validator for `forge-rgba`, not the palette-constrained gbc-atlas
importer. Plain Tiled consumes generated images/tilesets without understanding
the descriptor. No draft, transaction history or undeclared external source is
exported. Keep existing archive/input/output budgets; fail before writing if a
new representation exceeds them.

## Revisions, candidates and review

All revisions are lowercase SHA-256 hex strings, not timestamps or counters.
For the new aggregate artwork/candidate hashes below, recursively sort object
keys lexicographically before calling `record_bytes`; preserve array order and
reject nonfinite numbers. Do not change existing saved-file serialization.
Project revision is the digest of exact manifest bytes; scene revision is the
digest of exact saved map bytes. Define the artwork revision as the digest of
`record_bytes({"entry": entry, "files": files})`, where `files` contains every
declared path/digest under that atlas directory in lexicographic path order.
The entry includes the editable pointer, stable mappings and metadata. Thus pixel,
origin, metadata, source-policy and generated-file changes invalidate the artwork
base, including externally changed bytes that fail declared-inventory verification.

A candidate is a client-held, bounded immutable envelope containing version 1,
project/document/atlas identities, the full proposed descriptor and base64 RGBA
bytes, original project/artwork revisions (artwork is null only for creation),
operation kind and any source-copy, scene or placement dependencies. Its revision
is SHA-256 of `record_bytes(envelope)` with the sorted-key normalization above
and canonical base64; exclude the revision itself. Shared domain normalization
serves both transports. No server session or
ambient editor state is needed to reconstruct it. An edit returns a new candidate
revision, never mutates a previously reviewed candidate. Exact reads return the
rectangle, RGBA bytes, target, base revisions and candidate revision when unsaved.

| Operation | Required saved guards |
| --- | --- |
| Discover/read native pixels or prepare an edit | Project revision, verified declared assets, exact artwork revision |
| Create blank candidate/commit | Project revision and absence of reserved document/atlas IDs and output paths |
| Duplicate imported/native asset | Project revision, exact source artwork revision and destination absence |
| Edit existing native asset | Project revision and exact target artwork revision |
| Review shared consequences | Above guards plus revisions of every scanned saved scene; include reusable stamps and definitions as project-owned references |
| Preview in a saved or temporary scene candidate | Above guards, saved scene base revision, exact candidate scene digest and referenced asset digests |
| Commit with scene re-encoding or selected replacements | Above guards plus every rewritten scene's revision and precise original placement/cell values |

Read with one `ProjectStore.read_session`, verify declared bytes and revalidate
after expensive work. Never nest locking calls. The final transaction checks
the original project revision, all declared file digests, all reviewed or rewritten scene bytes
and destination absence under its lock. Include unchanged scenes from a review
receipt in these expectations too. An unrelated cooperating save therefore
conflicts too; version 1 deliberately uses conservative project-wide guards.
Scenes are not covered by the manifest digest: adding an atlas can change Tiled
GID ranges, so read/decode all saved maps against the old catalog, re-encode
against the new catalog and guard all rewritten maps, as import does today.
An existing pixel-only edit must not unnecessarily rewrite map/history content.

Review is read-only. Return isolated native/enlarged nearest-neighbor PNGs,
before/after data and bounded scene views through shared rendering. Reuse tile
transforms, origins and layer ordering. Existing scene renderer limits remain:
1,024 pixels per output dimension, 1,048,576 output pixels, 4,194,304 decoded
source pixels and 16,777,216 composited pixels. New-art review uses a temporary
catalog and explicit scene candidate, never a saved inventory placeholder.
An affected-reference scan must reject excess input with a request to narrow
scope; paginate detailed locations and identify incomplete coverage explicitly.
Never label a partial scan as all consequences.

A review receipt contains candidate revision and the full dependency guard set,
including the scene-candidate digest. Commit verifies it against the submitted
candidate and current dependencies; changing pixels or placement choices requires
a new review. A receipt binds content, not human approval or artistic quality.
Direct domain saves may omit review; the MCP reviewed-commit flow requires it.
Reviewing a scene does not implicitly save that scene or place new artwork.

Save acknowledgments contain project/document/atlas IDs, submitted candidate
revision, exact committed artwork and project revisions, source PNG digest and
revisions of any rewritten scenes. Derive these from the prepared committed
bytes, never a later catalog read. Busy, invalid input and conflict responses
are distinct and identify the target/dependency and recovery action. A stale base
rejects the whole operation and preserves the candidate. Never replay an ambiguous
write automatically; read saved revisions and compare the acknowledged/proposed
content before explicitly preparing another operation.

## External sources and recovery

Imported PNG/gbc-atlas assets remain read-only to native pixel operations. Users
can still explicitly reimport compatible artwork under the original identity
with existing geometry/metadata and revision rules. An external Aseprite source
is provenance, never an implicitly read or writable path. Forge neither watches
it nor promises Aseprite round-tripping. Its exported bundle enters through the
existing importer; gbc-atlas retains palette conversion ownership.

To hand-edit an import, duplicate a specified tile cell or static sprite region
as native artwork. Do not convert an imported atlas in place. Copy provenance as
`{project_id, atlas_id, region, grid, cell, artwork_revision, source_format}`;
grid/cell are null for sprites, cell is `[x,y]` for tiles, and source_format is
null for legacy gbc-atlas entries without that field. Provenance is informational,
has no live path and grants no update authority. Copying one named animation
region captures only that static image. Reimport of the original cannot modify
the copy; reimport targeting a native atlas ID is rejected. External atlas imports
also reject the reserved `forge-rgba` source format before writing; native artwork
enters through editable document services or Forge ZIP transfer.

Out-of-band edits to any declared source/derived file are drift, not an accepted
new revision. Preserve local work and copy changed files outside the managed
asset inventory before restoring every drifted file to its exact declared bytes.
Only after inventory verification succeeds may the preserved artwork enter
through a supported import under a fresh identity; subsequent native editing
requires duplication as described above. Importing under a new ID does not bypass
drift checks. If the original bytes are unavailable, saves and imports remain
blocked; retain the changed files and drafts while recovering a consistent project
from a backup. Never repair inventory digests silently. A raw PNG replacement
alone cannot acknowledge matching derived assets.

Artwork drafts live at `.forge/artwork-drafts/<draft_uuid>.json`, independent of
scene checkpoints/history. Each record contains version, draft/project UUIDs,
owner UUID (browser session or MCP client), original candidate/base envelope,
current candidate, display name and update time. The draft's raw-byte revision
guards create/update/delete/download; the owner UUID distinguishes writers, not
authentication, and existing loopback/mutation-token checks still apply. Another
owner can explicitly recover a copy
into a new draft but cannot silently take over its record. Stale candidates may
be checkpointed without validating their saved base, as scene recovery does.
Use the existing lock, safe-path, atomic-write and quota patterns; no journaled
project mutation or export inclusion for checkpoints.

Restoration checks draft/project identity, draft revision, original project and
artwork/source revisions, path absence for new artwork and any scene dependencies.
If stale, allow download/inspection and explicit copy/reconciliation, retaining
the original base. Never relabel stale pixels as based on a later save. Successful
restoration creates unsaved work; saving remains a separate guarded operation.
Disposal stops writers without deleting drafts. Undo/redo is local to the artwork
document, separate from scene history; reopening a checkpoint restores pixels and
base, not an implied durable undo stack. Only an exact save acknowledgment may
advance a local baseline, and only the submitted content becomes clean when
further local edits occurred while saving.

## Shared services and workflow examples

Pure raster validation/edit rules belong in `artwork`; `ArtworkService` composes
creation, duplication, exact reads, candidates and guarded persistence. `project`
owns manifest, saved reads and recovery coordination; `storage` owns locks and
journaling. `scenes/rendering.py` and scene services compose temporary catalogs
for review; `formats` owns portable export/transfer. Keep `Project` a composer.
HTTP/MCP adapters validate transport inputs and translate errors; neither writes
inventory, renders independently or infers an active document. Optional image
artifacts stay bounded and session-owned in MCP.

Browser artwork state/history, gestures and drafts have focused owners under
`frontend/artwork`, connected through typed ports and the mounted lifetime.
Scene ownership stays with `SceneSession`. Dirty artwork pauses external snapshot
adoption/navigation until explicit save, checkpoint or discard; dirty scene work
cannot be overwritten by an artwork operation that re-encodes/replaces maps.
Selection-specific replacement must include the exact local scene candidate and
base or require resolving the dirty scene first. Pointer cancellation, shortcuts
and disposal respect both owners and never route one undo command to both.

1. **New tile (#130–#132):** Create a transparent 16×16 tile at project revision
   P; batch literal RGBA edits to its candidate C. Read exact pixels, review C in
   isolation and a temporary scene based on S. Commit C with that receipt and P/S
   guards; receive P2/A2 and rewritten map revisions. Place the new stable tile
   reference through existing scene authoring using the resulting saved revisions.
2. **Shared native edit (#131–#133):** Open a native tile at P/A, enumerate its
   saved scene/stamp/definition references and show their scope. A pencil stroke
   produces C; preview existing placements with their transforms. Commit C only
   against P/A and review dependencies. All references display new pixels after
   safe refresh; no placement replacement or scene undo item is introduced.
3. **Sprite variation (#134):** Name scene/layer/object IDs and their saved bases;
   copy a native or imported static region to a fresh native identity. Retain
   origin and supported metadata. Review the new pixels and replacements together.
   Commit the artwork plus exactly those replacements atomically, retaining object
   IDs, coordinates, transforms and per-placement origin overrides. Other instances
   still use the original. Tile variations similarly name scene/layer/cell/grid
   and original reference/transform; no blanket string replacement is allowed.

## Implementation boundaries

#130 must update schema validation, asset generation, exact saved acknowledgments,
project export and scene transfer together: current transfer dispatch otherwise
routes unknown source formats through the gbc-atlas validator. Existing imports
and old projects need regression coverage without migration. #131 adds revision-bound
review; #132 exposes strict MCP operations; #133 owns browser tools/history/drafts;
#134 owns reference-aware atomic variation. Each issue validates its own behavior;
#135 evaluates the integrated tasks and documents actual capabilities separately
from this design. Follow the [documentation policy](DOCUMENTATION.md).

Deferred: arbitrary dimensions/resizing, layered or indexed editable documents,
animation timelines, source-file synchronization, palette-index editing, asset
merging, automatic conflict rebasing and Aseprite file import/export. Bounds may
be tightened by a transport but never silently relaxed. Changes to these format,
ownership or guard decisions require updating this contract with the implementation.

## Implemented service API (#130)

Use `project.artwork.documents` for native authoring. `create(atlas_id, name,
kind, width, height, project_revision, origin=None, region="artwork")` returns a
transparent unsaved candidate. `list(project_revision)` discovers explicit native
targets, descriptors and artwork revisions. `open(target, project_revision,
artwork_revision)` returns the saved pixels as an edit candidate. A target has
exactly `document_id`, `atlas_id` and `region`.

`duplicate(source, atlas_id, name, project_revision, region="artwork")` copies an
imported or native cell/static sprite to a fresh native identity. Source has
exactly `atlas_id`, `region`, `grid`, `cell`, `artwork_revision`; use null grid/cell
for a sprite, or a supported grid and region-relative `[x,y]` for a tile. Obtain
the source revision with `artwork.editable.artwork_revision(entry, project.files)`
from a verified saved-read session. Source provenance does not follow external files.

`edit(candidate, writes)` returns a new candidate; each write is
`{"x": 0, "y": 0, "rgba": [12, 34, 56, 0]}`. `read(candidate, rectangle=None)`
returns exact base64 row-major RGBA and identities/base/candidate revisions;
rectangle has `x`, `y`, `width`, `height`. `save(candidate)` performs one durable
transaction and returns exact project/artwork revisions, source PNG digest,
submitted candidate revision and revisions of rewritten scenes. Imported artwork
cannot be opened for pixel edits. Pixel saves cannot alter descriptor/metadata.

The version-1 candidate has exactly `version`, `project_id`, `document_id`,
`atlas_id`, `descriptor`, `rgba`, `project_revision`, `artwork_revision`,
`operation`, `source`, `metadata`, and its computed `revision`. Operation is
`create`, `duplicate` or `edit`; the target artwork base is null for both creation
operations. Source is null except for duplication. Metadata carries the original
saved metadata for edits or selected-source metadata under fresh keys for copies.
The service validates these policies again at save; recomputing a candidate hash
cannot bypass saved guards. Candidates are client-held JSON, without a server session.

For example, from a current project:

```python
artwork = project.artwork.documents
candidate = artwork.create("grass", "Grass", "tile", 16, 16, project.catalog()["revision"])
candidate = artwork.edit(candidate, [{"x": 0, "y": 0, "rgba": [24, 160, 48, 255]}])
exact = artwork.read(candidate, {"x": 0, "y": 0, "width": 1, "height": 1})
saved = artwork.save(candidate)
```

This is a Python domain API, not a browser/MCP command. Preserve the original
candidate on conflict and resolve its saved base explicitly. Durable artwork draft
records, review receipts and placement replacement are not implemented by #130.
Native artwork appears in the existing Library and can be placed/saved in scenes;
there are no pixel drawing controls yet. Native project ZIP extraction retains
editing, and Forge ZIP transfer validates/remaps native descriptors and identities.
