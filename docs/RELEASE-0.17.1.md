# Scene Forge 0.17.1

Browser acceptance now lives under `tests/playwright/`, grouped by editor,
project, artwork, objects, planning and optional MCP integration. Shared browser
fixtures and editor seeds have a single home in `support/`. Recursive TypeScript,
ESLint and Prettier checks cover the nested suites alongside existing model tests.

Python domain tests now live under `tests/backend/` and non-browser TypeScript
suites under `tests/frontend/`. Shared Python fixtures/scripts live in
`tests/support/`; installed-wheel smoke checks live in `tests/packaging/`.
See [test organization](../tests/README.md). Python discovery retains its root,
all 248 test cases and optional SDK behavior. All 15 TypeScript suite basenames
and individual Make targets remain available.

All public Make/npm suite commands remain available, including installed-wheel
first use and optional MCP/refresh checks. Regular and optional runs retain their
22 and two scenarios respectively, with one worker, zero retries and isolated
workspaces. Reports, traces, screenshots and server/browser logs remain in unique
per-invocation directories under `build/reports/playwright/` for CI upload.

This explicitly requested patch release prepares 0.17.1 for the suite organization
cleanup. Editor behavior, project/draft/Tiled formats and Python runtime
dependencies are unchanged. See [browser testing](BROWSER-TESTING.md) and the
[coverage provenance](BROWSER-COVERAGE.md#domain-organization-86). Publication is a
separate release step.
