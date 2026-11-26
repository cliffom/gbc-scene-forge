# Plugin project selection and first task

Milestone 25's experimental runtime supports `forge mcp --plugin`. It starts
without a project grant and exposes setup tools through MCP. No checkout, Python,
Node, settings-file edits or MCP reconfiguration is needed to choose a project.
The [MCP declaration](../plugin/mcp.json) and
[entry skill](../plugin/skills/forge-start/SKILL.md) are included by the
[repository packager](PLUGIN-DISTRIBUTION.md); no public release is published yet. Existing
`--project` and `--project-root` modes keep their explicit startup grants.

Plugin mode uses a fixed 32-tool profile: three setup tools, browser handoff and 28 authoring tools
for project discovery/creation, artwork and animation inspection/refinement,
scene/blockout editing, candidate recovery/cleanup, review/save and export. The demonstrated Codex
client exposed only the alphabetically first 32 tools from the full inventory,
which hid every setup tool and blocked first use. Both advertisement and dispatch
now enforce this bounded profile; `capabilities` reports its exact tools and
`unavailable_tools`. Use browser editing or direct `--project`/`--project-root`
MCP for other operations, including saved-content deletion, duplication, stamps,
frame-specific review, palette conversion, object definitions, world editing,
bulk candidate archives, filtered SVG scene review and diagnostics. Those direct
launch modes retain the full inventory. See the [outcome matrix](AUTHORING-OUTCOMES.md)
for operation details; its MCP column describes the full direct-launch surface.

## Choose, reopen or change a location

Ask Forge to open a project or start a new design. On first use, the native
folder picker asks for the folder where the game lives. Choose the current
working folder or another folder. Forge stores named projects under the
selected folder's `.gbc-scene-forge/` directory and continues the original
authoring task after confirmation.

`plugin_status` reports the effective path, its selection scope, and any
startup error. `plugin_choose_location` has three modes:

- `workspace` is the default for new work. Choose the game folder, then
  discover or create immediate projects under its `.gbc-scene-forge/` child.
  If the library is absent, `list_projects` returns an empty list.
  `create_project` creates the missing library on demand and uses the existing
  rules for reserving a named project directory.
- `project` opens one existing Forge project directly. Use the MCP name
  `project` to access it.
- `root` explicitly opens a library in the earlier layout. The chosen folder
  itself contains the named projects.

On macOS the optional `start_in` argument positions the picker at a known
absolute working folder from the chat. Without a usable hint the picker opens
at its normal location. The confirmed picker result grants project access.
Finish the dialog within 55 seconds or cancel to retain the previous selection.
The Forge selection applies to Forge tools in the current chat. Codex manages
the chat's working folder separately.

The chooser uses the macOS system `osascript` command. If macOS denies folder or
automation access, the error points to **System Settings → Privacy & Security**.
Windows and Linux can launch the runtime with explicit `--project` or
`--project-root` arguments. Platform delivery is tracked in #258/#263.

## Data ownership and browser handoff

New selections live in the chat's MCP connection. A fresh connection can
reopen a library by choosing the same game folder. Previous installations'
`~/Library/Application Support/Scene Forge/selection.json` remains readable as a
legacy selection and is never overwritten by a new choice. A reset clears the
active chat selection or forgets a legacy selection loaded by that connection.
It leaves project files intact.

Forge revalidates the confirmed folder and any open library before project calls
and artifact reads. Moved, replaced, denied or symlinked locations require a
fresh selection. Discovery reports malformed projects without repairing them.
Switching replaces the adapter and clears session previews. Read current revisions
and regenerate previews in the new project. Per-user cache and logs live under
`~/Library/Caches/Scene Forge/`, separate from projects, settings and the plugin
installation. This is a cooperative local application boundary.

Projects remain user-owned wherever selected. Plugin removal must remove only
installed plugin content; removing the plugin or cache cannot remove a project.
Temporary artifacts are session-owned in-memory MCP resources; browser-local
drafts remain owned by the browser. The plugin does not sweep any of these on reset.
Uninstall/update implementation belongs to #258.

