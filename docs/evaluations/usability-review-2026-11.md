# Editor usability review: discovery, scope and working space

## Assessment

The shared workbench is a sound foundation. The next usability pass should put
assets and task entry points ahead of management controls, make the drawing target
unambiguous, and improve laptop defaults. Preserve the integrated scene/artwork
shell and its safety contracts. Separate beginner and expert editions would add
another interface to learn; progressive disclosure and remembered preferences
are the better design hypothesis to test.

This review identifies observed interface behavior and proposed improvements.
Priority expresses the reviewer's judgment about task impact, not measured user
frequency. No recommendations below have been implemented.

## Scope and method

- **Scope:** Agent review on 2026-11-04 local time, clean source baseline
  [`98a33d8a`](https://github.com/cliffom/gbc-scene-forge/commit/98a33d8a8e7c7c57ff0112685a2e9a7c8e6b2ed5),
  rebuilt frontend `0.37.0-98a33d8`, macOS 27.0.1 arm64, Node 24.22.1,
  Python 3.13.13 and Playwright Chromium 156.0.8078.4. Captures use
  1440 × 900, 1280 × 800 and 800 × 640 CSS-pixel viewports, device scale
  factor 1 and default browser zoom. OS display scaling was not measured.
- **Method:** Source inspection, agent visual inspection of fresh screenshots,
  scripted browser task walkthroughs and DOM bounds. A disposable copy of the
  tracked demo supplied two scenes and fourteen imported assets. A native
  32 × 16 sprite sheet added two 16 × 16 frames, Pose 0 and Pose 1, origins
  [4, 8], and a two-entry, 120 ms looping Walk animation, using the same service
  pattern as the [contextual-panel fixture](../../tests/playwright/editor/contextual-panels.spec.ts).
  A separate empty project was created through the browser. Review covered scene
  discovery, Library actions, new artwork setup, named-frame opening, drawing,
  review/save, retained-document return, pane collapse, Objects, Stamps,
  blockout creation and export configuration. Secondary dialogs were inspected;
  blockout creation and export download were not completed.
- **Result:** The final artwork walkthrough completed edit → review → confirm
  save → scene → retained artwork without a page error. The secondary walkthrough
  completed its inspected states and confirmed scene `E` selects Erase. Named-frame
  opening, Library space consumption and shortcut inconsistency reproduced.
  [Raw bounds](../screenshots/usability-review-2026-11/measurements.json) and the
  linked screenshots retain the inspected states. Earlier scratch runs failed on
  an incorrect Fit selector, an expectation that an empty project's saved-scene
  selector should be enabled, and clicking a visually concealed layer radio
  instead of its visible label. Corrected walkthroughs completed; these failures
  are script corrections, not product defects or passing regression-suite claims.
- **Limits:** This is an expert-style agent evaluation, not an independent user
  study, accessibility audit, performance benchmark or full acceptance run.
  No participant completion rates, discovery times, satisfaction scores or
  prolonged drawing results were collected. Small fixtures do not establish
  large-library usability. Recovery/conflict behavior, live agent updates,
  full world/diagnostics/budget workflows, physical trackpads, other browsers,
  OS scaling and maximum-size artwork were not exercised in this pass. Earlier
  [workflow evidence](workflow-usability.md) and
  [consolidated-shell measurements](unified-editor-ux.md#consolidated-editor-assessment-milestone-22)
  retain their own revision and environment boundaries.

## Findings and proposed changes

P1 means address in the next focused usability increment; P2 means a subsequent
polish increment. Neither label implies data loss was observed.

| ID / priority | Observed trigger and evidence | Effect on new and experienced users | Proposed change and retest |
| --- | --- | --- | --- |
| F1 · P1 | In scene mode, Library commands, filters and explanations precede every asset. At [1280 × 800](../screenshots/usability-review-2026-11/scene-laptop.png), two of sixteen cards are fully visible initially. At [800 × 640](../screenshots/usability-review-2026-11/scene-compact.png), none are fully visible; the first starts at y ≈ 586. | Beginners must scroll before seeing the material they are meant to use. Repeated brush changes make experts revisit a management-heavy panel. | Put search and assets near the top. Keep New/Import compact; group selected-source edit/copy/update/delete actions together and show recovery when relevant. Offer thumbnail and compact-list views. Retest initial asset visibility and repeated brush changes with representative names and library sizes. Keep keyboard-accessible action labels. |
| F2 · P1 | Opening a project with two saved scenes shows [No scene open](../screenshots/usability-review-2026-11/project-entry-desktop.png) and only a Create scene CTA. Opening existing work requires the button captioned “Scene workspace · Scene ▾”, then [Open another scene](../screenshots/usability-review-2026-11/scene-chooser-laptop.png). “Documents” is in its tooltip rather than visible caption. | First-time users can infer that they must create a scene despite existing content. Returning users must learn an indirect entry path. | Show Open scene beside Create scene, or a short saved/recent-scene list in this empty state. Give the switcher a visible Documents/Open affordance while retaining active name and kind. Offer a one-action last-document return without silently replacing local work. Retest from the project root without guide instructions. |
| F3 · P1 | Opening Library frame `player/f1` selects Pose 1 but leaves [Sheet drawing scope](../screenshots/usability-review-2026-11/artwork-laptop-default.png) active. Clicking canvas position [16, 16] at 16× zoom edits sheet pixel [1, 1], inside Pose 0; Pose 1 remains selected. | A frame selection can be mistaken for an edit boundary. This affects both novice confidence and fast pose editing. This is permitted Sheet behavior, not a finding that its coordinate conversion is wrong. | For an explicit named-pose open, default to Frame scope unless restoring a deliberate retained view. Keep Sheet one click away. Place “Editing entire sheet” or “Editing Pose 1” beside drawing tools, distinct from document-wide/shared-save scope. Retest opening Pose 1 and editing only that pose, then deliberately editing across frames. |
| F4 · P2 | At 1280 × 800, the native sheet's [default dock](../screenshots/usability-review-2026-11/artwork-laptop-default.png) leaves 271.5px of drawing height; [collapsed](../screenshots/usability-review-2026-11/artwork-laptop-dock-collapsed.png) leaves 399.5px; [expanded animation](../screenshots/usability-review-2026-11/artwork-laptop-animation.png) leaves 201.5px. At 800 × 640, hiding both panes changes the collapsed-dock drawing viewport from 392 × 244 to 752 × 280. | Drawing and animation compete for space. The existing controls provide relief, but users must discover and repeatedly arrange them. | Start with the dock collapsed when opening for drawing; reveal it for an explicit animation task. Remember deliberate dock/pane preferences per document or workspace. Consider a discoverable Focus canvas action using the existing pane controls. Keep the active frame/scope visible with the dock collapsed. Retest longer edit → timing → edit cycles, including keyboard reopening. |
| F5 · P2 | With canvas focus, scene `E` changes the tool to Erase; artwork `E` leaves Pencil selected. Pixel tooltips omit the scene tool letters, and drawing help lives inside bottom Document actions. Shared modifier shortcuts already route through one command owner. | An expert carries a learned shortcut across the unified shell and can draw instead of erasing. Beginners have little support for learning the faster path. | Define consistent contextual letters for shared tool concepts, expose them in tooltips and one discoverable shortcut reference, and retain native radio navigation. State unsupported/context-specific commands explicitly. Retest scene → artwork → scene with text-field, popover and modal guards intact. |
| F6 · P2 | At [800 × 640](../screenshots/usability-review-2026-11/scene-compact.png), a routine “Scene opened” card covers most of the drawing area's width for part of its five-second lifetime. The already-documented dismissal and expiry work; the obstruction is visual. | Users see confirmation of an action while the result they want to inspect is obscured. Repeated switches make this more distracting for experts. | Use the document/status area for routine open/saved acknowledgments; reserve prominent cards for actionable or exceptional feedback. Preserve persistent errors, explicit conflict information and accessible announcements. Retest immediate drawing and inspection after switching, including keyboard dismissal. |
| F7 · P2 | [Empty project](../screenshots/usability-review-2026-11/empty-project-laptop.png) guidance says to import, while native artwork and artwork-free blockout are supported. [New artwork setup](../screenshots/usability-review-2026-11/new-artwork-laptop.png) begins with an Agent candidates disclosure and exposes a dense limits paragraph. | A new user must translate internal concepts before choosing a supported starting workflow. Experienced agent users still need candidate access, but its prominence need not be universal. | Offer goal-based starts: build with sample artwork, create artwork, import existing content, or plan a blockout. Keep the existing optional guide. Show applicable size guidance for the chosen type and put full limits in help. Show candidate/recovery affordances prominently when such content exists. Retest each starting route without naming controls. |
| F8 · P2 | The empty [Stamps Library](../screenshots/usability-review-2026-11/stamps-laptop.png) says to use “Save stamp… above the canvas,” but that command is inside the tools disclosure at this width. [Selected sprite](../screenshots/usability-review-2026-11/selected-object-laptop.png) correctly raises Selection to the Inspector top, but conversion and removal precede ordinary preview controls. | Instructions point beginners toward a hidden command; less frequent operations take priority over frequent inspection. | Add Create stamp from selection in the Stamps empty state, with a clear prerequisite when unavailable. Keep selection/edit and preview prominent; move conversion and removal to a labeled secondary group. Retest a novice's first reusable arrangement and an expert's repeated select/preview loop. |

The first three findings should be delivered together only if they remain small
and independently reviewable. Space and scope are related, but a wholesale shell
rewrite would make it harder to judge which change improved task completion.

## What to preserve

- The Library → canvas → Inspector model and shared document bar. The active
  name/kind, Saved/Modified state, stable history controls and contextual tools
  provide useful continuity across domains.
- Selection moving above scene properties when an object is selected, shown in
  the [selected-sprite capture](../screenshots/usability-review-2026-11/selected-object-laptop.png).
  Keep Layers readily reachable during repeated placement.
- Retained artwork and independent histories. The walkthrough returned to the
  same Pose 1 document after saving and switching through the scene.
- The current edge controls: compare [compact artwork](../screenshots/usability-review-2026-11/artwork-compact.png)
  with [panes hidden](../screenshots/usability-review-2026-11/artwork-compact-panes-hidden.png).
  Make this working affordance easier to discover before adding another mode.
- Contextual Save and [explicit artwork review](../screenshots/usability-review-2026-11/artwork-laptop-review.png).
  Keep affected-reference explanations, comparison and confirmation; label the
  first step “Review & save…” if participants expect the first activation to commit.
- Export first in [Project tools](../screenshots/usability-review-2026-11/project-tools-laptop.png),
  with scene lifecycle and destructive actions grouped by scope. The inspected
  [export configuration](../screenshots/usability-review-2026-11/export-laptop.png)
  describes portable output and the snapshot boundary clearly.
- Existing path/token/revision guards and recoverable local work. Improving
  disclosure must not bypass review, overwrite confirmations or recovery choices.

## Layout direction to prototype

| Surface | Immediately visible | Progressive disclosure / experienced-user path |
| --- | --- | --- |
| Project entry | Existing/recent scenes and goal-based starting actions | Project management and optional first-scene guide |
| Document bar | Documents affordance, active name/kind, save state, contextual Save | Searchable document chooser and a documented switch shortcut if repeated navigation warrants it |
| Library | Category, search, asset thumbnails, compact New/Import | Selected-source actions, filters, recovery/candidates when relevant, density preference |
| Canvas | Contextual tools, active layer or frame/edit scope, color, zoom/Fit | Secondary transforms, mappings and a shortcut reference |
| Inspector | Selection or active-document controls | Collapsible scene facts, uncommon conversions and diagnostics |
| Bottom dock | Small frame/scope affordance | Expanded animation/timing only when needed; remembered deliberate state |

Use the existing design system and stable control positions. Expose one clear
route for each task before adding command palettes or workspace presets. A
command palette is a later hypothesis for experienced users, not a substitute
for visible Open, assets or scope information.

## Independent-user study design

Extend the existing [session protocol](workflow-usability.md#independent-user-session-protocol-165)
with the findings above. A practical first round is eight participants: four new
to Forge and four returning users, recording relevant tile/pixel-editor experience
separately. This sample provides directional observations, not statistical proof.
Use a neutral moderator and approximately 45–60 minutes per participant. Obtain
observation/recording consent and keep identifying material outside the repository.

Give goals without naming controls or teaching the route:

1. Open the provided project and change one tile in Riverside; save and reopen it.
2. Open Player poses / Pose 1 and change only that pose, leaving Pose 0 untouched.
3. Make an independent artwork version for one placement, then explain which
   placements would change when editing the shared original instead.
4. Change an animation's timing, return to drawing, switch to a scene and resume
   the artwork. Use the participant's preferred input method.
5. Save a small arrangement for reuse and place it elsewhere.
6. In an empty project, start an artwork-free layout; separately create a new
   piece of artwork. Observe the route each participant chooses.
7. On a copied recovery/conflict fixture, retain local edits and reconcile an
   external save. Let participants explain what is saved, recoverable and local.
8. Repeat the frequent brush/pose/switching loop on their normal laptop viewport,
   including their actual zoom/scaling. Reserve several minutes for sustained
   drawing rather than only one-click success.

For each task, record independent/assisted/failed completion, time to the first
correct action, total task time, wrong turns, exact assistance, mistaken scope,
unintended edits and a 1–7 post-task ease rating. Record whether panes or dock
needed adjustment, shortcut mismatches, and the participant's explanation of
save/shared/frame scope. Do not treat successful scripted tasks as participant
success or measure script duration as human discovery time.

Use the current build first. Retest a small prototype with new participants or
counterbalance variant order to limit learning effects. Compare correct scope
and independent task completion before speed; ensure experienced users retain
shortcut access and repeated-edit fluency. Treat any wrong-pose edit or mistaken
shared-save scope as an actionable observation even when overall completion is
high. Select changes from those observations and repeat the affected tasks.

This study design adds detail to the existing independent-user work; outstanding
execution remains owned by [Validation / Remaining checks](../VALIDATION.md#remaining-checks).
This review does not mark those checks complete or create a second task ledger.

## Additional inspected states

[Scene at 1440 × 900](../screenshots/usability-review-2026-11/scene-desktop.png) ·
[Desktop document chooser](../screenshots/usability-review-2026-11/scene-chooser-desktop.png) ·
[Source actions](../screenshots/usability-review-2026-11/source-actions-laptop.png) ·
[Objects Library](../screenshots/usability-review-2026-11/objects-laptop.png) ·
[Create scene](../screenshots/usability-review-2026-11/create-scene-laptop.png) ·
[Create blockout](../screenshots/usability-review-2026-11/blockout-create-laptop.png)

These captures are source-checkout fixtures, not installed-wheel or participant
records. Native fixture pixels include the small saved test marks from repeated
walkthroughs. Geometry comparisons describe layout in the recorded state; the
Library scrolls to the chosen native frame during artwork opening. Asset-card
counts in the raw bounds count fully visible cards, not the total number of rows
in a multi-column layout.
