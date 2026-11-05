# Frontend architecture

The supported browser is `static/project.html` → `frontend/project.ts` →
`editor/project-editor.mts`. The entry mounts one editor. The composition creates owners,
connects typed controller ports, initializes the project, and returns `dispose()`.
Importing the composition or controllers does not query the DOM, install handlers,
start polling, or acquire canvas resources. No frontend framework is required.

## Ownership and dependency direction

| Owner/module | Responsibility |
| --- | --- |
| `editor/editor-shell.mts` | Shared workbench/Inspector presentation slots and active document kind. Typed contributions provide a surface, Inspector panels and focus callback; controllers retain models, commands, history and persistence. Mounted nodes return to their source locations on disposal. |
| `editor/project-editor.mts` | Composition, operation/busy gate, shared control availability, preview preferences and initial load. Callback forwarding connects controllers without importing each other. |
| `editor/editor-state.mts` | `SceneSession` owns the current scene descriptor, committed baseline/revision and `LayerEditor`, dirty comparisons and native serialization. `WorkspaceState` owns the adopted project catalog/revision, separately validated scene choices and navigation state. Selection, brushes/clipboard and gestures have separate owners. |
| `scene/layers.mts`, `scene/model.mts` | Authored scene, active layer, strokes and undo/redo. Controllers mutate through this existing model. Bidirectional changed-path/subtree records retain up to 100 operations; one transaction clone supports cancellation. Layer context replays with undo/redo. Selection, camera scroll and preview positions are not authored history. |
| `project/project-api.mts`, `project/project-contracts.mts`, `shared/decode.mts` | Standalone project-relative HTTP, mutation token, request cancellation, runtime JSON decoding and scene/catalog contracts. Decoder callbacks remain mandatory. JSON primitives live in `shared/`; project transport owns only standalone routes. |
| `artwork/pixel-editor.mts` | Artwork composition, active document transitions, setup, review/save and recovery. Wires retained-document, gesture, rendering, sheet and workspace owners through typed callbacks. `artwork/conversion-views.mts` derives bounded origin-aware scene views covering selected sprite conversions; confirmation requires all views of the same plan. The composition forwards exact save acknowledgments and stages catalog/image adoption. Successful saves retain the document/history and reopen the exact acknowledged revision before advancing its base; failed post-save adoption retires the submitted candidate. |
| `artwork/pixel-model.mts`, `artwork/artwork-session.mts`, `artwork/artwork-contracts.mts` | Exact RGBA/layout history using reversible changed 4 KiB blocks (100 operations / 64 MiB), serialized candidate/checkpoint writer, saved base and schema decoding. Large documents synchronize bounded rectangular patches through compact handles scoped to the session owner, so cleanup preserves other clients' copies. Pixel state stays outside scene history. |
| `artwork/artwork-documents.mts`, `artwork/artwork-gestures.mts`, `artwork/artwork-rendering.mts` | Retained sessions/control snapshots, captured authored gestures and main canvas drawing respectively. See the state/resource inventory below. |
| `artwork/editor-artwork.mts` | Imported images, derived tile/sprite indexes, palette filters/choices, brush capture/restore and atlas import/reimport/deletion. New PNG/Tiled intake belongs here or in focused intake helpers, not the composition. |
| `project/editor-workspace.mts` | Stage catalog and artwork decoding before adoption; project chooser/folder UI. An adoption callback fences staged external snapshots immediately before mutation. |
| `scene/scene-navigation.mts` | Project-relative scene paths and indexed browser history; restore the active entry before asynchronous confirmation, then traverse only after successful adoption. Resources belong to the editor lifetime. |
| `scene/editor-scene-actions.mts` | Open/create/switch, save acknowledgments and confirmations, rename/duplicate/resize/delete, undo/revert controls. Scene switching and saving run through the operation gate. |
| `project/editor-recovery.mts`, `project/drafts.mts` | Checkpoint writer, recovery choices, restore/download/discard. Stopping the editor cancels scheduled work without deleting recoverable drafts. Recovery remains revision guarded. |
| `project/editor-refresh.mts`, `project/editor-refresh-state.mts` | Refresh preference, visibility/focus/dirty/gesture eligibility, one in-flight probe, interaction generation, staged adoption and valid selection/layer/tool/brush restoration. The fence compares scene ID/revision, editor identity and project revision; animation redraws may replace a descriptor without invalidating the saved identity. |
| `editor/editor-rendering.mts` | Canvas drawing, coordinate conversion, object hit bounds and preview collision queries. `draw(false)` updates transient display without authored checkpoints or rebuilding controls. Backing and CSS dimensions change only when needed; each synchronous repaint isolates drawing styles and starts a fresh path. Owns a 16 MiB LRU of transparent tile chunks with content/region invalidation and viewport clipping; scroll/resize redraw through the mounted lifetime. `drawOverview` renders full authored layers directly to the resize preview without display clipping or transient feedback. See [rendering/history contracts and measurements](evaluations/scene-scalability.md). |
| `editor/editor-gestures.mts`, `editor/editor-viewport.mts`, `editor/editor-commands.mts` | Pointer authoring/cancellation and pan capture; zoom/fit/wheel and resize; keyboard/toolbar/export commands. The scene/pixel tool radio groups and zoom selectors are the single current tool/zoom values; do not add a second mutable copy. |
| `editor/editor-layers.mts`, `editor/editor-compositions.mts` | Layer/selection inspectors and layer actions; copy/cut/paste/transforms/stamp controls. |
| `editor/editor-layout.mts` | Mounted Library/Inspector visibility, accessible pane toggles, Library categories, guided reveal, responsive toolbar disclosure and command popovers. The active document selects artwork Library content while retaining the scene category. Pane/toolbar preferences are transient UI state; viewport transitions redraw without authored checkpoints. Disposal resets visibility. |
| `editor/editor-review.mts` | Transient review mode in `EditorActivity.reviewing`, layout/focus and camera transition; gestures enforce Pan and commands block authoring shortcuts. The existing tool/brush/selection remain owned by their usual controllers. |
| `editor/editor-panels.mts` | Wire existing tile/object inspectors, definitions, world, diagnostics, palette and blockout views to scene/project operations. Each feature view continues to own its dialog and validation state. Pending cross-scene navigation is owned here. |
| `preview/animation-preview.mts`, `preview/movement-preview.mts` | Playback, input state and preview positions/preferences. They receive preview contracts and redraw callbacks, never scene writers. |
| `editor/editor-notifications.mts` | Mounted feedback channels own document/operation identity, coalescing cards, live announcements, dismiss/expiry and paused timers. Explicit warnings expire; errors persist. Captured acknowledgments only resolve the notices they captured. Passive top-layer cards follow modal ownership without entering command-menu interaction guards. |
| `editor/editor-lifetime.mts`, `editor/editor-dom.mts` | Mounted resource ownership and checked, deferred DOM lookup. |

