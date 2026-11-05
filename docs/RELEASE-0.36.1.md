# Scene Forge 0.36.1

Fix the open-artwork review workflow for
[#220](https://github.com/cliffom/gbc-scene-forge/issues/220).

## Changes

- Clean open artwork follows committed MCP saves through the existing automatic
  refresh cycle, without a separate mode, browser reload or document reopening.
  Preserve zoom, viewport and valid frame/layer choices. Adoption clears old
  Undo/Redo history so previous commands cannot replay over external artwork.
- Unsaved manual work pauses replacement. An inline notice offers Download work
  and Load latest, with confirmation before discarding edits and their checkpoint.
- Background checks retry temporary contention quietly. Persistent failures
  provide inline status and Retry instead of recurring error toasts. Removed
  artwork retains the open version for download.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.36.1
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.36.1'
```

No native-format migration or mandatory dependency is added. Automatically refresh
still controls background following, and Check for external changes remains
available when it is off. Only committed saved artwork is followed; unpublished
candidate edits are not streamed. Manual edits, active interactions and unrelated
open documents remain protected. Your own saves retain history as before.

See [external refresh](user/external-refresh.md), [validation](VALIDATION.md) and
[release procedure](RELEASING.md). Publication remains separate.
