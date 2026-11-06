# Scene Forge 0.45.0

Organize the Artwork and Scene Inspectors around compact details and independent
sections, following the approved design for #248.

## Changes

- Lead Artwork with **Properties**: the name, Width, Height and Total pixels for
  the whole document. Keep scope explanations and frame/representation commands
  within Properties.
- Replace the floating Colors popover with an inline **Palette** before **Layers**.
  Keep exact RGBA, Composition/Selected layer scope, Hue/Most used ordering and
  bounded scrolling. Color selection leaves Palette open.
- Give Scene matching Properties, Layers, Selection, Object validation and Draft
  recovery disclosures. Raise and open Selection for changed selections; retain
  section choices on ordinary redraws. Collapsed validation and recovery headings
  show current status.
- Retain Artwork disclosure, palette scope and sort choices per open document.
  Review collapses Properties, Palette and Layers; opening any returns to editing.
  Native keyboard activation and focus restoration keep collapsed controls reachable.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.45.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.45.0'
```

This compatible editor feature release changes no artwork, project, Tiled or MCP
schemas and adds no runtime dependencies. Disclosure state is transient UI state,
resets on reload and does not enter Undo history. Existing save, recovery, layer,
frame, selection and preview operations retain their contracts.
See the [artwork guide](user/pixel-artwork.md), [standalone guide](STANDALONE.md),
[validation](VALIDATION.md) and [release procedure](RELEASING.md).