Controllers depend on models, JSON primitives and feature views, with explicit
ports for commands owned elsewhere. They do not import the composition or sibling
controllers at runtime. The composition forwards callbacks so installing a handler
never eagerly resolves a controller that has not been constructed. Getters are
used for current resources/state, not captured copies of mutable primitives.
Keep ports limited to each consumer's needs; do not replace these owners with a
shared miscellaneous state object or global event bus.

`artwork/artwork-workspace.mts` contributes layer/property/review sections and
color assistance to the one Inspector. `artwork/sheet-editor.mts` owns the drawing-boundary controls beside the tools and
the bounded bottom frame/animation dock, stops playback on collapse and reuses raster stamps
for unchanged thumbnails. Panel/dock disclosure is transient UI state, outside
pixel history. Source setup in `pixel-editor.mts` preserves entered fields during
discovery; a missing selected source stays an explicit unavailable choice instead
of adopting an unrelated source. Shared source edits and captured-placement copies
continue to use the existing guarded domain operations.

Library opening paints a named, cancellable loading state before suspension and
decoding. Read-only waits have an operation/mount fence; outgoing checkpoint
writes complete before replacement and are not cancelled with the read. Late
responses cannot adopt inventory or documents after cancellation/supersession.
Dirty layer reads check descriptors first and compare live sources without
cloning/compositing; decoded baseline bytes use a 32 MiB / 18-entry session LRU. Equality
is never cached across reads because buffers permit direct mutation.

