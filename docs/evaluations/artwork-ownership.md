# Artwork asynchronous ownership audit (#169)

## Scope and method

The implementing agent inspected the milestone-18 working tree based on
`166eda046c4121452615e16048100ad48107e0d6` on 2026-11-03, including the #168
ownership extraction. This is a bounded source/interleaving audit, supported by
synthetic service, model, Chromium and real MCP SDK checks. It is not independent
user evidence or a proof of every possible schedule. Observed results and runtime
boundaries belong in [Validation](../VALIDATION.md).

The [frontend inventory](../FRONTEND-ARCHITECTURE.md#artwork-state-and-resource-inventory)
identifies state, resources and typed ports. The extraction leaves the serialized
writer, review/save API calls and service/journal ownership in their existing
owners. Inspection compared those paths with the pre-extraction composition and
traced the following identities through submission, completion and disposal.

## Identity and completion boundaries

| Identity/state | Owner and completion rule |
| --- | --- |
| Active versus retained document | The composition owns the active ArtworkSession reference; retained entries keep the same session/model/history rather than a clone. Its busy gate blocks ordinary document transitions during asynchronous review/save/open. Suspend cancels the gesture and debounce, stops playback and awaits checkpoint work before remembering controls. |
| Candidate versus original saved base | ArtworkSession owns both envelopes. Synchronization advances only the candidate through layout/pixel services. Dirty comparisons use the original exact RGBA/descriptor. Successful save adoption reopens the acknowledgment's exact project/artwork revisions before advancing the original base. |
| Layout and sequence binding | PixelModel history may replace the descriptor with equal content. Sheet synchronization compares descriptor identity as well as serialized content, cancels playback and rebinds rows. Restoration creates options, restores frame/sequence controls, then forces rebinding; identical sequence IDs in different documents do not identify their row objects. |
| Exact review receipt | Authored changes and restored documents invalidate receipt/images. Review waits for the serialized candidate before submitting. The UI busy gate prevents ordinary concurrent edits; the service receipt binds candidate, artwork/files, project and every scanned scene revision, with guards passed to final commit. |
| Checkpoint submission and acknowledgment | The composition captures completed pixels before its debounce. ArtworkSession clones the submitted pixels/descriptor before enqueueing work. Its queue serializes layout/pixel synchronization and owned draft writes; later edits or Undo do not change submitted snapshots. Pending/uncertain acknowledgments remain unload guards even when Undo reaches the saved base. |
| Checkpoint identity and uncertain writes | Session UUID/owner and checkpoint revision are independent of document/atlas UUIDs. A lost checkpoint response triggers guarded listing/download inspection before another write or deletion. The server requires matching owner/revision/original identity. Stale bases remain downloadable/checkpointable; restoration validates them and cannot overwrite a later save. |
| External project/scene/artwork revisions | Browser and MCP use the same guarded services. Review scans/revalidates dependencies; final journal expectations reject changes after preparation, including raw scene-file drift. The acknowledgment describes prepared committed bytes, without rereading a later writer. |
| Captured authored gesture | The gesture owner retains its starting model and pointer. Replacement/disposal cancels that model, releases capture and creates no completed history entry. Navigation receives fresh model/view getters and has no authored mutation/checkpoint port. |
| Mounted lifetime | Controllers share one lifetime and transport abort signal. ProjectApi checks that signal after response JSON, so even a late successful read cannot start a document in a disposed mount. Event handlers, captures, timers, observers and surfaces are released through that lifetime. |

The busy gate and transport cancellation are part of the current review/open
identity fence. If future work permits document transitions or authored edits
during those requests, their completion must additionally check the submitted
session/content identity; the present code must not be copied into an unguarded
background task. No new bus, competing writer or service/journal bypass is added.

## Regression evidence and concrete gaps

| Interleaving | Existing or added checks |
| --- | --- |
| Edits, Undo/Redo and canceled gestures during checkpoint work | [Pixel/session model checks](../../tests/frontend/artwork/pixels.ts) cover ordered immutable submissions, Undo to saved bytes, lost initial/update acknowledgments and guarded inspection failure/retry. [Pixel browser acceptance](../../tests/playwright/artwork/pixels.spec.ts) covers pending checkpoint versus canceled later gesture and unload protection until checkpoint reconciliation. |
| Equal descriptors, sequence IDs and history restoration | Pixel browser cases `document restoration binds the selected sequence and clears other artwork reviews`, `artwork Undo and Redo stop playback before restoring sequence frames`, and representation/history-bound checks exercise live callbacks, exact timing/layout, fresh review and saved reopen. [Navigation acceptance](../../tests/playwright/artwork/navigation.spec.ts) covers controls, viewport and independent retained histories. |
| External MCP writes and stale reviews | [Real SDK/browser handoffs](../../tests/playwright/mcp/artwork-mcp.spec.ts) and [external refresh](../../tests/playwright/mcp/refresh.spec.ts) retain local work and reject stale commits. [Review service checks](../../tests/backend/artwork/test_artwork_review.py) cover changed candidates, raw reviewed-map drift before/final commit and drift during render. |
| Selected references and atomic save | [Variation service checks](../../tests/backend/artwork/test_artwork_variations.py) cover invalid/mixed/duplicate selections, changed selection receipts, selected-map races, exact recovery guards and rollback of artwork plus maps after an injected write failure. [Native save checks](../../tests/backend/artwork/test_editable.py) cover journal dependencies, interruption recovery and exact acknowledgment despite a later writer. |
| Lost successful save response | Added pixel browser case `successful artwork write with failed save acknowledgment preserves the correct recovery boundary`: the route commits successfully, then loses the response. Saved RGBA is exact; the retained checkpoint and Download work preserve submitted pixels; retry with the old review/base is rejected and leaves the checkpoint intact. |
| Acknowledged save followed by failed reopen | Added pixel browser case `successful artwork write with failed saved reopen preserves the correct recovery boundary`: saved RGBA is exact, the submitted checkpoint is removed and the old editable session is retired. The UI reports the acknowledged save rather than returning that stale candidate to editing. |
| Delayed read after disposal/remount | Added pixel browser case `a late artwork open cannot adopt into a replacement mounted editor`: hold the successful open response, dispose/remount, release it and verify no old document appears. A fresh open succeeds in the replacement. Existing [composition lifecycle checks](../../tests/playwright/editor/editor-lifecycle.spec.ts) retain the wider project/decode/cleanup boundaries. |
| Model replacement and active capture | The [extracted gesture check](../../tests/playwright/artwork/ownership.spec.ts) tests original-model rollback, unrelated pointer release and disposal with capture active. Real navigation/pixel cases cover Escape, blur, pointer cancellation and pan/tool focus. |

The three new asynchronous cases fill specific response/adoption gaps; they do
not duplicate the service race corpus. The first download attempt in the lost-save
case targeted a control inside the closed Document actions disclosure and timed
out. Opening that existing disclosure corrected the fixture; the saved write and
checkpoint assertions had already passed. This was not a product failure.

No additional product defect was verified in the audited asynchronous paths.
Consequently #169 adds focused regression evidence and records the existing
contracts without changing persistence, receipt, native/Tiled or security policy.
The #168 extraction separately makes captured-model ownership explicit.

## Limits

The audit exercises selected deterministic schedules, not arbitrary event-loop,
filesystem or process-failure permutations. Browser busy/disabled controls are
part of its assumptions; direct mutation of internal objects by unsupported host
code is outside the authoring interface. Late-read disposal is exercised directly;
every individual endpoint is not repeated under every disposal schedule.
Post-commit lost-response tests cannot establish whether an arbitrary real network
failure committed; they verify retention/rejection in the deliberately committed
case. Acknowledged adoption failure intentionally retires local editing history
because its saved bytes are durable. Existing human, platform and external-tool
gaps remain in the [single remaining-check list](../VALIDATION.md#remaining-checks).
