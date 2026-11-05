# Scene Forge 0.39.0

Complete milestone 24 P2 (#228–#234) with focused changes to everyday editing.

## Changes

- Begin artwork drawing with the frame dock collapsed. Keep frame/scope visible,
  explicitly open animation timing and retain deliberate pane/dock choices for
  the mounted editor, across document switches.
- Share P/E/F/S/H for drawing, erase, fill, selection and pan. Show contextual
  tooltips and visible Keyboard help while preserving native input/focus guards.
- Put routine scene open/save and artwork save acknowledgments in the status
  area. Warnings and persistent failures retain prominent feedback.
- Offer sample, artwork, import and blockout starting goals using existing flows;
  show relevant creation limits and available recovery/candidate content.
- Expose Create stamp from selection in the Stamps Library, and put ordinary
  editing and preview ahead of secondary conversion/removal in the Inspector.
- Download whole artwork or a selected frame as a native static PNG, including
  unsaved composited pixels and transparency, without changing save/history state.
  Editable work JSON and portable project ZIP exports remain available.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.39.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.39.0'
```

This compatible editor feature release adds no mandatory runtime dependencies and
changes no project/Tiled/MCP schemas. PNG is static flattened RGBA; animation and
layered interchange remain separate. Presentation choices reset on reload.
Reviewed artwork save, independent histories and recovery/revision guards remain.
See [standalone workflows](STANDALONE.md), [artwork](user/pixel-artwork.md),
[validation](VALIDATION.md) and [release procedure](RELEASING.md).
Publication remains separate. Independent participant studies remain #165/#166.
