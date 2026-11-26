---
name: forge-animation
description: Create or refine native Forge sprite/tile sheets, frame sequences and timing, inspect animation continuity, and save with an exact review receipt.
---

Use [forge-artwork](../forge-artwork/SKILL.md) for setup, fresh discovery, scoped
pixel/layer edits, visual quality and guarded save. Read its
[native contracts](../forge-artwork/references/native-editing.md) before editing.
This skill adds the sheet/timing decisions; it does not require external generation.
See [workflow checks](../forge-artwork/references/workflow-checks.md) for briefs.

Resolve the requested frame size, action/poses, sequence order, durations and
looping from the brief or saved sheet. Ask only when an unresolved choice matters;
otherwise state a reasonable first pass. Do not impose a frame count, GBC palette,
symmetry or uniform timing without a reason. Inspect existing frames, origins and
sequences before changing an animation. Clarify shared artwork versus a selected
placement variation when the scope is ambiguous.

Create with `create_artwork_sheet(...,compact:true)`, explicit native `frames` and
`sequences`. A frame is `{id,name,kind:"sprite"|"tile",x,y,width,height,origin:[x,y]}`;
a sequence is `{id,name,loop,frames:[{frame_id,duration_ms},...]}`. Keep IDs stable;
use lowercase letters/digits/underscores starting with a letter (up to 64
characters). Sheet axes are multiples of eight within 8..256; frame rectangles
use eight-pixel alignment and fit inside that sheet. Coordinates are sheet pixels.
Sequence frames share kind, dimensions and origin. Tile origins are `[0,0]`;
sprite origins fit their frame. Use `sequences:[]` for a nonanimated
sheet; separate tile variants do not imply an animation. Current bounds: 128
frames, 64 sequences, 256 entries/sequence, 1,024 total entries, durations
1..65,535 ms, plus document pixel limits. Read actual schemas before choosing sizes.

For existing sheets, open the fresh native target. Export its current candidate
descriptor, copy the complete frame/sequence arrays, change only intended entries,
then call `edit_artwork_layout(candidate,frames,sequences)`. Preserve IDs, geometry,
origins, other sequences and unselected timing. Existing frame IDs/geometry/origins
cannot be replaced; rename/reorder and append are supported. Changing saved frame
geometry requires a supported independent-copy/browser workflow. Never reconstruct
a whole sheet from a remembered summary. Pixel edits use sheet coordinates and
explicit layer UUIDs, retaining unrelated frames and hidden sources.

Inspect a first pass early and the final pass after refinement:

- Use `review_artwork_candidate` for the whole-sheet overview, exact references and
  receipt. Inspect every changed frame at native and integer nearest-neighbor scale.
- Request `inspect_artwork_candidate` with `format:"png"` and frame rectangles in
  sequence order (up to eight per page). For repeated entries, include their order
  in the report; a sheet of unique frames alone does not establish playback order.
  The contact labels show coordinates, not duration or sequence IDs. Read and
  report actual `frame_id`, `duration_ms` and `loop` from the exact descriptor.
- Call `review_artwork_animation(candidate,sequence_id,scale)` for the affected
  sequences' timing-preserving APNG. Inspect playback if the client actually
  supports it. Otherwise disclose that playback was not observed, inspect PNG
  contact pages and the explicit timing/order, and offer the managed browser's
  playback/onion-skin controls. APNG tool success does not prove animation played.
  `review_artwork_frame` is absent from the current plugin profile; contact sheets
  provide the available isolated-frame inspection route.

Check silhouette consistency, origins/registration, motion arcs, spacing between
poses, intentional holds and the last-to-first transition for loops. Include any
unchanged predecessor/successor frames needed to judge a scoped change. Static
inspection can reveal jumps but cannot establish perceived cadence. If playback
is unavailable, distinguish the checked frame/order/duration facts from that limit.
If no images can be inspected, follow the artwork skill's browser/user-review
fallback and do not claim visual acceptance.

Refine only the intended frames/timing, regenerate affected previews, and commit
the exact final candidate with a fresh review receipt and existing save
authorization. Reopen fresh saved content and verify the edited durations/order
and preserved frames/layers. Explain that PNG sheet export loses playback timing;
native saved artwork retains editability and sequence metadata. Retain unpublished
work when the user requested a preview, not publication.
