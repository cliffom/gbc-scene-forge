# Scene Forge 0.38.0

Make existing work and drawing boundaries easier to find for
[#225](https://github.com/cliffom/gbc-scene-forge/issues/225),
[#226](https://github.com/cliffom/gbc-scene-forge/issues/226) and
[#227](https://github.com/cliffom/gbc-scene-forge/issues/227).

## Changes

- Artwork search and thumbnail browsing precede source management. Compact
  **New…**, **Import** and **Source…** entries keep common actions reachable.
  Source editing, copy/update/delete and terrain/collision share one menu;
  **Filters & recovery** exposes filters, draft recovery and agent candidates.
  Terrain/collision targets the source named by that menu even when filters
  change the source while a different scene brush remains selected.
- The empty workspace offers **Open scene…** beside **Create scene** when saved
  scenes exist. The switcher visibly says **Documents**, retaining the active
  name, kind and adjacent save/external-change state.
- Fresh named-pose opening starts in **Frame** scope. Retained sheets keep their
  chosen drawing scope. Frame selection, Sheet/Frame controls and an explicit
  drawing-boundary label stay beside the tools with the animation dock collapsed.
  Whole-sheet drawing remains one explicit action away.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.38.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.38.0'
```

This compatible editor feature release changes no storage, Tiled or MCP schemas
and adds no mandatory runtime dependencies. Shared-source save scope, independent
histories, reviewed artwork confirmation and recovery/revision guards remain.
The remaining milestone 24 P2 work and independent participant evaluation are
separate. See [artwork](user/pixel-artwork.md), [scene navigation](user/scene-links.md),
[validation](VALIDATION.md) and [release procedure](RELEASING.md).
Publication remains separate.
