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

For a new game or design with no chat selection, ask the user to choose their
game folder. Explain that Forge uses `.gbc-scene-forge/` inside it for named
projects. Call `plugin_choose_location` with `mode:workspace`. If the host
provides an absolute working folder for this chat, pass it as `start_in` to
position the picker. Omit the hint if unknown. The native dialog grants access
to the chosen location. Ask the user to finish or cancel it. A cancelled picker
keeps the current selection. If the user wants to open a particular Forge
project elsewhere, use `mode:project`. Use `mode:root` only for an explicitly
requested existing library layout.

Show the confirmed absolute Forge location before proceeding. A legacy saved
selection is reported as `selection_scope:legacy`. Use it when the user is
continuing that project, and choose a game folder for a new task in a
different workspace. New choices last for the chat's plugin connection.
In a later chat, selecting the same game folder reopens its library.

Use `list_projects` to discover named projects. Discovery creates nothing.
When the task calls for a new project, use `create_project` with a name and
starter appropriate to the request. This creates a missing library. A single
project chosen with `mode:project` has the alias `project`. Continue the
original request after selection and any required project creation. Offer change
location or `plugin_reset_selection` when requested. Switching clears session
preview resources. Read fresh revisions and regenerate previews in the chosen
project. If OS permissions prevent selection, report the actionable tool error.

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
If the client cannot open a URL, give the returned URL to the user. A separate
terminal can also open saved projects using the bundled
`bin/forge browser --project <absolute-project-directory>`. These routes need
no Python, Node or checkout.

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
