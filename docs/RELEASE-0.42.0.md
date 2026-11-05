# Scene Forge 0.42.0

Keep artwork tools on one row at compact window sizes (#242 / PR #243).

## Changes

- Replace text-only Pan and Fit buttons with the scene editor's hand and
  fit-to-view icons, preserving tooltips, accessible names and tool state.
- Move controls that do not fit behind **>** (More artwork tools), starting with
  Download PNG, then drawing color and navigation. Drawing tools remain inline.
- Point the overflow arrow down while its menu is open. Open the menu with the
  keyboard and dismiss it with Escape or a click outside. Pan/Fit close the menu.
- Preserve control settings as resizing moves controls between the toolbar and
  menu. Transfer focus when a focused control becomes hidden and close nested
  PNG options when the toolbar changes width.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.42.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.42.0'
```

This compatible editor feature release adds no runtime dependencies and changes
no saved artwork, project, Tiled or MCP schemas. See the
[artwork guide](user/pixel-artwork.md), [validation](VALIDATION.md) and
[release procedure](RELEASING.md). Tagging and publication follow release checks.
