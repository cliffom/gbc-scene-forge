# Scene Forge 0.23.0

Agents can place saved reusable stamps with `place_stamp`, inspect the unsaved
candidate as artwork PNGs or blockout SVGs, then save it with the original revision
guards. Placement uses native type/name occurrence slots, overwrites covered tile
cells including empty cells, and appends objects and sprites with fresh IDs.
Responses report source-to-target layer and object identities and tile-write counts.

This compatible feature release resolves
[#111](https://github.com/cliffom/gbc-scene-forge/issues/111) and the
[MCP reusable composition placement milestone](https://github.com/cliffom/gbc-scene-forge/milestone/10).
Install with `python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.23.0'`.
The ordinary editor retains zero required runtime dependencies. Project, Tiled
and draft formats are unchanged; no migration is required. MCP clients caching
tool schemas should reconnect to discover `place_stamp` and the optional `scene`
argument on `review_artwork`.

Placement coordinates are whole cell indices; object offsets remain pixels.
The grid must match and the entire stamp must fit. Matching target layers must
exist and be visible. Missing/hidden layers, invalid assets, exhausted IDs,
object limits and stale revisions reject the whole placement. No layers are
created automatically, no content is clipped, and repeated placements allocate
new object IDs. Browser drafts, selection and Undo remain independent.

See [placement and review](MCP.md#place-reusable-stamps) and
[validation](VALIDATION.md#mcp-reusable-stamp-placement-111). This prepares
0.23.0; tagging and publication are separate steps.