Compact artwork candidates persist in the project across reset/restart and share
the browser's quota (256 records / 64 MiB). Each changed handle retains another
immutable candidate. Use `list_artwork_candidates` to recover handles and inspect
quota, `export_artwork_candidate` to preserve a full envelope, then
`release_artwork_candidate` only for an explicitly selected candidate that can be
discarded. Release removes that sidecar, not saved artwork or other candidates.
Saving or browser adoption does not release the original handles. Keep unpublished
branches unless the user chooses to discard them; no automatic eviction occurs.

## Managed browser handoff and process recovery

Call `plugin_browser(project, action:"open", scene_id?)` to obtain a verified
`http://127.0.0.1:PORT/` URL for the same project as MCP. Use the client's browser
opener with that returned URL. A saved `scene_id` adds the existing scene route;
missing scenes reject before launch. There is no artwork deep link: choose saved
artwork in **Documents**. Candidates are unpublished; opening the browser does
not save or adopt them. Direct launch retains the full MCP inventory; the bounded
plugin profile replaces filtered SVG `review_scene` with this handoff. Ordinary
saved-scene PNG review remains available through `review_artwork`.

From a terminal, use the bundled `bin/forge browser --project <absolute-project-directory>`
to open a saved project directly. The legacy `bin/forge browser --plugin` route
continues to use an existing saved selection. For a legacy root, add
`--project-name NAME`. Managed browsers choose their own port. Direct launches can
specify `--port`.

The client owns each stdio MCP subprocess. Normal stdin closure stops MCP; an
abrupt termination loses its in-memory resources. No MCP network listener is
created. Browser processes are shared by the same OS user, cache and exact
canonical project/directory identity, independently of any one chat. They survive
MCP exit and selection changes, keep their original project scope, and expire
after 30 minutes without editor requests. Open tabs that poll saved updates keep
the server active. Opening again refreshes its idle deadline. Health/status polling
does not. Idle/explicit shutdown waits for admitted requests, including saves;
crash recovery uses the existing durable journal, without replaying a tool call.
An already-open browser also recovers interrupted writes before its next content
request; it reports contention while another writer still holds the project lock.
Requests recheck project identity after queuing and, for mutations, after receiving
the body, so a delayed upload cannot write into a replacement directory.

`action:"status"` reports whether a recorded browser is actually live. To stop
one, use `action:"stop", instance:<current instance>` **only when the user asks**;
it affects every tab/conversation sharing that instance. Chat closure, reset,
switching projects and plugin sessions never implicitly stop it. A changed/expired
instance rejects stop. Direct foreground servers and other users' servers are
never adopted or signalled. The manager authenticates a fixed loopback endpoint
with a random owner-only cache secret and verifies project, runtime and instance.
It never signals a PID from a record. Concurrent launch requests serialize under
an OS lock; the worker holds its own lifetime lock. Failed starts are bounded by
a ten-second readiness wait; only the newly spawned process handle can be cleaned
up on failure. A live browser from another runtime/install must be explicitly
stopped before opening with the current runtime.

Owner-only records/logs live under the per-user cache's `browsers/` directory,
keyed by project identity. Records retain the selected port after stop/crash so
restart preserves the browser origin and its local recovery identity. A stale
record is a hint, never proof of liveness. An occupied saved port causes an
actionable failure; Forge does not kill its listener or silently change the
origin. Close that listener and retry. A missing/moved/replaced project fails
closed, including existing browser requests. Invalid or redirected records fail
without launching or deleting user files. Keep records while browsers are live;
cache removal can lose the remembered address. If a record is damaged, preserve
it, close its tabs and let the idle lifetime expire before clearing that record.

Diagnostics go to MCP stderr and bounded-at-start worker logs, never protocol
stdout. They describe lifecycle events without tool arguments, saved content,
URLs or ownership secrets. Direct foreground launch keeps its existing console.

