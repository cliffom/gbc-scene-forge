# Test organization

Run commands from the repository root. Test code is grouped by runner and domain:

| Location | Ownership |
| --- | --- |
| `backend/project/` | project/workspace lifecycle, drafts, samples, saved updates and exports |
| `backend/artwork/` | PNG decoding, intake, native candidates/persistence, revision-bound artwork review, selected-placement variations and tile metadata |
| `backend/objects/` | object editing, definitions and preview preferences |
| `backend/planning/` | blockout and world authoring |
| `backend/analysis/` | diagnostics, palette and hardware budgets |
| `backend/adapters/` | console, HTTP and optional MCP protocol integration |
| `backend/tooling/` | documentation checker, runtime launch and experimental plugin selection boundaries |
| `backend/architecture/` | backend dependency and installed-entry-point boundaries |
| `frontend/` | non-browser TypeScript suites grouped by editor, project, artwork, objects, planning, preview and infrastructure |
| `playwright/` | browser acceptance by domain, with browser fixtures and editor seeds in `playwright/support/` |
| `support/` | shared synthetic atlas/blockout fixtures and executable server, palette, MCP-writer and Tiled helpers |
| `fixtures/` | shared palette artwork and provenance used by backend and browser checks |
| `packaging/` | explicit installed-wheel and frozen-bundle smoke checks |
| `legacy/` | historical connector tests and their independent fixtures |

