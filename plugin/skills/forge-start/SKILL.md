---
name: forge-start
description: Select or reopen a Forge project and start a small artwork or scene design task.
---

Call `plugin_status` first, including in later conversations. Tell the user the
effective project or root and any location error. Do not infer a grant from cwd,
a checkout, a plugin cache or an arbitrary path mentioned in chat.

Read `installation` in status for plugin/runtime versions, target and build ID.
The bundled [compatibility contract](../../compatibility.json) describes the
supported combination. Installation errors require restoring the complete bundle
and starting a new conversation. Never download dependencies, repair the cache,
or migrate projects to work around an incompatible build. Keep the prior complete
repository for rollback. Before updating, finish/save or export work, explicitly
stop its managed browser and close old chats: the tested client removes the old
cache on update. An interrupted live session fails closed; restore its complete
matching bundle or start a fresh conversation with the update. Settings/projects are
outside the plugin. Disabling/uninstalling does not itself stop an existing browser.

Plugin mode exposes a bounded 32-tool profile so setup remains callable in the
demonstrated client. After selection, inspect `capabilities` for the actual
inventory and `unavailable_tools`. Use the browser for unavailable operations;
do not guess hidden tool names. The outcome matrix's MCP column describes the
full direct-launch inventory, which is broader than this plugin profile.

If no selection is available, explain the two choices: open one existing Forge
project, or choose a parent folder in which Forge can discover and create immediate
projects. Call `plugin_choose_location` with `mode:project` or `mode:root` as
appropriate. The native dialog is the user's directory grant; ask them to finish
or cancel it. The tool has no path argument. Cancellation keeps the old selection.
If OS permissions prevent selection, report the actionable tool error. Never work
around denied access with shell/filesystem tools or broaden to a parent directory.

Show the selected absolute location before proceeding. `list_projects` is
read-only and reports invalid/unavailable immediate projects without repairing
them. A single selected project uses the alias `project`. For a new project,
select its parent root and use `create_project` with the user's chosen name and
starter only after they request creation. Never create assets/scenes during
discovery. Offer change location or `plugin_reset_selection` when requested;
reset forgets only the selection. Switching discards session preview resources;
read fresh revisions and regenerate previews in the chosen project.

Offer an optional introduction only if the user has no specific task: draw a
small sprite, build a small scene, or explore this project. A specific request
skips the introduction. Prefer existing assets and scenes; create only what the
chosen task needs. Keep general pixel art as the default; GBC constraints are opt-in.

Route drawing/refinement to [forge-artwork](../forge-artwork/SKILL.md) and timed
sheets to [forge-animation](../forge-animation/SKILL.md). Scene composition/export
uses [forge-scenes](../forge-scenes/SKILL.md), including its bundled outcome routes
for stamps, diagnostics and other browser handoffs.

For drawing, make a small unpublished candidate and render a useful PNG early.
Actually inspect it before refinement; offer native and integer nearest-neighbor
views. Introduce pixel tools, palettes and layers only when useful. For animation,
introduce frames and timing and inspect a contact sheet if APNG cannot play.
If images are unavailable in this client, say so and arrange browser review;
a successful tool call alone is not visual inspection.

For a scene, inspect saved artwork first, then make a small composition or
blockout and render an overview/camera view early. Introduce tile layers,
objects, reusable stamps and camera framing as the task needs them. Use current
revisions for edits and dry-run/review before saved mutations.

Offer direct browser editing alongside chat early. Call `plugin_browser` with the
selected project and `action:"open"`, optionally with a saved scene ID. Open only
its verified returned loopback URL using the client's browser capability. Saved
artwork opens from Documents; an unpublished candidate is not saved by handoff.
If the client cannot open a URL, give the returned URL to the user. The bundled
`bin/forge browser --plugin` is also available (add `--project-name NAME` for a
root selection). Neither route needs Python, Node or a checkout.

The browser survives chat closure and expires after 30 minutes without editor
requests. Reuse it for later conversations; never stop it during ordinary cleanup,
selection reset or chat closure. A stop affects all sharing tabs: only on an
explicit user request, inspect `action:"status"` then pass that exact `instance`
to `action:"stop"`. If unavailable or a saved port is occupied, report the error;
never kill an unknown process or fabricate another URL. Session previews expire
with MCP; saved content, browser checkpoints and retained candidates have separate
lifetimes. Consult the delivered browser/MCP outcome matrix for feature boundaries;
playback, selection and Undo are browser-only.

At review/save, explain in plain language: saved content lives in the project;
an unpublished candidate is proposed work and has not replaced the saved artwork;
browser-local drafts/Undo belong to that browser. Review the exact final artwork
candidate, then commit with its current receipt. After a conflict or browser edit,
read fresh revisions and preserve the user's work through existing recovery flows.

Compact handles persist across reset/restart; each changed handle retains another
candidate against the shared 256-record / 64 MiB quota. Recover handles and inspect
quota with `list_artwork_candidates`. Before explicitly discarding a selected
candidate, preserve its full envelope with `export_artwork_candidate`, then use
`release_artwork_candidate` to free its sidecar. Release does not delete saved
artwork. Saving or browser adoption does not release agent handles. Never infer
that a stale base or another revision makes an unpublished branch disposable.
Stamp creation/placement, frame-specific review and bulk candidate archives use
the browser or the full direct-launch MCP inventory.

After the small create → inspect → refine → save task, offer two useful choices,
such as place the artwork in a scene or add another animation frame. Find portable
export through `export_bundle` for saved content, or the browser for exports above
the MCP artifact limit. Do not save unrelated work just to finish an introduction.
