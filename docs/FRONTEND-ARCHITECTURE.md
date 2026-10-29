# Frontend architecture

The supported browser is `static/project.html` → `frontend/project.ts` →
`project-editor.mts`. The entry mounts one editor. The composition creates owners,
connects typed controller ports, initializes the project, and returns `dispose()`.
Importing the composition or controllers does not query the DOM, install handlers,
start polling, or acquire canvas resources. No frontend framework is required.

## Ownership and dependency direction

| Owner/module | Responsibility |
| --- | --- |
| `project-editor.mts` | Composition, operation/busy gate, shared control availability, preview preferences and initial load. Callback forwarding connects controllers without importing each other. |
| `editor-state.mts` | `SceneSession` owns the current scene descriptor, committed baseline/revision and `LayerEditor`, dirty comparisons and native serialization. `WorkspaceState` owns the adopted project catalog/revision and navigation state. Selection, brushes/clipboard and gestures have separate owners. |
| `layers.mts`, `model.mts` | Authored scene, active layer, strokes and undo/redo. Controllers mutate through this existing model. Selection, camera scroll and preview positions are not authored history. |
| `project-api.mts`, `project-contracts.mts`, `decode.mts` | Standalone project-relative HTTP, mutation token, request cancellation, runtime JSON decoding and scene/catalog contracts. Decoder callbacks remain mandatory. Keep standalone routes separate from historical connector transport. |
| `editor-artwork.mts` | Imported images, derived tile/sprite indexes, palette filters/choices, brush capture/restore and atlas import/reimport/deletion. New PNG/Tiled intake belongs here or in focused intake helpers, not the composition. |
| `editor-workspace.mts` | Stage catalog and artwork decoding before adoption; project chooser/folder UI. An adoption callback fences staged external snapshots immediately before mutation. |
| `editor-scene-actions.mts` | Open/create/switch, save acknowledgments and confirmations, rename/duplicate/resize/delete, undo/revert controls. Scene switching and saving run through the operation gate. |
| `editor-recovery.mts`, `drafts.mts` | Checkpoint writer, recovery choices, restore/download/discard. Stopping the editor cancels scheduled work without deleting recoverable drafts. Recovery remains revision guarded. |
| `editor-refresh.mts`, `editor-refresh-state.mts` | Refresh preference, visibility/focus/dirty/gesture eligibility, one in-flight probe, interaction generation, staged adoption and valid selection/layer/tool/brush restoration. The fence compares scene ID/revision, editor identity and project revision; animation redraws may replace a descriptor without invalidating the saved identity. |
| `editor-rendering.mts` | Canvas drawing, coordinate conversion, object hit bounds and preview collision queries. `draw(false)` updates transient display without authored checkpoints or rebuilding controls. |
| `editor-gestures.mts`, `editor-viewport.mts`, `editor-commands.mts` | Pointer authoring/cancellation and pan capture; zoom/fit/wheel and resize; keyboard/toolbar/export commands. The tool radio group and zoom selector are the single current tool/zoom values; do not add a second mutable copy. |
| `editor-layers.mts`, `editor-compositions.mts` | Layer/selection inspectors and layer actions; copy/cut/paste/transforms/stamp controls. |
| `editor-panels.mts` | Wire existing tile/object inspectors, definitions, world, diagnostics, palette and blockout views to scene/project operations. Each feature view continues to own its dialog and validation state. Pending cross-scene navigation is owned here. |
| `animation-preview.mts`, `movement-preview.mts` | Playback, input state and preview positions/preferences. They receive preview contracts and redraw callbacks, never scene writers. |
| `editor-lifetime.mts`, `editor-dom.mts` | Mounted resource ownership and checked, deferred DOM lookup. |

Controllers depend on models, JSON primitives and feature views, with explicit
ports for commands owned elsewhere. They do not import the composition or sibling
controllers at runtime. The composition forwards callbacks so installing a handler
never eagerly resolves a controller that has not been constructed. Getters are
used for current resources/state, not captured copies of mutable primitives.
Keep ports limited to each consumer's needs; do not replace these owners with a
shared miscellaneous state object or global event bus.

## Initialization, asynchronous work and disposal

Create the lifetime and state owners first, then the layout, preview and label
views. Construct controllers and install their handlers before starting the
initial load. Startup, authored mutations and navigation use the busy gate.
The active editor and project/scene revisions are the authoritative adoption
identity. A request completing does not by itself authorize adoption.

External refresh captures that identity plus the interaction generation, checks
eligibility after the probe and snapshot, stages artwork decoding, and probes the
candidate revisions again before adoption. Dirty edits, open forms, gestures,
hidden tabs and preview movement pause adoption. Safe adoption preserves a valid
tool/brush, active layer, selection and viewport; deleted choices are cleared.
A save acknowledges the exact returned project revision, rather than fetching and
acknowledging an unrelated later writer. Native project/Tiled/draft schemas and
HTTP envelopes are unchanged.

One `EditorLifetime` belongs to each mounted editor and is passed to its feature
views. Event listeners use its abort signal. Stable and rebuilt controls use weak
handler ownership, so replaced palette/list nodes are collectable. Timers and
animation frames unregister when fired/cancelled; observers disconnect, pointer
captures release, download URLs revoke and handlers restore on disposal. The
transport shares the signal and rejects responses after disposal. Preview and
draft writers stop; stopping a writer does not delete its saved checkpoint.
Disposal is idempotent. The entry disposes on a non-persisted `pagehide`; a page in
the browser's back/forward cache retains its mounted resources for restoration.

Polling cadence remains two seconds for saved revisions and five seconds for
checkpoint flushing and palette freshness. Refactoring adds no poller and no
extra redraw. Scene replacement resets the existing preview/writer; it does not
mount a second editor. An embedding host replacing the whole editor must call
`dispose()` before mounting the next instance.

## Historical code

`frontend/legacy/` holds the unsupported connector's controllers, document/Apply
transport, DOM registry, response decoding and types. `frontend/app.ts` remains a
thin historical bundle entry for the existing fixture/build tests. The build
continues emitting `app.js` so those isolated fixtures can still run; it is not
loaded by the standalone editor. Shared JSON primitives, errors, generic geometry
and the editing model stay outside `legacy`. The supported bundle must not import
legacy code, including through generic helpers or model defaults.

## Validation and maintenance

- `tests/editor-state.ts`: import safety without a DOM, serialization/undo/dirty
  ownership, stable refresh fencing, resource cancellation and transport contracts.
- `tests/editor-lifecycle-browser.ts`: real disposal/remount, overlay cleanup,
  stopped polling and exactly one scene-opening handler after replacement.
- `tests/refresh-browser.ts`: real MCP concurrent saves, local-edit/form protection,
  paused/hidden refresh, interaction and decode races, tools/brushes and animation.
- Existing model suites cover layers, compositions, previews, definitions, world,
  drafts and resize. Existing Chrome suites exercise the complete editor workflows.
- `tests/frontend-build.ts`: real strict build, maps/identity, atomic failed builds,
  transitive imports and exclusion of legacy from the supported source map.
- Installed-wheel checks exercise bundled assets and launcher; the first-use Chrome
  suite can run against the installed package with `FORGE_TEST_PYTHON`.

Run `make lint test build check-dist`, `make test-browser`, and optional-SDK
`make test-mcp test-mcp-browser`. See [RELEASING.md](RELEASING.md). Behavior-preserving
internal cleanup retains 0.13.1; publication requires a separately chosen,
unpublished version and release authorization.
