# Test organization

Run commands from the repository root. Test code is grouped by runner and domain:

| Location | Ownership |
| --- | --- |
| `backend/project/` | project/workspace lifecycle, drafts, samples, saved updates and exports |
| `backend/artwork/` | PNG decoding, artwork intake and tile metadata |
| `backend/objects/` | object editing, definitions and preview preferences |
| `backend/planning/` | blockout and world authoring |
| `backend/analysis/` | diagnostics, palette and hardware budgets |
| `backend/adapters/` | console, HTTP and optional MCP protocol integration |
| `backend/tooling/` | documentation checker regression tests |
| `backend/architecture/` | backend dependency and installed-entry-point boundaries |
| `frontend/` | non-browser TypeScript suites grouped by editor, project, artwork, objects, planning, preview and infrastructure |
| `playwright/` | browser acceptance by domain, with browser fixtures and editor seeds in `playwright/support/` |
| `support/` | shared synthetic atlas/blockout fixtures and executable server, palette, MCP-writer and Tiled helpers |
| `fixtures/` | shared palette artwork and provenance used by backend and browser checks |
| `packaging/` | explicit installed-wheel smoke checks |
| `legacy/` | historical connector tests and their independent fixtures |

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
`FORGE_SCALABILITY_PROFILE=1`; the two optional MCP/refresh scenarios remain separate. See the
[rendering measurements](../docs/evaluations/canvas-repainting.md) for reproduction
and the distinction between timing observations and deterministic assertions. See
[scalability profiling](../docs/evaluations/scene-scalability.md) for the archived
comparison fixtures, history profiler and optional Forest workload.