Illustration-layer UI belongs to `artwork/artwork-layer-controls.mts`; exact sources,
active layer and history belong to `PixelModel`, and `artwork/artwork-layers.mts`
owns integer compositing. Layer snapshots share the existing history budget.
`ArtworkSession` serializes metadata/source synchronization and checkpoints before
review or exchange. Candidate adoption is an explicit new session with a distinct
owner and Undo history; other sessions remain retained. Artwork discovery stages
a separate saved catalog/images through the composition without advancing scene
or artwork saved bases. Interaction generation, session identity, focus/modal,
gesture and busy gates fence every asynchronous discovery adoption.

Selected artwork variations capture at most 256 explicit locations from a clean
saved scene. Pixel candidates/checkpoints retain that selection. After an exact
atomic artwork/reference acknowledgment, the composition reloads matching saved
scene content with fresh history; its old conflict guard remains until content
adoption succeeds. Ordinary shared artwork edits retain local scene edits/history.

Canvas view filters belong to the mounted rendering controller and use the pure
classification in `scene/view-filters.mts`. They never enter scene history,
serialization, recovery or diagnostics. Hidden categories lose selection and hit
tests; gestures reject hidden placements/tiles, and composition commands require
all categories visible. Filter redraws refresh controls without checkpointing.

## Shared document shell

The scene and artwork surfaces occupy the same `editor-workbench`; scene and
artwork panel contributions occupy the same `inspector-pane`. The mounted shell
sets `EditorActivity.document` and presentation visibility together. Scene keyboard,
Space-pan, focus restoration, history navigation and saved-refresh eligibility
explicitly reject the artwork context; they no longer depend on a nonmodal artwork
dialog being open. Pixel gestures and review/save remain owned by their existing
controllers. Artwork discovery keeps its existing independent eligibility fence.

The document bar derives names, kinds and local Saved/Modified/New state from
the active owner. A separate warning reports detected changes to its saved base;
it does not rebase local history. Documents offers the active scene, other saved
scenes and up to 16 retained artwork sessions. Switching cancels captured gestures
and stops outgoing playback. Scene view retention belongs to its viewport
controller; artwork controls, selection and view belong to its retained session.
Artwork checkpoints must succeed before a scene or project departure. The shared
operation gate rejects duplicate navigation, and lifetime checks prevent disposed
responses from restoring a document. `editor/document-commands.mts` binds the shared command strip and document-bar Save
once per mount. Fresh typed capabilities come only from the active scene/artwork
owner; model, history, clipboard and persistence stay domain-owned. The same route
handles common shortcuts from outside either surface, excluding text editing and
modal/popover focus. Scene dirty equality is reused from the current update;
capabilities are checked again at invocation. Artwork Save retains exact review,
confirmation, receipt invalidation, checkpoint and acknowledgment adoption.
The contextual pixel toolbar and bounded frame dock remain; subsequent milestone
issues refine panels. Artwork layer/properties and exact-change review currently contribute
their existing controls to the shared Inspector. Review opens it when collapsed.
Retained artwork controls
include both its surface and Inspector; they never snapshot scene controls.

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

Polling cadence remains two seconds for saved revisions and navigation inventories
and five seconds for checkpoint flushing and palette freshness. Inventory discovery
shares the refresh cycle and adds no timer or redraw. It updates choices independently
of snapshot adoption, without acknowledging project revisions. Hidden tabs, focused
dropdowns and dialogs defer discovery; text input and dirty scenes do not. Unchanged
server checks use metadata caches. Scene replacement resets the existing preview/writer;
it does not mount a second editor. An embedding host replacing the whole editor must call
`dispose()` before mounting the next instance.

## Runtime policy ownership

These are existing interaction and retention policies, independent of the shared
[authoring limits](DOMAIN-LIMITS.md). Values remain unchanged by #172. Keep each
policy in its owner; matching numbers do not imply matching semantics.

