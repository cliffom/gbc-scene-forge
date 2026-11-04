# Browser and MCP authoring outcomes (#167)

This inventory describes the supported surface for prepared 0.33.0, including
milestone 22 consolidation at `0269aae`, reviewed 2026-11-03. It is an outcome inventory, not a tool-count
claim. See [MCP guidance](MCP.md) for wire schemas and detailed limits and
[standalone usage](STANDALONE.md) for browser operations.

## Boundaries and classifications

Browser scene edits live in a local document/history until Save. Artwork pixels,
layout and timing live in a local document until exact review and Confirm save;
server checkpoints are recovery records, not saved artwork. Browser project
settings/library actions use their individual guarded save/confirmation flows.

MCP reads saved content. Scene dry runs return canonical unpublished JSON without
reserving IDs; `save_scene` or a non-dry-run operation commits using the inspected
project/scene revisions. Artwork envelopes and compact handles are unpublished;
`commit_artwork` requires an exact review receipt. Retained handles survive server
restart and appear in the explicit Agent candidates inbox, separately from saved Library assets. Each save requires fresh bases
before further writes. Review resources and exports are snapshots, not live views.

Classifications below mean:

- **Intentional**: interfaces differ while the stated outcome is supported.
- **Canonical workaround**: existing validated native data can express the outcome,
  but MCP has no equivalent semantic command. Inspect saved data first; do not
  invent a schema or rewrite unrelated fields.
- **Missing**: MCP cannot perform this authoring operation; use the browser and
  then inspect the saved result through MCP. This does not authorize new tools.
- **Unverified**: the cited evidence does not establish the particular claim.

## Outcome matrix

