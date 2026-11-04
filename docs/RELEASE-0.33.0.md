# Scene Forge 0.33.0

Prepared feature release for [milestone 22](https://github.com/cliffom/gbc-scene-forge/milestone/22).
Publication is separate. This draft currently describes the shared-shell increment;
later milestone issues extend the release before final publication.

## Changes

- Scenes and artwork use the same workbench, document title area and collapsible
  Inspector. Artwork layers, frame properties and exact-change review contribute
  to the existing Inspector instead of replacing the editor with a separate shell.
- Scene keyboard commands, focus restoration and saved refresh explicitly respect
  the active document. Artwork retains its existing models, history, pixel targeting,
  guarded review/save, recoverable drafts and browser/MCP discovery.
- Returning to a scene restores its canvas focus and contextual Inspector. Artwork
  creation also works without a scene. The initial increment retains the artwork
  Save footer, document chooser and frame/animation dock.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.33.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.33.0'
```

No project, Tiled, artwork or MCP schema changes are introduced by this increment.
Scene and artwork histories remain independent. Ordinary source edits retain local
scene work; selected-placement variations still atomically update saved references
and deliberately reload the affected scene history after successful adoption.

Current usage belongs in the [artwork guide](user/pixel-artwork.md); observed checks
and outstanding validation belong in [Validation](VALIDATION.md).
