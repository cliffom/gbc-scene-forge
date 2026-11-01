# Scene Forge 0.22.0

Agents can paint and erase tile cells and create, rename, reorder, hide or delete
layers through `edit_scene`, without replacing a full scene document. Tile,
layer and existing object operations can share one atomic revision-guarded batch.
Dry runs return canonical candidates with tile and layer before/after summaries.
Original flat scenes are supported as well as named-layer scenes.

This compatible feature release addresses [#109](https://github.com/cliffom/gbc-scene-forge/issues/109)
and [#110](https://github.com/cliffom/gbc-scene-forge/issues/110). The existing 18-tool
inventory remains unchanged; the new operations extend `edit_scene`. Clients that
cache tool schemas should reconnect after upgrading.

Install with `python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.22.0'`.
The ordinary editor still requires no runtime dependencies; MCP remains optional.
Project, Tiled and draft formats are unchanged, with no migration required.

Batches allow 1..128 operations and at most 4,096 tile cell writes within the
existing 4 MiB input limit. Tile coordinates use cells, layer indices use stored
bottom-to-top order, and invalid operations reject the entire batch. Layer
deletion removes its content and retains normal linked-object guards. Browser
drafts and Undo remain independent. Semantic terrain brushes and stamp placement
are deferred.

See [MCP authoring](MCP.md#tile-and-layer-batches) for schemas, examples and limits,
and [validation](VALIDATION.md#mcp-tile-and-layer-authoring-109-110) for observed checks. This prepares the release;
tagging and publication are separate steps.
