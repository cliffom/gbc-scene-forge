# Scene Forge 0.33.0

Prepared feature release for [milestone 22](https://github.com/cliffom/gbc-scene-forge/milestone/22).
Publication is separate. This draft currently describes the shell, navigation and command increments;
later milestone issues extend the release before final publication.

## Changes

- Scenes and artwork use the same workbench, document title area and collapsible
  Inspector. Artwork layers, frame properties and exact-change review contribute
  to the existing Inspector instead of replacing the editor with a separate shell.
- Scene keyboard commands, focus restoration and saved refresh explicitly respect
  the active document. Artwork retains its existing models, history, pixel targeting,
  guarded review/save, recoverable drafts and browser/MCP discovery.
- Returning to a scene restores its canvas focus and contextual Inspector. Artwork
  creation also works without a scene. The bounded frame/animation dock remains.
- One Documents control navigates between the active scene, other saved scenes and
  retained artwork. The bar shows the active name, document kind and local state,
  with detected external saved-base changes shown separately. Switching preserves
  editing context and independent history; project departure waits for artwork
  checkpoints, and outgoing preview playback stops.

- A single document-bar Save action and shared history/clipboard/transform strip
  follow the active scene or artwork, including shortcuts from shared controls.
  Artwork Save opens exact-change review and requires confirmation in that same
  location. Pixel Cut/Paste preserves exact RGBA; text editing and modal focus
  retain native keyboard behavior. Scene and artwork histories remain independent.

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