`make test-frontend-domain-contracts` pins original normalized outputs and first
errors for the domain response corpus, including input non-mutation. Set
`FORGE_CONTRACT_BASELINE` to a Git revision for case-by-case original/candidate
comparison before changing expectations. The [contract inventory and methods](../docs/evaluations/valibot-pilot.md#compatibility-corpus-and-reproducibility)
also describe optional normal Courtyard loading and
`node tests/support/measure_contracts.ts BASE_REF STEP_REF ... WORKTREE` for fixed-label
production bundle/source measurements. Neither tool changes tracked demo assets.

`make test-frontend-domain-limits` and `backend/artwork/test_domain_limits.py`
consume the shared `fixtures/domain-limits.json` boundary corpus. See the
[limit ownership inventory](../docs/DOMAIN-LIMITS.md) for units, validator ownership,
MCP advertising and intentionally distinct cross-field/serialization rules.

`make test-frontend-checkpoint-scheduling` exercises debounce boundaries, explicit
flushes and mounted cancellation with a fake clock. Pixel/large-artwork suites
cover write chunk acknowledgments and history count/byte eviction. The tile-cache
browser check compares actual Canvas2D backing bytes with the renderer estimate
at and above the cache ceiling for all supported grids. See
[runtime policy ownership](../docs/FRONTEND-ARCHITECTURE.md#runtime-policy-ownership).

The artwork palette suites cover composition/source scope, exact blending and
transparency, frame rectangles, bounded color membership and usage ordering.
Browser cases verify layer/history/frame refresh, color selection without history,
empty states, keyboard navigation, compact layout and on-demand raster collection.

`playwright/artwork/download-options.spec.ts` covers PNG icon discovery, keyboard
scope choices, output details, nested overflow dismissal, per-document restoration
and missing-frame/gesture/busy guards. `playwright/editor/working-space.spec.ts`
decodes downloaded sheet and frame PNGs to verify unsaved composited RGBA,
transparency, dimensions and unchanged work, review and Undo/Redo state.

Python discovery remains `python -m unittest discover -s tests -p 'test_*.py'`
(`make test-python`). Empty `__init__.py` markers in `backend/` and each domain
allow discovery to recurse on supported Python versions. Imports use
`backend.<domain>` and `support` relative to the discovery root. Legacy tests
retain their existing `legacy` namespace. There is no root `tests` package or
checkout-source path injection; compatibility CI uses the installed wheel.

Optional `make test-mcp` uses the same discovery root with `-p 'test_mcp*.py'` and
requires the SDK in `FORGE_MCP_PYTHON`. Plain runs retain adapter checks and skip
the SDK-only test when the extra is absent. `packaging/package_smoke.py` is
explicitly run with `python -I` after wheel installation, outside unit discovery.
It imports only the installed application, never test helpers.

`make check-bundle` runs `packaging/bundle_smoke.py` with the locked SDK as a driver
and no Forge imports. The executable child runs from a relocated read-only copy,
with an empty PATH and invalid external Python settings. It checks guarded native
artwork, scene rendering, export/reopen, raw protocol stdout, HTTP assets and demo
restoration. `make test-bundle-browser` separately launches the real frozen browser
with an empty PATH and captures its sample editor. It is skipped in ordinary
Playwright runs unless `FORGE_TEST_BUNDLE` is supplied. See the
[runtime guide](../docs/RUNTIME-BUNDLES.md) for build inputs and bounded evidence.

`backend/tooling/test_plugin_probe.py` checks the experimental launcher's explicit
external selection, symlink containment and argument-override rejection. The
macOS-only [plugin probe](../examples/plugin_probe/verify.py) separately installs
both runtime alternatives into disposable Codex state and exercises SDK/client
MCP saves, resources, export and browser HTTP. It is not part of ordinary unit
discovery and does not start a model turn. Its [evaluation](../docs/evaluations/plugin-feasibility.md)
records exact client and visual limits.

`fixtures/pixel-cleanup/motif.json` is an original MIT synthetic motif with
independently declared noise coordinates and intentional glint/diagonal failures.
`support/measure_cleanup.py` reproduces the archived PNGs/results; the
[cleanup evaluation](../docs/evaluations/pixel-cleanup.md) records its limits.
Domain and MCP cleanup suites cover selection, exact constraints and official-SDK
review/commit/reopen. The SDK example reads this source-tree fixture explicitly;
the installed product has no dependency on test data.

`backend/adapters/test_mcp_native_artwork.py` covers client-held artwork candidates,
strict schemas, exact RGBA/resource reads, reviewed commits, contention and a
complete official-SDK new-tile and selected-variation review/commit/placement workflow. Run it against
the installed optional-MCP wheel through `make test-mcp`.
`backend/adapters/test_mcp_artwork_workshop.py` runs the example over the actual SDK,
checking normal placement and conflicts with a competing saved scene or external map edit.

`backend/adapters/test_mcp_illustration.py` covers illustration preparation, palette
conversion, atomic batches, exact bundle/reopen preservation, archive interruption
and partial release recovery. The [SDK example](../examples/mcp/illustration_workflow.py)
exercises the full static workflow; `support/measure_illustration_batch.py` compares
identical full/compact/batched edits over measured stdio JSON-RPC messages.

Milestone 21 adds `backend/adapters/test_mcp_iteration.py` for PNG intake, bounded
raster/color operations, layered persistence/recovery, previews and saved deletion.
`playwright/artwork/iteration.spec.ts` owns layer controls and wheel navigation;
`playwright/mcp/iteration-mcp.spec.ts` owns unpublished exchange and saved discovery
while preserving another dirty document. The optional
`support/measure_artwork_iteration.py` and `support/measure_artwork_history.ts`
harnesses record transport, layer, recovery and history costs; their boundaries
and archived observations are in the [artwork evaluation](../docs/evaluations/artwork-iteration.md).

`playwright/editor/notifications.spec.ts` covers locked-layer rejection without
pixel/history changes, coalescing, expiry, hover/focus pauses, dismissal, document
ownership, persistent checkpoint/save failures and retries, modal keyboard access,
keyboard review/save retry coalescing and resolution across command entry points,
stale replies/timers and mounted disposal.

`make test-frontend` discovers the TypeScript suite files one domain level
under `frontend/`; their basenames retain the public `make test-frontend-<suite>`
selectors. For example, `make test-frontend-model test-frontend-contracts` runs
only those suites. TypeScript, ESLint and Prettier cover `tests/**/*.ts`.
Keep suite basenames unique and place shared helpers outside that executable glob.

Python support scripts run directly, for example:

```sh
.venv/bin/python tests/support/serve_standalone_fixture.py --root /tmp/forge-fixture --port 8777
.venv/bin/python tests/support/prepare_palette_fixture.py --root /tmp/forge-palette-example
make test-tiled TILED=/path/to/Tiled RASTERIZER=/path/to/tmxrasterizer
```

Direct server/Tiled scripts import their sibling atlas helper. Browser subprocess
snippets insert only the test root to import `support` fixtures; installed-wheel
smoke checks retain isolated mode and do not do this.

Live-browser MCP writers and individual animation-fixture operations use bounded
project-busy handling from `support/project_busy.py`: at most 20 attempts with
50 ms between attempts. MCP retries require the exact structured busy message
with `invalid_request` (direct lock contention), `conflict` (commit wrapping),
or `busy` (artwork operations);
direct Python fixture operations retry `TransactionBusy` or a `Conflict` whose
explicit cause is `TransactionBusy` (the commit adapter's wrapping contract).
Validation errors, revision conflicts and transport failures still fail. Revision
arguments are preserved, and fixture setup is never replayed as an entire batch.
This is test infrastructure; runtime locking and API behavior remain unchanged.
Single-project server startup separately retries explicit lock contention before
the session opens; see [MCP retry boundaries](../docs/MCP.md#startup-contention-and-retry-boundaries).
`backend/adapters/test_mcp_startup.py` covers held-lock release, exhaustion,
non-busy failures and real SDK initialization. `support/hold_project_lock.py`
synchronizes SDK/browser tests on the real lock and an explicit stdin release;
the browser case waits for the server's startup-busy diagnostic before releasing.

The organization baseline for #88 is commit `62cced6` (the Playwright move in
PR #87). Before/after discovery preserves all 248 Python test IDs after removing
the new `backend.<domain>` module prefixes, including legacy and optional cases,
without duplicates. All 15 non-browser TypeScript suite basenames are preserved.
At that organization baseline, browser discovery retained 22 regular scenarios and two optional scenarios; see
[browser testing](../docs/BROWSER-TESTING.md) and
[historical coverage inventories](../docs/BROWSER-COVERAGE.md).

Historical results and the unavailable Tiled-tool limitation are recorded in
[suite organization validation](../docs/VALIDATION.md#suite-organization-86-88).

Canvas repaint coverage for #76 adds `playwright/editor/rendering.spec.ts` with
small and large multi-layer workloads. Regular discovery also includes viewport/reference pixel comparisons and tile-cache
invalidation checks. Two observational scalability matrix cases require
`FORGE_SCALABILITY_PROFILE=1`; the four optional MCP/refresh scenarios remain separate, including
`playwright/mcp/artwork-mcp.spec.ts` for alternating SDK/browser artwork, selected
sprite variation, stale recovery and portable export/reopen. See the
[rendering measurements](../docs/evaluations/canvas-repainting.md) for reproduction
and the distinction between timing observations and deterministic assertions. See
[scalability profiling](../docs/evaluations/scene-scalability.md) for the archived
comparison fixtures, history profiler and optional Forest workload.
