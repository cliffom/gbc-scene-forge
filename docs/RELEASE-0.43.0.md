# Scene Forge 0.43.0

Edit artwork layers directly in a compact Inspector stack (#244).

## Changes

- See the front-to-back layer order, active source, visibility and locks together.
  Drag grips to reorder; Alt + Up/Down on a focused grip provides keyboard access.
  Cancel a drag with Escape or release outside the list. A drop is one Undo step.
- Click to select; double-click a name or press F2 to rename inline. Enter or blur
  commits, Escape cancels. New layers start in rename mode. Compact plus/trash
  icons replace large Add/Remove buttons; the dropdown and move buttons are gone.
- Use per-row eye/lock controls and synchronized opacity slider/numeric percentage
  entry. Remove the separate Name field and Apply button. Existing native opacity
  bytes remain exact when their displayed percentage is merely rounded.
- Preserve artwork-local Undo/Redo, save, revision checks and checkpoint recovery.
  Keep long stacks independently scrollable at compact sizes.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.43.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.43.0'
```

This compatible editor feature release adds no runtime dependencies and changes
no artwork, project, Tiled or MCP schemas. Scene-layer controls retain their
existing behavior. See the [artwork guide](user/pixel-artwork.md),
[validation](VALIDATION.md) and [release procedure](RELEASING.md).
Tagging and publication follow release checks.
