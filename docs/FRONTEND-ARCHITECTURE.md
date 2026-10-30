# Frontend architecture

The supported browser is `static/project.html` → `frontend/project.ts` →
`editor/project-editor.mts`. The entry mounts one editor. The composition creates owners,
connects typed controller ports, initializes the project, and returns `dispose()`.
Importing the composition or controllers does not query the DOM, install handlers,
start polling, or acquire canvas resources. No frontend framework is required.

## Ownership and dependency direction

| Owner/module | Responsibility |
| --- | --- |
| `editor/project-editor.mts` | Composition, operation/busy gate, shared control availability, preview preferences and initial load. Callback forwarding connects controllers without importing each other. |
| `editor/editor-state.mts` | `SceneSession` owns the current scene descriptor, committed baseline/revision and `LayerEditor`, dirty comparisons and native serialization. `WorkspaceState` owns the adopted project catalog/revision and navigation state. Selection, brushes/clipboard and gestures have separate owners. |
| `scene/layers.mts`, `scene/model.mts` | Authored scene, active layer, strokes and undo/redo. Controllers mutate through this existing model. Selection, camera scroll and preview positions are not authored history. |
| `project/project-api.mts`, `project/project-contracts.mts`, `shared/decode.mts` | Standalone project-relative HTTP, mutation token, request cancellation, runtime JSON decoding and scene/catalog contracts. Decoder callbacks remain mandatory. JSON primitives live in `shared/`; project transport owns only standalone routes. |
| `artwork/editor-artwork.mts` | Imported images, derived tile/sprite indexes, palette filters/choices, brush capture/restore and atlas import/reimport/deletion. New PNG/Tiled intake belongs here or in focused intake helpers, not the composition. |
| `project/editor-workspace.mts` | Stage catalog and artwork decoding before adoption; project chooser/folder UI. An adoption callback fences staged external snapshots immediately before mutation. |
| `scene/editor-scene-actions.mts` | Open/create/switch, save acknowledgments and confirmations, rename/duplicate/resize/delete, undo/revert controls. Scene switching and saving run through the operation gate. |
| `project/editor-recovery.mts`, `project/drafts.mts` | Checkpoint writer, recovery choices, restore/download/discard. Stopping the editor cancels scheduled work without deleting recoverable drafts. Recovery remains revision guarded. |
| `project/editor-refresh.mts`, `project/editor-refresh-state.mts` | Refresh preference, visibility/focus/dirty/gesture eligibility, one in-flight probe, interaction generation, staged adoption and valid selection/layer/tool/brush restoration. The fence compares scene ID/revision, editor identity and project revision; animation redraws may replace a descriptor without invalidating the saved identity. |
| `editor/editor-rendering.mts` | Canvas drawing, coordinate conversion, object hit bounds and preview collision queries. `draw(false)` updates transient display without authored checkpoints or rebuilding controls. Backing and CSS dimensions change only when needed; each synchronous repaint isolates drawing styles and starts a fresh path. See [measurements and scheduling assessment](evaluations/canvas-repainting.md). |
| `editor/editor-gestures.mts`, `editor/editor-viewport.mts`, `editor/editor-commands.mts` | Pointer authoring/cancellation and pan capture; zoom/fit/wheel and resize; keyboard/toolbar/export commands. The tool radio group and zoom selector are the single current tool/zoom values; do not add a second mutable copy. |
| `editor/editor-layers.mts`, `editor/editor-compositions.mts` | Layer/selection inspectors and layer actions; copy/cut/paste/transforms/stamp controls. |
| `editor/editor-review.mts` | Transient review mode in `EditorActivity.reviewing`, layout/focus and camera transition; gestures enforce Pan and commands block authoring shortcuts. The existing tool/brush/selection remain owned by their usual controllers. |
| `editor/editor-panels.mts` | Wire existing tile/object inspectors, definitions, world, diagnostics, palette and blockout views to scene/project operations. Each feature view continues to own its dialog and validation state. Pending cross-scene navigation is owned here. |
| `preview/animation-preview.mts`, `preview/movement-preview.mts` | Playback, input state and preview positions/preferences. They receive preview contracts and redraw callbacks, never scene writers. |
| `editor/editor-lifetime.mts`, `editor/editor-dom.mts` | Mounted resource ownership and checked, deferred DOM lookup. |

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

