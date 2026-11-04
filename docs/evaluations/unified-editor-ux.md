# Unified editor human workflow review

## Scope and method

Design review on 2026-11-02 of milestone 15 at
[`88f25d0`](https://github.com/cliffom/gbc-scene-forge/commit/88f25d0fe771ad66b5e5eb99f818f2125f0309df).
The user reported an unnecessary Scene / New / open artwork row and a noisy,
convoluted artwork workspace. The intended product is one project/world, shared
tiles and sprites, contextual scene/artwork tools, and manual, agent or mixed
authoring without requiring third-party external artwork tools.

Agent inspection combined source review, Chrome/Playwright task walkthroughs and
visual inspection of fresh captures. A disposable copy of the demo project had a
native four-pose sprite sheet, two-entry animation and imported scenery. Tasks
included scene navigation, opening new-artwork setup, opening a named native
frame, opening imported artwork, switching sheet/frame views, playback, generating
an animation review, and creating/reviewing/saving a blank tile without a scene.
Viewport measurements covered 1440 × 900, 1280 × 800 and 800 × 640 CSS pixels.

This is an expert-style agent review, not independent human usability testing or
an accessibility audit. Measurements describe these fixture states, not every
document. Scratch captures and scripts are not archived evidence. Existing
[sheet](../images/unified-player-sheet.png),
[frame](../images/unified-player-frame.png) and
[compact](../images/unified-player-compact.png) captures illustrate the implemented
structure but have different viewport/state provenance; they are not the source
of the measurements below. The findings and recommendations below describe that baseline; the delivered
iteration is recorded separately at the end.

## Assessment

The domain foundation supports the intended workflow. The interface still exposes
its implementation stages: setup form, candidate editing, sequence configuration,
review receipt and commit. Human users need a document they can open, draw in,
play, save and continue editing. Most complexity should become contextual rather
than remain visible throughout that loop.

Retain the shared Library, distinct scene/artwork histories, exact pixel and
timing preservation, recoverable drafts, revision guards, explicit placement
replacement, sheet overview and animation review. The established colors and
compact spatial tool icons can remain. Reorganizing hierarchy matters more than
changing the visual theme.

## Prioritized findings

Priority 1 affects the core drawing/review loop; priority 2 affects clarity and
efficiency around it.

| Priority | Observed behavior | Human consequence | Recommendation |
| --- | --- | --- | --- |
| 1 | Scene / New / open artwork occupies a separate 48.5px row before any artwork is open. Project/scene selection and scene commands remain above the artwork workspace. | Navigation repeats, canvas space shrinks, and active-document ownership is ambiguous. | Put active document and workspace navigation in the existing context bar. Keep an accessible document switcher there; creating artwork belongs in the Library. Avoid a permanently reserved document row. |
| 1 | Existing and New artwork appear side by side, with edit, duplicate, whole-sheet copy, placement variation, blank asset and blank sheet actions simultaneously exposed. Copy actions on the left consume Name and Asset ID fields on the right. | Users must understand several storage operations before drawing; the fields for one action appear under another task. | Separate New from opening existing assets. Give duplication/import-copy their own small, source-specific flow with their own name fields. Offer selected-placement variations from the selection context. |
| 1 | At 1440 × 900, the sheet controls were about 919px high inside a 336px inspector viewport. After generating animation review, the stack grew to about 1,027px; at 1280 × 800 its viewport was about 206px high. | Frame selection, timing, playback and save comparison cannot be seen together. Scrolling to one loses the others. | Use a frame strip/timeline below the canvas, a small contextual properties inspector, and a separately opened change-review surface. Keep playback beside the sequence it controls. |
| 1 | The artwork canvas container was about 336px high initially at 1440 × 900, 206px in the reviewed 1280 × 800 state, and 124px at 800 × 640. Short-window upper controls also scroll separately. | Controls remain bounded while the actual drawing task becomes cramped; tools and color can require scrolling. | Give the canvas the remaining space after a bounded tool row and timeline. Collapse optional panes before compressing the canvas; use one accessible secondary surface at compact sizes. |
| 1 | Opening the Library's Walk frame opened Player with Idle selected and frame editing unchecked. | The entry point loses the user's requested target, making immediate correction of generated artwork uncertain. | Open the requested frame selected and visibly highlighted in the sheet. Preserve it when revisiting an already-open sheet. Make Sheet / Frame view explicit rather than a scope checkbox. |
| 1 | An untouched saved native sheet immediately says “Unsaved artwork.” Saving a reviewed asset closes its document and returns to Scene. | The state label is misleading and Save interrupts repeated edit/play/save cycles. | Distinguish Saved, Modified and New. Save should retain the document and canvas context; Close and Return to scene should be separate navigation actions. Preserve guarded bases and independent histories during that change. |
| 2 | Every Library region has its own Open artwork button, including four frames belonging to the same player sheet. Scene placement hints and Terrain & collision remain visible while editing pixels. | Repeated commands and irrelevant scene controls compete with asset browsing and frame selection. | Adapt the Library to the active task: placement regions in Scene; document/sheet groups and frame thumbnails in Artwork. Provide one clearly labeled, keyboard-accessible edit action for the selected item, with optional double-click acceleration. |
| 2 | Frame names, immutable IDs, geometry, origin, representation conversion and new sequence IDs sit among frequent editing controls. Blank and sheet creation use separate buttons sharing fields. | Technical distinctions dominate before the user has chosen what to make. | Start New with Tile or Sprite, size and name. Offer multiple frames and layout options progressively. Generate IDs with an advanced override. Keep origin/layout in Properties and representation conversion in asset actions. |
| 2 | Review current pixels, Generate animation review and Save reviewed artwork are separate actions in different places; before/after review follows the entire animation inspector. | Users must discover which review enables saving and find the next step by scrolling. | Provide a clear Save entry that leads through any required exact-change review and explicit confirmation. Keep animation playback immediate and exported animation review secondary. Retain revision-bound receipts and show shared-reference effects in review. |

The opening/saving/state findings are directly observed, with implementation
corroboration in [pixel-editor.mts](../../frontend/artwork/pixel-editor.mts).
Repeated region actions come from
[editor-artwork.mts](../../frontend/artwork/editor-artwork.mts); the inspector
structure spans [project.html](../../src/gbc_scene_forge/static/project.html) and
[sheet-editor.mts](../../frontend/artwork/sheet-editor.mts). The current layout is
defined in [project.css](../../src/gbc_scene_forge/static/project.css).

## Recommended interaction model

Use one shell with a shared Library, an active document, contextual tools and an
optional Inspector. A compact document switcher in the existing context bar
shows the active scene or artwork, modification state and document actions.
Scene selection remains available as navigation; Scene actions should not appear
to save the active artwork. Artwork creation should work without an open scene.

**New artwork:** Library → New artwork → Tile or Sprite → name and dimensions →
Create. Sprite creation optionally exposes frame size and layout; tile sheets
receive equivalent progressive options. Explain sheet size versus frame size
with a layout preview. Create enters the canvas directly. New is a document
state, not a second editing interface.

**Existing native artwork:** select an asset → Edit artwork → its sheet with the
requested frame selected. A visible Sheet / Frame control sets drawing scope.
Names and thumbnails should convey Idle, Jump, Duck and movement poses before
users need coordinates or IDs. Opening an imported asset instead offers a
focused Create editable copy flow with its source preview and exact-copy limits;
unsupported input must remain explicit rather than silently transformed.

**Draw and animate:** keep drawing tools and color close to the canvas. A frame
strip supports whole-sheet review and selecting a pose. For sprite sequences,
an optional animation panel below the canvas contains named sequences,
thumbnail entries, durations, ordering, loop, play and step. Sequence entries
reference artwork frames and may repeat them; do not imply that changing a
duration edits the source frame or that named poses define gameplay behavior.
Onion skin belongs beside frame/animation viewing. Tiles expose repetition
preview rather than unrelated sprite controls.

**Save and review:** maintain one visible document state and Save action. It can
open a focused before/after review with affected references and an explicit
commit action, rather than requiring users to locate an enabling review command.
The review must bind the exact pixels, timing and saved dependencies; edits
invalidate it and conflicts retain local work. Downloading an animation review
is a separate result, not a competing primary workflow. Saving retains the
document. Discard belongs in document actions, separated from Save.

**Manual/agent continuity:** once generated artwork is saved and visible to the
browser, it follows the same asset → selected frame → playback → correction
route. Show externally changed/stale state distinctly from local modification;
offer explicit reconciliation while preserving local work. Saved assets, local
drafts and agent candidate handles must not be presented as interchangeable.
The existing candidate/recovery contracts remain in
[the unified editor contract](../UNIFIED-EDITOR-DESIGN.md); this review does not
promise a new browser inbox for unpublished agent candidates.

## Recommended scope for the next design iteration

Treat this as a focused interaction redesign on the existing foundation. First
resolve document navigation, creation/opening, correct frame targeting and
document state/save behavior. Then arrange canvas, properties and animation as
coherent regions and adapt the Library. Avoid merely collapsing the current
form stack: it would hide commands without fixing their relationships.

Judge a prototype by concrete tasks: create a tile without a scene; open an
existing Walk pose directly; inspect the full player sheet; edit a pose while
keeping animation playback reachable; review exact shared changes; save and keep
drawing; return to Scene and resume the artwork without losing context. At
1280 × 800 and 800 × 640, assess the drawing area and command discovery, not just
whether the footer fits. Include keyboard entry and focus transitions. These
are proposed evaluation tasks, not claims that the redesign has passed them.

This proposal changes presentation and some document lifecycle behavior; it
does not require another asset format or a replacement for the domain services.
Any accepted implementation should update the
[layout guidelines](../UI-DESIGN.md) and
[artwork user guide](../user/pixel-artwork.md) alongside the interface.


## Delivered interaction redesign

Implemented in the prepared 0.29.0 working tree based on `88f25d0`, checked
2026-11-02 local time (2026-11-03 UTC). The baseline findings above retain their
original scope. The delivered interface puts document navigation in the existing
context bar, separates New from existing/copy setup, opens the requested pose,
and places frame/animation controls below drawing. Properties and exact-change
review open independently. Saving retains the document, viewport and Undo/Redo
with the newly acknowledged saved base. The Library adapts to scene placement or
artwork opening and groups frames by atlas.

Fresh source-checkout captures use a disposable demo copy with a native four-pose
Player sheet and two-entry Walk sequence. These are synthetic fixture pixels,
not production art. Agent visual inspection covered these captures; no
independent human study is claimed:

| State | CSS viewport | Capture |
| --- | --- | --- |
| Scene, without a reserved artwork row | 1440 × 900 | [Scene](../images/artwork-workspace-scene.png) |
| Focused creation, optional recovery collapsed | 1440 × 900 | [New artwork](../images/artwork-workspace-new.png) |
| Whole sheet with Walk selected | 1440 × 900 | [Sheet](../images/artwork-workspace-sheet.png) |
| Frame drawing with expanded animation dock | 1440 × 900 | [Animation](../images/artwork-workspace-animation.png) |
| Expanded animation, laptop | 1280 × 800 | [Laptop](../images/artwork-workspace-laptop.png) |
| Expanded animation, compact | 800 × 640 | [Compact](../images/artwork-workspace-compact.png) |
| Explicit before/after save confirmation | 1440 × 900 | [Review](../images/artwork-workspace-review.png) |

With animation expanded, the measured canvas scroll surface is 200.5px high at
1280 × 800 and 161px at 800 × 640. Fit selects 8× for the fixture's 8 × 16 frame
in the compact view. Closing animation recovers drawing space. Compact animation
content scrolls within its bounded dock; Save stays reachable. These dimensions
describe this fixture, not every combination of content or user scaling.

Browser acceptance covers progressive controls and recovery, keyboard entry,
requested-frame opening, sheet/frame scope, sequence timing, guarded review,
repeated saves with retained history, exact manual/agent handoff, first use and
portable export/reopen. The [validation record](../VALIDATION.md) owns results,
material failures and remaining checks. The review does not promise a browser
inbox for unpublished agent candidates or a complete accessibility audit.


## Feedback refinements

User feedback on the working tree based on `3a13eb4` identified the setup's
“New artwork” switcher as a duplicate action and the Browse/recover label as cut
off. On 2026-11-02 local time (2026-11-03 UTC), the source-checkout captures above
were refreshed after hiding the switcher in setup when no document is retained,
using **Documents ▾** when retained documents exist, and allowing the complete
**Browse / recover** Library label to wrap. Capture fixture and viewport sizes
remain those in the delivered-layout table. Asset identity now follows the name
with punctuation removed and whitespace normalized; explicit overrides survive
later name changes. A [1280 × 800 identity capture](../images/artwork-name-identity.png)
comes from the source-checkout sample fixture, refreshed on 2026-11-02, and
demonstrates punctuation normalization using a generic “Player’s Sprite” example
with advanced identity expanded.

Two reported restoration bugs are addressed by rebuilding timeline controls
against the restored sequence and clearing shared comparison images, references,
APNG reviews and receipts. Returning to a document requires a fresh review before
saving. Automated acceptance uses two sheets with matching sequence IDs and
contrasting pixels/timings, then verifies a saved Walk edit leaves Idle and the
other sheet unchanged. Results and test-setup failures remain in the
[validation record](../VALIDATION.md#artwork-setup-and-document-restoration-feedback-pr-158).


## Consolidated editor assessment (milestone 22)

Prepared 0.33.0, source content committed as `0269aae`, checked 2026-11-03 local
(2026-11-04 UTC), macOS arm64, Python 3.13.13, Node 24.22.1 and Playwright Chromium.
This assessment uses the consolidated shell and command work from #194–#196,
contextual panels (#197), Library source actions (#198), and integrated checks
(#199). Earlier findings and measurements above retain their original scope.

The reproducible [panel fixture](../../tests/playwright/editor/contextual-panels.spec.ts)
creates a 32 × 16 native sheet with two 16 × 16 poses, origins [4, 8], and a two-entry
120 ms looping animation. The [Library fixture](../../tests/playwright/editor/library-sources.spec.ts)
adds static sources, no-scene illustration creation, explicit copy actions, named
pose targeting and [source deletion during copy setup](../screenshots/consolidated-editor/deleted-source-fields.png). Other supported workflows
use their existing pixel, layer, command, recovery, lifecycle and browser/MCP cases;
[layered illustration](../screenshots/consolidated-editor/layers-and-wheel.png) and
[compact layer controls](../screenshots/consolidated-editor/layers-compact.png) come
from the committed illustration/wheel regression at 1440 × 1000 and 760 × 800.
Current execution results belong in
[Validation](../VALIDATION.md#consolidated-editor-workflows-milestone-22), which owns
the single remaining-check list.

These are actual drawing-viewport dimensions in CSS pixels, with both side panes
expanded. Each value links its captured state. Normal has the dock collapsed;
Animation expands both dock and sequence controls and focuses a duration field
after keyboard navigation from Play to Step; Properties and Review use an
expanded frame dock with the animation disclosure closed. Review-ready feedback
can persist across states, making later captures slightly shorter than the initial
state. Dimensions describe the scrollable drawing viewport, not the zoomed artwork.

| Window | Normal / dock closed | Animation dock | Properties | Exact review |
| --- | --- | --- | --- | --- |
| 1440 × 900 | [910 × 535.5](../screenshots/consolidated-editor/1440x900-normal.png) | [910 × 337.5](../screenshots/consolidated-editor/1440x900-animation.png) | [910 × 407.5](../screenshots/consolidated-editor/1440x900-properties.png) | [910 × 383.5](../screenshots/consolidated-editor/1440x900-review.png) |
| 1280 × 800 | [750 × 375.5](../screenshots/consolidated-editor/1280x800-normal.png) | [750 × 177.5](../screenshots/consolidated-editor/1280x800-animation.png) | [750 × 247.5](../screenshots/consolidated-editor/1280x800-properties.png) | [750 × 247.5](../screenshots/consolidated-editor/1280x800-review.png) |
| 800 × 640 | [392 × 204](../screenshots/consolidated-editor/800x640-normal.png) | [392 × 150](../screenshots/consolidated-editor/800x640-animation.png) | [392 × 150](../screenshots/consolidated-editor/800x640-properties.png) | [392 × 150](../screenshots/consolidated-editor/800x640-review.png) |
| 1280 × 600 | [750 × 214](../screenshots/consolidated-editor/1280x600-normal.png) | [750 × 150](../screenshots/consolidated-editor/1280x600-animation.png) | [750 × 150](../screenshots/consolidated-editor/1280x600-properties.png) | [750 × 150](../screenshots/consolidated-editor/1280x600-review.png) |

[Raw canvas measurements](../screenshots/consolidated-editor/canvas-space.json)
retain viewport positions and unrounded dimensions. At 800 × 640 and short desktop
heights, an expanded dock leaves a shallow 150px drawing region with both side
panes present. The dock scrolls internally; sequence/timing controls may require
scrolling. Collapsing Frames & animation restores drawing height, and common
Library/Inspector collapse handles restore horizontal space. Document-bar Save
and the bottom Document actions remain reachable in every measured state. This is
an explicit compact-size tradeoff, not evidence of prolonged drawing comfort.

The same fixture instruments 32 frame-navigation changes after thumbnails have
been rendered: zero thumbnail raster paints, zero thumbnail subtree rebuilds,
zero additional dock listeners and zero growth in DOM canvas count.
[Work counts](../screenshots/consolidated-editor/navigation-work.json) extend the
[existing rendering foundation](artwork-interaction-polish.md); the existing hover
regression separately requires zero raster/control work. Source review caught a
new dock listener placed in redraw; it was moved to mount scope before the final
runs. The new work-count test then exposed unchanged frame-label text-node writes;
those are now skipped. Source-action testing also exposed a rapid-click race during
pending native open, corrected by disabling those actions through the shared busy
gate. Retained shared sources are reused instead of opening a second local session.
The first completed broad run exposed a Colors popover opening-position race after
a window resize (145 cases passed, one failed, eleven optional profiles skipped).
Palette position is now bounded before its first visible frame and updated during
resize while open; five focused repetitions passed before the final full run.

The checks measure bounded work in these fixtures, not process heap, physical GPU
memory, all document sizes or all sixteen retained documents at maximum history.
Synthetic acceptance and agent screenshot inspection do not complete independent
participant evaluation (#165) or findings-based remediation (#166). Existing
revision/token/path guards, exact review, atomic variation adoption, independent
histories and portable saved content remain domain-owned; there are no new storage
formats or MCP authoring operations.
