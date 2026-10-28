# Scene Forge 0.7.0

World view and scene connections for issue [#27](https://github.com/cliffom/gbc-scene-forge/issues/27),
implemented in [PR #44](https://github.com/cliffom/gbc-scene-forge/pull/44).

- Arrange scenes in a persistent world diagram by dragging cards or entering
  coordinates. Save world changes independently of open scene edits and history.
- Author named one-way or two-way connections between exit/trigger and entrance
  objects using stable scene UUIDs and scene-wide object IDs.
- Inspect and follow endpoints with the existing unsaved-scene Save / Discard /
  Cancel flow. Hidden endpoints remain identifiable without changing layer visibility.
- Find and repair missing scenes, removed objects, and invalid object definitions
  through deterministic endpoint findings, including current unsaved scene edits.
- Preserve connections through scene/object renames. Duplicates create no implicit
  links; deleting linked scenes or saving edits that remove linked objects requires
  explicit confirmation and retains broken connections for repair.
- Retain versioned world metadata in portable projects and `world.json` export
  sidecars. Project exports include all scenes; scene-only exports retain graph
  context without implicitly including other maps.
- Guard world reports and saves with mutation tokens, project/scene revisions,
  and durable transactions, including concurrent external scene changes.

Connections describe authoring intent; they do not execute game transitions or
claim runtime reachability. Existing manifest version 1 projects open without
migration. See the [world view guide](STANDALONE.md#world-view-and-scene-connections)
for editing, lifecycle, and portable-format details.

The Python package remains dependency-free at runtime and supports Python 3.10+.
Publication follows [RELEASING.md](RELEASING.md).
