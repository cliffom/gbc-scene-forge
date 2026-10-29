# Scene Forge 0.8.0

Project diagnostics for issue [#28](https://github.com/cliffom/gbc-scene-forge/issues/28),
implemented in [PR #47](https://github.com/cliffom/gbc-scene-forge/pull/47).

- Run read-only diagnostics across project scenes, including the current scene's
  unsaved edits. Inspect findings in the editor with the usual Save / Discard /
  Cancel flow when changing scenes.
- Find object schema errors, broken world endpoints, and unused artwork. Reusable
  stamps, definitions, preview sprite preferences, and animation dependencies count
  as artwork usage, including references in hidden or excluded scenes.
- Choose explicit spawn, entrance, and goal definitions and a footprint to check
  spawn overlap, blocked entrances, and four-direction grid reachability. Reports
  state movement assumptions and mark unsupported or incomplete checks unverified.
- Configure hidden-layer inclusion, scene exclusions, and finding-code exclusions
  without changing project data. Findings distinguish errors, warnings, and
  informational results and navigate to scenes, objects, or artwork.
- Reject stale reports before navigation using project and scene revision guards.
  Bound collision indexing and search work, including large footprints, so
  unfinished movement checks become unverified findings.

Grid movement checks describe an explicit static authoring model; they do not
simulate runtime physics or establish gameplay reachability. Existing manifest
version 1 projects open without migration. See the
[diagnostics guide](STANDALONE.md#project-diagnostics) for assumptions, limits,
API details, and a screenshot.

The Python package remains dependency-free at runtime and supports Python 3.10+.
Publication follows [RELEASING.md](RELEASING.md).
