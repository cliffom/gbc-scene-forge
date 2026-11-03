# Editor layout guidelines

Scene Forge is a desktop authoring tool. Give the canvas and artwork room to
work, keep common edits close to that canvas, and organize management commands
by what they affect. The established dark colors and accent remain the visual
system; hierarchy comes from grouping, spacing and clear labels.

- **Document context:** project and scene selection, save state and two command
  groups. Scene actions starts with Save scene and its keyboard shortcut, followed
  by scene lifecycle commands; Project tools starts with Export, followed by world
  and diagnostic work. Separate destructive commands from ordinary actions.
- **Pane edges:** independent Library and Inspector chevrons sit in the open pane
  headers, leaving no extra column between pane and canvas. Closing a pane replaces
  it with a 24px edge handle; the arrow reverses, with Show/Hide tooltips and
  accessible names. The Inspector header stays above its scrolling sections,
  including when Selection rises to the top. Focused controls scroll below it,
  including nested layer rows. Handles avoid covering canvas controls; Review
  scene hides them.
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
  When resizing hides the focused command, move focus to the disclosure or Review
  button; leave focus outside the toolbar undisturbed.
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

Use one active-document switcher in the existing context bar; do not reserve an
extra navigation row. New artwork is a focused creation flow, separate from
opening existing assets. Copy setup keeps its name/identity with its source.
Native artwork opens directly with the requested frame selected. Generate asset
IDs and disclose advanced overrides and layout/origin options progressively.

Keep compact tool/history/clipboard/transform groups, color, opacity, transparency,
zoom and Fit beside the canvas. Show a short shared/new/variation badge beside
the title. Put frame selection, Sheet/Frame scope and thumbnails below drawing,
with an optional bounded animation dock containing sequence entries, millisecond
durations and playback. Hide frame thumbnails in short windows while preserving
the labeled selector. Properties and exact-change review are separate optional
panes; narrow windows use an overlay, and compact artwork hides the Library while
the document switcher retains New/Browse navigation.

Save opens change review and explicit confirmation. Keep its footer reachable
while the animation dock or comparison scrolls. A successful save retains the
current document, history and viewport and updates Saved/Modified/New state.
Return to Scene and Close/discard are separate actions. Document actions contains
less frequent download/discard/help commands. Preserve revision guards, review
invalidation, checkpoints and independent scene history. Bounds checks and agent
inspection do not replace independent human usability testing. The
[workflow review](evaluations/unified-editor-ux.md) records the motivating findings;
[current workspace captures](evaluations/unified-editor-ux.md#delivered-interaction-redesign)
show the delivered layout; the [earlier polish evaluation](evaluations/editor-polish.md) preserves its own
historical scope and captures.

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
