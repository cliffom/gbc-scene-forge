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

Ask Forge to open a project or start a new design. `plugin_status` reports the
effective absolute project/root, settings/cache locations and any startup error.
On first use there is no filesystem discovery until a directory is chosen.

`plugin_choose_location` opens a native folder dialog with one of two scopes:

- `project`: choose an existing Forge project. Only that project is accessible,
  using the MCP name `project`.
- `root`: choose an existing parent directory. Forge can discover its immediate
  project directories and create a new project there with `create_project`.
  Discovery creates no projects, artwork or scenes and reports malformed projects
  as unavailable. Creation atomically reserves a new child using existing name rules.

The dialog states its scope. The model cannot submit a path or browse the
filesystem through a setup tool. Finish the dialog within 55 seconds, or cancel
and ask to choose again. A cancelled dialog or failed validation/settings write
keeps the previous selection. Project/root validation happens before settings are
saved. Invalid project content does not trigger repair or interrupted-write recovery
during selection. Normal project operations retain the existing recovery and
revision contracts.

This solves the startup-grant ordering by separating bootstrap from authoring:
the initial MCP process owns only its known settings file; a native user choice
constructs the scoped domain adapter inside that process. The direct server's
startup authorization is unchanged. No general shell/file tools are added.

The native chooser currently uses macOS's system `osascript`, without a shell or
development tools. macOS folder/automation restrictions can deny the dialog or
subsequent access; the error points to **System Settings → Privacy & Security**.
Windows/Linux native selection is unavailable in this initial macOS runtime.
Their explicit launch arguments remain the fallback; bundle/platform delivery is
owned by #258/#263. The [feasibility record](evaluations/plugin-feasibility.md)
names the tested Codex client; a chooser unit test is not installed-client proof.

Later conversations reopen the persisted selection. Missing/moved directories,
replaced directories, a new symlink, read-only/denied access, invalid settings or
invalid projects leave setup available with a diagnostic. Nothing silently falls
back to cwd, a parent folder or a plugin cache. Ask to **change Forge location**
to choose again, or **reset Forge selection** (`plugin_reset_selection`) to forget
only the settings entry. Reset never deletes a project.

Selection is checked before each project call and artifact read. Another
conversation changing/resetting settings revokes the old session's grant; that
session must explicitly choose again. A switch replaces the adapter and clears
session preview resources. Read current revisions and regenerate previews before
continuing. Symlink/path containment remains enforced for project children and
declared files. This is a cooperative local application boundary, not a sandbox
against another process running as the same OS user.

## Data ownership and browser handoff

The default macOS settings file is
`~/Library/Application Support/Scene Forge/selection.json` (schema version 1,
scope, canonical path and directory device/inode). Its parent is created only
after a successful choice; the selection file is written atomically with owner
read/write permissions. Cache/log output belongs under
`~/Library/Caches/Scene Forge/`. OS-appropriate Windows/XDG locations are defined
for future platform delivery; there is no project-path environment override.
These locations and user projects must be separate from each other and the
runtime/plugin bundle, including ancestor/descendant aliases.

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

The bundled `bin/forge browser --plugin` uses the same manager and opens the OS
browser. With a root selection, add `--project-name NAME` for one immediate
project. `--no-browser` prints the verified URL to stderr and exits. Managed
browsers choose their own port; `--port` applies only to direct launches.

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
The dedicated artwork/scene skills in #259/#260 own detailed authoring workflows;
the entry skill routes to them when delivered, with current guarded tools as a
fallback. Installed handoff and independent-user acceptance stay with #261/#264.
