# Scene Forge 0.46.1

Make inactive editor buttons visually consistent for
[#252](https://github.com/cliffom/gbc-scene-forge/issues/252).

## Changes

- Give **Save scene** the same dimmed disabled appearance as **Close document**
  when no document is open.
- Keep disabled text, primary, destructive, folder and icon buttons visually
  inactive on hover. Enabled buttons retain hover feedback, and modified
  documents retain the accented Save action.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.46.1
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.46.1'
```

This compatible patch release adds no dependencies or data-format changes.
Scene and artwork save/review, command availability, Undo/Redo and recovery
retain their existing contracts.

See the [standalone guide](STANDALONE.md), [validation](VALIDATION.md) and
[release procedure](RELEASING.md).
