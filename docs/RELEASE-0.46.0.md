# Scene Forge 0.46.0

Refine artwork download around a compact icon and clear output options, following
the reviewed mockup for [#250](https://github.com/cliffom/gbc-scene-forge/issues/250).

## Changes

- Replace the labeled PNG toolbar button with a **Download artwork** icon.
- Open an anchored overlay with whole-artwork/sheet and selected-frame radio
  choices, frame availability guidance, filename and native PNG dimensions.
- Keep download explicit. Opening, changing scope and dismissing the overlay
  do not download or change artwork. Escape and Close return to the trigger;
  the overlay remains usable inside the compact toolbar overflow.
- Download current composited RGBA, including unsaved edits and visible layers,
  at original size with transparency. Keep grids, guides and viewport decorations
  out of the PNG.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.46.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.46.0'
```

This compatible editor feature release adds no dependencies and changes no artwork,
project, Tiled or MCP schemas. PNG naming and encoding, save/review, Undo/Redo and
recovery retain their contracts. Download work JSON and whole-project ZIP remain
in their existing command groups.

See the [artwork guide](user/pixel-artwork.md), [validation](VALIDATION.md) and
[release procedure](RELEASING.md).
