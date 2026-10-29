# Scene Forge 0.13.1

Keep a browser editor in sync with saved MCP and other external changes. This
release addresses [#54](https://github.com/cliffom/gbc-scene-forge/issues/54).

- Clean, visible editors check lightweight cached revisions every two seconds.
  Full snapshots and artwork load only when saved content changes.
- Checks pause during unsaved edits, forms, gestures, preview movement and hidden
  tabs. In-flight refreshes cannot replace newly started local work. Existing
  conflict checks and recoverable checkpoints continue to protect edits.
- External refresh preserves valid selection, layer, zoom and viewport, updates
  project inventories, and handles deletion of the open scene. Adopting external
  content clears the previous Undo/Redo history.
- Project tools contains automatic-refresh and manual-check controls. Connection
  failures retain the displayed scene and retry when the editor is ready.

No project migration, MCP configuration change, or required runtime dependency is
needed. Update both the browser launcher and MCP version pins, then restart them:

```sh
python -m pip install --upgrade gbc-scene-forge==0.13.1
# With the optional local MCP server:
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.13.1'
```

See the [external refresh guide](user/external-refresh.md) for controls, overhead,
Undo/Redo and conflict handling, or [MCP setup](MCP.md) for agent configuration.