Evidence links identify source acceptance, not proof that every row ran on every
release. Current execution evidence belongs in
[Validation](VALIDATION.md#consolidated-editor-workflows-milestone-22);
the table also retains inherited source coverage.

| Outcome | Browser route | MCP route | Saved/candidate boundary and relevant limits | Difference / workaround | Existing acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| Create/open/rename/duplicate/delete scenes | Project/scene controls, including deletion consequences | `create_project`, `create_scene`, `create_blockout_scene`, `get_scene`, lifecycle tools | Scene creation/lifecycle writes saved content; dry-run deletion writes nothing; scene and project guards; 65,536 cells, 8,192 px per axis | Intentional: MCP duplication copies saved content; save browser edits first | [SDK lifecycle](../tests/backend/adapters/test_mcp_lifecycle.py), [browser lifecycle](../tests/playwright/editor/editor-lifecycle.spec.ts) |
| Paint tiles and manage ordered layers | Canvas, layer controls, Save | `edit_scene` tile/layer operations or `save_scene` | Browser local until Save; MCP dry run vs atomic save; 128 layers, 128 operations, 4,096 cell writes/batch, 4 MiB request | Intentional: pointer selection/Undo remain browser-local | [Tile/layer SDK](../tests/backend/adapters/test_mcp_tiles_layers.py), [standalone browser](../tests/playwright/editor/standalone.spec.ts) |
| Terrain brush results | Terrain rules/brush; paint connected terrain | Read canonical scene and save resolved cells with `save_scene` | Browser brush resolves neighboring cells locally; native scene save guards remain | Canonical workaround for resolved tiles; semantic rule inference/brush commands missing in MCP; use browser for rule-driven editing | [Terrain browser](../tests/playwright/artwork/terrain.spec.ts); arbitrary MCP terrain inference unverified |
| Create/edit static tile or sprite pixels | Library → New/Edit artwork, shared commands/tools, Save → Confirm save | `create_artwork`, `open_artwork`, `duplicate_artwork`, pixel read/edit, review, commit | Static sprites: integer 1..4,096 px axes, ≤4,194,304 pixels; tiles/sheets retain grid limits; candidate ≤24 MiB, pixel batch ≤1 MiB or rectangular patch ≤65,536 pixels; exact RGBA including hidden RGB; shared originals affect references | Intentional: local gestures/history vs immutable candidate edits | [Native MCP](../tests/backend/adapters/test_mcp_native_artwork.py), [pixel browser](../tests/playwright/artwork/pixels.spec.ts) |
| Create/edit sheets, frames, sequences and timing | Multiple-frame setup, optional Frames & animation dock, Inspector Properties | Sheet creation/layout tools, frame/animation reviews, `commit_artwork` | 128 frames, 64 sequences, 256 entries/sequence, 1,024 total entries, 1..65,535 ms; saved geometry/IDs protected | Intentional: browser playback/onion skin vs PNG/APNG resources; physical playback controls are not required MCP tools | [Sheet SDK](../tests/backend/adapters/test_mcp_sheets.py), [sheet browser](../tests/playwright/artwork/pixels.spec.ts) |
| Shared edits and selected-placement variations | Library Source actions → shared artwork / independent copy / saved-selection variation; review affected references | `open_artwork`/`duplicate_artwork` with explicit placement list, review/commit | Exact captured saved scene bases; variation artwork and replacements commit together; other placements/source remain | Intentional: browser selection vs explicit canonical placement identities | [Variations](../tests/backend/artwork/test_artwork_variations.py), [SDK/browser alternation](../tests/playwright/mcp/artwork-mcp.spec.ts) |
| Static sprite-to-tile representation/conversion | Frame Properties → representation; selected sprites → review mapping | `edit_artwork_layout` (append a tile frame), `review_sprite_tile_conversion`, `commit_sprite_tile_conversion` | Review-bound conversion of grid-aligned static poses; explicit static acknowledgment; source animation retained | Intentional: neither interface infers gameplay semantics or animation equivalence | [Domain workflows](../tests/backend/artwork/test_authoring_workflows.py), [sheet SDK](../tests/backend/adapters/test_mcp_sheets.py), [conversion browser](../tests/playwright/artwork/pixels.spec.ts) |
| Definitions and typed object instances | Definition editor, object palette/properties | `save_object_definition`, `edit_scene`/`save_scene`, deletion preview | Guarded library writes; local scene instances until save; typed overrides retained; ≤4,096 objects/layer | Intentional: browser forms vs native typed properties; inspect inherited/explicit values | [MCP project edits](../tests/backend/adapters/test_mcp.py), [definitions browser](../tests/playwright/objects/definitions.spec.ts) |
| Reusable stamps and placements | Selection → save stamp; stamp palette | `save_stamp`, `place_stamp`, `delete_stamp` | Stamp save is a project write; placement dry-run vs save; exact layer occurrence slots, full extent must fit, new object IDs | Intentional: transform selection in browser or supply a validated transformed canonical stamp | [Stamp SDK](../tests/backend/adapters/test_mcp_stamps.py), [composition browser](../tests/playwright/objects/compositions.spec.ts) |
| World layout and connections | World controls | `save_world` with native world and all scene revisions | Guarded saved project write; all scene bases required; dangling endpoint diagnostics | Intentional: visual layout vs canonical positions/endpoints | [MCP project edits](../tests/backend/adapters/test_mcp.py), [world browser](../tests/playwright/planning/world.spec.ts) |
| Tile metadata, palette profiles and preview preferences | Terrain & collision / profile / preview controls | Saved inspection where exposed; `palette_report` consumes existing profile | Browser-owned guarded metadata/preferences writes; report reads saved scene/profile | Missing MCP authoring capability; configure in browser then inspect/report. Raw `save_scene` is not a generic project-settings API | [Terrain browser](../tests/playwright/artwork/terrain.spec.ts), [palette tests](../tests/backend/analysis/test_palette_budget.py) |
| Import external atlas | Import artwork → atlas ZIP/preflight/reimport | `import_atlas` bounded upload/preflight/reimport | Upload is not a filesystem grant; preflight does not save; commit requires current project base and compatibility | Intentional: file chooser vs bounded uploaded data; 4 MiB MCP request including base64, 1 MiB manifest, 4 MiB decoded PNG, at most 256 8px cells | [Atlas MCP](../tests/backend/adapters/test_mcp_artwork.py), [imports browser](../tests/playwright/artwork/imports.spec.ts) |
| Import generic PNG, Tiled map or Forge scene | Import controls and portable scene transfer; Agent candidates adoption | `import_artwork_png` creates unpublished native sprites; Tiled/Forge intake still browser-only | Browser preflight then guarded save; assets copied into declared project; format/geometry checks remain | PNG editable intake supported through uploaded bytes; other formats use browser, then saved inspection | [Imports browser](../tests/playwright/artwork/imports.spec.ts), [Forge transfer](../tests/playwright/artwork/forge-imports.spec.ts) |
| Export portable project/scene | Export controls | `export_bundle` immutable ZIP resource | Saved snapshot; browser drafts/candidates excluded; MCP artifact ≤16 MiB, session cache 24 MiB | Intentional size/transport difference; larger exports use browser | [MCP export](../tests/backend/adapters/test_mcp.py), [mixed export/reopen](../tests/playwright/mcp/artwork-mcp.spec.ts) |
| Diagnostics, scene/artwork review and budgets | Diagnostics/review/preview panels | `diagnostics`, `palette_report`, `review_artwork`, `review_blockout`, artwork candidate/frame/animation reviews | Saved diagnostics; explicit candidates for preview; review does not save; artwork receipts required to commit, scene review is advisory; reference pages ≤256 locations | Intentional: PNG/SVG/APNG snapshots vs interactive viewing; absent metadata stays unverified; no runtime/physics certification | [MCP review](../tests/backend/adapters/test_mcp_artwork.py), [browser review](../tests/playwright/editor/review.spec.ts), [diagnostics](../tests/playwright/planning/diagnostics.spec.ts) |
| Recovery, external refresh and conflicts | Browser checkpoint/recovery/download, explicit refresh/reconcile; Undo/Redo | Retain/list/export immutable artwork candidates; fresh saved reads; stale revisions reject | Browser checkpoints and MCP candidate store are separate; 256 retained records/64 MiB with no eviction; candidate recovery does not publish; conflicts preserve local work | Intentional: no MCP access to browser drafts/Undo. Explicit Agent candidates adoption/return exchanges unpublished snapshots with separate owners; saved handoff uses fresh open. Discovery never rebases local work | [Candidate SDK](../tests/backend/adapters/test_mcp_sheets.py), [refresh SDK/browser](../tests/playwright/mcp/refresh.spec.ts), [mixed conflict recovery](../tests/playwright/mcp/artwork-mcp.spec.ts) |

## Milestone 21 additions

| Outcome | Browser route | MCP route | Boundary / evidence |
| --- | --- | --- | --- |
| Literal raster editing and recoloring | Draw tools, selections, exact RGBA | `edit_artwork_raster`, `artwork_colors`; existing exact writes/patches retained | Atomic batches, explicit rectangles and layer targets; simultaneous remaps. [Equivalent measurements](evaluations/artwork-iteration.md); opt-in island cleanup below, near-color consolidation deferred |
| Named illustration layers | Artwork layers controls and per-document Undo | `edit_artwork_layers` and explicit `layer_id` | Eight sources, aggregate pixel limit including composite; exact source preservation across recovery/export. [Domain/SDK](../tests/backend/adapters/test_mcp_iteration.py), [browser](../tests/playwright/artwork/iteration.spec.ts) |
| Immediately visible bounded review | Existing comparison and detail panels | Inline PNG blocks plus resource links; scene overview without camera | Two inline images / 4 MiB decoded; resources/session lifetime retained. [SDK checks](../tests/backend/adapters/test_mcp_iteration.py); changed-pixel overlay deferred |
| Unpublished handoff | Agent candidates inspect/adopt, Return candidate to agent | Retain/list/export immutable candidates | Separate owner/local history; original saved base remains fixed; review before commit. [Real SDK/browser exchange](../tests/playwright/mcp/iteration-mcp.spec.ts) |
| Saved artwork discovery and deletion | Library/source choices update while Artwork stays open; existing atlas deletion | `delete_artwork` dry-run/exact plan/current revision | Whole atlas; references block; independent work retained, stale saves reject. [SDK/browser discovery/deletion](../tests/playwright/mcp/iteration-mcp.spec.ts) |
| Pointer wheel navigation | Ordinary wheel zoom, existing panning controls | Interactive navigation intentionally browser-only | Preserves pixels/dirty/history, scoped to viewport. [Browser coverage](../tests/playwright/artwork/iteration.spec.ts) |

## Selective cleanup addition (0.36.0)

| Outcome | Browser route | MCP route | Boundary / evidence |
| --- | --- | --- | --- |
| Analyze and selectively clean small color islands | Inspect/adopt an unpublished candidate; literal manual edits remain available | `analyze_artwork_cleanup`, `preview_artwork_cleanup`, `validate_artwork_cleanup`, existing review/commit | MCP-specific suggestions and exact constraints; no new browser cleanup UI or Undo transfer. Explicit layer/regions/protection, immutable proposals, source previews and exact coordinate map. [Synthetic evaluation](evaluations/pixel-cleanup.md), [SDK/source fidelity regressions](../tests/backend/adapters/test_mcp_cleanup.py). Artistic intent remains unverified. |

## Representative equivalence method

Use identical starting sheet pixels, frame IDs, hidden RGB, durations and looping
for browser-only, SDK-only and alternating browser/SDK routes. Apply the same
pixel/timing changes, review and save, reopen and compare full RGBA/descriptor
content. The three-route regression copies one saved project, preserving artwork
identities; it compares all saved pixels and descriptor fields directly rather
than comparing revision hashes of different operations.
Then have an external SDK writer update saved content: verify clean refresh,
stale-review refusal, preserved browser local work and recovery download. Export
and reopen the final saved project. The pixel, sheet SDK, mixed-authoring and
refresh suites linked above cover these boundaries; no claim is made that every
matrix row has been exercised in all three modes.

Independent novice discovery, prolonged comfort and actual zoom/OS scaling remain
**unverified**. Source coverage, synthetic browser input and SDK transport checks
do not establish those outcomes. Session tasks and observation fields are in the
[usability evaluation](evaluations/workflow-usability.md); outstanding checks live
only in [Validation](VALIDATION.md#remaining-checks).
