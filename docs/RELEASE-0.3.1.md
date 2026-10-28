# Scene Forge 0.3.1

## Project and scene selection

Switch projects from the **Project** dropdown beside the scene selector. Choose
**Choose or create project…** to open the simplified project selector or create
another project. Unsaved changes still offer save, discard and cancel choices.
Open saved scenes directly from the scene dropdown. The compact folder button
beside the GitHub link shows the current directory and offers **Copy path**.

## Editing improvements

- Drag layer grips to reorder layers, with undo support and clearer controls for
  selecting, renaming and showing hidden layers.
- Hold Space and drag to pan temporarily, then return to the active editing tool.
- Zoom around the pointer with the mouse wheel, or use **Fit scene** to center
  the map at a whole-number zoom level.
- See unsaved changes beside the scene selector and an accented **Save scene**
  button when edits need saving.
- Inspect selected tiles and objects at the top of the inspector. Mouse-operated
  tools and dropdowns return focus to the canvas; keyboard navigation keeps focus.

## Sample and development

The bundled sample now comes from the tracked portable project in
`assets/demo/project/`, with editable Aseprite sources, exported artwork and an
atlas manifest alongside it. `make demo` restores that project on every launch;
use `make run PROJECT=.demo` to preserve edits.

Development uses Python 3.13, Poetry 2.4–2.x and Node 24 (24.12+). CI checks the
same built wheel on Python 3.10 through 3.14. The installed editor still supports
Python 3.10+ with no Node or additional Python runtime dependencies.

## Compatibility and installation

Manifest schema remains version 1. Existing 0.2.0 and 0.3.0 projects need no format
migration. The project-root and direct-project CLI behavior introduced in 0.3.0
is unchanged.

```sh
python -m pip install gbc-scene-forge==0.3.1
gbc-scene-forge
```

See the [README](../README.md) for setup and the
[editor guide](STANDALONE.md) for controls and project storage.
