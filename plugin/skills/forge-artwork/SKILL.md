---
name: forge-artwork
description: Create or refine editable pixel illustrations, tiles and static sprites in a selected Forge project, with image inspection and guarded save. Use forge-animation for timed sheets.
---

Use Forge's bundled MCP tools for the requested artwork. Follow
[forge-start](../forge-start/SKILL.md) for project selection, installation errors
and browser lifecycle. Call `plugin_status` even in a resumed conversation, show
the effective location, then read `capabilities`. Its actual `tools` inventory
governs which operations can run; feature descriptions can mention tools absent
from this plugin profile. Never bypass selection or install another runtime.

Read [native editing and review](references/native-editing.md) before the first
edit; it gives compact-handle, layer, batch, receipt and handoff contracts. For
representative briefs or behavioral evaluation, read
[workflow checks](references/workflow-checks.md). For frames/timing, use
[forge-animation](../forge-animation/SKILL.md).

Start from the brief and saved inventory (`get_project`, then `list_artwork` with
its revision). Reuse an existing native target when requested. Ask only for a
missing decision that changes the result: intended dimensions/use, visual style,
transparency, an explicit palette/target, or whether edits should affect a shared
asset or only selected placements. Otherwise state reasonable choices and begin.
General pixel art is the default. Do not impose GBC grids, palettes or budgets on
an illustration or arbitrary sprite. Tile geometry still follows native tile
sizes. Requested/configured target estimates are not runtime certification.

Open saved native artwork with its fresh target and artwork/project revisions;
create new artwork with `create_artwork(...,compact:true)`. Imported artwork is
read-only until copied. Shared edits affect every reference. Selected-placement
variations require the explicit duplication/replacement workflow, currently a
browser handoff in this profile. Do not simulate a variation by editing the shared
source or silently replacing scene references.

Build an unpublished candidate and render a useful first pass early. Prefer a
few deterministic batches for silhouettes, color planes and repeated motifs;
refine intentional pixel clusters rather than issuing one tool call per pixel.
Use named layers when they improve editability. Preserve unrelated source pixels,
layers (including hidden/locked sources), palette choices, metadata and frame
content during scoped work. Whole-document replacement, quantization, flattening,
resizing and palette conversion require a task that calls for those changes.

Actually inspect the returned PNGs at native size and an integer nearest-neighbor
detail scale before choosing refinements. Assess silhouette/readability, edge
rhythm, contrast, shading, transparency and the requested style. Use before/after
and changed overlays for a scoped edit. A tool success, receipt, color count or
decoded PNG is not evidence that the image was seen or that the art is good.
If the client cannot expose images to the model, disclose that limit and arrange
browser/user inspection; leave work unpublished unless the user explicitly
authorizes saving without model inspection. Never claim unseen images were reviewed.

Refine from observed defects, rerender changed content, and inspect the final
candidate. Confirm the full scope and affected references through exact review
before `commit_artwork` with that candidate's current receipt. Carry forward any
existing user authorization to save; do not ask for routine approval again.
After saving, read fresh inventory and reopen to verify the intended result.
Report what changed, what was visually inspected, what was saved versus retained
as a draft, and any target/client limits. Offer a useful next action only when it
helps the task, such as placing the artwork or adding animation.

Forge alone must suffice. External image generation/reference tools are optional:
state availability, connectivity/cost implications and intake limits before making
them part of a proposed workflow. Do not treat them as required dependencies.
