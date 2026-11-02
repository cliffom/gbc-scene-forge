# Scene Forge 0.27.0

Prepared milestone 14 artwork authoring: shared native artwork services create and
duplicate static tile/sprite documents, read exact RGBA8 pixels, apply bounded
batches and save immutable candidates against project and artwork revisions.
This implements [#130](https://github.com/cliffom/gbc-scene-forge/issues/130).
Shared read-only candidate review ([#131](https://github.com/cliffom/gbc-scene-forge/issues/131))
adds native/enlarged pixel comparisons, saved-reference scans and temporary
scene previews. Review receipts bind exact candidate and saved dependencies;
reviewed saves guard all scanned maps, including unchanged ones, at commit.
MCP artwork commands ([#132](https://github.com/cliffom/gbc-scene-forge/issues/132))
expose discovery, blank creation, duplication, exact pixels, immutable batched
edits, candidate PNG resources and receipt-required commits. New artwork can be
reviewed in a temporary scene before saving and placed through existing scene tools.
The [browser pixel editor](user/pixel-artwork.md) ([#133](https://github.com/cliffom/gbc-scene-forge/issues/133))
adds creation/copying, pencil/erase/fill, eyedropper, line/rectangle shapes,
selection move/copy/paste/transforms, palettes/transparency, isolated/scene review
and receipt-required saves. Its bounded undo/redo and owned project-local drafts
remain independent of scene history. Recovery checks the original base and copies
checkpoints; conflicts preserve pixels for explicit reconciliation. New artwork is
reviewed through temporary placements and added to the Library without placing it.
Selected-placement variations ([#134](https://github.com/cliffom/gbc-scene-forge/issues/134))
copy artwork under fresh identities and atomically replace explicitly selected
saved tile/sprite references after review. Browser selections require a saved
scene; MCP can select across saved scenes. Other placements, source artwork,
stamps and definitions retain their original semantics. Drafts retain the exact
selection and reject stale restoration. The [workshop example](../examples/mcp/artwork_workshop.py)
supports repeatable creation and explicit revisions through the optional SDK;
the [workflow evaluation](evaluations/artwork-workflows.md) records #135 scope and limits.

Native artwork uses one-region atlases and a declared editable descriptor.
Pixel-only edits retain local tile IDs, metadata, sprite origins and scene files.
Adding artwork atomically re-encodes affected Tiled maps. Variation saves also
apply selected reference replacements in that same transaction. Exact save acknowledgments
identify the submitted candidate and committed bytes. Existing transaction recovery
covers source PNGs, generated tilesets/images, descriptors and map writes.

Project ZIP extraction retains native editing. Both scene and project ZIP transfer
validate native sources and allocate fresh document and atlas identities. Plain
Tiled still uses generated PNGs/tilesets. Imported PNG/gbc-atlas artwork stays
read-only to pixel operations; duplicate a tile cell or static sprite to edit it.
Reimport cannot replace native documents. Generic RGBA, including partial alpha
and hidden RGB beneath transparency, requires no GBC palette.

Existing projects without native documents remain manifest version 1 and need no
migration. Projects containing the optional `editable` field require Forge 0.27+;
older versions reject it. Back up the entire project before adopting native
artwork. See the [service API and limits](EDITABLE-ARTWORK.md#implemented-service-api-130).
No Python runtime dependency is added. Version 0.27.0 is prepared on the milestone
integration path; tagging, package publication and milestone integration into
main remain separate. Observed checks belong in the [validation record](VALIDATION.md).
