# Scene Forge 0.25.0

The document controls now include **Hide Library** and **Hide Inspector** buttons.
Collapse either pane or both to reclaim canvas width while continuing to edit.
The Inspector toggle hides the entire right pane, including layers and selection
properties. **Show Library** and **Show Inspector** stay visible for reopening.

This compatible feature release resolves
[#116](https://github.com/cliffom/gbc-scene-forge/issues/116).
Install with `python -m pip install --upgrade gbc-scene-forge==0.25.0`;
include `[mcp]` for the optional MCP tools. Project, Tiled and draft formats
are unchanged; no migration is required.

Pane choices last through scene switches and entering/leaving Review scene in
the mounted editor. Reloading or replacing the editor starts with both expanded.
Choices are separate from authored data and do not add Undo entries or change
draft recovery. Tools, brushes, Library category, layers and selections survive
collapse. The viewport retains its scene center where scroll bounds allow, and
Fit scene follows the available space. Guided reveal and explicit world or
diagnostic navigation reopen the relevant pane.

See [editor layout](STANDALONE.md#editor-layout) and the
[validation record](VALIDATION.md#collapsible-editor-panes-116).
This prepares 0.25.0; tagging and publication remain separate steps.
