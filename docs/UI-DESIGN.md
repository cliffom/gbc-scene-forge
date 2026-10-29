# Editor layout guidelines

Scene Forge is a desktop authoring tool. Give the canvas and artwork room to
work, keep common edits close to that canvas, and organize management commands
by what they affect. The established dark colors and accent remain the visual
system; hierarchy comes from grouping, spacing and clear labels.

- **Document context:** project and scene selection, save state, Save and Export.
  Scene actions groups scene lifecycle commands; Project tools groups world and
  diagnostic work. Separate destructive commands from ordinary actions.
- **Library:** Artwork, Objects and Stamps are separate authoring categories.
  Keep search and filters with artwork, definitions with objects, and stamp
  selection/placement together. Ordinary refreshes preserve the chosen category.
- **Canvas:** expose labeled drawing tools and Undo/Redo. Group clipboard and
  selection actions on their own row. Put less frequent transforms in a labeled
  command popover. Keep view overlays and coordinate feedback beside the canvas.
- **Inspector:** scene, layers and contextual selection properties belong here.
  Maintain independent scrolling so a long inspector does not move the canvas.
- **Controls:** use consistent 32px command heights, with at least 28px for dense
  layer controls. Let groups wrap as units; do not squeeze labels beneath arrows
  or remove drawing-tool labels to force a single row. Single-value dropdowns
  reserve 32px for their arrow (28px in dense preview tables). Bound long user
  names with ellipses; expose the full selected stamp name in its tooltip.
- **Keyboard:** preserve native buttons, selects, dialogs and popovers. Command
  panels are groups of ordinary buttons, not ARIA menus that imply unsupported
  arrow-key behavior. Library tabs use roving Tab focus, arrows and Home/End.
  Keep visible focus outlines and associated labels. Opening a command must not
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
Screenshots are written to `build/reports/scene-editor/`. The broader browser
suite verifies that editing, stamps, recovery, definitions, world links and
first-use instructions remain usable with this hierarchy.

## Visual comparison

[Before](screenshots/ui-cleanup/before.png) ·
[After](screenshots/ui-cleanup/after.png) ·
[Stamp library](screenshots/ui-cleanup/stamps.png) ·
[Compact stamp library](screenshots/ui-cleanup/compact-stamps.png) ·
[Project commands](screenshots/ui-cleanup/project-tools.png)
