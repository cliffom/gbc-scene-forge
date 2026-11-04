# Scene Forge 0.33.2

Make error feedback dismissible and consistent across artwork, scenes and project
actions, addressing [#204](https://github.com/cliffom/gbc-scene-forge/issues/204).

## Changes

- Shared notification cards appear at the top-right of the workbench, below the
  drawing controls, without moving the editor layout or taking editing focus.
- Routine messages expire after five seconds and pause while hovered, focused
  or the browser tab is hidden. Repeated warnings refresh one card.
- Locked-layer edits still preserve artwork and history. Their warning says
  “Layer is locked. Unlock it to edit.” and clears after resolution or departure.
- Save, conflict and recovery failures remain until dismissed or resolved by
  their operation. Dismissing a card acknowledges the message; it does not mark
  work saved or repair a failed checkpoint. Field validation and document state
  remain in context.
- Cards have keyboard dismissal and live announcements, including inside modal
  dialogs. Their passive presentation does not pause drawing or external refresh.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.33.2
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.33.2'
```

No project, Tiled, artwork or MCP schema changes are introduced. Existing projects
need no migration. The shared component uses the existing TypeScript/CSS stack;
no runtime dependency is added. Release preparation does not publish packages.

See the [artwork guide](user/pixel-artwork.md), [UI guidelines](UI-DESIGN.md) and
[validation record](VALIDATION.md) for usage, presentation and scoped evidence.
