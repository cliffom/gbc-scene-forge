# Native editing and exact review

The installed tool schemas are authoritative for arguments and current limits.
These recipes use the bounded plugin inventory; do not call a tool merely because
`capabilities` describes its underlying domain feature.

## Candidates and narrow edits

Use `compact:true` on create/open. Every edit returns a new immutable candidate;
use that returned handle for subsequent calls. A handle contains `handle`,
`project_id`, `project_revision`, `revision`, and sometimes `owner`. Retain all of
those fields, including browser ownership. Candidate listing rows contain other
descriptive fields: pass only their handle fields, not the entire listing row.

Use `export_artwork_candidate` to inspect the canonical descriptor when layer IDs,
frames or sequence arrays are needed. Do not invent a full envelope or copy an old
one over fresh content. `read_artwork_pixels` reads exact straight RGBA8 in
row-major order, including RGB under zero alpha. Read bounded rectangles (at most
65,536 pixels), and specify `layer_id` for layered sources.

`edit_artwork_pixels` accepts exactly one of:

- `writes:[{x:1,y:2,rgba:[77,160,81,255]},...]`: unique top-left integer points;
  at most 65,536 writes and 1 MiB JSON per batch.
- `patch:{rectangle:{x,y,width,height},rgba:<canonical base64 straight RGBA8>}`:
  at most 65,536 pixels. Decode the current region first when retaining existing
  pixels; every pixel in the rectangle is replaced, including transparent ones.

Both forms replace RGBA without blending. Batch invalidity rejects the whole
edit. Prefer patches for dense deterministic regions, writes for sparse changes.
Do not erase a large bounding rectangle to change only a few pixels. Do not run
shell drawing/file tools to evade a missing MCP operation or directory grant.

For layered artwork, provide an explicit stable `layer_id`. `edit_artwork_layers`
takes the complete ordered bottom-to-top layer list with UUID `id`, `name`,
`visible`, `opacity` (0..255) and `locked`. Read that list fresh, preserve every
unrelated entry and use explicit unlocks only within the requested scope. The
first flat-to-layer migration retains existing pixels in the first source layer.
Up to eight layers are supported, subject to aggregate pixel bounds including
the composite. Composite inspection alone cannot reveal changes to hidden layers;
compare exact source reads/exports for preservation checks.

The current profile omits `edit_artwork_raster`, `edit_artwork_batch`,
`prepare_artwork_document`, `convert_artwork_palette`, PNG/layer intake and cleanup
analysis/preview/validation. Use available pixel batches or hand off to browser
tools that actually support the requested operation. Browser editing has no
automatic small-island cleanup equivalent. If a future verified inventory exposes
these tools, use their schemas: structured raster batches avoid per-pixel calls;
cleanup needs explicit source/region/protected features, selected finding IDs,
before/after validation and visual review. Small islands may be intentional stars
or glints; numeric constraint success is not artistic approval. Do not claim
automatic semantic repair, silhouette scoring or hardware compliance.

## Rendering and publication

`review_artwork_candidate(candidate,scale:4)` returns native/enlarged before/after
PNG resources, affected references and an exact whole-candidate `receipt`. Review
has at most 256 reference locations per page; follow `offset` for further pages.
For large canvases, inspect the overview plus relevant native rectangles: default
overview sampling can hide individual defects. Read the reported scale/sampling
rather than claiming a sampled overview is native resolution.

`inspect_artwork_candidate(candidate,rectangles:[{x,y,width,height},...],
format:"png",scale:4,changed_overlay:true)` creates labelled before/after detail
cells. PNG must be requested explicitly (SVG is default). Use an explicit
`before_candidate` to compare with a prior draft; otherwise the baseline is saved
artwork (transparent for new documents). Magenta marks composite changes, including
hidden RGB differences, but cannot reveal changes confined to invisible sources.
The response states coverage `complete`, exact revisions and receipt. Partial
coverage is detail evidence, not proof the whole document was inspected. Each
call accepts 1..8 rectangles and scale 1..8, with a 512-pixel cell-axis limit;
split large inspections into bounded pages. Native/enlarged review and contact
sheets preserve nearest-neighbor pixels within their reported view.

Inspect actual inline images when supported. At most two PNGs / 4 MiB decoded PNG
bytes are inlined per response; other images remain resource links. Use the
client's supported resource/image reader when needed. A resource URI is not an
arbitrary local path. Regenerate expired images; previews disappear on cache
eviction, selection change or MCP exit. Do not infer visibility from resources/read
success alone. Browser review is the fallback when image display is unavailable.

After final inspection, call `commit_artwork(candidate,receipt:<matching receipt>)`.
The receipt binds the entire exact candidate and saved bases even when obtained
from a detail view; that does not make partial visual inspection complete.
Any pixel, layer or timing edit invalidates the old receipt. Conflicts require a
fresh project/inventory/open and a deliberate reapplication of the intended
changes, with fresh review; never swap in new base revisions to force a stale
candidate through. Preserve/export the old candidate for comparison/recovery.

## Browser and recovery boundaries

Use `plugin_browser(project,action:"open")` and the client's browser capability
to open its verified returned loopback URL. Saved artwork opens through Documents.
For unpublished work, open From agent and let the user inspect/adopt the exact
retained candidate. Adoption does not publish or transfer agent Undo. After Return
candidate to agent, rediscover the owner-bearing handle and inspect it fresh;
after a browser save, reopen saved artwork with fresh revisions. MCP cannot read
browser-local Undo or silently merge unsaved browser work. A browser save and a
candidate commit are separate publication routes.

Independent copies/selected-placement variations and imported-source duplication
currently use the browser. Preserve the source and unrelated placements; review
the exact selected replacements before save. Unsupported frame geometry changes
may need a new independent document rather than rewriting saved identities.

Retained handles survive conversations under the project's shared 256-record /
64 MiB quota. Saving does not release them. Recover with `list_artwork_candidates`;
export the full envelope before an explicitly requested release. Do not clear
other owners' records or infer that stale/same-looking work is disposable. Durable
bulk archives are outside this profile. `export_bundle` contains saved content,
excluding unpublished candidates and browser drafts; use browser export above
the MCP artifact limit. Browser process stop/update rules remain in
[forge-start](../../forge-start/SKILL.md).
