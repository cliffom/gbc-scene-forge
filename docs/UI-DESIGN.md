# Editor layout guidelines

Scene Forge is a desktop authoring tool. Give the canvas and artwork room to
work, keep common edits close to that canvas, and organize management commands
by what they affect. The established dark colors and accent remain the visual
system; hierarchy comes from grouping, spacing and clear labels.

- **Document context:** project and scene selection, save state, Save and Export.
  Scene actions groups scene lifecycle commands; Project tools groups world and
  diagnostic work. Separate destructive commands from ordinary actions.
- **Pane edges:** independent Library and Inspector chevrons sit in the open pane
  headers, leaving no extra column between pane and canvas. Closing a pane replaces
  it with a 24px edge handle; the arrow reverses, with Show/Hide tooltips and
  accessible names. Handles avoid covering canvas controls; Review scene hides them.
- **Project path:** copy icons beside the header folder name and the full path in
  its popover copy directly, confirm success with a checkmark and announce status.
  If clipboard access fails, show the selectable path and manual-copy guidance.
- **Library:** Artwork, Objects and Stamps are separate authoring categories.
  Keep search and filters with artwork, definitions with objects, and stamp
  selection/placement together. Ordinary refreshes preserve the chosen category.
- **Canvas:** group drawing tools, history, clipboard and selection commands in one
  compact toolbar. Keep zoom, review and fit on the first row; use a container-width
  disclosure for secondary commands instead of automatically adding rows. At the
  narrowest widths drawing tools share the disclosure and its trigger names the
  current tool. Keyboard shortcuts remain available; Escape collapses the disclosure.
  Put less frequent transforms in a labeled
  command popover. Keep view overlays and coordinate feedback beside the canvas.
- **Inspector:** scene, layers and contextual selection properties belong here.
  Maintain independent scrolling so a long inspector does not move the canvas.
- **Controls:** use consistent 32px command heights, with at least 28px for dense
  layer controls. Let groups wrap as units; do not squeeze labels beneath arrows.
  Use recognizable 18px SVG tool icons
  in 32px targets for frequent spatial commands, with accessible names and tooltips
  including shortcuts where supported. Gold, a border and an inset underline identify
  selected tools; unavailable actions remain visibly disabled. Keep text for
  management, save/review and destructive commands. Single-value dropdowns
  reserve 32px for their arrow (28px in dense preview tables). Bound long user
  names with ellipses; expose the full selected stamp name in its tooltip.
- **Keyboard:** preserve native buttons, selects, dialogs and popovers. Command
  panels are groups of ordinary buttons, not ARIA menus that imply unsupported
  arrow-key behavior. Library tabs use roving Tab focus, arrows and Home/End.
  Keep visible focus outlines and associated labels. Native tool radios retain
  keyboard arrow navigation; pointer selection returns to the drawing canvas.
  Opening a command must not
  steal focus from a modal; pointer-only canvas focus restoration skips popover
  triggers.
- **Feedback:** secondary placement must not hide important status. Keep save
  state in the document bar and palette failure feedback on Project tools even
  when its command panel is closed. Color supplements text or symbols.

These choices apply [W3C's guidance on visual and semantic grouping](https://www.w3.org/WAI/tutorials/forms/grouping/),
[associated control labels](https://www.w3.org/WAI/tutorials/forms/labels/),
and [Microsoft's command-bar hierarchy guidance](https://learn.microsoft.com/en-ca/windows/apps/design/controls/command-bar).
The browser implementation uses the [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
These references guide the design; they are not a claim of audited accessibility
conformance.

`make test-layout-browser` checks canvas/footer bounds at 1440×900, 1280×800,
1024×768, 760×640 and 1440×600; arrow clearance; long stamp names; keyboard tabs;
command dismissal, positioning and modal focus; and visible palette warnings.
Screenshots are written to `build/reports/playwright/`. The broader browser
suite verifies that editing, stamps, recovery, definitions, world links and
first-use instructions remain usable with this hierarchy.

## Pixel editor layout

Use the same compact tool/history/clipboard/transform groups as the scene editor.
Keep Color, Alpha and Transparent aligned at the control baseline, separately
from zoom/grid. Setup and recovery share one padded scroll surface so dropdowns
and focus rings stay within their bounds. Explain an empty artwork selector and
disable its unavailable operations. Keep editing scope and save/conflict feedback
visible; occasional drawing help and scene-preview coordinates use disclosures.

The drawing canvas and review column scroll independently between the toolbar
and save footer. Test long names, expanded help, review comparisons and recoverable
drafts in both short and narrow desktop windows. Do not equate bounds assertions
with human usability testing. See the [polish evaluation](evaluations/editor-polish.md)
for the checked task flows, screenshots and limits.

## Visual comparison

[Before](screenshots/ui-cleanup/before.png) ·
[After](screenshots/ui-cleanup/after.png) ·
[Stamp library](screenshots/ui-cleanup/stamps.png) ·
[Compact stamp library](screenshots/ui-cleanup/compact-stamps.png) ·
[Project commands](screenshots/ui-cleanup/project-tools.png)

## Collapsible panes

[Expanded](screenshots/collapsible-panes/expanded.png) ·
[Library hidden](screenshots/collapsible-panes/library-hidden.png) ·
[Inspector hidden](screenshots/collapsible-panes/inspector-hidden.png) ·
[Both hidden](screenshots/collapsible-panes/both-hidden.png) ·
[Both hidden at 760px](screenshots/collapsible-panes/compact.png)

The [pane acceptance tests](../tests/playwright/editor/panes.spec.ts) check all four
combinations at 1440×900, 1024×768 and 760×640, including actual viewport width,
keyboard reopening, focus, camera/pointer geometry, retained authored state and
checkpoints, continued editing, guided reveal and Review scene transitions.
