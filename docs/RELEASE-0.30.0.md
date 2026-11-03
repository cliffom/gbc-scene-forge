# Scene Forge 0.30.0

Prepared artwork-editor interaction improvements for
[milestone 20](https://github.com/cliffom/gbc-scene-forge/milestone/20).
Tagging and publication remain separate.

- Preview the exact target pixel before drawing, selecting or sampling, including
  zoomed, scrolled and offset frame views. A contrasting overlay leaves pixels,
  history, dirty state and checkpoints untouched.
- Pan fitting or enlarged artwork with middle drag, Space+drag on the canvas,
  or the Pan button. Pan also supports arrow keys. Fit centers the view; each
  retained artwork document keeps its own viewport and navigation choice.
- Tools, color/opacity and view controls share available toolbar space and wrap
  in groups on smaller windows. Drawing controls and the save footer remain
  reachable with Animation, Properties and Review open.
- Open documents appear in a focused modal chooser with a dimmed background,
  a prominent Return to scene action, current-document/state labels, wrapped
  names, keyboard dismissal and focus restoration.

Project formats, optional MCP operations, revision guards, exact color/alpha,
Undo/Redo and reviewed saves are unchanged. Existing projects need no migration.
See the [drawing/navigation guide](user/pixel-artwork.md) for gestures and
[validation](VALIDATION.md) for tested configurations and limitations.