| Content | Owner and lifetime |
| --- | --- |
| Saved artwork/scenes and transaction recovery | User project; survives chat, browser and runtime restart. Existing locks and revision guards apply. |
| Scene/artwork checkpoints | Browser-owned records in project-local `.forge/drafts/` and `.forge/artwork-drafts/`; recover through the browser. Closing a server does not delete them. Changes since the last acknowledged checkpoint and in-memory Undo may be lost. |
| Compact candidates | Immutable project-local sidecars; survive MCP exit/reset and browser restart until explicitly released. Stale bases remain stale. Recover with candidate listing/export. |
| PNG/APNG/ZIP previews and review resources | MCP memory cache only; expire on eviction, selection change or process exit. Regenerate an expired resource; a URI is not a durable saved file. |
| Browser process records/logs | Per-user cache; neither saved project content nor a checkpoint. Preserve records during active use. |

This contract targets the initial local macOS arm64 runtime and the
[recorded client support matrix](evaluations/plugin-feasibility.md#environment-and-client-boundary).
It adds process-level installed-executable and browser acceptance, not new Codex
client installation or human-inspection evidence. WSL, remote workspaces and
cloud are deferred: a remote loopback URL is not the local user's browser;
there is no remote MCP socket, forwarded-port fallback or inferred local path.
Windows/Linux native selection/delivery and other clients remain downstream
acceptance in #258/#261/#263/#264.

## A small, optional introduction

The entry skill offers **draw a small sprite**, **build a scene** or **explore this
project**. A specific request skips this introduction and receives guidance in
context. Use existing assets when available and create only what the task needs.
General pixel art is the default; GBC limits remain opt-in.

Show a useful render early, inspect it, refine, then save through current review
receipts/revisions. Introduce palettes/layers while drawing, frames/timing while
animating, and tile layers/objects/stamps/camera framing while composing. Offer
browser editing alongside chat and use the
[browser/MCP outcome matrix](AUTHORING-OUTCOMES.md) for capability boundaries.
Animation playback, selection and Undo require browser interaction; image-tool
success alone does not establish that the model or user saw the result.

At review/save explain: saved content lives in the project; an unpublished
candidate is proposed work that has not replaced the saved artwork; browser-local
drafts and Undo belong to that browser. After saving, offer a useful next action
and portable `export_bundle` output (or browser export above the MCP size limit).
The bundled [artwork skill](../plugin/skills/forge-artwork/SKILL.md) handles
illustrations, tiles and static sprites; the
[animation skill](../plugin/skills/forge-animation/SKILL.md) adds explicit frames,
order, timing and loop inspection. Their
[native editing reference](../plugin/skills/forge-artwork/references/native-editing.md)
describes the actual bounded profile, scoped source preservation and exact receipt
flow. The [representative briefs and checks](../plugin/skills/forge-artwork/references/workflow-checks.md)
cover draft-only work, shared-asset scope, hidden layers, timing, missing tools and
image/playback fallbacks. Read fresh inventory and canonical descriptors rather
than replacing documents from remembered JSON. General pixel art remains the
default; opt-in palette estimates do not certify a target runtime.

Model image inspection is required when the client supports it. If images cannot
be exposed, disclose the limit and arrange browser/user review; keep the candidate
unpublished unless the user authorizes saving without model inspection. Animation
PNG contact sheets plus exact order/duration inspection cover a client without
APNG playback, but do not establish perceived cadence. Numeric validation alone
does not establish visual quality. The bundled
[scene skill](../plugin/skills/forge-scenes/SKILL.md) covers blockouts, existing or
new artwork placement, composition refinement and portable export. Its
[outcome routes](../plugin/skills/forge-scenes/references/outcome-routes.md) identify
browser handoffs for stamps, diagnostics, semantic terrain brushes and preferences;
its [export guide](../plugin/skills/forge-scenes/references/portable-export.md)
distinguishes saved snapshots from drafts and requires separate reopen verification.
[Scene workflow briefs](../plugin/skills/forge-scenes/references/workflow-checks.md)
cover candidate review, conflicts and bounded overview inspection. Installed handoff,
quality/resource evaluation and independent-user acceptance stay with #261/#262/#264.
