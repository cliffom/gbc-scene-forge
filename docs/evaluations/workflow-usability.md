# Existing authoring workflow evaluation (#165–#167)

## Scope and method

Prepared on 2026-11-03 from `0d3ab3c` for milestone 17. Initial findings below
come from agent source inspection, followed by deterministic browser reproduction.
There are no independent participants, consent records, discovery-time measurements,
physical-device scaling observations or prolonged drawing results in this record.
The [validation owner](../VALIDATION.md#remaining-checks) retains those checks.
Prior observations retain their original attribution in the
[unified-editor review](unified-editor-ux.md) and
[interaction-polish evaluation](artwork-interaction-polish.md).

## Bounded findings selected before implementation (#166)

| Priority | Trigger and current confusion | Intended task outcome | Evidence and scope |
| --- | --- | --- | --- |
| 1 | Save a newly created independent artwork document: review says saving a shared edit updates references, despite this being a new Library entry. | Distinguish adding new artwork, changing a shared original and replacing selected placements before confirming save. | `reviewCurrent` in the baseline pixel editor unconditionally uses shared-edit wording for every non-placement candidate; agent observation, not participant feedback. |
| 1 | Review an existing shared original: a total reference count gives no affected scene names or placement identities, although the guarded service response contains them. | Inspect the affected saved scenes and bounded exact reference locations before confirming save; disclose pagination rather than suggesting a partial list is complete. | Baseline `art-references` consumes only `references.total`; `ArtworkReview.references` returns scenes and a location page. Agent source finding pending browser reproduction. |
| 2 | Select imported artwork in Existing artwork: Edit shared artwork is disabled with no explanation attached to the control. | Learn that imported pixels require an editable copy using the existing source help, including keyboard/screen-reader context. | Baseline source help already explains the copy route but the disabled control has no description association. |
| 1 | Review an untouched saved original: the document badge says Saved while the checkpoint line says Unsaved artwork. Undo to the saved base has the same misleading checkpoint label. | Distinguish authored modification from the existence of a recovery checkpoint while preserving unload guards. | Agent inspection of the first desktop review capture reproduced the contradictory labels; `reviewCurrent` and checkpoint completion use unconditional unsaved wording. Recorded before the label fix. |

These changes retain the integrated workbench and exact revision-bound review,
local history and recovery. They do not reopen the delivered navigation, Library,
frame-targeting, tool-density or panning redesign. Automated and visual evaluation
will cover keyboard access, desktop and compact review states; human retesting is
unavailable until participant observations are supplied.

## Independent-user session protocol (#165)

Use a disposable copy of representative current content after the responsiveness
fixes. Record the exact commit/build identity, OS/device, browser version, viewport,
actual browser zoom and OS display scaling. Recruit both first-use and experienced
participants; label each anonymized participant's relevant scene/pixel/agent
experience. Obtain consent for observation and separately for recordings; collect
no names, accounts or unrelated project content in repository records.

Give task goals without naming controls. Observe before offering assistance:

1. Create a tile and place it in a scene without prior guidance.
2. Open the intended named sprite pose; edit pixels and animation timing.
3. Make a change to the shared original, then make an independent variation for
   one selected placement; explain which references each save affects.
4. Inspect the changes, save, return to Scene and resume the retained artwork.
5. Reconcile an external agent save first with clean artwork, then with local
   changes. Retain or download local work before choosing a new saved base.
6. Repeat representative tasks using keyboard navigation and a short/narrow
   laptop layout. Allow prolonged drawing, panning and selection on ordinary and
   slower physical devices at the participant's actual zoom/scaling settings.

For each participant/task record: completion (independent/assisted/failed), start
and completion/discovery time, wrong turns, exact assistance, terminology confusion,
participant-reported latency/comfort and anonymized observations. Separate these
from instrumented rendering measurements and art quality. Do not invent timing or
completion values for unperformed sessions. Reproduce actionable failures with
synthetic fixtures, rank by task impact and frequency, and link each remediation
to the observation and retest. Store consent-sensitive raw material outside the
repository; commit only consent-appropriate anonymized results.

## Outcome verification (#167)

The maintained [browser/MCP outcome matrix](../AUTHORING-OUTCOMES.md) owns routes,
boundaries, limits, difference classifications and acceptance links. A synthetic
browser task is a browser-only route check, not an independent manual-user study.

## Delivered checks and visual inspection

The prepared 0.30.1 working tree was checked on macOS 27.0.1 arm64, Python
3.13.13, Node 24.22.1, Playwright 1.64.1 / Chromium 156.0.8078.4 and MCP SDK
1.30.0. Browser fixtures reproduce the two-reference shared edit, independent new
artwork and a 360-reference/three-scene case. Review identifies every affected
scene while explicitly showing only the first 256 exact locations. Keyboard
Enter opens the disclosure; closing review returns focus to Save. Imported source
selection exposes the existing copy explanation through `aria-describedby` and a
tooltip. Reviewing untouched artwork and completing Undo checkpoints now use saved
wording when the document matches its saved base. Revision/conflict and unload
protection retain their existing behavior.

Agent image inspection covers the installed production wheel at
[1440×900](../screenshots/workflow-usability/references-desktop.png),
[800×640 with scrolled references](../screenshots/workflow-usability/references-compact.png)
and [800×640 new-artwork review](../screenshots/workflow-usability/new-artwork-compact.png).
Review scrolls independently; Save remains visible and the drawing surface remains
usable. These captures record fixture states, not prolonged drawing comfort.
Initial captures exposed the contradictory Saved/Unsaved checkpoint wording before
it was corrected. Early test fixtures also failed by deriving an API URL from a
scene URL, editing an immutable candidate in place (correctly rejected by its
digest), and comparing separately allocated artwork UUIDs. The final equivalence
fixture copies one saved baseline and uses the SDK's layout-edit operation without
mutating the envelope. These are fixture corrections, not evidence that the guards
were relaxed. Final command results belong in [Validation](../VALIDATION.md).