| Owner | Named policy and units | Scope and rationale |
| --- | --- | --- |
| [`tile-cache.mts`](../frontend/editor/tile-cache.mts) | `TILE_CHUNK_EDGE_PIXELS` = 256 native pixels; `TILE_CACHE_BYTES` = 16 MiB | `tileChunkPixels` rounds down to whole cells, with at least one cell. Cache allocation and the renderer's `tileViewBytes` retention estimate use that geometry. The conservative estimate charges full edge chunks and all visible tile layers; views above budget use temporary chunks. The byte cap covers retained RGBA canvases, not signatures, source images, browser/GPU overhead or total process memory. Eviction/disposal zero canvas dimensions. |
| [`scene/model.mts`](../frontend/scene/model.mts) | `MAX_SCENE_HISTORY_OPERATIONS` = 100 | Per-scene undo count; variable-sized deltas and the active transaction copy have no byte cap. No-ops retain redo; cancellation restores the transaction. |
| [`pixel-model.mts`](../frontend/artwork/pixel-model.mts) | `MAX_PIXEL_HISTORY_OPERATIONS` = 100; `MAX_HISTORY_BYTES` = 64 MiB; `PIXEL_HISTORY_CHUNK_BYTES` = 4 KiB | Completed edits trim the oldest undo records by count and payload estimate. The estimate includes flat XOR blocks, layer snapshots, encoded descriptors and bookkeeping charges (16 bytes/block, 64 bytes/entry), not exact JavaScript allocations. Live buffers, clipboard and active edit snapshots are additional. Undo/redo reuse flat blocks; layer travel captures the opposite source state and does not reapply the byte trim. These are not total-document/process memory guarantees. |
| [`artwork-session.mts`](../frontend/artwork/artwork-session.mts) | `MAX_BASELINE_BYTES` = 32 MiB; `MAX_BASELINE_ENTRIES` = 18 | Per-session decoded saved/checkpoint LRU: two aggregate 16 MiB baselines, with two sets of eight sources plus a composite. Encoded candidate strings and other session state are additional. Direct source mutations remain observable; this caches decoded bytes, never dirty equality. |
| [`artwork-documents.mts`](../frontend/artwork/artwork-documents.mts) | `MAX_OPEN_ARTWORK_DOCUMENTS` = 16 | New-artwork setup, saved Library opening and candidate adoption share this retained-session guard. The scene is separate; count does not bound aggregate browser memory. |
| [`artwork-session.mts`](../frontend/artwork/artwork-session.mts) | `MAX_PIXEL_WRITES_PER_REQUEST` = 8,000 unique writes | Individual-write synchronization stays below the service's 1 MiB decoded-write JSON budget. Candidate envelopes and large-document rectangular patches retain their separate bounds. Each acknowledgment advances the next request's candidate. |
| [`drafts.mts`](../frontend/project/drafts.mts), [`editor-recovery.mts`](../frontend/project/editor-recovery.mts) | `SCENE_CHECKPOINT_DEBOUNCE_MS` = 750 ms; `SCENE_CHECKPOINT_FLUSH_INTERVAL_MS` = 5,000 ms | Quiet time coalesces observed scene edits; explicit/visibility flushes bypass it. Periodic flush retries subject to busy/gesture gates. Immutable observations, serial writes, exact uncertain retries and stop-without-delete semantics remain with the writer. |
| [`pixel-editor.mts`](../frontend/artwork/pixel-editor.mts) | `ARTWORK_CHECKPOINT_DEBOUNCE_MS` = 350 ms; `ARTWORK_DISCOVERY_INTERVAL_MS` = 2,000 ms | Completed artwork edits capture pixels/layout/sources before scheduling. Inventory discovery is separate from checkpointing and remains fenced by document identity, activity and revision. |
| [`editor-refresh.mts`](../frontend/project/editor-refresh.mts) | `SAVED_REFRESH_INTERVAL_MS` = 2,000 ms | Saved scene/project revision probes and navigation discovery; eligibility and adoption fences remain authoritative. |
| [`palette-budget.mts`](../frontend/diagnostics/palette-budget.mts) | `PALETTE_REPORT_DEBOUNCE_MS` = 300 ms; `PALETTE_FRESHNESS_INTERVAL_MS` = 5,000 ms | Local report coalescing and idle saved-revision freshness are distinct policies. Stale replies cannot render. |
| [`movement-preview.mts`](../frontend/preview/movement-preview.mts) | `MAX_MOVEMENT_STEP_MS` = 100 ms | Clamp simulated catch-up after a delayed frame. Animation and hover paints still use owned animation frames; sheet playback uses authored frame durations, with no fixed polling cadence. |

