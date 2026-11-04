# Human–agent artwork iteration (#189)

## Scope and evidence boundary

Prepared 0.32.0 milestone-21 working tree based on `c55fc8d`, measured
2026-11-03 (America/Los_Angeles) on macOS 27.0.1 arm64 / Apple M4 Max,
Python 3.13.13, Node 24.22.1 and MCP SDK 1.30.0. These are local synthetic
service/SDK/browser observations and agent screenshot inspection. They do not
establish independent human discovery, prolonged drawing comfort, lower-memory
device behavior or external-tool quality/parity. The original #182 report compared
Aseprite MCP and Forge 0.30.1 on different illustration tasks; it motivated missing
capabilities and orchestration work, not a controlled speed or artistic-quality result.

Existing exact writes/rectangular patches, compact candidates, bounded overview/
detail reviews, before/after resources and reviewed commits form the baseline.
New PNG intake, structured raster/color operations, source layers, inline preview
transport and explicit unpublished exchange extend it. The maintained
[outcome matrix](../AUTHORING-OUTCOMES.md#milestone-21-additions) separates these
from intentionally browser-local navigation/history and remaining capabilities.

## Reproducible equivalent task

Run with the optional SDK installed:

```sh
.venv/bin/python tests/support/measure_artwork_iteration.py
node tests/support/measure_artwork_history.ts
```

The [Python harness](../../tests/support/measure_artwork_iteration.py) creates a
fresh project/process per route and size. Both routes run on the same implementation;
the baseline uses previously supported create plus ≤65,536-pixel patches. Input is
`random.Random(189).randbytes(width*height*4)`, with each red channel set to 11.
The identical requested result replaces the first exact RGBA color with
`[71,72,73,0]`, fills an 8×8 block with `[255,40,20,128]`, then copies it to `[8,8]`.
The baseline computes the result and chunk patches in client code. The improved
route uploads the PNG then sends three explicit raster operations in one batch.
Both review, read every returned PNG resource, commit, reopen and assert **all
resulting RGBA bytes**. Archived source/output SHA-256 values match across routes.

Counters wrap actual SDK streams, counting UTF-8 serialized JSON-RPC messages
using the SDK stdio serializer plus newline. They include text and structured
result duplication, inline base64 PNGs, handle metadata and explicit resource
reads. Initialization, server startup, client-side source/result preparation and
OS pipe buffering are outside timed request intervals. Times are one observational
run, including transport/service work; server peak RSS is collected after process
exit. No repetitions, confidence intervals or claims about artistic output are made.
The structured route still requires explicit handle/revision/review orchestration.

| Size / route | Tool calls + resource reads | Request bytes | Response bytes | Request latency sum (ms) | Server peak RSS (bytes) |
| --- | --- | --- | --- | --- | --- |
| 128×128 / patches | 6 + 2 | 178,181 | 595,697 | 159.91 | 73,302,016 |
| 128×128 / PNG + raster | 5 + 2 | 78,286 | 594,977 | 138.58 | 72,253,440 |
| 375×525 / patches | 12 + 2 | 2,106,415 | 4,973,929 | 813.44 | 95,485,952 |
| 375×525 / PNG + raster | 5 + 2 | 904,486 | 4,968,883 | 457.87 | 94,896,128 |

[Raw transport and layer observations](assets/artwork-iteration/transport-and-layers.json)
include every request latency and byte count. Base64 alone expands the 676,065-byte
card PNG to 901,420 characters; its intake request totals 901,735 bytes. Full reopen
and review/resource payloads remain material: compact handles do not make those
outputs small. These tasks show less request orchestration, not generally constant
cost or a guaranteed latency improvement. Intake is new; same-build route comparison
does not claim that a previously published server had inline preview support.

## Layer, recovery and local history costs

Fresh isolated Python processes measure three full-canvas layers (base plus two
transparent sources), candidate retention and original-plus-current checkpoint
write/restore. Base pixels are seeded RGBA noise. Timings include candidate
validation/compositing/serialization; the checkpoint row's disk bytes include
both the retained candidate sidecar and draft JSON. Restore checks exact sources.

| Size | Raw sources + composite | Candidate / handle bytes | Retained candidate + draft disk bytes | Make layers / retain / checkpoint / restore (ms) | Process peak RSS |
| --- | --- | --- | --- | --- | --- |
| 256×256 | 1,048,576 | 1,399,644 / 300 | 4,199,954 | 61.31 / 38.54 / 74.47 / 67.07 | 54,329,344 |
| 768×1024 | 12,582,912 | 16,778,749 / 300 | 50,337,269 | 724.56 / 430.54 / 840.93 / 785.45 | 582,467,584 |

The [Node harness](../../tests/support/measure_artwork_history.ts) separately creates
three layers and twelve single-pixel edits in the actual browser model, then
checks Undo/Redo composite equality. [Raw history results](assets/artwork-iteration/history.json)
record 13 retained operations / 9,707,104 history bytes at 256×256, and 7 retained
operations / 66,064,670 bytes at 768×1024. The 64 MiB history policy evicts old
entries for the larger case. Observed Node peak RSS was 131,104,768 and 368,017,408
bytes respectively. This excludes browser DOM/canvas/images, checkpoint strings,
other open documents and the Python server. Active snapshots and Undo/Redo travel
allocate additional working copies. Sources are bounded to eight layers and
4,194,304 aggregate pixels **including the composite**; total process memory is
not limited to the raw 16 MiB budget. These measurements justify explicit quotas
and disclosure, not suitability for every low-memory device or maximum-layer input.

## Integrated workflow coverage

The [real SDK/browser task](../../tests/playwright/mcp/iteration-mcp.spec.ts) imports
exact PNG pixels, creates separate source/glow layers, draws an isolated effect,
adopts a separately owned unpublished snapshot, changes effect opacity/manual
pixels and returns a candidate without publication. It checks source isolation,
then performs targeted recoloring, reviews/commits, explicitly reopens saved work,
continues manually and resumes MCP against the resulting saved revision. Another
dirty document retains its Undo/Redo. It also checks camera-independent discovery,
real modal pause, auto-refresh preference, manual discovery and MCP deletion.

The [domain/SDK regressions](../../tests/backend/adapters/test_mcp_iteration.py)
cover exact transparent RGB, partial-alpha operations, simultaneous remapping,
invalid/atomic batches, stale receipts/bases, source locks, aggregate limits,
owner-isolated adoption, retained stale inspection, layered recovery, whole-sheet
copy and native scene/project export/reopen/transfer. A layered-save interruption
test forces journal restoration to fail, then verifies that reopening restores the
original manifest, exact sources and composite. Existing storage transaction tests
also cover deletion rollback and semantic GID preservation.
The [browser layer/wheel task](../../tests/playwright/artwork/iteration.spec.ts)
checks pointer anchoring after scrolling, zoom bounds, unchanged dirty/history and
manual layered save/reopen. No claim is made that every raster primitive has an
equivalent browser gesture (for example ellipse/region resize remain MCP operations).

Agent inspection covers the layer panel at 1440×1000 and 760×800 and the exchange
workflow at 1440×1000; production captures are archived with this evaluation.
See [desktop layers](assets/artwork-iteration/layers-and-wheel.png),
[compact layers](assets/artwork-iteration/layers-compact.png) and
[unpublished return](assets/artwork-iteration/unpublished-handoff.png).
No new independent
participant or physical input-device observations were performed. Opt-in
near-duplicate/isolated-pixel/texture diagnostics remain deferred: interpreting
intentional stars, glints or pixel texture needs explicit algorithms and thresholds.
The optional changed-pixel overlay is also deferred; visible PNGs cannot expose
hidden RGB differences, so exact reads/counts remain necessary. Outstanding human
and external-tool checks remain solely in [Validation](../VALIDATION.md#remaining-checks).
