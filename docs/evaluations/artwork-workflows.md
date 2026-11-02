# Mixed pixel artwork workflows (#134, #135)

The bounded workshop completes new-tile creation, selected sprite variation and
alternating browser/MCP revision with saved-base conflict recovery. Selected
replacement is a separate choice from shared editing and duplication alone.
It requires a saved scene in the browser; this prevents variation saves from
overwriting local scene work.

## Scope and attribution

Evaluated on 2026-11-02 in the implementation working tree based on
[`7a42dc5`](https://github.com/cliffom/gbc-scene-forge/commit/7a42dc5b8fbd1e2fde0d7c92833ef14bc6450f39):
macOS 27.0.1 arm64, Python 3.13.13, Node 24.22.1 and Playwright 1.64.1.
The production browser label was 0.27.0. This scope identifies the pre-commit
source walkthrough; final package/acceptance provenance belongs in
[Validation](../VALIDATION.md).

Codex supplied a task-derived brief: an 8×8 moss tile and two 16×16 warm lantern
props, followed by a cool variation for the first lantern. The
[workshop client](../../examples/mcp/artwork_workshop.py) used the actual optional
SDK over stdio, explicit saved bases, pixel writes, PNG resource reads, temporary
scene review, guarded artwork commits and scene placement. The script does not
call a model. Codex inspected actual images and chose the subsequent revisions;
this is an agent visual assessment, separate from the scripted acceptance below.
No human participant took part.

## Task walkthrough

| Task | Observed outcome | Retained evidence |
| --- | --- | --- |
| Brief → new tile/sprite → review → commit/place | SDK client created original RGBA artwork, reviewed temporary placements, committed and saved a 96×80 scene containing repeated moss and two lanterns. | [Initial scene](assets/artwork-workflows/workshop-before.png), [repeatable client](../../examples/mcp/artwork_workshop.py) |
| Hand edit → Undo/Redo → review/save | Agent drove normal browser Pencil at moss pixel 0,0 to RGBA 146,161,90,255, then Undo/Redo, scene review and save. Review reported 120 saved tile references; the scene stayed saved. | [Exact actions and observations](assets/artwork-workflows/observations.json) |
| Inspect → request agent revision | After inspecting repeated highlights, Codex softened that corner to 98,128,70,255 through MCP. For lantern 1 it requested cyan glass/light while retaining the dark silhouette and original lantern 2. | [Final scene](assets/artwork-workflows/workshop-after.png), [enlarged cool lantern](assets/artwork-workflows/cool-lantern.png), exact input writes in [observations](assets/artwork-workflows/observations.json) |
| Save selected sprite variation | The source lantern PNG remained byte-identical to the initial saved resource. Only object 1 changed asset; object 2 kept the original. Placement IDs, coordinates and origin semantics remained stable. | [Assertions and object snapshots](assets/artwork-workflows/observations.json) |

The moss remains visibly periodic and the lanterns are simple fixture art. The
cool/warm difference is visible in scene context while both retain their outline.
This establishes that exact pixels, preview and revision are usable for these
specific tasks; it does not establish broad art quality, novice success rates or
prolonged drawing comfort. Generic RGBA and transparency remain available without
target palette conversion.

## Repeatable acceptance and failure boundaries

- [Domain variation tests](../../tests/backend/artwork/test_artwork_variations.py)
  cover selected/unselected references across scenes, eight tile transforms,
  metadata, sprite origins/properties, stamps/definitions, ZIP reopen, stale
  selections, changed review content, final-write races, failed map-write rollback
  and recovery of immutable selections.
- [Optional SDK coverage](../../tests/backend/adapters/test_mcp_native_artwork.py)
  covers strict nested wire schemas, exact transparent pixels/resources, reviewed
  creation/placement and selected tile replacement through the installed SDK.
- [Pixel browser acceptance](../../tests/playwright/artwork/pixels.spec.ts)
  covers selected tile/sprite choices, recovered variation drafts, dirty-scene
  refusal, stale selected scenes, save/reload and later scene saves retaining
  replacements. Existing scenarios retain drawing, cancellation, external artwork
  conflicts, lost acknowledgments and ordinary scene-history isolation.
- [Mixed SDK/browser acceptance](../../tests/playwright/mcp/artwork-mcp.spec.ts)
  runs the workshop, hand-edits with Undo/Redo, preserves the hand edit during a
  fresh MCP revision, varies one of two sprites, then races a reviewed browser
  candidate with an actual MCP save. Save and recovery reject the stale base;
  the checkpoint remains downloadable and the winner's saved pixels survive.
  A portable ZIP is extracted and reopened to verify the final mixed result.

The first local implementation check exposed a missing required map-read budget
message and failed native saves; this was corrected before the focused suites
passed. The first new browser checks reached successful variation saves, then
two assertions assumed explicit layers even though the fixture used the supported
compact scene form. Correcting those test readers produced 13/13 passes without
retries. These failures are retained to distinguish implementation and test-harness
errors; they are not reported as passing runs.

Visual inspection found generic preview wording that incorrectly described a
temporary placement for variations, plus a pending-checkpoint label after explicit
review had checkpointed the pixels. Both now describe the actual variation/review
state. The desktop dialog exposes the replacement count and expandable location
list; compact layout stacks review below the canvas and keeps save controls
reachable by scrolling. Screenshots: [1440×1000](assets/artwork-workflows/variation-desktop.png)
and [800×900](assets/artwork-workflows/variation-compact.png).

Reproduce source checks with `make docs-check lint test`, the pixel spec, and
`FORGE_MCP_ONLY=1 npm run test:playwright -- mcp/artwork-mcp.spec.ts` with the MCP
extra installed. Repeat against a built plain wheel for pixel acceptance and an
installed optional-MCP wheel for transport/mixed checks. Exact final counts,
revision/environment and package results are recorded once in
[Validation](../VALIDATION.md); ignored local reports/transcripts are not archived
CI evidence. Committed images, observations and executable sources are retained.

## Compatibility and limits

External PNG/gbc-atlas/Aseprite sources stay under explicit import/reimport control.
Copy supported cells/static sprites to edit natively; no layered Aseprite
round-trip is claimed. Native metadata, portable descriptors and sprite origins
retain the #129 contract. GBC constraints and gbc-atlas conversion remain optional
and separately owned. There is no animation timeline or game-specific build path.

Browser variation selection is limited to one saved active layer, with Across
layers off and one matching source. MCP permits explicit saved locations across
scenes. At most 256 placements, 64 saved scenes and 16 MiB map input are reviewed;
larger projects must narrow scope. Stale candidates/drafts are downloadable for
explicit reconciliation, not automatically rebased. Not every workflow was
repeated at both viewports. No human, Windows, non-Chromium, screen-reader,
physical-device or official Tiled/rasterizer assessment was performed here.
Outstanding maintained checks stay in the
[single Remaining checks list](../VALIDATION.md#remaining-checks).
