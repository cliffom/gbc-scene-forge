# Scene Forge 0.18.0

Agents can decorate saved blockouts through MCP without browser automation or
editing the project inventory. `import_atlas` accepts a bounded manifest/PNG
upload, offers full preflight, and uses the browser's shared atomic import and
compatible reimport rules. Scene IDs, typed geometry, saved semantic placements
and applicable tile metadata survive import/reimport. Revision conflicts and
invalid bundles leave the project intact.

`review_artwork` returns revision-bound PNG camera and overview resources with
transparent native-scale artwork, ordered visible layers, orthogonal tile
transforms and static sprite origins. Views cap at 1024×1024; larger scenes can
be inspected through explicit overview rectangles. Planning overlays remain in
`review_blockout`. See the [MCP workflow and limits](MCP.md).

This minor release prepares 0.18.0 for new MCP capabilities. Existing project,
Tiled and draft formats are unchanged. No required runtime dependency is added;
MCP remains optional. Publication is a separate step.
