# Editor layout guidelines

Scene Forge is a desktop authoring tool. Give the canvas and artwork room to
work, keep common edits close to that canvas, and organize management commands
by what they affect. The established dark colors and accent remain the visual
system; hierarchy comes from grouping, spacing and clear labels.

- **Document context:** project and scene selection, save state and two command
  groups, plus a single contextual Save entry with its keyboard shortcut.
  Scene actions contains scene lifecycle commands; Project tools starts with Export,
  followed by world and diagnostic work. Separate destructive commands from ordinary actions.
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
  Artwork rows show the source name inside each card, without repeated headings
  above cards or generic region/kind labels.
  Source actions keeps shared editing, copies, updates and deletion with the
  chosen Library source; the Inspector does not repeat the project asset inventory.
- **Artwork setup:** New artwork, Existing artwork and From agent are peer tabs
  with padded hover targets and native keyboard navigation. New begins with the
  creation form; available agent drafts contribute a count without promoting
  themselves above it. Use visual draft cards and a read-only modal preview with
  explicit Edit a copy, separate PNG/native JSON downloads and collapsed revision
  details. Hide the shared editing-command row and disable its capabilities until
  an editable document opens; preserve independent histories and save guards.
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
  Artwork Properties, Palette and Layers use independent native disclosures with headings
  next to their content. Right/down chevrons indicate closed/open state; the layer
  count stays visible. All three start open, with per-retained-document state for this
  mounted editor. Review collapses all three; reopening any exits review. Keep the
  summary keyboard reachable and return focus there when its contents collapse.
  Artwork uses a bounded stack with frontmost rows first, grip/eye/name/lock per
  row, gold active selection, and compact plus/trash controls in the heading.
  Click selects; double-click or F2 opens an inline name. Percentage opacity below
  the stack combines a slider with exact numeric entry. Retain the distinct scene
  and raster models. The list follows familiar [Aseprite layer](https://www.aseprite.org/docs/layers/)
  and [Krita layer docker](https://docs.krita.org/en/reference_manual/dockers/layers.html)
  conventions for visible stacks, ordering and per-layer state. Forge keeps its
  existing single-layer selection and lock protections; these references do not
  imply support for groups, blending modes or other tools' full feature sets.
- **Controls:** use consistent 32px command heights, with at least 28px for dense
  layer controls. Let groups wrap as units; do not squeeze labels beneath arrows.
  Use recognizable 18px SVG tool icons
  in 32px targets for frequent spatial commands, with accessible names and tooltips
  including shortcuts where supported. Gold, a border and an inset underline identify
  selected tools; unavailable actions remain visibly disabled. Keep text for
  management, save/review and destructive commands, except the contextual artwork
  layer trash icon, which has an explicit tooltip and accessible name. Single-value dropdowns
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
- **Feedback:** transient artwork, scene and project messages use shared
  dismissible cards at the top-right of the workbench, below its toolbars. Routine
  notices expire after five seconds, pausing while hovered, focused or the tab is
  hidden; repeated messages refresh one card. Save, conflict and checkpoint
  failures persist until dismissed or resolved by their operation. Dismissal
  acknowledges feedback and never changes the underlying save/recovery state.
  Document changes retire routine notices; unresolved artwork failures belong to
  their document. Cards use text severity labels and screen-reader announcements,
  preserve editing focus and remain keyboard reachable inside modal dialogs.
  Card bodies let canvas gestures pass through; dismissal buttons remain interactive.
  Field validation remains beside the relevant input. Passive notification
  popovers do not count as open command menus for editing or refresh guards.
  Secondary placement must not hide important status. Keep save
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

## Shared document shell

Scenes and artwork use one workbench between the same Library and Inspector.
The artwork name appears in the document bar. Pixel tools and the pixel viewport
are contextual contributions to the workbench; raster layers, frame properties
and review use the existing Inspector. Its collapse handle works in both contexts;
opening artwork review reveals the Inspector if needed. Returning to the scene
restores its canvas focus and existing Inspector content.

One Documents button shows the active name and kind, with Saved/Modified/New
beside it and a separate detected-external-change warning. Its chooser offers the
active scene, other saved scenes and retained artwork. Switching preserves local
context and independent history; failed checkpoints block departure. The artwork
frame/animation dock can be collapsed using its Frames & animation disclosure. Save occupies the document bar and shared history,
clipboard, deselection and transform commands occupy a stable strip above contextual
tools. Raster layers and document/frame properties use shared Inspector sections;
Palette is an inline Inspector section. Setup is a focused
surface in the workbench; dialogs remain appropriate for modal confirmations and document choice.

Library opening shows the selected asset in a dedicated loading surface before
expensive work. Cancel opening returns to retained work; another Library selection
supersedes the read. A failed open offers retry and return actions. The source/copy
chooser appears for explicit source actions and imported artwork that needs a copy.
[Desktop loading](screenshots/artwork-opening/desktop.png) ·
[Compact loading](screenshots/artwork-opening/compact.png)

## Pixel editor layout

Use one active-document switcher in the existing context bar; do not reserve an
extra navigation row. New artwork is a focused creation flow, separate from
opening existing assets. Copy setup keeps its name/identity with its source.
Native artwork opens directly with the requested frame selected. Generate asset
IDs and disclose advanced overrides and layout/origin options progressively.

Keep compact tool/history/clipboard/transform groups, color, opacity, transparency,
zoom and Fit beside the canvas. Show shared/new/variation scope in the Inspector;
keep the active name and local state in the document bar. Put frame selection, Sheet/Frame scope and thumbnails below drawing,
with an optional bounded animation dock containing sequence entries, millisecond
durations and playback. The dock has its own bounded scrolling at short heights;
collapse Frames & animation to return that space to drawing. Properties and exact-change review are optional content in the shared Inspector.
Library and Inspector retain their common collapse handles at compact sizes; the
document switcher retains New/Browse navigation.

Save opens change review and explicit confirmation in the same document-bar location,
remaining reachable while the animation dock or comparison scrolls. A successful
save retains the current document, history and viewport and updates Saved/Modified/New state.
Choosing the scene in Documents retains artwork; Close/discard removes it. Document actions contains
less frequent download/discard/help commands. Preserve revision guards, review
invalidation, checkpoints and independent scene history. Bounds checks and agent
inspection do not replace independent human usability testing. The
[workflow review](evaluations/unified-editor-ux.md) records the motivating findings;
[current workspace captures](evaluations/unified-editor-ux.md#consolidated-editor-assessment-milestone-22)
show the delivered layout; the [earlier polish evaluation](evaluations/editor-polish.md) preserves its own
historical scope and captures.

## Visual comparison

### Inspector organization (#248)

The user-approved [interactive mockup](mockups/inspector-organization.html) and
[static preview](mockups/inspector-organization.png) preserve the design provenance
for [#248](https://github.com/cliffom/gbc-scene-forge/issues/248). Sample values and
mockup editing actions are illustrative.

Artwork puts compact Properties first: an unlabeled display name, Width, Height
and Total pixels (whole-document width × height, without multiplying by layers
or frames). Shared editing scope and frame/representation controls remain within
Properties. Palette is an inline disclosure before Layers, retaining
Composition/Selected layer scope and Hue/Most used ordering. Each section opens
independently and retains state per document. Palette content and swatches scroll
within bounded areas; choosing a color keeps the section open.

Scene uses matching headings and compact geometry, with Grid and cell dimensions
as additional context. Properties leads with no selection; Selection rises and
opens for a changed selection, keeping editing and animation preview prominent.
Object validation and Draft recovery start collapsed with live status summaries.
Ordinary redraws preserve section choices. Pane visibility and section state remain
presentation choices outside authored history and saved files.

Implemented 0.45.0 wheel captures: [Artwork desktop](images/inspector-artwork-desktop.png),
[Artwork compact scrolled Palette](images/inspector-artwork-compact.png),
[long artwork name and stack](images/inspector-artwork-long-name.png),
[Scene desktop](images/inspector-scene-desktop.png),
[Scene compact](images/inspector-scene-compact.png),
[Selection desktop](images/inspector-selection-desktop.png) and
[Selection compact](images/inspector-selection-compact.png).

[Desktop notification](screenshots/notifications/desktop.png) ·
[Compact notification](screenshots/notifications/compact.png)

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

## Drawing workspace refinements

Routine open/save feedback uses the status area; actionable warnings and persistent
failures keep prominent cards and dismissal controls. Keyboard help is visible above
the workbench. Artwork starts with a collapsed dock and persistent adjacent frame/scope
controls; Edit animation explicitly reveals timing. The Stamps Library exposes the
existing save-selection command with prerequisites. Selection prioritizes editing
and preview before the Convert or remove selection disclosure.
