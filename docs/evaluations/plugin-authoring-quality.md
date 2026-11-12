# Plugin authoring quality and resource costs (#262)

## Preregistered scope

This protocol is defined before running the baseline. Use the artwork/animation
and scene skills on the milestone branch, general pixel art, Forge alone, and
disposable projects. No external image generation, editor, stock images or paid
reference service is required. Fixed procedural fixtures make a replay comparable;
they do not measure a model's ability to invent artwork from an unseen brief.
The protocol was written in the working tree before execution; it was not
registered in an independent timestamp service or committed separately beforehand.

| Case | Fixed brief and constraints | Inspection and exact oracle |
| --- | --- | --- |
| Lantern | Transparent 32×32 dark-blue metal lantern with warm gold light; editable Metal, Light and hidden Sketch layers. | Native and 8× views: identifiable handle, housing, light and feet; no accidental opaque background. Save/reopen exact sources. |
| Beacon | Four 16×16 poses on a 64×16 sheet, fixed origin, looping 120/160/240/160 ms pulse. | All frames in sequence order at 1×/8×, compare registration and last-to-first continuity; inspect APNG if playback is available. Verify descriptor/timing on reopen. |
| Grass | Four separate 8×8 grass variants sharing a palette, with no animation. | Sheet and a 64×32 repeated arrangement: inspect horizontal/vertical joins, repeated marks and tile reuse. Distinguish intentional texture from seams. |
| Island | 160×96 dusk island illustration, separate Sky, Island and Details layers; unpublished. | Whole image and native detail: focal hierarchy, shore separation, readable warm beacon and tree; retain exact editable sources. |
| Room | 256×128 px room on an 8 px grid using the saved grass and lantern, floor, spawn, exit and upper route. | Whole artwork and planning views: route/focal spacing, overlaps, sprite origin and native tile joins. Save and reopen portable project, preserving plan and IDs. |
| Scoped light | Recolor only the lantern's light; retain metal, hidden sketch, source metadata and all other pixels. | Before/after/contact change overlay plus exact per-source/descriptor comparisons. Reject stale receipt, review the final candidate and reopen. |

All six cases run once initially. Record initial failures and corrections; repeat
every failed or revised case against the same fixture. A replay after a fix is a
new attempt, never a replacement for the initial observation. No arbitrary tool
budget or artistic pass percentage is a prerequisite: the initial measurements
will establish provisional planning budgets for a later independent run.

## Review rubric

Record each applicable dimension as **0** (brief not met/unreadable), **1**
(recognizable with a material defect), **2** (brief met at the inspected sizes),
or **unobserved**. These anchors define how to describe observations, not a
measured quality threshold. Cover silhouette, multi-frame continuity, tile
seams/reuse, illustration readability, scene composition and revision scope.
Name the defect and image supporting each judgment; never average unobserved
dimensions into a passing score. Technical preservation is a separate exact
pass/fail oracle. A useful editable result needs both a visual judgment and
preservation; PNG validity, a review receipt or successful export alone cannot
establish it. A single evaluator's score is not independent human consensus.

## Measurement and attribution

Record source commit, skill/reference SHA-256, runtime/plugin identity, OS,
Python/client/model identity where observable and unknown values explicitly.
Separate deterministic replay, decisions made by the current agent after image
inspection, actual installed-plugin model turns and human visual judgments.
Reading or decoding an image in a script is not model image inspection. Keep an
image-view ledger with filenames, inspected scale, observed defects and decisions.
APNG generation without observed playback cannot establish cadence.

Count every dispatcher call, including discovery, rejected calls, review, export
and reopen. Record duration and compact JSON argument/result bytes per call;
resource reads have their own serialized/base64 and decoded byte counts. These
dispatcher sizes exclude JSON-RPC envelopes, MCP text/structured duplication,
inline-image duplication and client context overhead. Do not compare them as
equivalent to the [stdio measurements](illustration-production.md).
Record retained candidate count/bytes, total measured service time, correction
loops and stage wall time. Report model latency, tokens, billing/cost, peak memory
and client wire traffic as unavailable unless actually instrumented. External
service usage is zero for this Forge-only baseline; that is not zero model cost.

