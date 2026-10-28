# Scene Forge 0.3.4

## GBC scene palette budgets

Choose **GBC palettes…** to enable an optional project profile that checks the
current scene across imported atlases. Background/window and sprite palettes
have separate eight-slot budgets and explicit reservations for runtime content.
Blank reservations remain unknown and cannot produce a passing preflight.

Reports include unsaved canvas edits, hidden layers, and animation frames linked
to placed regions. Equivalent ordered palettes share a slot within their pool;
unused artwork does not consume slots. Expand a palette to inspect its colors
and navigate to the placements that require it. Reports refresh after edits,
undo/redo, scene changes, reimports, and profile saves; stale responses and
external revision conflicts cannot replace a current report with an old pass.

Run explicit palette preflight in the editor, through the loopback API, or for
a saved scene from the command line:

```sh
gbc-scene-forge --project /path/to/project --palette-preflight SCENE_UUID
```

The command outputs JSON and exits 1 unless the palette check passes. A passing
result covers the declared static palette budget; a consuming game build still
owns final runtime allocation and other hardware requirements. Generic Tiled
editing and export remain available for failed or unverified palette checks.

Uses the existing gbc-atlas manifest v1 contract and conformance examples from
gbc-atlas 0.3.1. Forge requires no gbc-atlas installation or new runtime
dependencies. See the [palette budget guide](PALETTE-BUDGETS.md) for counting
policies, API details, and reproducible passing and over-budget examples.

## Compatibility and installation

Existing projects remain opted out until you enable the profile. Manifest
version remains 1, and generic Tiled maps receive no target metadata. The profile
is stored separately in the Forge project manifest and survives whole-project
export. Older Forge versions cannot open a project with the profile enabled;
disable it using this release before reopening the project with an older version.

Python 3.10+ is supported. The installed editor needs neither Node nor additional
Python runtime dependencies.

```sh
python -m pip install --upgrade gbc-scene-forge==0.3.4
gbc-scene-forge
```

Implemented in [PR #37](https://github.com/cliffom/gbc-scene-forge/pull/37),
closing [#32](https://github.com/cliffom/gbc-scene-forge/issues/32).
