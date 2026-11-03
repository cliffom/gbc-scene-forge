# Scene Forge 0.29.2

Prepared responsiveness fixes for [milestone 16](https://github.com/cliffom/gbc-scene-forge/milestone/16).
Tagging and publication remain separate.

- Pixel gestures reuse one RGBA raster, resize canvases only when geometry changes,
  redraw affected frame thumbnails and defer collapsed timeline thumbnails until
  revealed. Pointer feedback no longer synchronizes every sheet control.
- Artwork dirty checks compare exact bytes, including RGB under zero alpha,
  without encoding the full sheet on every pointer event. Completed strokes,
  cancellation, Undo/Redo, reviewed saves and recovery retain their exact contracts.
- Scene object selectors retain unchanged options through selection and tool
  changes. Renames, order changes, layers, history and refreshed content still
  update their labels and identities.
- Scene checkpoints capture immutable JSON once per observation. Serial writes,
  exact uncertain-response retries and guarded cleanup remain supported.
- Disposing the editor releases artwork raster/thumbnail surfaces and row bindings.

Project formats, optional MCP operations, revision guards and supported import
formats are unchanged. Existing projects need no migration. See the
[performance evaluation](evaluations/editor-responsiveness.md) for reproducible
methods, raw samples and the limits of synthetic measurements, and
[validation](VALIDATION.md) for checked configurations.