## Directory layout

`frontend/project.ts` is the browser entry; `frontend/build.ts` is the Node build
entry. All other modules live with their owning domain:

| Directory | Contents |
| --- | --- |
| `editor/` | Composition, editor session/interaction state, canvas/viewport, command wiring, layout, DOM and mounted lifetime. |
| `project/` | Native transport/contracts, workspace adoption, recovery/checkpoints, external refresh and first-scene guide. |
| `scene/` | Authoring model, layers/history, scene lifecycle, resizing and exports. |
| `artwork/` | Imported images, atlas intake, tile metadata/transforms, terrain adjacency model and tile inspector. |
| `objects/` | Objects/properties, reusable definitions, inspector and definition library. |
| `compositions/` | Clipboard and reusable stamp model. Editor command wiring remains in `editor/`. |
| `blockout/` | Blockout model, review UI and label layout/rendering. |
| `world/` | World model and map dialog. |
| `preview/` | Animation playback, movement simulation and preferences. |
| `diagnostics/` | Project diagnostics dialog and optional palette-budget UI. |
| `shared/` | Domain-independent JSON decoders, error values and geometry/model contracts. |

Use direct relative imports. Keep models independent of DOM/controller modules;
feature views receive typed ports and the mounted lifetime. The existing cross-domain
contract references do not justify moving feature models into `shared/` or adding
barrel exports. Build, lint and strict TypeScript configuration recurse into these
directories. Tests import the owning modules directly.

The unsupported connector frontend, its entry and `static/index.html` have been
removed. Only `project.js` and its source map are built. The build also removes
stale historical bundle artifacts from previously built checkouts. Shared
`style.css` and branding remain required by the standalone editor. Backend
`src/gbc_scene_forge/legacy/` and Python fixtures remain separate historical code;
they no longer have a browser UI. Generic model, transport, timeout and browser
helper coverage now uses supported native contracts.

## Validation and maintenance

- `tests/frontend/artwork/terrain.ts` and `tests/playwright/artwork/terrain.spec.ts`: four-neighbor transition rules,
  collision-preserving neighbor changes, authored rule configuration and native save/reopen.
- `tests/frontend/editor/editor-state.ts`: import safety without a DOM, serialization/undo/dirty
  ownership, stable refresh fencing, resource cancellation and transport contracts.
- `tests/playwright/editor/editor-lifecycle.spec.ts`: real disposal/remount, overlay cleanup,
  stopped polling and exactly one scene-opening handler after replacement.
- `tests/playwright/mcp/refresh.spec.ts`: real MCP concurrent saves, local-edit/form protection,
  paused/hidden refresh, interaction and decode races, tools/brushes and animation.
- Existing model suites cover layers, compositions, previews, definitions, world,
  drafts and resize. Existing Chrome suites exercise the complete editor workflows.
- `tests/frontend/infrastructure/frontend-build.ts`: real strict build, maps/identity, atomic failed builds,
  transitive imports, stale bundle removal and native-only source maps.
- Installed-wheel checks exercise bundled assets and launcher; the first-use Chrome
  suite can run against the installed package with `FORGE_TEST_PYTHON`.

Run `make lint test build check-dist`, `make test-browser`, and optional-SDK
`make test-mcp test-mcp-browser`. See [RELEASING.md](RELEASING.md). Behavior-preserving
internal cleanup retains 0.13.1; publication requires a separately chosen,
unpublished version and release authorization.

## Response schemas

World-report snapshots, project catalogs and saved scenes use pinned Valibot
schemas with inferred output types and the existing decoder callback boundaries.
`shared/schema.mts` owns JSON object/array/dictionary checks, primitive messages,
first-error parsing and a bridge to existing domain decoders. Specialized domain
rules remain explicit; migrate other response contracts progressively rather than
duplicating their validation during conversion. See the
[adoption evaluation](evaluations/valibot-pilot.md) for compatibility requirements,
measured cumulative/marginal bundle cost and dependency/license handling.
Browser dependencies are bundled during build; the installed Python editor still
requires no Node or CDN requests.
