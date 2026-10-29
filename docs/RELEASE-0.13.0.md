# Scene Forge 0.13.0

Read dense blockout plans without magnified, overlapping text. This release
addresses [#55](https://github.com/cliffom/gbc-scene-forge/issues/55).

- Browser captions render at display resolution and stay at a readable size
  across zoom levels and standard/Retina displays. Artwork keeps its pixel scaling.
- Selected objects get first label placement, followed by cameras, gameplay
  markers, notes, geometry, and climb endpoints. Nearby placement and suppression
  prevent caption collisions; long captions use an ellipsis.
- Read full names and design notes in the Selection inspector. Captions follow
  pan, zoom, resize, layer visibility, and object edits without intercepting clicks.
- SVG reviews also receive bounded, prioritized caption placement, higher-contrast
  backgrounds, and vector text. Object titles retain names and notes when captions
  are shortened or omitted.

Existing projects, native geometry, portable exports, MCP schemas, save revision
guards, and draft recovery retain their existing behavior. Browser live refresh
remains tracked separately in #54.

```sh
python -m pip install --upgrade gbc-scene-forge==0.13.0
# With the optional local MCP server:
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.13.0'
```

See the [blockout tutorial](user/blockout-tutorial.md#reading-labels-in-a-dense-plan)
for label behavior and before/after screenshots, and [MCP setup](MCP.md) for local
agent authoring.
