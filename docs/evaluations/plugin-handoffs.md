# Installed-plugin browser handoffs (#261)

## Acceptance boundary

This protocol verifies alternating browser and agent ownership in the repository
plugin. It builds on [human–agent iteration](artwork-iteration.md),
[plugin selection and lifetimes](../PLUGIN-START.md) and
[versioned installation](../PLUGIN-DISTRIBUTION.md). It does not replace the
independent-user study in #165/#166, quality/resource evaluation in #262 or
platform release validation in #263.

A fresh MCP process, a fresh native client thread and a model-led conversation
are different observations. Automated native tool calls can establish saved-state
discovery and revision protection; they cannot establish whether a model actually
discovers the intended asset, inspects an image or preserves the user's intent.
Browser pointer automation is not a human manual edit. Record those methods
separately. Completion remains governed by the
[single validation checklist](../VALIDATION.md#remaining-checks).

## Reproduction

Build/package the runtime using the [distribution procedure](../PLUGIN-DISTRIBUTION.md).
Then, on the supported macOS arm64 host with a compatible native Codex client:

```sh
make test-plugin-handoff \
  PLUGIN_ARCHIVE=/absolute/path/to/scene-forge-0.1.0-alpha.1-macos-arm64.tar.gz \
  CODEX=/absolute/path/to/codex
```

The [browser test](../../tests/playwright/packaging/plugin-handoff.spec.ts)
launches a [stdlib-only driver](../../tests/packaging/plugin_handoff_driver.py)
that installs the actual archive through the native repository marketplace
commands. The driver uses isolated client state and a synthetic external root
grant in a disposable HOME. It calls tools through native app-server threads,
including simultaneous clients and closed/recreated clients. Installed MCP and
browser children have no Python or Node on PATH. The test driver and Chromium
still require the development environment. The test does not read the user's
client files or start model turns, and is skipped without both explicit inputs. Ordinary Linux
CI does not establish this macOS acceptance.

The Playwright report retains installation/native-client logs, plugin build and
archive identities, host/Python/Codex/Chromium versions, screenshots and a
downloaded conflicting checkpoint. These local reports are diagnostic outputs,
not committed evidence. Archive selected results and captures with source base,
test source hashes and material failures when recording an observation. Do not
copy selection paths, mutation tokens or unrelated project content into public
records. A product version alone does not identify a rebuilt preview plugin.

## Automated observation (2026-11-11 local time)

The issue working tree is based on milestone revision
`80a2e29205c4f7574f74a80c07744e33c211021f`. The
[archived result](assets/plugin-handoffs/result.json) identifies the test sources,
archive and installed build: preview plugin 0.1.0-alpha.1, Forge 0.46.1,
macOS 27.0.1 arm64, driver Python 3.13.13, Codex CLI/app-server 0.167.1 and
Chromium 156.0.8078.4. The observation is dated 2026-11-12 UTC / 2026-11-11
America/Los_Angeles. The runtime binary and original wheel hashes match the
[recorded distribution baseline](assets/plugin-distribution/result.json);
the new archive includes the current milestone skills. No runtime source change
or version bump was needed for these tests.

The native installed-plugin case passes the assertions listed in the result:
fresh-thread discovery and disjoint refinement of browser-saved pixels/scenes,
visible clean adoption, exact winning content after rejected competing/dirty saves,
stale project/artwork/scene guards, changed-candidate receipt refusal, immutable
retained exchange, explicit release, expired previews, exact conflicting checkpoints
after restart, and selection revocation/rediscovery. The companion managed-browser
checkpoint test passed against the freshly built wheel; `make docs-check lint test`
passed (551 Python tests and all frontend suites), as did production build and
seven isolated wheel smoke checks. These are local results, not archived CI claims.

Agent inspection at 1440×1000 covers the
[saved artwork](assets/plugin-handoffs/saved-artwork.png),
[saved scene](assets/plugin-handoffs/saved-scene.png),
[unpublished return](assets/plugin-handoffs/unpublished.png), and
[conflicting scene checkpoint after restart](assets/plugin-handoffs/checkpoint-restart.png).
The artwork's green corner and adjacent blue pixel remain distinct; the scene
retains the browser placement alongside the subsequent agent placement. Conflicting
checkpoint restore refuses to replace newer saved work. Exact data comparisons,
rather than screenshots alone, establish preserved content.

Early harness runs failed on missing navigation/render readiness waits (including
a hidden scene canvas yielding screen coordinates 0,0), a canvas-border gesture,
using guarded pixel reads for stale-candidate inspection, transient lock contention
during reads/cleanup, reading returned candidate JSON before completion and assuming
every blank scene already had named layers. The harness now waits for actionable
documents and completed return data, uses retained export for stale inspection,
uses bounded exact busy handling, preserves the original failure during cleanup,
and accepts both canonical scene forms. One failed cleanup left a test-owned worker;
it was identified by its disposable installation path and terminated. No product
failure is inferred from those harness errors. Native-client logs also emitted
background Responses WebSocket connection errors; no model turn was requested,
and the native tool/browser assertions completed.

This is an opaque 8×8 tile and a small scene, with synthetic directory grants and
browser gestures. It does not establish hidden-layer/animation fidelity through
this installed fixture, model skill adherence or image visibility, a human edit,
independent OS-user isolation, native folder-dialog behavior or another client/OS.
The required human and actual fresh-conversation acceptance remains unperformed;
#261 stays open. Broader SDK coverage and the protocol below retain their own bounds.

## Cases and exact oracles

Use a disposable project outside the plugin cache and an unrelated second root.
Use distinctive names/IDs; include another plausible target when assessing model
discovery. Never give the fresh conversation an old candidate JSON, receipt,
revision, process identifier or preview URL as a substitute for saved discovery.

| Case | Procedure | Required observation |
| --- | --- | --- |
| Saved artwork | Create/review/save a small tile; paint a distinctive pixel in the browser and Save. Close the first conversation; request a disjoint refinement in a fresh conversation. | Fresh status identifies the effective root; inventory resolves the saved canonical target. Compare every RGBA byte with an independently constructed expected raster, plus descriptor/source-layer equality outside the requested change. Inspect native and enlarged results. |
| Saved scene | Create a scene with the saved artwork; place a tile/object manually and Save. Close the conversation; discover and refine that scene in a fresh conversation. | Compare the complete canonical scene with a copy changed only at the requested location. Preserve IDs, counters, layers, properties, camera and connections. Inspect the returned saved scene URL and composition. |
| Clean browser | Keep a clean document open while MCP commits; then reload. | Wait for actual external adoption and inspect visible content before reload. Saved data and refreshed pixels agree; no duplicate/dropped edits. Reload reads the same saved result. |
| Dirty browser | Make unsaved edits and obtain browser review, then commit a competing MCP edit. Attempt browser Save. | Conflict retains local pixels/scene and Undo/Redo; exact saved content contains only the winning commit. Recover/download the acknowledged checkpoint after tab/server restart and compare its content. Do not relabel a stale draft with fresh hashes. |
| Competing sessions | Two clients read the same base. One commits after the other's review. Try the losing save. | A structured conflict rejects the losing publication; both candidate and winning saved bytes remain intact. Fresh read, deliberate reconciliation and new review precede any retry. Test same user sessions separately from OS-user isolation. |
| Stale guards | Isolate stale project, artwork and scene revisions; also change candidate content after review. | Each incorrect guard/receipt fails with a relevant conflict, no saved byte changes and no lost candidate. A generic transport failure is not passing conflict evidence. |
| Unpublished exchange | Retain a candidate, restart MCP, list/export it, explicitly adopt a separate browser copy, edit and return it without Save. | Original handle bytes are immutable; returned candidate matches exactly and saved content is unchanged. Checkpoints, retained sidecars and previews have their documented distinct lifetimes. |
| Expired references | Read an old preview URI after MCP restart; explicitly release a chosen retained handle and try it again. | Preview is clearly expired; rereview regenerates it. Released handle is unavailable, while other candidates/saved assets/checkpoints remain. A retained handle surviving restart is expected. Review receipts bind content/bases; process restart alone does not invalidate their digests. |
| Changed selection | Change to the other explicitly authorized root while an old session remains open; use an overlapping project alias. | Old session reports revocation and refuses access. New conversation displays the new effective root and discovers its inventory; it does not infer a target from stale chat state. Returning to the original root finds its exact saved content and retained candidates. |

The automated case is deliberately small (8×8 tile, 8×8-cell scene); it does not
measure large-project behavior, artistic quality, animation cadence, physical
input comfort, independent OS users or cross-platform delivery. Existing
[lifecycle acceptance](../../tests/packaging/plugin_lifecycle_smoke.py) covers
normal/abrupt MCP exit, shared browser ownership, stable-origin restart and expired
previews; [managed checkpoint acceptance](../../tests/playwright/packaging/plugin-lifecycle.spec.ts)
covers tab/server restart. Existing
[SDK/browser iteration](../../tests/playwright/mcp/iteration-mcp.spec.ts) covers
layered exchange. Those are complementary methods, not installed-client/model
acceptance claims. Map each recorded pass to the actual case/assertions exercised;
the full table is a protocol, not a declaration that all cases have run.

## Human and fresh-conversation procedure

Use the supported installed plugin and its bundled skills, rather than a checkout
server or the historical feasibility probe. Record client name/version, plugin
version/build identity, runtime version, OS/architecture, browser version,
project-format version, date/time zone and the source/archive provenance. Record
who performed each gesture and whether the model actually saw the image. Keep
the project outside the installation/cache and obtain the normal directory grant.

In conversation A, request a named small artwork and scene, inspect the candidate
and save through the normal guards. Open the verified browser URL. Have the user
make and Save a distinctive artwork pixel and scene placement. Capture the saved
revisions and exact source/canonical content for the evaluator's oracle, without
giving those stale handles to the next conversation. Close conversation A.

Start an actual new conversation B with only the intended project/asset names and
a precise refinement such as “keep my green corner; make the adjacent pixel blue.”
Have the model discover the selected location and saved target, inspect the current
image, refine, review and save. Repeat for the scene with a disjoint placement.
Keep the clean browser open to observe external adoption and then reload. Compare
all saved data and inspect the visual results. Record misunderstandings, assistance,
wrong-target attempts and failed writes, including any later successful retry.

Repeat with dirty browser documents and a second installed client/session, using
the cases above. Keep losing work available; reconcile only after fresh reads and
review. Exercise explicit unpublished exchange and changed selection, then restart
the runtime and verify the lifetime boundaries. If a capability is unavailable,
record the actual diagnostic and keep that case unverified. A tool status or a
decoded PNG is not evidence that the user or model saw the expected image.

Store the observation with **Scope**, **Method**, **Result** and **Limits** in
[Validation](../VALIDATION.md), linking attributable reports and reviewed captures.
Do not close #261 or mark human/model checks complete from automated passes alone.
