---
name: forge-scenes
description: Create or refine Forge blockouts and artwork-inclusive scenes, arrange existing assets and reusable compositions, inspect candidates, and export portable Tiled projects.
---

Follow [forge-start](../forge-start/SKILL.md) for selection and browser lifecycle.
Call `plugin_status` even when resuming, show the effective location and inspect
`capabilities`. Use only its actual tool inventory. Read the bundled
[outcome routes](references/outcome-routes.md) before choosing an operation;
the full MCP outcome matrix includes tools absent from the installed profile.
Read [portable export](references/portable-export.md) when exporting and
[workflow checks](references/workflow-checks.md) for evaluation briefs.

Start with `list_projects`, `get_project`, then `get_scene` for the chosen saved
scene. Inspect atlas regions, grid-compatible tiles, sprite dimensions/origins,
definitions, stamps, world connections and ordered layers before editing. Names
help discovery; canonical IDs identify targets. Reuse the user's artwork and
compositions. Ask only for decisions that materially change the result, such as
which scene, dimensions/camera intent or shared-artwork scope. Otherwise state
reasonable choices and begin. General pixel art is the default; GBC targets are
opt-in, and no diagnostic establishes game physics or hardware fit.

For artwork-free planning, use `create_blockout_scene` with explicit units, grid,
dimensions and camera settings. Creation saves the initial scene; it is not an
unpublished draft. Discover preset UUIDs from typed `blockout_role` defaults,
then dry-run geometry/marker edits. Keep the plan on its existing layers when
adding artwork later. Use [forge-artwork](../forge-artwork/SKILL.md) only when
new pixels are needed, and [forge-animation](../forge-animation/SKILL.md) for
timed sheets. Inspect/review/commit artwork before placing its saved asset IDs;
an unpublished artwork handle is not a saved atlas reference.

Scene width/height and tile painting coordinates are **cells**; multiply by grid
for pixels. Objects, camera rectangles and sprite anchor positions use whole
**pixels**. A sprite's drawn top-left is `(x-origin_x, y-origin_y)`; preserve the
saved origin unless intentionally changing its anchor. Stored layers draw bottom
to top; browser layer lists show the reverse. Keep IDs, allocation counters,
visibility, typed overrides and unrelated objects/layers/tiles intact. Supplying
an object's `properties` replaces its entire explicit override list. Preserve
world endpoints and artwork; do not delete/recreate content to simplify an edit.

Use `edit_scene(...,dry_run:true)` for supported object/tile/layer changes. For
sprite insertion or other canonical edits, copy the freshly read scene, change
only the requested fields, allocate IDs from its counter, and validate through
candidate review before `save_scene` (which has no dry-run option). Preserve flat
versus layered canonical representation. Use returned canonical candidates,
including their allocation counters. Batches permit 128 operations, 4,096 cell writes and 4 MiB
input; split larger work deliberately, with a new inspected base after each save.
Scenes allow 65,536 cells, 8,192 px per axis and 128 layers. Smaller review bounds
still apply. Reusable stamp creation/placement and diagnostics use the browser
in this profile; do not invent hidden tools or approximate stamp placement with
unreviewed layer/object copies.

Render the candidate early, then refine from what is actually visible. Use
`review_artwork` for artwork-inclusive PNGs and `review_blockout` for planning
geometry and camera intent, passing the same candidate and original saved guards.
Inspect overall spacing, focal hierarchy, overlaps, route readability and camera
framing, plus native-scale tile joins, sprite edges and origins. Artwork PNGs omit
planning overlays; use both reviews or browser combined Scene view. Review's
`snapshot_revision` must identify the final candidate. Scene review is advisory,
not an artwork commit receipt or a save.

An artwork overview is at most 1024×1024 native pixels and defaults to the top-left
bounded rectangle. Check `overview_complete` and page explicit pixel rectangles
for larger scenes; do not call a cropped view a full composition review. Use
integer nearest-neighbor enlargement in the browser for detail. Actually inspect
the images/resources: successful calls or PNG decoding do not establish layout
quality. If the client cannot expose images, disclose the limit and arrange
browser/user review; keep the scene candidate unpublished unless the user
explicitly authorizes saving without model inspection.

After final inspection, `save_scene` the exact candidate with its original
project/scene revisions, then reread saved content. Carry forward authorization
already given to save. On conflict, preserve the candidate, fetch current project
and scene, compare changes and deliberately reapply only still-intended edits;
review again. Never swap fresh hashes onto an old destructive candidate. After a
lost acknowledgment inspect saved state before another write. Browser-local
drafts/Undo, scene candidates held in chat and retained artwork handles have
different owners/lifetimes; MCP cannot inspect or save the browser's unsaved scene.

For browser handoff call `plugin_browser(project,action:"open",scene_id:<saved ID>)`
and open its verified returned URL with the client's browser capability, or give
it to the user. Say which operation remains and which saved scene/base it uses.
The URL opens saved content, not the in-memory scene candidate. Preserve that
candidate separately; never save it solely to expose a preview without review.
After browser Save, read fresh canonical content before resuming. Use browser
Diagnostics and optional palette reports before final export; report unresolved
warnings and anything not checked. Finish with what was inspected, saved versus
still proposed, and the export/reopen result when requested.
