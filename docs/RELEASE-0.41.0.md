# Scene Forge 0.41.0

Inspect the palette of the composed artwork while keeping the editing layer in
place (#240).

## Changes

- Start **Colors ▾** on **Composition**, with colors from visible layers after
  opacity and source-over blending. Transparent pixels and editor overlays are
  excluded; partially transparent colors retain their exact RGBA.
- Switch to **Selected layer** for exact source colors, including hidden RGB
  beneath transparency. Both views follow the current Frame or Sheet drawing
  scope, with a scope label and explicit empty state.
- Sort swatches by hue or pixel usage. Choose a color without changing the
  active layer, drawing tool, artwork or Undo history. Keep keyboard navigation,
  Escape focus restoration, checkerboard swatches and an exact drawing-color preview.
- Collect colors on demand using the shared rendering snapshot. Refresh after
  edits, history, layer changes and frame changes; skip collection while closed
  and during pointer gestures. Bound the grid to the first 1,024 distinct colors,
  clearly disclosing when ordering covers only the shown subset.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.41.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.41.0'
```

This compatible editor feature release adds no runtime dependencies and changes
no saved artwork, project, Tiled or MCP schemas. Palette inspection does not
quantize artwork or impose hardware color restrictions. Selected-layer source
colors remain available; the initial view now shows the visible composition.
See [artwork workflows](user/pixel-artwork.md), [validation](VALIDATION.md) and
the [release procedure](RELEASING.md). Release preparation is separate from
tagging and publication.
