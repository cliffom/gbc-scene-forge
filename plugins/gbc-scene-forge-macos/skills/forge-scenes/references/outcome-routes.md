# Scene authoring outcome routes

This bundled plugin column extends the maintained
[authoring outcome matrix](https://github.com/cliffom/gbc-scene-forge/blob/milestone/25-codex-authoring-plugin/docs/AUTHORING-OUTCOMES.md).
It is the local routing reference for the 32-tool profile delivered with these
skills. `capabilities.tools` remains authoritative if the installed version
differs. No repository checkout or network fetch is required to use this table.

| Promised outcome | Installed MCP route | Explicit browser handoff / boundary |
| --- | --- | --- |
| Project/scene discovery and inventory | `list_projects`, `get_project`, `get_scene`, `list_artwork` | Native folder grant through forge-start; discovery creates nothing. Rename/copy/delete scenes use browser scene actions. |
| Artwork-free blockout | `create_blockout_scene`, `edit_scene` dry run, `review_blockout`, `save_scene` | Browser Blockout library for pointer drawing. Initial creation is a saved write; refinement can remain proposed. |
| Tile/layer placement and refinement | `edit_scene` tile/layer operations; `save_scene` canonical candidate | Browser selection, gestures and Undo are local. Respect stored bottom-to-top order. |
| Static sprite placement and origins | Inspect saved atlas regions, edit canonical objects, candidate `review_artwork`, guarded `save_scene` | Browser object palette/Inspector for interactive placement; animation playback does not turn a static preview into a timing review. |
| Reusable stamps/compositions | Inspect saved `stamps` in `get_project` | Use browser selection → save stamp and stamp palette placement; `save_stamp`/`place_stamp` are absent in this profile. Preserve occurrence slots, layer order, fresh object IDs and full-extent fit through the native browser flow. |
| New/changed artwork for a scene | forge-artwork / forge-animation candidate review and commit; fresh saved inventory before placement | Shared edits affect references; selected-placement variations use browser. Do not overwrite shared source to vary one prop. |
| External atlas import | `import_atlas` uploaded manifest/PNG, preflight `dry_run:true`, then guarded import | 4 MiB total request including base64, 1 MiB manifest, 4 MiB decoded PNG, at most 256 8px cells. Upload is not a path grant. Reinspect mappings/revisions after import. |
| Generic PNG, Tiled and Forge scene import | Not exposed by this profile | Use browser import/preflight and saved inspection afterward. Do not guess `import_artwork_png` merely because full MCP supports it. |
| Semantic terrain brushes | Canonical resolved tile painting only | Browser Terrain rules/brush for neighbor-aware semantics. Do not claim rule inference or full brush parity. |
| Definitions, world layout/connections | Read via `get_project`, preserve references during scene edits | Browser definition/world controls for writes. `save_scene` cannot author project settings or repair world data. |
| Diagnostics, metadata, GBC palette budgets and preferences | Scene review resources only | Browser Diagnostics, Terrain & collision, palette/profile and preview controls. `diagnostics`, `palette_report` and settings writes are absent here. Missing metadata stays unverified; no build/physics claims. |
| Overall/artwork/planning review | Candidate `review_artwork` PNG + `review_blockout` SVG with matching snapshot | Browser Scene view for combined filters, native details and interactive camera. `review_scene` is absent here. Hidden layers stay hidden; reviews are snapshots. |
| Portable project/scene export | `export_bundle` guarded saved snapshot | Browser export for larger resources or local canvas snapshots; see [export and reopen](portable-export.md). Neither route silently publishes unrelated drafts. |
| Conflict/recovery and later refinement | Fresh saved reads, explicit candidate comparison; retained artwork handles via artwork skill | Browser checkpoint/recovery/download and external refresh are distinct. Scene dry runs are not durable retained artwork handles. Browser Undo/drafts are inaccessible through MCP; conflicts require deliberate reconciliation. |

For a fuller verified direct-launch inventory, tools such as `place_stamp`,
`review_scene` and `diagnostics` may be present. Use their installed schemas and
native guards only when exposed. Do not install a second runtime or use shell
edits to evade this plugin's capability or selection boundaries.
