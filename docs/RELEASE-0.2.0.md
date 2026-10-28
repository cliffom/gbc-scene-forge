# GBC Scene Forge 0.2.0

Scene Forge now authors standalone projects from imported artwork and saves
portable Tiled maps. Create and edit scenes without supplying a game connector.

## Standalone projects

- Create/open a local project with `gbc-scene-forge /path/to/world`.
- Import gbc-atlas manifests and PNGs through a folder picker. Projects retain
  their own asset copies, stable references and atlas provenance.
- Create named scenes on 8, 16 or 32 pixel grids; paint tiles/stamps and place
  native-size sprites using atlas origins. Search/filter the asset library,
  select, drag, pan, undo/redo, save and reopen.
- Reimport compatible artwork with change reports. Delete scenes and unused
  atlases with dependency checks and confirmation.
- Move a whole project directory without retaining the original import folder.
  Revision guards and durable transactions preserve conflict-aware recovery.

## Tiled authoring and exports

- Author named tile/object layers with ordering, visibility and active-layer editing.
- Add spawn markers and trigger rectangles, with names, classes and typed properties.
- Edit shared tile terrain classifications and collision flags/shapes; inspect overlays.
- Save native `.tmj` maps with external `.tsj` tilesets and project-local PNGs.
- Export scene or whole-project ZIPs, optionally including unsaved canvas edits.
  Whole-project exports reopen in Forge; both scopes open in Tiled.
- Export supported atlas sequences as native Tiled animations with original timing.
  `export.json` identifies sequences skipped because of grid or starting-tile conflicts.

## Sprite previews

- Play, pause, step and adjust animation speed; inspect sprite origins.
- Map explicit idle/walk sequences for up, down, left and right per sprite asset.
- Preview movement with arrows/WASD or pixel waypoints, adjustable footprints,
  optional metadata-based collision checks, pause/resume and reset.
- Save preview preferences independently. Playback leaves saved starting positions,
  scene dirty state and undo history intact; reopening pauses playback and disables movement.

## Compatibility and installation

Standalone project and Tiled authoring are the supported product direction.
Connector v1, game-specific Apply/build integrations and their document formats
are legacy code with no compatibility guarantee. Existing connector documents
are not standalone projects; this release provides no automatic migration.
Game runtime integration remains the consumer's responsibility.

Forge supports a documented Tiled subset and rejects unsupported data before
rewriting it. Preview movement settings do not export as runtime actor logic.
See [standalone usage and file compatibility](STANDALONE.md) for the complete
format, atlas reimport rules, export limitations and recovery behavior.

Python 3.10+ is required. The installed package includes the browser assets and
has no runtime Python dependencies; Node is needed only to develop/build Forge.
Install from PyPI:

```sh
python -m pip install gbc-scene-forge==0.2.0
gbc-scene-forge /path/to/world --create "My world"
```

Open the loopback URL printed by the launcher. Stop and restart it with the same
directory to reopen the project.
