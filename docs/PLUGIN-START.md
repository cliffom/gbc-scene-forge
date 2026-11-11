# Plugin project selection and first task

Milestone 25's experimental runtime supports `forge mcp --plugin`. It starts
without a project grant and exposes setup tools through MCP. No checkout, Python,
Node, settings-file edits or MCP reconfiguration is needed to choose a project.
The [MCP declaration](../plugin/mcp.json) and
[entry skill](../plugin/skills/forge-start/SKILL.md) are packaging inputs for #258;
this issue does not ship a new installable marketplace release. Existing
`--project` and `--project-root` modes keep their explicit startup grants.

Plugin mode uses a fixed 32-tool profile: three setup tools and 29 authoring tools
for project discovery/creation, artwork and animation inspection/refinement,
scene/blockout editing, stamps, review/save and export. The demonstrated Codex
client exposed only the alphabetically first 32 tools from the full inventory,
which hid every setup tool and blocked first use. Both advertisement and dispatch
now enforce this bounded profile; `capabilities` reports its exact tools and
`unavailable_tools`. Use browser editing or direct `--project`/`--project-root`
MCP for other operations, including deletion, duplication, cleanup, palette
conversion, object definitions, world editing and diagnostics. Those direct
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

`bin/forge browser --plugin` opens the persisted project/root through the existing
loopback/token-protected editor, with logs under the user cache. It fails clearly
when no valid selection exists. It requires no development tools. MCP does not
yet manage/reuse browser processes or provide a handoff tool; #257/#261 own that
integration. Existing browser processes retain their original explicit scope;
switching an MCP session does not retarget or terminate them. Stop/reopen the
browser launcher to follow a new selection and retain drafts through normal recovery.

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
