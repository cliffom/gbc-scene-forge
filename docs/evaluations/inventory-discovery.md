# Inventory discovery cost

Issue #98 extends the existing two-second refresh cycle with project-root and
scene-choice requests. There is no worker or additional interval. A busy cycle
coalesces focus/reconnect/timer triggers; hidden tabs and active dropdowns defer
work. Inventory adoption never acknowledges an authoring revision.

Unchanged root requests enumerate immediate directories and stat manifests.
Unchanged scene requests stat the manifest and each registered map under the
project transaction lock. Validated entries and invalid-map results are cached
by device, inode, size, modification time and change time. Removed entries are
evicted. Backend regression tests reject any manifest read on warmed unchanged
checks, including cached invalid results. Scene content and artwork are not sent.

## Local sample

Measured on 2026-10-31 in the development environment with `perf_counter`, using
10 temporary empty projects and 100 small default blockout scenes in one project.
For each operation: one cold call followed by 100 unchanged calls. These are
service-call timings, excluding HTTP/browser/network overhead; they are not
universal latency or CPU guarantees.

| Operation | Cold | Warm median | Warm p95 | JSON response |
| --- | ---: | ---: | ---: | ---: |
| Root catalog, 10 projects | 9.188 ms | 0.589 ms | 0.637 ms | 1,049 bytes |
| Scene choices, 100 scenes | 895.237 ms | 3.523 ms | 3.764 ms | 6,721 bytes |

Reproduce by creating a temporary `ProjectRoot`, ten `Project.create` projects,
and 100 `project.planning.create_blockout` scenes. Time `root.catalog()` and
`Updates(project.store).choices()` separately, warming each before recording
100 samples. Use the same process and local filesystem for comparisons.

Idle work grows linearly with the number of projects and registered scenes.
The cold map cost includes decoding and validating all 100 scenes. A changed
manifest invalidates map validation because artwork and other project references
may have changed. Changed individual maps are revalidated independently. Large
inventories or frequent writes can therefore cost more than this idle sample.
Existing full snapshot adoption and artwork decoding still occur only when the
editor is eligible and revisions change.
