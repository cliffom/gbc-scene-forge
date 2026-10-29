# Scene Forge 0.15.0

Paint connected roads, walls and shorelines using four-neighbor terrain brushes.
See the [terrain tutorial](user/terrain-brushes.md) for setup and limitations.

- Configure transition edges in the existing shared terrain/collision editor.
  Each terrain and scene grid supports 16 north/east/south/west patterns.
- Paint and erase update immediate neighbors on the active tile layer in one
  undoable stroke. Borders and other terrain types count as disconnected edges.
- Incomplete and duplicate rules have explicit diagnostics and deterministic
  fallbacks. Collision metadata stays independent; incompatible automatic
  replacements are blocked or retained with feedback.
- Rules survive compatible artwork reimport. Saved scenes and portable exports
  remain ordinary tile placements; optional `forge:terrain_mask` tile properties
  document the rules without claiming Tiled Wang/automapping interoperability.
- No required runtime dependency or project migration is introduced. Existing
  projects without rules work unchanged. Use this version or later after saving
  transition metadata; older versions may reject that optional field.

Install with `python -m pip install --upgrade gbc-scene-forge==0.15.0`, or use
`'gbc-scene-forge[mcp]==0.15.0'` for the optional MCP extra. Terrain painting is a
browser authoring workflow; existing MCP operations continue to work unchanged.
