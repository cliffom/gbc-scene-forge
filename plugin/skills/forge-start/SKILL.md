---
name: forge-start
description: Select or reopen a Forge project and start a small artwork or scene design task.
---

Call `plugin_status` first, including in later conversations. Tell the user the
effective project or root and any location error. Do not infer a grant from cwd,
a checkout, a plugin cache or an arbitrary path mentioned in chat.

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

Route drawing/refinement to the artwork authoring skill when available, and scene
composition/export to the scene authoring skill when available. Those workflows
are owned by issues #259 and #260; do not claim absent skills are installed.
Until available, use current capabilities and the guarded authoring flow below.

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

Offer direct browser editing alongside chat early. The bundled launcher has
`bin/forge browser --plugin`; browser process management/handoff automation is
owned by #257/#261 and is not an MCP capability yet. If the client cannot launch
it, explain this limitation and give the user that command relative to the installed
plugin. Do not imply a repository checkout, Python or Node is needed. Consult
the maintained browser/MCP outcome matrix in the delivered documentation when
describing a specific feature; playback, selection and Undo are browser-only.
Never claim full browser/MCP parity or fabricate a browser URL.

At review/save, explain in plain language: saved content lives in the project;
an unpublished candidate is proposed work and has not replaced the saved artwork;
browser-local drafts/Undo belong to that browser. Review the exact final artwork
candidate, then commit with its current receipt. After a conflict or browser edit,
read fresh revisions and preserve the user's work through existing recovery flows.

After the small create → inspect → refine → save task, offer two useful choices,
such as place the artwork in a scene or add another animation frame. Find portable
export through `export_bundle` for saved content, or the browser for exports above
the MCP artifact limit. Do not save unrelated work just to finish an introduction.