Timers and animation frames retain their mounted lifetime and cancellation gates.
The [scene scalability decision](evaluations/scene-scalability.md#rendering-results-and-decision),
[large-artwork evidence](evaluations/large-artwork.md) and
[opening measurements](evaluations/artwork-opening.md) explain the existing
performance choices; naming policies adds no new capacity or latency claim.

## Hover feedback and dirty state

Pointer coordinates update immediately. Cell changes and pointer leave request
one transient canvas paint through `editor-rendering.mts:createHoverPaint`.
The pending frame reads current hover, tool, brush and viewport state and uses
`draw(false)`, avoiding control/inspector refresh and checkpoint work. Authoring,
selection, cancellation and control changes keep synchronous `draw()`; animation
keeps synchronous `draw(false)` inside its owned frame. Either immediate draw
cancels a pending hover paint. If hover paints first, a later animation or authored
draw in the same frame can still paint; immediate feedback takes priority.

The mounted `EditorLifetime` owns/cancels the queued frame. A queued request also
checks editor identity and loaded scene ID/revision before painting. Scene open,
external adoption, recovery and close perform an immediate draw, superseding any
queued work; identity checks reject replacements even before that draw. No scene
snapshot or authored mutation is captured by the scheduler.

Each synchronous composition `update()` evaluates content-based dirty equality
once and passes the result to checkpoint observation and controls. This result
expires when the call returns. Independent navigation, before-unload, refresh,
visibility and periodic checkpoint checks still read current content. There is
no persistent dirty cache, mutation generation or new invalidation contract;
in-progress strokes, no-ops, undo back to saved content and adopted/recovered
baselines retain their existing equality semantics. See the
[interaction measurements](evaluations/canvas-repainting.md#interaction-efficiency-77-90-91).

## Directory layout

Native pixel editing follows the [editable artwork contract](EDITABLE-ARTWORK.md).
Its document history/recovery owners live under `artwork/`, separate from scene
history and connected through the existing composition/lifetime.

`frontend/project.ts` is the browser entry; `frontend/build.ts` is the Node build
entry. All other modules live with their owning domain:

| Directory | Contents |
| --- | --- |
| `editor/` | Composition, editor session/interaction state, canvas/viewport, command wiring, layout, DOM and mounted lifetime. |
| `project/` | Native transport/contracts, workspace adoption, recovery/checkpoints, external refresh, first-scene guide and Forge scene-transfer preflight. |
| `scene/` | Authoring model, layers/history, scene lifecycle, resizing and exports. |
| `artwork/` | Imported images/intake, native artwork documents, pixel history/gestures/rendering, sheet/animation controls, tile metadata/transforms, terrain adjacency model and tile inspector. |
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
- `tests/playwright/artwork/ownership.spec.ts`: captured strokes retain their original model across replacement and disposal; unrelated pointers cannot finish a stroke.
- Existing model suites cover layers, compositions, previews, definitions, world,
  drafts and resize. Existing Chrome suites exercise the complete editor workflows.
- `tests/frontend/infrastructure/frontend-build.ts`: real strict build, maps/identity, atomic failed builds,
  transitive imports, stale bundle removal and native-only source maps.
- Installed-wheel checks exercise bundled assets and launcher; the first-use Chrome
  suite can run against the installed package with `FORGE_TEST_PYTHON`.

Run `make lint test build check-dist`, `make test-browser`, and optional-SDK
`make test-mcp test-mcp-browser`. See [RELEASING.md](RELEASING.md). Behavior-preserving
internal cleanup does not require a dedicated version bump; publication requires a separately chosen,
unpublished version and release authorization.

## Response schemas

World-report snapshots, project catalogs, saved scenes, objects/properties,
definitions, tile/collision metadata and palette/hardware profiles use pinned
Valibot schemas with inferred output types and the existing decoder callbacks.
Domain schemas live beside their owning models; project contracts compose them
directly. `NewObject` and independent scene, world and preview authoring models
remain separate from wire inputs. Keep authoring policy in its existing validators:
finite response numbers do not imply safe-integer authored values.
`shared/schema.mts` owns JSON object/array/dictionary checks, primitive messages,
first-error parsing and justified decoder integration. The remaining bridges are
authored world metadata, region-dependent animation manifests and stamp composition.
Keep defaults, conditional dispatch, optional-field omission and cross-field rules
explicit. Schema field/stage order is observable error behavior. Projection makes
`v.exactOptional` reject absent fields; use `v.optional` and explicitly omit
undefined fields from normalized output where the old decoder did so.

For a contract change, update its owning schema and callers, add malformed/default
and multi-error cases to the compatibility corpus, and compare the baseline before
updating the pinned outcomes. Do not copy rules into a second validation path.
The [adoption inventory](evaluations/valibot-pilot.md#bounded-domain-adoption-75)
records retain decisions and specific revisit conditions for small inline replies,
reports and preferences; there is no open-ended conversion requirement. It also
owns reproducible compatibility/bundle methods and dependency/license handling.
Browser dependencies are bundled during build; the installed Python editor still
requires no Node or CDN requests.

## Artwork and scene refresh costs

`artwork/artwork-raster.mts` owns one reusable canvas/ImageData snapshot for the
mounted pixel editor. It compares all RGBA channels against mutable model bytes;
history replacement, hidden RGB and direct writes require no mutation flag.
Changed bounds invalidate intersecting frame stamps; geometry and document
changes also invalidate thumbnails. The sheet controller owns weak per-canvas
stamps, refreshes collapsed timeline images on reveal, and releases rows/surfaces
on disposal. Pixel gesture painting updates the raster, overlays and dirty
command label; completion and cancellation perform full control synchronization.
No pointer segments are dropped or deferred.

Artwork sessions retain at most two decoded pixel baselines for exact saved and
checkpoint comparisons. Dirty state itself is never cached. Encoding remains at
persistence/download boundaries. Pending and uncertain checkpoint acknowledgments
continue to protect departure, even when Undo reaches the saved base.

`editor/editor-layers.mts` compares exact object option labels/order/IDs before
replacing options, then updates selection and availability separately. Scene
models and validation remain authoritative on each refresh. `project/drafts.mts`
captures JSON at observation, compares that immutable string directly and decodes
only when flushing. A caller cannot mutate an observed or uncertain-retry payload.
See the [performance evaluation](evaluations/editor-responsiveness.md) for costs
retained deliberately and the bounds of current measurements.


## Artwork viewport and document navigation

Artwork saved discovery also follows a clean active saved document. Reads stage a
fresh candidate and revalidate the saved project revision and interaction/session
fence before adoption. Replacement creates a new model/history, retires only that
document's checkpoint and transfers retained view/control state without focusing
the canvas. Dirty or uncertain local work blocks automatic adoption. Explicit
Load latest confirms discard and uses the existing operation gate; background
failure/retry status stays inline rather than entering the toast channel.

`artwork/artwork-viewport.mts` owns padded scrolling, normalized per-document view
centers, Pan/Space/middle-button input and a coalesced DOM pixel-target overlay.
Its coordinate conversion is shared by hover and authored pointer gestures;
only captured drawing clamps at canvas edges. Navigation and hover have no model,
control-refresh, raster-paint or checkpoint callbacks. Layout writes occur only
when sheet/frame geometry, zoom or viewport dimensions change. Fit and frame
scope changes recenter; resize and zoom preserve the viewed center.

`artwork/document-chooser.mts` owns the native modal chooser, dismissal and focus
restoration. `artwork/artwork-documents.mts` retains sessions and their control,
viewport-center and Pan snapshots; `artwork/pixel-editor.mts` coordinates their
transitions, review/save and recovery. Opening the chooser cancels an
unfinished authored gesture and suspends transient navigation. Busy requests
disable its trigger. The mounted lifetime owns listeners, capture, the hover
frame and ResizeObserver; disposal releases them together.

The pure `artwork/artwork-palette.mts` collector bounds exact RGBA colors to
1,024 and sorts neutral colors followed by hue. The composition owns its native
popover, keyboard focus and lifetime; swatches never mutate artwork pixels.
Main artwork backing surfaces stay within 4,194,304 pixels and 4,096 per axis,
independently of CSS zoom; a CSS overlay draws the zoomed grid when needed.

## Artwork state and resource inventory

| Owner | State/resources | Typed boundary |
| --- | --- | --- |
| `pixel-editor.mts` | Current session, busy gate, source inventory, palette signature, checkpoint debounce and conversion plan. | Composes owners with fresh getters for current session/model, sheet view and selected frame. Owns API calls, error presentation, authored-change/checkpoint notification and exact save adoption. |
| `artwork-documents.mts` | Retained session identities, input/radio/select/details snapshots and normalized viewport/Pan snapshots. Cleared on mounted disposal. | Receives the dialog and lifetime; remembers only measurable views. Creates no model, writer or timer. The composition creates sheet options, restores controls, then forces sheet callback rebinding before drawing/restoring the viewport. Save retirement removes the submitted entry before fallible adoption; successful adoption reuses its snapshot. |
| `artwork-gestures.mts` | One captured pointer, start/last points, tool and original model identity. Tool values remain in the native radio group. | Receives current-model/availability getters, clamped coordinate conversion, color and narrow mutation/paint/cancellation callbacks. Pointer segments synchronously paint through the composition; completion alone notifies authored changes. Cancellation rolls back the original model and releases capture, including replacement/disposal. Listeners and captures belong to the lifetime. |
| `artwork-rendering.mts` | Main canvas/context, dimensions and raster/overlay drawing. Disposal releases its backing surface. | Reads current model, frame view/selection, zoom and grid/onion preferences through getters. Receives the shared raster; never synchronizes sheets, checkpoints or controls itself. |
| `artwork-raster.mts`, `sheet-editor.mts` | Exact reusable RGBA upload/cache; weak thumbnail stamps, frame/sequence binding, playback position and owned timer. | The composition synchronizes controls before rendering. During a stroke it uses pixel/thumbnail painting only; completion/cancellation performs full synchronization. Sheet mutation still enters PixelModel history through its existing port. |
| `pixel-model.mts`, `artwork-session.mts` | Pixel/layout history and selection/clipboard; candidate/original/receipt, serialized checkpoint queue, checkpoint identity/uncertainty and exact saved/checkpoint baselines. | Remain the authoring and persistence authorities. Retained-document and rendering owners neither clone these owners nor replace their identity checks. |
| `artwork-workspace.mts`, `artwork-viewport.mts`, `document-chooser.mts` | Setup/properties/review presentation; scroll geometry, pan/capture, target frame and ResizeObserver; modal focus/dismissal. | Existing presentation/lifetime contracts remain. Navigation has no authored mutation or checkpoint port. |

Imports acquire no DOM, canvas, listeners or timers. All owners are created once
per mount and use the same lifetime; callback forwarding avoids sibling runtime
controller imports. Rendering remains synchronous, resets context state and
retains geometry checks, exact RGBA comparisons and bounded thumbnail work from
the [responsiveness measurements](evaluations/editor-responsiveness.md).

## Explicit document closure

`editor/document-close.mts` owns one native confirmation and resolves a domain-neutral
Save/Keep/Discard/Cancel choice. The shared command routes to the active domain;
controllers recheck document identity and mounted lifetime before mutation. Scene
closure uses strict checkpoint cleanup or confirms the latest desired snapshot
through `DraftWriter.keep()` before stopping its writer. Failed cleanup restores
writer ownership for retry. An acknowledged scene save updates the saved baseline
and scene/project revisions before cleanup, so cleanup failure retains a safely
editable saved scene. Artwork closure cancels gestures/playback, awaits its
serialized checkpoint writer, removes only the active retained session and releases
its raster. Save-and-close retains the existing review receipt and explicit
confirmation; Cancel closing removes that intent. Another retained artwork is
activated last-insertion-first, otherwise the scene/empty workspace receives focus.
Saved assets are not deleted, unrelated document histories stay owned by their
controllers, and scene closure commits the project URL through existing navigation.
