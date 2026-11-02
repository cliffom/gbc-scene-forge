# Scene Forge 0.24.0

Agents can organize saved projects with `rename_scene`, `duplicate_scene` and
`delete_scene`, and clean up libraries with `delete_object_definition` and
`delete_stamp`. Deletion previews identify concrete world connections or saved
scene/stamp object references before committing with the original revision guards.

This compatible feature release resolves
[#112](https://github.com/cliffom/gbc-scene-forge/issues/112) and
[#113](https://github.com/cliffom/gbc-scene-forge/issues/113), completing the
[MCP project lifecycle milestone](https://github.com/cliffom/gbc-scene-forge/milestone/11).
Install with `python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.24.0'`.
MCP clients caching tool schemas should reconnect. The ordinary editor retains
zero required runtime dependencies; project, Tiled and draft formats are unchanged.
No migration is required.

Rename preserves scene identity and bytes. Duplication allocates a new scene UUID
and preserves native copied content without cloning world links. Scene deletion
removes its world position and retains connections as broken links only with
explicit acknowledgment; previews list the exact endpoints. Definition deletion
preserves placed objects, stamp content and explicit overrides while inherited
defaults cease to resolve. Stamp deletion leaves existing placements intact.
Unknown IDs, stale revisions and concurrent writes reject the whole operation.
Lifecycle responses identify the affected resources and exact committed catalog.
Browser drafts and Undo remain independent.

See [saved lifecycle](MCP.md#organize-and-clean-up-saved-content) and the
[validation record](VALIDATION.md#mcp-project-lifecycle-112-113). This prepares 0.24.0; tagging and publication
remain separate steps.
