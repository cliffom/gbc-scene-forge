# Local MCP authoring

Forge's optional Model Context Protocol (MCP) server exposes saved standalone
projects to a local agent. The normal offline browser editor needs no MCP package,
server, network service or account. MCP uses the same project services, native
scene validation, typed definitions, rendering, Tiled serialization and durable
transactions as browser authoring. There is no connector or game compiler.

## Install and connect

Install the release with Python 3.10 or newer:

```sh
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.25.0'
gbc-scene-forge-mcp --project-root /absolute/path/to/projects
```

From this checkout, after the normal development setup:

```sh
poetry install --extras mcp
poetry run gbc-scene-forge-mcp --project-root /absolute/path/to/projects
```

Or install this checkout into a separate Python 3.10+ environment with
`pip install '.[mcp]'`. This extra installs the official Python MCP SDK
(`mcp>=1.30,<2`) and its dependencies. A plain `pip install .` retains zero runtime
Python dependencies. The entry point reports an installation hint if MCP is absent.

Configure a local stdio-capable MCP client to launch the executable from that
Python environment. For clients using a `mcpServers` configuration:

```json
{
  "mcpServers": {
    "scene-forge": {
      "command": "/absolute/path/to/environment/bin/gbc-scene-forge-mcp",
      "args": ["--project-root", "/absolute/path/to/projects"]
    }
  }
}
```

Use `--project /absolute/path/to/existing-project` instead to grant access to one
existing project. Its tool-facing name is always `project`; a root grants access
to its immediate project directories by their names. `list_projects` discovers
them. Project creation is available only with `--project-root` and exclusively
reserves a new directory using the normal project-name rules.

The client owns the subprocess/session. Closing stdin ends the session; Ctrl-C
also stops it. Responses go only to stdout, diagnostics to stderr. Nothing binds
a socket. Authorization is the user's choice to launch the subprocess with a
declared directory and OS permissions; there is no network bearer token or remote
MCP mode. Browser HTTP remains independently loopback-bound and mutation-token
protected. Launch the browser against the same root/project to inspect saves:

```sh
gbc-scene-forge --project /absolute/path/to/projects/mcp-forest
```

