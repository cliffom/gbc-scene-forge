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
| `editor/` | standalone editor workflow (including cross-domain persistence/export), layout and chooser, editor lifecycle, review mode, middle-button pan, scene links, wide scenes, canvas repaint profiling | 65 |
| `project/` | first use, discovery, draft recovery and server-log ownership | 12 |
| `artwork/` | PNG/Tiled imports, terrain brushes, artwork editing, navigation, layers, ownership and responsiveness | 83 |
| `objects/` | compositions and definitions | 2 |
| `planning/` | blockout, world and diagnostics | 3 |
| `mcp/` | optional real SDK authoring, layered exchange and external refresh | 6 |
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

Regular discovery includes 165 cases in 43 files, including optional profiling
cases skipped by default; optional discovery includes six MCP/refresh cases in
four files. Basename selectors such as `first-use.spec.ts`
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

The runner retains zero retries and schedules individual tests in parallel,
including tests within a file. Locally and on CI, the default is half of Node's
available CPU parallelism, rounded down, with at least one and at most four
workers. Each test drives Chromium and Python processes, so the policy leaves
CPU headroom: two workers on the measured four-CPU CI runner and four on an
eight-or-more-CPU development machine. Set
`FORGE_BROWSER_WORKERS` to a positive integer to override the count for any
Make/npm entry point, including installed-wheel and optional MCP checks:

```sh
FORGE_BROWSER_WORKERS=1 make test-browser
FORGE_BROWSER_WORKERS=4 npm run test:playwright
FORGE_BROWSER_WORKERS=2 make test-mcp-browser
```

Empty, fractional, zero and negative overrides fail before running tests.
Playwright's `--workers=N` also overrides the configured count for direct npm
commands. Explicit profiling modes automatically use one worker; both environment
and CLI requests for more workers are rejected in those modes. Run timing
comparisons on an otherwise idle runner, with the same revision, suite, browser
and build mode. Ordinary concurrent acceptance results establish assertions and
resource behavior; their attached timings are not performance baselines.

Each test receives an isolated
browser context and temporary project directory. Fixtures start servers on
an ephemeral port, retain their output, terminate them on success, assertion
failure or startup failure, and remove workspaces. Servers ignoring SIGINT receive
SIGKILL after five seconds. Tests can restart servers or open multiple pages
inside their own fixture; they never share mutable workspaces across scenarios.
A hard host/process kill cannot execute teardown.

The concurrency audit for #206 covers regular acceptance, installed-wheel first
use, and optional MCP/refresh. All use the same test-scoped workspace fixture;
Python input artwork, exports, SDK writers and lock holders stay under that
test's temporary directory. An empty `workspace/` child remains available for
project creation; its parent owns neighboring input artwork, including for tests
that create a project directly at the workspace root. Servers also use that parent as their working
directory: per-port rotating activity logs previously shared the checkout and
could mix evidence when ports were reused. The fixture attaches those activity
files alongside captured server output before removing the workspace, including
on failure. Ports are assigned by the operating system. Shared
seed projects and application bundles are read-only during a runner invocation.
Make builds the application before invoking Playwright; do not rebuild or run
another Make browser target in the same checkout while an invocation is active.
Test-only instrumented bundles use esbuild's `write: false` and page-scoped routes.
Screenshots, attachments and traces use Playwright's per-test output paths under
the invocation's report directory. No serial groups are needed for ordinary
acceptance; explicit timing profiles own the entire single-worker invocation.

Standalone acceptance separates launcher/switching, artwork/placement, sprite
preview, layer/object editing with export/restart, demo conformance, and palette
budgets. Preview and layer checks seed independent portable projects from
`tests/playwright/support/fixtures/editor/`; a real browser placement establishes undo history.
Draft acceptance separates deliberate multi-tab/restart/move recovery, checkpoint
retry/preview behavior, and stale-revision download/discard. Each has its own
purpose-specific project setup. Review-mode acceptance covers viewport expansion,
pan/zoom/Fit, blocked authoring input, retained selection/history and camera position,
narrow layouts, installed-wheel use, disposal/remount and external deletion. See [the coverage inventory](BROWSER-COVERAGE.md).

## Worker comparison (#206)

The [CI comparison](https://github.com/cliffom/gbc-scene-forge/actions/runs/41859847523)
ran the same production bundle and original 163-case regular suite at revision
`430598b`, sequentially with one, two and four workers on one Ubuntu 24.04 x86_64
runner. Its AMD EPYC 9V74 exposed four logical CPUs (two cores, two threads each),
15,983 MiB RAM, 3,071 MiB swap and 7.9 GiB shared memory. Open-file and process
limits were 65,536 and 58,121; stack was 16,384 KiB, with CPU, data and virtual
memory unlimited. Cgroup CPU/memory/process limit files were unavailable.

| Workers | Wall time | Passed / skipped / failed | Maximum RSS (KiB) |
| ---: | ---: | --- | ---: |
| 1 | 10:38.36 | 152 / 11 / 0 | 932,708 |
| 2 | 6:25.95 | 152 / 11 / 0 | 817,872 |
| 4 | 4:59.51 | 150 / 11 / 2 | 824,104 |

Two workers reduced wall time by 39.5% and establish the default on this runner.
Four workers failed Library navigation assertions in artwork pixels (Undo stayed
disabled) and contextual panels (the expected animation frame remained absent).
Their root cause was not established; assertions and zero retries remain intact.
The half-CPU policy permits up to four workers locally: the final 165-case suite
passed on a 16-CPU macOS development machine with 154 passes and 11 profile skips.

The run's `browser-diagnostics` artifact retains per-count JSON/HTML reports,
failure traces/logs, GNU time output and runner resource observations. Wall time
includes npm/report overhead. GNU maximum RSS is not aggregate peak memory across
all browser/server processes. This was one sequential sweep, without repeated
sampling or control for warm-cache/order effects. The benchmark predates the final
fixture isolation changes and two server-ownership tests. Final local acceptance
also passed installed-wheel first use and all six optional MCP cases; these were
skipped in the benchmark CI run. Ordinary acceptance timings do not establish
editor performance baselines.

## Failure evidence

Each invocation writes a unique directory under `build/reports/playwright/`, named
with its timestamp and process ID. Workers inherit that name. JSON summaries
(`summary.json`, including effective configuration, durations and failures), HTML reports,
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

## Rendering measurements

`editor/rendering.spec.ts` adds small/large native multi-layer workloads for hover,
painting and sprite animation, plus deterministic canvas sizing and history
regressions. It attaches raw `rendering-profile.json` samples to the report.
Timings are observational; CI asserts resource/state behavior without speed
thresholds. See [the baseline, results and scheduling decision](evaluations/canvas-repainting.md).

## Responsiveness profiles

The regular artwork response case checks deterministic canvas/encoding work counts;
it never fails on a timing percentile. `FORGE_RESPONSIVENESS_PROFILE=1` enables the
full sheet/frame/timeline and normal/4× CPU matrix. `FORGE_SCENE_COST_PROFILE=1`
enables mixed-inventory scene-control and resource-lifetime observations.
`FORGE_PROFILE_OUTPUT` archives their JSON in a caller-selected directory, and
`FORGE_COST_BASELINE=1` reads the pinned pre-optimization frontend from Git for the
scene profile. See the [evaluation](evaluations/editor-responsiveness.md) for exact
commands, workload sizes, provenance, reference-build instructions and limits.
These optional profiles extend the regular tests; ordinary CI does not collect
the entire timing/resource matrix.
