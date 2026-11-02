# Scene Forge 0.27.0

Prepared milestone 14 foundation: shared native artwork services create and
duplicate static tile/sprite documents, read exact RGBA8 pixels, apply bounded
batches and save immutable candidates against project and artwork revisions.
This implements [#130](https://github.com/cliffom/gbc-scene-forge/issues/130).
Browser drawing tools, MCP commands, candidate review and placement-specific
variations are subsequent milestone work; this release preparation does not
claim the complete user–agent authoring workflow.

Native artwork uses one-region atlases and a declared editable descriptor.
Pixel-only edits retain local tile IDs, metadata, sprite origins and scene files.
Adding artwork atomically re-encodes affected Tiled maps. Exact save acknowledgments
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
