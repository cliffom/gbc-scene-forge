# GBC Scene Forge 0.47.0

GBC Scene Forge adds a self-contained Codex plugin preview for macOS Apple Silicon.
This release includes plugin `0.1.0-alpha.11` and the Forge `0.47.0` standalone wheel.

## Changes

- Create, inspect and revise pixel artwork, sprite animation, and scene blockouts
  from Codex. Review artwork and scenes as images, open them in the local browser
  editor, and export portable Tiled maps.
- Choose a game folder when starting a project. Forge creates or reuses its
  `.gbc-scene-forge/` directory, with project and browser handoff scoped to that choice.
- Install **GBC Scene Forge** from the repository marketplace. The macOS plugin
  includes Forge, its Python runtime, and the production editor.
- Preserve artwork Redo in browser recovery and handle stale checkpoints
  independently. Artwork tiles become clickable when editor startup completes.

## Installation and compatibility

The plugin preview supports local Codex on Apple Silicon with macOS 27 or newer.
The tested CLI/app-server baseline is Codex 0.167.1. Windows and Linux are tracked
in [#283](https://github.com/cliffom/gbc-scene-forge/issues/283) and
[#284](https://github.com/cliffom/gbc-scene-forge/issues/284).

```sh
codex plugin marketplace add cliffom/gbc-scene-forge
codex plugin add gbc-scene-forge-macos@gbc-scene-forge-repository
```

For an existing registration, follow the [marketplace upgrade steps](PLUGIN-DISTRIBUTION.md#update-and-rollback).
The standalone editor remains installable with Python 3.10 or newer using the
wheel from the [GitHub release](https://github.com/cliffom/gbc-scene-forge/releases/tag/v0.47.0).
The project and selection formats remain at version 1.

See the [plugin start guide](PLUGIN-START.md), [standalone guide](STANDALONE.md)
and [validation record](VALIDATION.md) for supported workflows and evidence.
