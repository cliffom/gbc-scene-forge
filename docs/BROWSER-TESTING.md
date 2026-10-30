# Browser acceptance

Forge is adopting Playwright Test incrementally. Lifecycle and first-use acceptance
use Playwright; the remaining suites retain `tests/chrome.ts` until migration.
There is one permanent implementation of each suite. Browser tooling is an npm
**development dependency**; installed wheels, `uvx` and the MCP server need neither
Node nor Playwright.

## Running and debugging

After `make setup`, install Chromium once:

```sh
npx playwright install chromium
make test-playwright-browser
make test-editor-lifecycle-browser
make test-first-use-browser
npm run test:playwright -- --ui
npm run test:playwright -- --grep 'editor disposal'
```

Make targets rebuild the frontend; npm runner commands use the existing bundle.
`make test-browser` runs all acceptance suites, including both migrated suites
once. Use `CHROME=/path/to/chrome` with Make (or as an environment variable with
npm) to select a local executable. Without it, Playwright uses its versioned
Chromium; older CDP suites use the macOS Chrome application path. On Linux,
install browser system libraries with `npx playwright install --with-deps chromium`.
CI retains system Chrome for existing suites and also exercises Playwright's
Chromium through the installed-wheel first-use check.

Playwright uses one worker and zero retries locally and in CI. Each test receives
an isolated browser context and temporary project directory with its own loopback
server on an ephemeral port. Fixtures terminate the server on success, assertion
failure or startup failure, escalating to SIGKILL after five seconds, and remove
the workspace. Playwright owns browser profiles and contexts. As with any test
runner, a hard process/host kill cannot execute fixture teardown.

`build/reports/playwright/` contains an HTML report, server/browser logs and first-use
screenshots; failures retain a screenshot, DOM error context and trace. CI uploads
`build/reports/` even when a test fails. Inspect locally:

```sh
npx playwright show-report build/reports/playwright/html
npx playwright show-trace build/reports/playwright/results/TEST-DIRECTORY/trace.zip
```

A new invocation replaces the prior report; copy it before rerunning when needed.
Trace and screenshot collection do not require a retry. Uncaught page errors fail
the test, while console output is attached for diagnosis. Lifecycle steps name the
ownership invariant being tested, so reports identify the failing race check.

## Application readiness and race checks

`editorReady(page)` requires both the completed startup status and an enabled
scene selector, including after disposal/remount. Playwright actionability alone
does not prove that project refresh has completed. Use locators and web assertions
for user interactions and known UI states; do not add arbitrary startup sleeps.

The lifecycle migration deliberately retains the original in-page fault injection
and assertions for delayed project responses, pending artwork decode, interrupted
definition save/delete and cancelled draft cleanup. Named `test.step` blocks
preserve their sequence and shared ownership scenario. Browser evaluation is still
needed to replace fetch/decode and mount/dispose controllers; it is not a new CDP
abstraction. Existing expression predicates are polled with `expect.poll` and
`page.evaluate`: string-based `waitForFunction` uses eval under this CSP and fails.
Do not enable `unsafe-eval` or bypass CSP to make tests pass. The 2.3-second
observations prove that disposed pollers stay stopped; short post-release
observations retain the original late-completion checks rather than startup waits.

First-use now uses locator clicks/fills/selects, mouse painting and a real
Playwright download stream. It verifies the served version through the same Python
interpreter that starts the server. To check a built wheel without rebuilding:

```sh
FORGE_BUILD_MODE=production make build check-dist
FORGE_TEST_PYTHON="$PWD/build/package-smoke/bin/python" npm run test:playwright -- first-use.spec.ts
```

`FORGE_TEST_PYTHON` also applies to sample setup and server startup in the shared
fixtures. Optional installed MCP coverage remains independent:

```sh
FORGE_MCP_PYTHON=/path/to/mcp-venv/bin/python make test-mcp test-mcp-browser
```

## Decision and migration scope (#73)

**Adopt Playwright for new acceptance coverage and migrate existing suites in
bounded changes.** Built-in process/context ownership, locator actionability,
runner steps, traces and screenshots are preferable to growing the custom CDP
transport. This is test infrastructure only: retain package version 0.16.2 and
prepare no dedicated product release.

The setup inventory and ownership after this pilot:

| Concern | Previously | Pilot ownership / remaining work |
| --- | --- | --- |
| Temp project, Python server, startup URL and teardown | Repeated in each suite | `browser-fixtures.ts` owns migrated test resources; other suites still repeat setup |
| Browser profile, sessions, protocol transport, pointer and screenshots | `chrome.ts` plus per-suite target setup | Playwright owns migrated browser resources; a small canvas coordinate helper remains |
| Startup readiness | Repeated expressions, including the #72 enabled-control fix | Shared `editorReady`; race injection remains in lifecycle |
| Failure evidence | Console assertions and occasional explicit screenshots | Automatic trace/screenshot, named lifecycle steps, attached logs and CI report artifact |
| Installed-product execution | First-use selected Python via environment variable | Same capability via shared fixture, now exercised in CI |
| MCP writer and concurrent refresh | Dedicated CDP suites and optional SDK Python | Preserved unchanged pending a separate migration |

The two old suite files (484 lines total) are removed rather than retained in
parallel. Their replacement specs preserve behavior while eliminating per-suite
server/target/profile setup. The shared fixture is application glue, not another
browser protocol wrapper. At the pilot checkpoint, the two specs total 362 lines
and the fixture/config total 167 lines: 529 versus 484 previously. This initial
45-line increase buys shared cleanup and diagnostics; the first two migrations
do not yet reduce the overall test infrastructure line count. The approximately 250-line CDP transport **is not yet
removed** because ten ordinary suites and two optional MCP suites still depend on
it. No installed application code is changed.

A local macOS production-bundle comparison (single run, not a performance claim):
old lifecycle 12.64s and old first-use 1.58s; migrated lifecycle 11.3s and first-use
2.0s, with the combined Playwright run reporting 13.6s including runner overhead.
Both old suites used local Chrome; the pilot used managed Chromium, so timings
are not controlled browser benchmarks. The gain is diagnostics and ownership,
not an asserted speedup. Playwright adds its pinned npm runner/core dependencies
and a one-time browser download (plus Linux system dependencies). CI installs the
browser explicitly; normal Python installation does not download it.

Next migration scopes:

1. **Layout:** port layout/keyboard coverage to locator assertions and shared
   fixtures; add #80's hover/focus regression when that issue is implemented.
2. **Domain suites:** migrate terrain, imports, blockout, compositions, definitions,
   world and diagnostics independently, retaining their acceptance assertions and
   screenshots. Parameterize fixtures only when a real second consumer needs it.
3. **Large editing/recovery suites:** split standalone and drafts into isolated
   scenarios with explicit readiness and purpose-specific seeded projects.
4. **MCP and external refresh:** preserve real installed SDK writers, revision
   conflicts, held responses and dirty-editor protection while migrating.
5. **Retirement:** delete `chrome.ts` and leftover server setup only when no callers
   remain. Do not add a long-lived compatibility adapter or duplicate old suites.

Reference: [fixtures](https://playwright.dev/docs/test-fixtures),
[actionability](https://playwright.dev/docs/actionability),
[CI setup](https://playwright.dev/docs/ci), and
[trace viewer](https://playwright.dev/docs/trace-viewer).
