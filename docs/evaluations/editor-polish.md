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
| Paint, fill, erase, select and pan | Labeled tools plus a separate textual clipboard/action row consume canvas space | Consistent icon tools, history and selection groups share a responsive toolbar. Familiar commands have names/tooltips; save, management and destructive commands retain text, while compact review uses a named eye icon. Native radio navigation and scene shortcuts remain. |
| Copy, transform and reuse a selection | Large Copy/Cut/Paste/Duplicate/Deselect/Save stamp buttons compete with drawing | Grouped 32px commands stay close to the canvas. Transform retains its named popover; Across layers stays with the selection commands, including in the expanded toolbar. Stamps still use the existing placement library. |
| Copy the project root | Copying requires opening the folder popover and finding a text button | Copy icons beside the header folder and full popover path copy directly. Success uses a checkmark and announced status; clipboard failures expose the selectable path. |
| Hide/reopen authoring panes | Text buttons occupy the document bar rather than the pane boundary | Independent chevrons stay in narrow edge rails when panes collapse; native keyboard activation, Show/Hide names and focus recovery remain. Rails reserve layout space rather than covering the canvas. |
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
