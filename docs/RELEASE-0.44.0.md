# Scene Forge 0.44.0

Make artwork Inspector section state clear with Option A from #246.

## Changes

- Replace the tab-like Layers/Properties button row with independent **Artwork
  layers** and **Properties** disclosures. Right-facing chevrons mean closed;
  down-facing chevrons mean open. Keep the layer count visible when collapsed.
- Open both sections for newly opened artwork and retain their state per open
  document during this editor session, including scene and Inspector transitions.
- Use native pointer and Enter/Space activation with visible keyboard focus.
  Collapsing a section moves focus out of hidden controls when necessary.
- Review collapses both sections. Opening either section returns to editing;
  closing Review leaves the sections collapsed. Keep existing layer, frame,
  palette, Undo/Redo, save and recovery behavior.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.44.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.44.0'
```

This compatible editor feature release adds no runtime dependencies and changes
no artwork, project, Tiled or MCP schemas. Expansion choices are transient UI
state and reset on reload. Scene Inspector controls retain their existing behavior.
See the [artwork guide](user/pixel-artwork.md), [validation](VALIDATION.md) and
[release procedure](RELEASING.md). Tagging and publication remain separate.
