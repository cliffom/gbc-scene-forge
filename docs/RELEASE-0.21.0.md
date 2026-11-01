# Scene Forge 0.21.0

Hold the middle mouse button and drag over the scene workspace to pan with any
editing tool selected. Release it to stop, leaving the selected tool, scene
content, dirty state and undo/redo history intact. Middle-button panning also
works in review mode. The viewport shows the existing grabbing cursor during
the gesture and suppresses browser middle-click defaults.

Button release (including mouse-button chords), pointer cancellation/capture loss,
window blur, hidden tabs and editor disposal end the pan. Existing Pan-tool,
Space+drag, left-button authoring and wheel zoom remain available. See the
[standalone guide](STANDALONE.md#import-and-edit) and
[review guide](user/review-mode.md).

This minor release prepares a compatible authoring shortcut for
[#103](https://github.com/cliffom/gbc-scene-forge/issues/103). Project, Tiled and
draft formats and required runtime dependencies are unchanged. Tagging and
publication remain separate from release preparation.

See [interaction validation and retained captures](VALIDATION.md#middle-button-scene-panning-103)
for the tested revision, environment and limits.