The official SDK handles JSON-RPC, initialization, schema validation, cancellation,
and stdio framing. Its supported protocol revisions are `2024-11-05`, `2025-03-26`,
`2025-06-18` and `2025-11-25`; the recorded SDK-client proof uses `2025-11-25`.
The server advertises tools and session artifact resources, with no subscriptions,
prompts, tasks, sampling, elicitation or HTTP transport. `tools/list` is the
machine-readable schema inventory; `capabilities` describes limits and deferrals.
See the [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
and [official Python SDK](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x).

## Supported surface

| Area | Tools and behavior | Deferred |
| --- | --- | --- |
| Discovery | `list_projects`, `get_project`, `get_scene`, `capabilities`. Canonical scenes, ordered layers/cells/objects, imported asset inventories, definitions, stamps, world data and revisions. | File browsing outside declared inventories; live subscriptions. |
| Creation | `create_project` (empty or blockout), `create_scene` (cell dimensions), `create_blockout_scene` (pixel/cell settings and camera). | Sample-project creation through MCP. |
| Scene editing | `edit_scene`: atomic object, tile painting/erasing and layer creation/update/reorder/deletion batches. `place_stamp`: saved composition placement with layer mapping, fresh IDs and dry-run candidates. `save_scene`: validated full canonical layers, tiles, sprites and objects. `rename_scene`, `duplicate_scene`, `delete_scene`: guarded saved lifecycle with deletion consequences. | Semantic terrain brushes; use canonical `save_scene` or browser.  |
| Project editing | `save_object_definition`, `save_world`, `save_stamp`, `delete_object_definition`, `delete_stamp` reuse native validators and transaction services; deletion previews identify references and retained overrides. | Palette profile/metadata and animation preference editing use browser. No arbitrary import paths. |
| Artwork | `import_atlas`: bounded uploaded manifest/PNG, preflight and compatible reimport with exact project/scene acknowledgments. | Arbitrary filesystem paths; artwork creation/approval. |
| Review | `review_artwork`: saved/candidate PNG camera and bounded/paged overview. `review_blockout`: full overview and chosen camera frame SVG resources, exact saved/candidate revisions, pixel dimensions and camera intent. | Animated playback and runtime/physics simulation. |
| Verification | `diagnostics` checks the saved project; `palette_report` checks a guarded saved scene with the existing opt-in profile. | Missing metadata stays unverified; no reachability or hardware-fit certification. |
| Portability | `export_bundle` returns existing project/scene Tiled ZIP exports as immutable resources. | Arbitrary output paths; exports over 16 MiB use browser. |

Generic PNG/Tiled intake, terrain brush commands and profile editing remain
browser operations. Browser selection, playback and Undo are browser interactions,
not claimed MCP capabilities. The initial agent workflow is inspect/create/edit/
review/diagnostics/export; the project tools extend that surface through existing
service contracts without exposing a shell or unrestricted filesystem operations.

## Schemas and a safe editing sequence

All tools have strict top-level JSON schemas. Use `get_project` and `get_scene`
for canonical content before constructing edits. IDs and revisions are opaque:
project/definition/scene IDs are UUIDs, object/layer IDs are native integers, and
revisions are SHA-256 strings. Coordinates and rectangle sizes use whole pixels.
A scene's `width`/`height` are **cells**, with `grid` pixels per cell. Empty tile
cells are `""`; painted references come from the imported atlas inventory.

1. `get_project({"project":"plan"})` returns `{project, revision}`. The project
   includes `scenes`, `atlases`, `object_definitions`, optional `stamps` and `world`.
2. `create_blockout_scene` requires `project`, `project_revision`, `name` and
   optional `options`. Options are `units` (`pixels`/`cells`), `width`, `height`,
   `grid` (8/16/32), `camera_width`, `camera_height` (pixels), `scroll_x`, `scroll_y`.
   Defaults are 960×272px, grid 8, camera 160×136px. Scenes support at most 65,536 cells and 8,192 pixels per axis;
   cameras must fit. Native preset definitions are initialized once.
3. Discover a preset definition's UUID in `object_definitions.definitions` using
   its typed `blockout_role` default. `get_scene` returns
   `{id, name, scene, revision, project_revision}`.
4. Call `edit_scene` with `project`, `scene_id`, `project_revision`,
   `scene_revision`, `dry_run:true` and `operations`, for example:

   ```json
   [
     {"op":"place","definition_id":"<solid preset UUID>","x":0,"y":240,"width":320,"height":32,"name":"West floor"},
     {"op":"update","object_id":1,"changes":{"y":136}},
     {"op":"duplicate","object_id":2,"changes":{"x":384}},
     {"op":"delete","object_id":3}
   ]
   ```

   Operations are sequential on a private candidate, never partial disk writes.
   IDs allocated by placement/duplication appear in `allocated_object_ids`. Existing
   identities remain stable. Omit `dry_run` to save the entire valid batch once.
   `place` uses a point/rectangle blockout definition and optional `layer_id`,
   name, dimensions and explicit `properties`. `update`/`duplicate` accept x/y,
   width/height, name/class, properties and sprite origin; IDs/kinds/definition
   links are immutable in these patch operations. Use `save_scene` for other
   validated native edits. Deleting linked endpoints retains normal broken-link
   protection; repair world connections before removing their objects.
5. Typed properties are arrays of `{name,type,value}`, where type is string,
   int, float or bool. Supplying `properties` replaces the **complete explicit
   override list**; omitting it preserves overrides. Inherited fields remain in
   the definition. Retained unknown/mismatched overrides follow browser behavior.
6. `review_blockout` accepts the same guards plus optional `scene` (the candidate)
   and `camera_id`. It returns `scene_id`, `project_revision`, `scene_revision`,
   `snapshot_revision`, dimensions, camera/framing intent and `overview_resource`/
   `camera_resource`. `snapshot_revision` hashes the exact canonical candidate.
   A candidate view does not save or move the starting camera.
7. Commit a reviewed candidate with `save_scene`, using its original guards and
   `scene`. Reinspect after writes. Object summaries contain before/after values,
   changed layer IDs and snapshot hashes; full-scene summaries cap detailed object
   and tile changes at 128 each and explicitly report truncation. Layer metadata
   before/after and stored layer order are also included. The returned canonical scene
   is the serialized round-trip result.

## Tile and layer batches

`edit_scene` accepts the following operations alongside object edits. All operations
run sequentially against a private candidate and save once. A batch contains
1..128 operations, at most 4,096 cell writes total (including repeated writes to
the same coordinate), and at most 4 MiB of input. `dry_run:true` returns a canonical
candidate without writing. Both project and scene revisions are required, including
for dry runs. The same operations work on the original flat Ground/Sprites scenes;
responses retain the normal canonical flat or layered representation. An explicitly
created empty `Sprites` object layer stays layered so its ID and allocation
counter survive saves and reopening.

| Operation | Fields and behavior |
| --- | --- |
| `paint_tiles` | `layer_id`, `cells:[{x,y,tile}]`. Coordinates are zero-based **cell** indices, not pixels. `tile` is an imported tile reference for the scene grid, with optional native `#1`..`#7` transform suffix; `""` clears a cell. |
| `erase_tiles` | `layer_id`, `cells:[{x,y}]`. Clears the specified cells to `""`. |
| `create_layer` | `name`, `type` (`tilelayer`/`objectgroup`), optional `visible` (default true) and `index` (default append). Allocates an empty native layer. |
| `update_layer` | `layer_id`, nonempty `changes` containing `name` and/or `visible`. Identity and type cannot be changed. |
| `move_layer` | `layer_id`, `index`. Index is the zero-based final position in stored order, bottom to top; the browser displays its layer list in reverse. |
| `delete_layer` | `layer_id`. Removes the layer and its tiles/objects. At least one layer must remain; normal linked-object removal guards apply when saving. |

Layer creation allows an insertion index from zero through the existing layer
count; moving requires an index within the existing list. Native limits remain
128 layers and IDs below 2,147,483,647. Existing layer/object IDs and allocation
counters are retained; deletion does not recycle IDs. `allocated_layer_ids` lists
new layers retained in the returned candidate, in its stored order. To target a
layer created earlier in the same batch, use the inspected `next_layer_id` (or
max existing layer ID plus one for a flat scene).

For example, after inspecting the scene and its tile layer ID:

```json
[
  {"op":"paint_tiles","layer_id":1,"cells":[{"x":2,"y":3,"tile":"terrain/earth/0/0"}]},
  {"op":"update_layer","layer_id":1,"changes":{"name":"Forest floor"}},
  {"op":"create_layer","name":"Decoration","type":"tilelayer"}
]
```

Out-of-bounds coordinates, unknown/wrong-grid tile references, non-tile target
layers and malformed operations reject the complete batch. Hidden layers may be
explicitly edited. Repeated coordinates are applied in order; the last valid write
wins. Direct cell edits do not infer terrain connections or alter neighboring
cells. Semantic terrain brushes remain deferred; use `place_stamp` for saved compositions.

The summary reports net `tile_change_count`, up to 128 `tile_changes` with
`layer_id`, cell `x`/`y` and before/after references, plus
`tile_changes_truncated`. Added/deleted tile layers compare their cells against
empty cells. `layer_changes` reports before/after name, type, visibility and index;
`before_layer_order`/`after_layer_order` and `changed_layer_ids` also report moves.
Review a dry-run candidate with `review_blockout` or `review_artwork` and optional
`scene`, or save it with `save_scene` using the original revision guards.

## Place reusable stamps

Inspect `get_project` for a saved stamp's `id`, canonical `scene` and `slots`, and
`get_scene` for the target scene and both revisions. Call `place_stamp` with:

```json
{
  "project": "project",
  "project_revision": "<saved project revision>",
  "scene_id": "<target scene UUID>",
  "scene_revision": "<saved scene revision>",
  "stamp_id": "<saved stamp UUID>",
  "x": 2,
  "y": 3,
  "dry_run": true
}
```

`x` and `y` are zero-based whole **cell** indices for the stamp's top-left corner.
Its grid must equal the target grid and its whole rectangular extent must fit;
there is no clipping. Each source layer maps to the target layer with the same
type and exact name at its zero-based occurrence slot, counting hidden layers
in stored order. That target must exist and be visible. Create missing layers or
show hidden targets with `edit_scene` first, then inspect fresh revisions.

Placement overwrites every covered tile cell, including empty cells and native
transform suffixes. It appends point, rectangle and sprite objects in source order,
offsetting their pixel positions by `x*grid`/`y*grid`. Definitions, explicit typed
properties, sprite assets and origins are retained. Objects receive fresh IDs
from the target scene's allocation counter, independent of source IDs and every
existing object's layer; IDs are never recycled. Unrelated scene content, layer
identities/order and the saved stamp remain intact.

`placement` reports the stamp identity/name, cell position/extent, total
`tile_write_count`, `object_count` and `layer_mapping`. Each mapping identifies
`source_layer_id`, `target_layer_id`, `slot`, and tile writes or source-to-allocated
`object_ids`. `allocated_object_ids` and the normal net before/after `changes`
summary accompany the canonical scene. Tile-write counts include empty and
unchanged cells; net tile changes count only differences.

Both revision guards apply to dry runs and commits. A dry run saves nothing and
reserves no IDs or locks. Review its `scene` using `review_artwork` and/or
`review_blockout` with the original guards; the review's `snapshot_revision`
matches `changes.after_snapshot`. Save the reviewed candidate with `save_scene`,
or repeat `place_stamp` without `dry_run` against the same saved base. Reinspect
after each save before placing again. Conflicts require inspection, never a
fabricated revision or automatic replay.

The request remains bounded to 4 MiB; native stamp/scene limits apply: 128 layers,
65,536 cells per layer, 8,192 pixels per axis and 4,096 objects per target layer.
Unknown stamps/assets, wrong grids, missing/hidden targets, invalid geometry,
exhausted IDs and stale revisions reject the entire operation. Review retains
its existing camera, output, source-image and compositing limits. Browser drafts,
selection, playback and Undo are independent; transform stamps in the browser
before saving them when needed.

[Stamp regression and SDK workflow](../tests/backend/adapters/test_mcp_stamps.py)
covers repeated multi-slot placements, tile clearing/transforms, sprites, exact
candidate PNG/SVG review, canonical saves, portable export, invalid inputs and
concurrent writes. Run it through `make test-mcp` against an installed MCP wheel.

## Project library and world edits

`save_world` accepts the native `world` document and the complete
`scene_revisions` map (available from diagnostics). `save_object_definition`
accepts a native definition; omit its ID to create one, retain ID to update.
`save_stamp` accepts `name`, a validated native `scene`, and a `slots` array with
one 0..127 occurrence slot per layer in order (same type/name slots increase).
Use `get_project` to inspect existing examples of these native schemas.

## Organize and clean up saved content

`rename_scene` and `duplicate_scene` require `project`, `project_revision`,
`scene_id`, `scene_revision` and `name`. Rename changes the catalog name while
preserving the scene UUID and saved bytes. Duplication copies saved native content
with a new scene UUID, preserving layer/object identities, allocation counters,
typed overrides, artwork and visibility. It leaves the source, world positions
and connections unchanged; connections are not cloned. Responses include the
updated `{project, revision}` catalog plus `renamed` or `duplicated`,
`scene_revision`, and `source_scene_id` for duplication.

Before deleting a scene, inspect its exact consequences:

```json
{
  "project": "project",
  "project_revision": "<saved project revision>",
  "scene_id": "<scene UUID>",
  "scene_revision": "<saved scene revision>",
  "dry_run": true
}
```

`delete_scene` returns `consequences.connections` with each complete native
connection (UUID, name, direction and both scene/object endpoints), plus
`world_position`. The preview writes nothing. Omit `dry_run` to delete at the
same guards. Linked deletion is rejected unless `confirm_broken_links:true`
explicitly acknowledges those inspected links. The saved scene and its world
position are removed; connections remain in the world document and diagnostics
report their missing-scene endpoints. Repair connections with `save_world` first
when broken links are unwanted. Changing the world changes the project revision
and invalidates the earlier acknowledgment. The commit returns `deleted`, the
same consequences and updated catalog. Unrelated scenes remain intact.

`delete_object_definition` takes `project`, `project_revision`, `definition_id`
and optional `dry_run`. Its preview reports `consequences.scene_references`
(scene UUID/name/revision, layer and object IDs) and `stamp_references` (stamp
UUID/name, layer and object IDs), including hidden layers. Deleting a referenced
definition is allowed, matching browser semantics. Saved instances and stamps
retain their definition UUIDs and complete explicit overrides, including unknown
fields and type mismatches; no objects are rewritten. Inherited defaults cease
to resolve and diagnostics report `missing-definition`. Inspect those consequences
before committing with the same project revision. Scene revisions discovered by
the service are also guarded at commit so the reported references cannot silently
change during preparation. Missing or invalid saved scenes prevent a complete
reference report and reject definition deletion.

`delete_stamp` takes `project`, `project_revision`, `stamp_id` and optional
`dry_run`. Placements are native copies with no live stamp dependency, so deleting
a stamp leaves every existing placement intact. Definition/stamp deletion returns
`deleted_definition_id`/`deleted_stamp_id`, consequences and updated `{project,
revision}`. The manifest revision guards both libraries; there is no separate
library revision. Unknown identities, stale guards, undeclared project paths and
malformed arguments reject the whole operation. Dry runs reserve no lock for a
later commit. Conflicts require fresh inspection.

Lifecycle acknowledgments describe the exact committed catalog and revisions;
a later writer's state is never substituted. Browser drafts, selection, playback
and Undo remain independent. Reconnect clients that cache tool schemas to discover
the five new tools. The [lifecycle regression and installed-SDK workflow](../tests/backend/adapters/test_mcp_lifecycle.py)
exercises rename/copy/delete, linked-scene acknowledgment, referenced definitions,
retained overrides, actual stamp placements, strict schemas and concurrent writes.

## Import and review saved artwork

1. Read `get_project` and retain its revision. Call `import_atlas` with `project`,
   `project_revision`, `bundle` and `dry_run:true`. The bundle has exactly
   `name` (a basename ending `.atlas.json`), `manifest` (the JSON file as text),
   and `png` (base64 image bytes). This upload contract uses the same gbc-atlas
   validation as the browser; it accepts no server filesystem path. The whole
   JSON request must fit 4 MiB, including base64 expansion; manifests additionally
   cap at 1 MiB and decoded PNGs at 4 MiB. Normal atlas dimensions, cell count,
   RGB5 palette, transparency and region rules apply.
2. Inspect `added`, `changed`, `removed`, image dimensions and `regions` in the
   preflight report. Repeat the same payload with `dry_run:false` to commit.
   Import is atomic and guards every rewritten saved scene and declared asset.
   Reimport requires `reimport:true` and the same atlas ID, retains region
   identities/dimensions/kinds and applicable Forge metadata, and reports
   `artwork_changed` and `metadata_changed`. Invalid/stale imports change nothing.
   Preflight validates full serialization/persistence limits but reserves no lock
   for a future commit. An updated payload needs a new preflight.
3. Reinspect inventory and scenes after import; acknowledgments also include the
   exact committed `project_revision` and `scene_revisions`. Scene IDs, typed
   blockout objects and their properties remain intact. Tile identities are
   `atlas/region/x/y`; grid inventories are keyed by editor pixel grid. For a
   **16px editor grid with 8px palette cells**, declare tile regions whose width
   and height are divisible by 16. Each 16px tile includes four palette cells;
   8px-only regions do not become 16px tiles. No scene-grid limit changes.
4. Use `save_scene` with the returned canonical scene, preserving existing
   geometry/IDs and adding ordered tile/object layers. Tile transform suffixes
   `#1`..`#7` encode horizontal, vertical and diagonal combinations. Sprite
   objects use `{id,asset,x,y}` and optional `origin`; omit `kind` for sprites.
   Reopen with `get_scene` to inspect the serialized result.
5. Call `review_artwork` with exact `project_revision`, `scene_revision` and
   `scene_id`, plus optional visible typed `camera_id` and canonical candidate
   `scene`. Candidates retain the original saved guards and are validated and
   round-tripped before rendering; review never saves them. Read `camera_resource`
   and `overview_resource` as PNG blobs. Each output is native scale (one pixel
   per authored pixel), transparent, with ordered visible artwork layers,
   canonical grid slicing, tile transforms and static sprite origins. Planning
   geometry/labels, selections, background and playback are excluded; use
   `review_blockout` alongside it for geometry and camera intent.
6. Views cap at **1024 pixels per axis / 1,048,576 output pixels**, and
   16,777,216 composited pixels and 4,194,304 decoded source pixels per view. An oversized camera fails explicitly.
   The default overview starts at `(0,0)` and crops each axis to 1024.
   `overview_complete` states whether it covers the whole scene. Pass
   `overview:{x,y,width,height}` to review another native-scale rectangle; the
   returned `overview` and full scene dimensions make coverage explicit. There
   is no silent scaling. Outside artwork stays transparent.
7. Run diagnostics/palette review and `export_bundle` at fresh revisions. The
   portable ZIP retains tile images, sprites, layer ordering, semantic references
   and typed geometry. Runtime compatibility remains a downstream concern.

The regression proof in `tests/backend/adapters/test_mcp_artwork.py` follows this
sequence with a generic 16px-grid fixture, 8px palette cells, transformed tiles,
sprite placement, metadata-preserving reimport and portable export. Real SDK
protocol checks exercise upload and PNG resource reads; browser MCP acceptance
checks import/reimport inventory adoption and preserved saved placements alongside
existing dirty-edit/recovery protection.

## Revisions, drafts and review artifacts

All updates require the expected project revision; scene edits/reviews additionally
require the expected scene revision. Invalid/stale requests do not overwrite later
work. Scene saves use durable transactions with existing interrupted-write
recovery. Project creation reserves a new name rather than replacing contents.
`edit_scene` bounds batches to 128 operations and authoring tool input to 4 MiB;
normal scene, property, object and layer limits still apply.

MCP writes saved files. It does **not** see or overwrite a browser's unsaved canvas,
checkpoint files or Undo stack. A browser with unsaved edits will get a conflict
when trying to save over an MCP-modified scene. Keep the tab open to inspect it;
automatic checkpoints also remain recoverable after losing the tab. After reload,
use recovery to download the stale draft; restore is blocked until its base matches.
Do not discard the draft until its changes have been reconciled.

A clean, visible browser automatically checks saved revisions every two seconds
and loads external changes. Checks pause while there are unsaved edits, open forms,
active gestures, or a hidden tab; focus/reconnect and finishing a save or revert
trigger another check when safe. Adoption preserves valid selection, active layer,
zoom and viewport, and clears the previous Undo/Redo history. Browser Undo never
undoes another author's transaction. Project tools contains an automatic-refresh
toggle and a manual check; no permanent refresh button is added. See
[external refresh](user/external-refresh.md) for conflicts, recovery and limitations.
Coordinate saved edits or use separate scenes while a human is editing.

Tool failures have `isError:true`. Native errors also include
`structuredContent.error` with `code:conflict` or `invalid_request` and a message.
SDK schema failures are text errors with `isError:true`. Unknown tools/capabilities
fail explicitly. Reinspect after a conflict; never retry with fabricated revisions.

### Startup contention and retry boundaries

With `--project`, the server opens and recovers the declared project before starting
the MCP session. Explicit transaction-lock contention retries that opening at most
21 times, with 100 ms between attempts (two seconds of retry delays, plus opening
time). The first busy attempt writes a diagnostic to stderr; stdout remains MCP
protocol data. Releasing the lock within this bound permits normal initialization
with the same `project` alias. Exhaustion exits with a clear startup error: stop
the competing operation and reconnect. No tool has been submitted at that point.
Other opening errors, including missing/invalid projects and path validation
failures, fail immediately. `--project-root` opening does not use this retry loop.
Native transaction locks remain nonblocking, including after initialization.

The server does not retry tool calls or initialization/transport failures. Test
fixtures retry only the exact structured busy response described in
[test organization](../tests/README.md), retaining every original argument and
revision. Conflicts and other errors remain errors. After a transport failure or
lost write acknowledgment, inspect saved state before deciding what to submit;
never automatically replay an ambiguous mutation or rebase its revision fences.

Previews/exports return MCP resource links. `resources/read` retrieves UTF-8 SVG
text or base64 PNG/ZIP blobs. URIs are content-addressed `forge-artifact://snapshot/…`,
immutable and accessible only in their server session. The cache holds up to
24 MiB; old artifacts may expire. Save desired artifacts on the client before
ending the session; regenerate expired ones. Arbitrary file/HTTP URIs are refused.
SVG rendering retains its 4096-visible-object and 2 MiB-per-view limits. Large
native exports retain the existing export computation limits and must fit the
16 MiB MCP artifact cap; use browser downloads for larger bundles. The SDK parses
protocol messages before tool input limits apply.

## Reproduce the opening-forest proof

Run this in an environment with this checkout and the MCP extra installed:

```sh
python examples/mcp/opening_forest.py \
  --root /tmp/forge-mcp-projects \
  --output /tmp/forge-mcp-review
gbc-scene-forge --project /tmp/forge-mcp-projects/mcp-forest
```

Use a fresh root or a new directory each time; the example refuses to overwrite
an existing `mcp-forest`. This is a real official SDK `ClientSession` over stdio,
not a direct adapter call. Project-supplied data in
[`examples/mcp/opening-forest.json`](../examples/mcp/opening-forest.json) describes
21 planning objects plus the camera: ground/landings, red pool, climb endpoints,
enemy/patrol/approach, visible/hidden rewards, spawn/checkpoint, exit and arena.
There are no game-specific code branches or imported assets.

The client discovers definitions, creates a 960×272px starting section, configures
a 160×136px camera, then widens the landing, moves the patrol, and lengthens the
climb. It reviews the unsaved candidate before saving, verifies exact snapshot
hashes, reopens content, reviews a second camera position without saving it, runs
diagnostics and exports. IDs remain stable. The output contains `before.svg`,
`after.svg`, `camera.svg`, `camera-landing.svg`, `changes.json`, `diagnostics.json`,
`session.json` (complete structured request/results including negotiated protocol)
and `forest.zip` (portable project).

Open the saved scene in Forge, use **Blockout → Camera & overview…**, or select
objects and use **Edit selected object**. Later artwork belongs on separate tile/
object layers. It preserves the plan's identities, geometry and typed fields.
Follow the [blockout tutorial](user/blockout-tutorial.md) for normal browser editing.

![MCP-authored forest and camera review](screenshots/mcp/forest-review.png)

The forest is a starting section, not a required complete stage. Planning and
palette reports (disabled without an opt-in profile) do not establish jump/climb reachability, runtime game feel or
hardware fit. SVGs show planning geometry; use the main browser canvas for artwork.

## Validation

```sh
make lint test build check-dist
FORGE_MCP_PYTHON=/path/to/mcp-environment/bin/python make test-mcp test-mcp-browser
```

The ordinary suite runs dependency-free service tests and skips the SDK test if
the extra is absent. `test-mcp` requires the SDK. The dedicated browser test runs
the real-client example, opens that saved scene in Chrome, edits/saves/reopens it,
and checks simultaneous MCP saves against an unsaved browser draft, conflict
protection and draft download. Existing blockout acceptance covers native artwork
placement and export; service tests check that importing later artwork preserves
the MCP-edited plan. CI also tests the optional protocol against installed wheels
on Python 3.13/3.14 after verifying the plain offline installation.
