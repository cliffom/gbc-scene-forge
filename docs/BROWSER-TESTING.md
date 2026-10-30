# Browser acceptance

All supported browser acceptance uses Playwright Test. `tests/playwright/support/browser-fixtures.ts`
owns test-scoped temporary projects and loopback Python servers; Playwright owns
browser contexts and profiles. There is no custom CDP transport or permanent
parallel implementation of a suite. Installed wheels, `uvx` and the MCP server
need neither Node nor Playwright.

## Suite ownership

The runner configuration is `tests/playwright/playwright.config.ts`. It discovers
`**/*.spec.ts` recursively within `tests/playwright/`:

| Folder | Suites | Scenarios |
| --- | --- | ---: |
| `editor/` | standalone editor workflow (including cross-domain persistence/export), layout and chooser, editor lifecycle, review mode | 11 |
| `project/` | first use and draft recovery | 4 |
| `artwork/` | PNG/Tiled imports and terrain brushes | 2 |
| `objects/` | compositions and definitions | 2 |
| `planning/` | blockout, world and diagnostics | 3 |
| `mcp/` | optional real SDK authoring and external refresh | 2 |
| `support/` | shared browser/server fixtures and `fixtures/editor/` seed projects | — |

The standalone workflow remains together to preserve its existing public suite
selector. Python fixtures/protocol helpers live in `tests/support/`, shared palette fixtures
in `tests/fixtures/`, and non-browser TypeScript checks in `tests/frontend/`.
See [test organization](../tests/README.md). Run commands from the repository
root; server helpers and shared seeds use root-relative paths.
TypeScript, ESLint and Prettier include `tests/**/*.ts`, covering both scopes.

To inspect regular and optional discovery without executing scenarios:

```sh
npm run test:playwright -- --list
FORGE_MCP_ONLY=1 npm run test:playwright -- --list
npm run test:playwright -- editor/review.spec.ts --list
```

Regular discovery includes 22 scenarios in 13 files; optional discovery includes
only the two MCP/refresh scenarios. Basename selectors such as `first-use.spec.ts`
and all existing Make/npm entry points remain supported. Reports resolve from the
configuration to the repository's `build/reports/playwright/`, matching CI uploads.

## Running and debugging

After `make setup`, install Chromium once:

```sh
npx playwright install chromium
make test-browser
make test-standalone-browser
make test-drafts-browser
make test-editor-lifecycle-browser
npm run test:playwright -- --ui
npm run test:playwright -- --grep 'editor disposal'
```

`make test-browser` and `make test-playwright-browser` each execute every regular
scenario once in one runner invocation. Existing suite-specific Make targets and
`npm run test:standalone` / `npm run test:drafts` select the corresponding specs.
Make targets rebuild assets; npm runner commands use the existing bundle. Use
`CHROME=/path/to/chrome` to select an executable. Otherwise every suite uses the
same versioned Playwright Chromium. Linux installation can use
`npx playwright install --with-deps chromium`.

The runner uses one worker and zero retries. Each test receives an isolated
browser context and temporary project directory. Fixtures start servers on
an ephemeral port, retain their output, terminate them on success, assertion
failure or startup failure, and remove workspaces. Servers ignoring SIGINT receive
SIGKILL after five seconds. Tests can restart servers or open multiple pages
inside their own fixture; they never share mutable workspaces across scenarios.
A hard host/process kill cannot execute teardown.

Standalone acceptance separates launcher/switching, artwork/placement, sprite
preview, layer/object editing with export/restart, demo conformance, and palette
budgets. Preview and layer checks seed independent portable projects from
`tests/playwright/support/fixtures/editor/`; a real browser placement establishes undo history.
Draft acceptance separates deliberate multi-tab/restart/move recovery, checkpoint
retry/preview behavior, and stale-revision download/discard. Each has its own
purpose-specific project setup. Review-mode acceptance covers viewport expansion,
pan/zoom/Fit, blocked authoring input, retained selection/history and camera position,
narrow layouts, installed-wheel use, disposal/remount and external deletion. See [the coverage inventory](BROWSER-COVERAGE.md).

## Failure evidence

Each invocation writes a unique directory under `build/reports/playwright/`, named
with its timestamp and process ID. Workers inherit that name. HTML reports,
server/browser logs and scenario screenshots survive subsequent suite,
installed-wheel and MCP invocations. Failures retain a screenshot, DOM error
context and trace without requiring a retry. CI uploads all of `build/reports/`
even after failure. An explicit `FORGE_BROWSER_RUN` selects a report name; use a
fresh value if previous evidence must be retained.

```sh
npx playwright show-report build/reports/playwright/RUN/html
npx playwright show-trace build/reports/playwright/RUN/results/TEST/trace.zip
```

Console messages and uncaught errors are collected for every page, including
recovery and secondary tabs. Uncaught page errors fail acceptance. Expected HTTP
400/409 responses remain in the console evidence while their UI/error and saved
file behavior are asserted by the relevant scenario. Ordinary interactions use
locators, native keyboard/mouse input and Playwright web assertions. Complex
canvas pixel, layout, authored-data and fault-injection assertions still use
browser evaluation and Node assertions where appropriate.

## Readiness and race checks

`editorReady(page)` requires both completed startup status and an enabled scene
selector, including after disposal/remount. Additional scenario predicates assert
specific adoption, cancellation, capture and disposal states. Actionability alone
does not prove that a project refresh has completed.

`waitForUI` polls through `expect.poll` and `page.evaluate`. String-based
`waitForFunction` uses eval under Forge's CSP and fails; do not enable
`unsafe-eval` or bypass CSP. Delayed fetch/artwork decode, held responses,
interrupted saves, capture transfer and cancelled cleanup remain explicit fault
injection. Timed observations prove disposed/dirty/hidden pollers remain stopped;
they are not arbitrary startup sleeps. Real SDK writers remain real processes,
not mocked success responses.

The only Playwright CDP sessions emulate Chromium display density: blockout checks
change DPR while retaining the authored scene; chooser checks emulate desktop
zoom by changing CSS viewport dimensions and DPR together. Playwright context DPR
is immutable. Blockout asserts the effective DPR at every zoom. Its Retina
screenshot uses that same CDP session because Playwright screenshot capture resets
the override to the original context density; PNG dimensions and retained DPR are
asserted. Other screenshots, input, navigation, file selection and target
ownership use Playwright APIs.

## Installed-product and optional MCP checks

```sh
FORGE_BUILD_MODE=production make build check-dist
FORGE_BUILD_MODE=production FORGE_TEST_PYTHON="$PWD/build/package-smoke/bin/python" npm run test:playwright -- first-use.spec.ts
FORGE_MCP_PYTHON=/path/to/installed-mcp-venv/bin/python make test-mcp test-mcp-browser
```

`FORGE_TEST_PYTHON` selects the application interpreter, including fixture setup.
`FORGE_MCP_PYTHON` selects the real installed SDK client/server used by optional
MCP writers. MCP and external refresh are excluded from ordinary runs;
`make test-mcp-browser` enables both in one invocation with `FORGE_MCP_ONLY=1`.
They retain concurrent saves, revision conflicts, recovery, view/tool/brush modes,
form/dirty/hidden protection, held response/decode races and animated adoption.

CI reuses the single Chromium installation for regular, installed-wheel and MCP
checks. It builds the production minified bundle and validates installed-wheel
first use. The Python compatibility matrix remains 3.13 and 3.14 and consumes the
same wheel without Node or browser installation. Playwright remains npm development
infrastructure, with a one-time Chromium download and Linux system libraries.
No second browser installation or duplicate acceptance run is required.
