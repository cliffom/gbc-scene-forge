# Scene Forge 0.14.0

Import ordinary PNG tilesheets and a documented subset of external Tiled JSON maps
without gbc-atlas or GBC palette setup. See the [import tutorial](user/import-artwork.md).

- PNG slicing supports square 8/16/32 px tiles, whole-pixel margins/spacing, a
  visual preview and validation before copying files.
- Explicit compatible reimport retains stable tile identities, authored metadata
  and saved placements. Generic colors/transparency are preserved; GBC palette
  requirements remain unverified when metadata is absent.
- Tiled preflight checks supported fields and dependencies before creating a new
  scene and project-owned artwork in one revision-guarded transaction. Unsupported
  content is rejected rather than silently dropped. Source bundles stay unchanged.
- Existing gbc-atlas imports, native manifest version 1, portable exports and
  loopback/mutation-token protections are retained. No required runtime dependency
  or project migration is introduced.

Install with `python -m pip install --upgrade gbc-scene-forge==0.14.0`, or use
`'gbc-scene-forge[mcp]==0.14.0'` for the optional MCP extra. The new import dialogs
are available in the browser; existing MCP tools continue to work unchanged.
