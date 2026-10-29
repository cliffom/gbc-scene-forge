# Scene Forge 0.16.1

This maintenance release improves the organization and consistency of HTTP
routing and frontend response validation while preserving existing editor behavior.

- Dispatch fixed project and workspace endpoints through explicit registries and
  share the bundled-file allowlist and response handling across server modes.
- Derive project catalog, saved-scene and world-report types from Valibot schemas,
  with shared JSON validation helpers and explicit domain normalization/rules.
- Preserve defaults, flat-scene compatibility, atlas animation fallbacks, stamps,
  error messages, security checks, revision guards and editor lifecycle behavior.
- Bundle pinned Valibot code and its MIT notice. The installed editor still needs
  no Node, CDN or additional required Python runtime dependency.

Existing projects require no migration. Native manifests, portable Tiled files,
HTTP/MCP contracts and authoring workflows remain compatible. See the
[adoption evaluation](evaluations/valibot-pilot.md) for measured bundle impact and
the direction for incremental response-schema adoption.

Install with `python -m pip install --upgrade gbc-scene-forge==0.16.1`, or use
`'gbc-scene-forge[mcp]==0.16.1'` for the optional MCP extra.