Use the maintained [iteration method](artwork-iteration.md) for identical inputs
and source preservation. Archive raw per-call results, preview images, full
candidate exports and portable saved content with hashes. Failed calls remain in
the trace. Explicitly distinguish final saved outputs from the unpublished island
and retained draft branches. No cleanup may discard unrelated work.

For native acceptance repeat the briefs in the supported installed plugin with
its actual bundled skills and directory chooser; record complete client/runtime
and model identity, actual image delivery, assistance, correction loops, elapsed
time and observable tokens/cost. Source-dispatch replay cannot certify native
tool availability or automatic skill adherence. Independent users remain the
scope of #165/#166/#264. Outstanding acceptance belongs only in
[Remaining checks](../VALIDATION.md#remaining-checks).

## Observed baseline and image delivery

Run on 2026-11-11 America/Los_Angeles (2026-11-12 UTC), source base
`a5834052945b8bc4548166f9fad8379c470e471f`, Forge 0.46.1 / unpublished plugin
0.1.0-alpha.1, macOS 27.0.1 arm64, Python 3.13.13. The
[environment](assets/plugin-quality/environment.json) records the exact skill
hashes and tool inventory. The current agent wrote the fixed drawing recipes,
received local PNGs through `view_image`, chose refinements after inspection,
and directed save/reopen. This was the VS Code Agents host, with GPT-6 family
identity supplied by session instructions; exact model/build, client build and
usage accounting were unavailable. No native installed-plugin model turn or human
visual judgment occurred. The exposed native tools belonged to the older #254
probe, not this milestone's current plugin. The synthetic grant is restricted to
the evaluation's own disposable project; no real user selection was bypassed.

The [image ledger](assets/plugin-quality/inspection.json) names the PNGs actually
delivered to the agent, views and decisions. All six tasks have inspected output;
this is not a claim that every generated resource was viewed. The four-frame
contact sheet was seen, but the APNG was not played. Room planning SVG was rendered
by headless Google Chrome 157.0.8103.78 at a 1024×512 viewport and its 256×128 SVG
element captured; the PNG was viewed. These are resource inspections, not an
assessment of the editor's controls or native client browser handoff.

| Dimension | Initial → final | Observed judgment and limit |
| --- | --- | --- |
| Silhouette | 2 → 2 | [32×32 lantern at 8×](assets/plugin-quality/lantern-initial-after-enlarged_resource.png): handle, housing, light and feet are distinct. At native size the dark handle is faint against the viewer's black transparency background. Simple geometric art, not a production sprite benchmark. |
| Frame continuity | 2 → 2 static; cadence unobserved | [Four ordered poses](assets/plugin-quality/beacon-initial-contact.png): fixed base and highlight; glow expands/contracts through a symmetric 0→1→2→3→0 loop. Reopened native timing is 120/160/240/160 ms, 680 ms total. Playback was not observed. |
| Seams/reuse | 1 → 2 | [Initial repetition](assets/plugin-quality/grass-initial-repeat.png) shows stripes. The first correction removes bright boundary rows but retains duplicate pairs. The [second correction](assets/plugin-quality/grass-refine-2-after-enlarged_resource.png) produces four distinct rasters with matching boundary colors; [mixed repetition](assets/plugin-quality/grass-refine-2-repeat.png) has no obvious edge seams. The tiny motifs still visibly repeat; no terrain-transition/large-map assessment. |
| Illustration readability | 1 → 1 | [Initial island](assets/plugin-quality/island-initial-after-native_resource.png) reads as tree/beacon/land/sea, but the dark shore is weak and the bright square moon competes with the beacon. [One correction](assets/plugin-quality/island-refine-after-native_resource.png) adds shore contrast; the straight accent and schematic composition remain weak. Kept unpublished; not classified as finished illustration quality. |
| Scene composition | 1 → 1 | [Artwork view](assets/plugin-quality/room-initial.png) has readable lanterns and continuous floor, but large empty space and symmetric props provide little focal hierarchy. The [planning view](assets/plugin-quality/room-plan-browser.png) exposes floor/spawn/exit/upper route and camera; labels are crowded at native size. Artwork-only review omits planning geometry. No physics/reachability claim. |
| Revision scope | 2 → 2 | [Light change overlay](assets/plugin-quality/scope-initial-contact.png) confines the gold→cyan change to the light source. Exact metal, locked hidden sketch (including hidden RGB), descriptor and full canonical scene remain unchanged. The retained original remains available. |

Three visual correction loops occurred: two on grass, one on the island. Lantern,
beacon and scoped-edit outputs met the bounded brief at inspected sizes; grass
met it after correction. Island and room quality remain material weaknesses.
All six data workflows completed: three artwork documents and the scoped light
revision were saved/reopened, the island remained unpublished, and the room was
saved/exported/reopened. A stale receipt
was deliberately rejected in each run, followed by a fresh reviewed save. This
expected refusal is counted in the trace and is not an art correction loop.

The exact oracles compare complete saved source/descriptor data, not just PNG
validity. [Post-export checks](assets/plugin-quality/export-oracles.json) compare
12 reopened native documents across both runs' project exports: descriptor,
composite, layer sources and timing match the relevant saved envelopes. Scene
IDs, layers, planning objects and canonical scene data match on reopen. These
fixtures contain no world connections or unrelated second animation sequence;
the existing skill workflow tests own those separate preservation checks.

## Resource baseline and provisional comparison budgets

[Raw calls](assets/plugin-quality/calls.jsonl) and the
[summary](assets/plugin-quality/summary.json) include discovery, both first/final
reviews, exact exported-candidate reads, resource reads, failed calls, storage
inspection and reopen. Bytes below combine tool and resource payloads; the two
call-count columns remain separate. Failure responses are Python exceptions,
with unknown serialized error bytes recorded as null rather than zero traffic.

| Task | Tool calls | Resource reads | Argument bytes | Result bytes | Service ms | Stage wall s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Lantern | 26 | 6 | 23,789 | 136,938 | 117.838 | 0.158 |
| Beacon | 24 | 8 | 12,419 | 139,357 | 233.437 | 0.249 |
| Grass, including two corrections | 38 | 12 | 12,057 | 148,210 | 478.950 | 0.520 |
| Island, including one correction | 30 | 9 | 255,409 | 1,163,937 | 1,060.201 | 1.105 |
| Room | 20 | 3 | 17,534 | 163,065 | 413.784 | 0.459 |
| Scoped light, including refused stale save | 31 | 11 | 10,124 | 335,327 | 688.799 | 0.736 |

The 169 tool calls plus 49 resource reads total 331,332 argument bytes and
2,086,834 known result bytes, 2,993.009 ms measured service time and 3.227 s
summed stage wall time. First-to-final stage **start** interval was 243.755 s;
that interval includes agent inspection and command orchestration but excludes
earlier harness/protocol development and final-stage completion. It is not a
complete task latency or model inference measurement. The final store retained
24 immutable candidates / 1,983,771 bytes; saving does not release them. The
layered island accounts for 1,728,705 retained bytes at its final stage. No
candidates were released or other work discarded.

Use the observed per-task calls/reads/bytes as provisional comparison budgets on
identical fixtures, rather than a universal latency or dollar ceiling. For example,
four corrected grass variants took 38 calls/12 reads and two visual corrections;
the 160×96 layered draft took 30/9 and over 1.16 MB of results, much of it exact
source exports. An increase deserves explanation; these two local runs do not
justify a statistical performance threshold. Do not equate this script's low
service time with low interaction cost. Token/billing cost, actual client wire
traffic, model reasoning time, peak memory and native installation costs remain
unavailable. External generation/reference usage is zero in both runs.
Host exec/filesystem/image-view tool counts and payloads are not instrumented;
the dispatcher trace is not a complete record of client interaction overhead.

For subsequent visual comparisons retain at least the observed rubric anchors
on the strong cases, and require explicit improvement of the island/room's
documented defects before describing those as finished-quality outputs. This is
an evidence-based comparison target, not a calibrated automated visual judge or
an independent-user acceptance threshold.

## Corrections, replay and evidence recovery

Two preliminary harness attempts are preserved in the
[output archive](assets/plugin-quality/outputs.zip). The first used the wrong
plugin manifest path and failed after three setup calls. The second looked for
incorrect top-level preview keys and silently skipped native/enlarged reads;
it did generate a contact sheet but was not used as visual acceptance evidence.
The corrected harness requires nested `before`/`after` native/enlarged resources,
with explicit null-before handling. These are harness defects, not product failures.
The baseline room was saved before its planning screenshot was viewed; that
ordering does not establish pre-save planning inspection.

A clean deterministic [replay](assets/plugin-quality/replay-summary.json) uses the
final harness and [updated skill hashes](assets/plugin-quality/replay-environment.json).
It repeats both grass corrections, the still-weak island correction, publication,
stale-receipt rejection and export/reopen. Its room artwork and planning PNGs
were actually viewed before save, correcting the baseline ordering gap; its scoped
contact was also viewed before save. The other replay previews were generated
without another agent viewing pass: [16 exact image/source comparisons](assets/plugin-quality/replay-comparison.json)
confirm identical initial/final artwork RGBA and sources to the inspected baseline.
Replay costs are reported separately; 169 calls/49 reads, 3,085.083 ms measured
service time and 3.319 s stage wall time. The 65.037 s first-to-final stage-start
interval includes that run's orchestration/pause, not complete model latency.
Fixture/harness refinements evolved during the baseline; the archived harness
hash identifies the final reproducible version, not every intermediate invocation.

The finding changes the artwork skill to check pixel distinctness and repeated
arrangements before accepting tile variants. Synthetic replay validates the final
recipe, not automatic adherence to that prose. No new required domain operation
was discovered: raster/batch, stamp and diagnostic omissions are existing bounded
profile/browser routes. No claim is made that shell fixture assembly is a missing
MCP operation or that an agent should bypass plugin selection to reproduce it.

[Hashes](assets/plugin-quality/manifest.json) identify the archived files and
final harness. The ZIP contains every run's emitted top-level file, including
full native candidate envelopes, APNGs, intermediate PNGs, exact revisions/receipts,
trace, storage reports and stage-start timestamps; `room-project.zip` contains
the warm saved scene, while `scope-project.zip` contains the later shared cyan
lantern refinement. Unpublished island candidates are separate JSON envelopes;
they are absent from saved project exports. Previews' resource URIs are expired
session references; use the archived bytes, not those URIs, for inspection.

## Reproduce the staged run

Use a fresh output directory and the checkout interpreter after normal setup:

```sh
.venv/bin/python tests/support/measure_plugin_authoring.py --output build/plugin-quality-new --case lantern --phase initial
# Inspect the emitted native/enlarged PNGs before this next phase.
.venv/bin/python tests/support/measure_plugin_authoring.py --output build/plugin-quality-new --case lantern --phase save
```

Repeat initial → inspect → save for beacon. For grass, inspect the initial sheet
and repeat aid, run `--phase refine`, inspect again, run
`--phase refine --iteration 2`, inspect again, then save. For island run initial →
inspect → refine → inspect → save (the final phase retains it unpublished).
Then run room initial → inspect artwork and planning SVG → save, and scope
initial → inspect before/after/contact → save. Keep this order so the room uses
fresh saved artwork and scoped revision checks the complete saved scene. Each
phase refuses an existing start marker; preserve a failed output and start a new
attempt instead of rewriting its evidence. The repeat PNG is a deterministic
arrangement aid assembled from exact tile RGBA; room PNG/SVG come from Forge.

This baseline warrants neither a package/runtime version bump nor publication;
it adds evaluation tooling/evidence and clarifies an unpublished skill. It does
not complete #262's installed-client quality/cost acceptance. The remaining
native/model/human/platform limits stay in the single validation checklist.
