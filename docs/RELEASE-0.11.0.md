# Scene Forge 0.11.0

Plan levels before importing artwork. This release completes
[#46](https://github.com/cliffom/gbc-scene-forge/issues/46) with a native blockout
workflow and a [step-by-step user tutorial](user/blockout-tutorial.md).

- Create a **Blockout — no artwork needed** project, or add a blockout scene to
  an existing project. Set dimensions in pixels/cells and inspect screen counts.
- Use 20 editable presets for ground, one-way platforms, hazards, climbs,
  encounters, rewards, progression, sections/notes and camera frames. Labels,
  symbols and patterns distinguish categories alongside color.
- Drag rectangles, move/resize selections, edit typed properties and use normal
  Undo/Redo. Blockout Fit supports zooming below 1×; artwork workflows retain
  their existing minimum. Add artwork later without replacing the plan.
- Configure movable camera rectangles and independent scrolling axes. Review
  full-route and player-camera SVG snapshots, including unsaved edits, and
  download them. Reviews validate revisions, identify the authored snapshot,
  escape text and bound rendering work.
- Keep geometry, definitions, properties and stable identities through normal
  save/reopen/recovery and portable Tiled export. No project migration or new
  runtime dependencies are required.

The shared Python authoring and SVG review services provide the foundation for
[#51's MCP proof of concept](https://github.com/cliffom/gbc-scene-forge/issues/51).
The forest example is independent fixture data. Planning geometry and camera
intent do not simulate platforming physics or establish jump/climb reachability.
SVG review shows planning geometry; the main canvas reviews artwork alongside it.

```sh
python -m pip install --upgrade gbc-scene-forge==0.11.0
gbc-scene-forge
```

See the [tutorial](user/blockout-tutorial.md) and [reference](BLOCKOUT.md) for
complete workflows, camera settings, persistence and preview limits.
