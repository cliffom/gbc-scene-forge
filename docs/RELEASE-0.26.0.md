# Scene Forge 0.26.0

Transfer selected scenes from a Forge export ZIP into the current project through
**Library → Import… → Forge export ZIP**. Preflight lists every
source scene, proposed names, required artwork/definitions and conflicts. Rename
or skip conflicting scenes, check the final selection, then explicitly import.
This resolves [#127](https://github.com/cliffom/gbc-scene-forge/issues/127).

Selected scenes and dependencies receive new identities. Shared artwork and
referenced definitions are copied once per selection; destination content is never
overwritten. Layers, transforms, sprites, objects, typed properties and
terrain/collision metadata survive save/reopen and re-export. Existing guarded
transactions, revision checks and unsaved-work prompts protect the destination.

World positions/connections, project settings, preview preferences and unplaced
stamps are omitted with an explicit preflight notice. Intake accepts ZIPs directly,
bounded to 5 MiB compressed, 256 MiB expanded and 8,192 regular files. Unsupported
or inconsistent content is rejected before commit. See the
[workflow and limits](user/import-artwork.md#forge-export-zips).

New scene-only exports include original managed artwork and a transfer manifest.
Older scene-only ZIPs require re-export with 0.26.0; older whole-project exports
can use their project manifest. Native project, Tiled and recovery formats remain
compatible; no project migration is required. Installed editors retain zero
required Python runtime dependencies and need no Node or network service.

Install with `python -m pip install --upgrade gbc-scene-forge==0.26.0`;
include `[mcp]` for optional MCP tools. This prepares 0.26.0; tagging and publication
are separate steps. Observed checks belong in the [validation record](VALIDATION.md).
