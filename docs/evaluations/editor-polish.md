# Editor toolbar and layout polish (#144)

## Scope and method

User-reported examples on 2026-11-02 identified the pixel artwork selector/focus
edge and the raised Transparent button, alongside broader command clutter.
The screenshots did not record browser, viewport or zoom. This pass uses a clean
source baseline at
[`06ca6f8`](https://github.com/cliffom/gbc-scene-forge/commit/06ca6f8f1b9c2de2dea9dc303e3ce10d3f3bf6f1)
and a local working tree preparing 0.27.1 on Darwin 27.0.0, Python 3.13.13 and
Node 24.22.1 and Chromium 156.0.8078.4. Baseline layout/pixel automation passed 15 scenarios; passing those
checks did not cover the reported alignment or focus-clearance concerns.

Methods are agent inspection, screenshot comparison and synthetic pointer/keyboard
browser interaction with disposable projects. No independent human user study or
claim of measured editing comfort is made. The originating user's screenshots
remain user reports, not a fully reproduced browser/environment combination.

## Task flows and decisions

| Task | Prior friction | Implemented behavior and retained tradeoff |
| --- | --- | --- |
| Save and export | Separate document-bar buttons compete with scene/project navigation | Save scene is first in Scene actions, with a visible shortcut hint; Export is first in Project tools. Save status stays beside the selectors. Ctrl/⌘ S works with the menu closed, and guide instructions name the menu paths. |
| Paint, fill, erase, select and pan | Labeled tools plus a separate textual clipboard/action row consume canvas space | Consistent icon tools, history and selection groups share a responsive toolbar. Familiar commands have names/tooltips; save, management and destructive commands retain text, while compact review uses a named eye icon. Native radio navigation and scene shortcuts remain. |
| Copy, transform and reuse a selection | Large Copy/Cut/Paste/Duplicate/Deselect/Save stamp buttons compete with drawing | Grouped 32px commands stay close to the canvas. Transform retains its named popover; Across layers stays with the selection commands, including in the expanded toolbar. Stamps still use the existing placement library. |
| Copy the project root | Copying requires opening the folder popover and finding a text button | Copy icons beside the header folder and full popover path copy directly. Success uses a checkmark and announced status; clipboard failures expose the selectable path. |
| Hide/reopen authoring panes | Text buttons occupy the document bar rather than the pane boundary | Independent chevrons use open pane headers and narrow reopen handles only when collapsed; native keyboard activation, Show/Hide names and focus recovery remain. Expanded panes meet the workbench without reserved arrow columns. |
| Keep zoom and review available | Automatic toolbar wrapping places viewing controls on another row | A canvas-width disclosure reserves the first row for zoom/review/fit. Secondary commands expand explicitly; very narrow canvases also disclose drawing tools and name the current tool. Shortcuts remain active; Escape collapses the toolbar. |
| Choose a pixel tool repeatedly | Each change requires opening the Tool dropdown and choosing an item | Eight native radio tools are directly available in one pointer choice. Keyboard arrow navigation retains focus; pointer choice returns to the drawing canvas. No second mutable tool state is introduced. |
| Choose RGBA and view scale | Transparent is centered against labeled fields rather than their controls | Color, Alpha and Transparent align at the bottom of their controls. Zoom and Pixel grid form a separate view group. |
| Open/create/copy artwork | Two overflowing grid columns and unpadded scroll edges risk clipped focus treatment; an empty source selector has no explanation | Setup/recovery share a padded scroll surface, columns use bounded minimums and stack at narrow widths. Empty source controls are disabled with an explanatory option; blank creation stays available. |
| Review and save pixels | Instructions/settings compete with drawing and review actions, particularly in short windows | Scope stays visible, occasional drawing help and scene coordinates use disclosures. Review is above its coordinate settings. Canvas/review scroll independently above the save footer. Review receipts and recovery semantics remain unchanged. |
| Layer/property editing, imports, blockouts, objects, sprite preview, save/reopen, recovery and export | Established domain workflows must remain usable while commands move | Retain their owners and labeled management entry points; use shared dialog wrapping/viewport bounds. Existing browser acceptance exercises these flows rather than inventing unrelated features. Search/import issues #123–#125 remain separate. |

Retain independent pane collapse and Review scene. Within the expanded toolbar,
groups wrap instead of shrinking their hit targets or overflowing into the inspector. During
visual inspection an intermediate layout clipped Across layers at 760px; the
final implementation bounds the composition group and checks every visible
command rectangle for containment and pairwise overlap.

## Browser coverage and evidence

The new [polish acceptance](../../tests/playwright/editor/polish.spec.ts) checks:

- Scene command containment/overlap and a usable canvas at 1440×900, 1280×800,
  1024×768, 760×640 and 1440×600, with all four Library/Inspector combinations.
- Pixel setup focus clearance, long artwork names, directly selected tools,
  native keyboard radio navigation, expanded/collapsed drawing help, review and
  save-footer bounds, color-control baseline alignment and usable canvas height
  at the same five sizes.
- Representative 1.25 device-scale emulation at a 1024×640 CSS viewport for scene
  and pixel commands. This is Chromium emulation, not an actual OS scaling or
  browser-toolbar zoom test.
- Checkpoint close/reopen/recover/review/save and a first-use UI-only sequence:
  create an empty project, inspect unavailable source controls, create/draw/review/
  save pixels, create a scene, place the artwork, save/reload and download a project
  ZIP. It uses neither the guide nor MCP.
  Recovery is exercised at the final viewport, not every pane/size combination.

Two initial new-test failures came from incorrectly assuming the empty-project
fixture opened the editor or displayed a project-list button; the test now creates
an empty project through its visible form. These were fixture assumptions, not
product failures. Corrected polish scenarios passed locally. Full verification
results are owned by the [validation record](../VALIDATION.md).

Selected captures are archived with this change:

- [Scene before](../screenshots/editor-polish/scene-before.png) · [Scene after](../screenshots/editor-polish/scene-after.png)
- [Pixel editor before](../screenshots/editor-polish/pixels-before.png) · [Pixel editor after](../screenshots/editor-polish/pixels-after.png)
- [Narrow scene](../screenshots/editor-polish/scene-compact.png) · [Narrow pixel editor](../screenshots/editor-polish/pixels-compact.png)
- [Focused artwork setup](../screenshots/editor-polish/setup-focus.png)

Baseline captures come from the 15-scenario source-baseline run on 2026-11-02.
After captures come from the production 0.27.1 browser acceptance run. Scene
comparisons are 1440×900; pixel comparisons are 1440×1000. Compact captures
are 760×640. Local
HTML reports under ignored build outputs are not archived CI evidence. Independent
human discoverability, non-Chrome browsers and actual OS/browser scaling remain
outside the claims here; outstanding validation belongs only in the maintained
[Remaining checks](../VALIDATION.md#remaining-checks) list.

## Pane, path and responsive-toolbar refinements

Follow-up user feedback requested direct path-copy icons, pane-edge chevrons and
an alternative to zoom/review wrapping onto another row. The refinements use a
0.27.1 working tree based on
[`6e8b7dd`](https://github.com/cliffom/gbc-scene-forge/commit/6e8b7ddf1a470ca89bbb4c6c068a7042dfb1cddd),
checked on 2026-11-02 in the same local environment. The original captures above
remain evidence of the first implementation; these captures show the refined
production frontend:

- [Responsive desktop toolbar and pane edges](../screenshots/editor-polish/scene-responsive.png)
- [Collapsed toolbar at 760×640](../screenshots/editor-polish/scene-responsive-compact.png)
- [Expanded tools at 760×640](../screenshots/editor-polish/toolbar-expanded-compact.png)
- [Direct path-copy success](../screenshots/editor-polish/folder-copy.png)
- [Clipboard failure and long selectable path](../screenshots/editor-polish/folder-copy-fallback.png)

Agent inspection and synthetic browser checks verify a single default toolbar row
at all five sizes and pane combinations, explicit keyboard expansion/collapse,
fixed zoom position during expansion, page/footer bounds with tools expanded,
current-tool labels after shortcuts/library choices, and review transitions.
Copy checks use Chromium clipboard read/write permissions for success and an
injected clipboard failure for fallback. They cover direct header activation,
popover activation, retained keyboard focus and long-path bounds.

Inspection caught a stale success checkmark after a failed copy; a new request
now resets it. An existing variation scenario initially tried clicking a hidden
drawing radio after switching to 800px; it now opens the disclosure before
continuing the scene edit. This was an outdated interaction expectation. Final
results and limits belong in the [validation record](../VALIDATION.md).

## Pane header refinement

User feedback identified wasted horizontal space in the permanent arrow rails.
The subsequent 0.27.1 working tree based on
[`9687665`](https://github.com/cliffom/gbc-scene-forge/commit/9687665b485094aec11b296a95968cb9d5b457ad),
checked on 2026-11-02, moves each open pane's chevron into its existing header.
Expanded panes now meet the workbench directly, returning 48px to the canvas when
both panes are open. Only closed panes reserve 24px reopen handles. The Inspector
keeps its save-status badge below the heading so the arrow stays at the outer edge.

The same native button moves between header and closed handle, retaining its
event handlers and accessible state. Focus is restored after moving it; hiding a
pane with focus inside still sends focus to its toggle. Geometry checks verify
header placement, direct pane/workbench adjacency, non-overlapping header content
and reachable handles across five desktop sizes and every pane combination.
Keyboard checks exercise both transitions; existing state, camera, review and
lifetime checks remain applicable.

These installed-wheel captures supersede the open-pane layout in the previous
refinement's screenshots, which retain their earlier revision scope:

- [Header chevrons at 1440×900](../screenshots/editor-polish/pane-headers-desktop.png)
- [Header chevrons at 760×640](../screenshots/editor-polish/pane-headers-compact.png)
- [Closed edge handles at 760×640](../screenshots/editor-polish/pane-handles-compact.png)

## Save and export menu consolidation

Further user feedback placed Save scene in Scene actions and Export in Project
tools. The 0.27.1 working tree based on
[`a9ed6a0`](https://github.com/cliffom/gbc-scene-forge/commit/a9ed6a0), checked on
2026-11-02, keeps each command first in its menu. Save has a visible keyboard
shortcut and retains its enabled/unsaved treatment; current save status remains
visible beside scene selection. This trades an additional pointer click for fewer
permanent controls. Ctrl/⌘ S continues working without opening a menu.

Synthetic keyboard checks enter each menu with Enter, Tab to the command and
activate it. Both Control+S and Meta+S save with the menu closed. The first-scene
guide names the new locations and its Save/Export actions still work. The UI-only
first-use flow now explicitly opens each menu. Existing save/export scenarios use
the shared visible-menu helper instead of trying to click hidden commands.
Initial screenshot inspection caught inherited dark primary-button text against
the menu background; the menu Save action now uses the readable accent color.

Final installed-wheel captures show the compact document bar and both menus:

- [Document bar at 1440×900](../screenshots/editor-polish/command-bar-desktop.png)
- [Document bar at 760×640](../screenshots/editor-polish/command-bar-compact.png)
- [Scene actions with Save scene](../screenshots/editor-polish/scene-save-menu.png)
- [Project tools with Export](../screenshots/editor-polish/project-export-menu.png)

Prior screenshots retain their earlier revision scope. Results and limitations
belong in the [validation record](../VALIDATION.md).

## Persistent Inspector header and responsive focus

The 0.27.1 working tree based on
[`13537f9`](https://github.com/cliffom/gbc-scene-forge/commit/13537f9eb17113b621db01f92d3f6a173323312b),
checked on 2026-11-02, keeps the Inspector chevron and save badge in a sticky
header directly under the pane. Its lifetime spans all sections, and its flex
order stays above Selection when that section rises to the top. Scrolling to
recovery or project assets keeps the arrow visible without adding a column.
Synthetic checks hit-test the arrow and use physical pointer coordinates to
collapse it without a locator scrolling it into view first. Reopening retains
the scroll position. Both selection states are checked at the five desktop sizes.

The toolbar remembers a focused command when responsive CSS hides it before the
resize observer runs. Focus moves to the disclosure, or Review when the disclosure
disappears on a wider canvas. Explicit blur and focus on another control clear the
remembered target. Keyboard checks cross both breakpoints and verify that focus
outside the toolbar stays put.

Source-checkout Chromium captures, inspected by the agent, show the scrolled
Inspector with an active tile selection:

- [Scrolled Inspector at 1440×900](../screenshots/editor-polish/inspector-scrolled-desktop.png)
- [Scrolled Inspector at 760×640](../screenshots/editor-polish/inspector-scrolled-compact.png)

These captures are from the working tree, not the previously installed wheel.
Earlier captures retain their original revision scope.
