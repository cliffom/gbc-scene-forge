# Scene Forge 0.32.0

Prepared feature release for [human–agent artwork iteration](https://github.com/cliffom/gbc-scene-forge/milestone/21).
Publication is separate.

## Changes

- MCP imports uploaded generic PNGs directly as unpublished native sprites, with
  exact RGBA, compact retention and the existing reviewed atomic commit flow.
- Structured raster batches add fill, line, rectangle/ellipse, copy/move, flip,
  region resize and exact replacement/remapping. Paged color counts include alpha
  and hidden RGB. Existing exact writes and rectangular patches remain available.
- Native illustrations and sheets support named layers with stable UUIDs, order,
  visibility, opacity and locks. Browser history, MCP targeting, checkpoints,
  save/reopen and portable transfers preserve source layers independently of the
  flattened PNG used by scenes.
- Browser Agent candidates supports inspect/download, deliberate adoption into
  separately owned work and return to MCP without publication. Local documents
  and their histories remain independent; review and commit still guard saved work.
- MCP review includes bounded inline PNG previews with resource links. Scene
  artwork overview works without a camera; explicit camera review remains available.
- Saved artwork becomes discoverable while Artwork stays open. Discovery preserves
  local pixels, saved bases and history. MCP can preview and delete an unused whole
  saved atlas/document while retaining independent candidates and checkpoints.
- Ordinary wheel input over the artwork viewport zooms around the pointer;
  existing pan controls remain available. Ctrl/Meta-wheel keeps browser zoom.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.32.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.32.0'
```

Existing flat documents require no migration. Creating layers adds an optional,
versioned extension to static/sheet descriptors and candidate envelopes, plus
declared source PNGs. Older releases reject that extension; keep a native project
backup before editing with newer features. Flattening is explicit and loses layer
separation; PNG output contains the deterministic visible composite. Individual
region copies are flattened, while whole-sheet copies retain layers.

Layers are limited to eight and 4,194,304 aggregate pixels including the composite
(16 MiB decoded); candidate, retention, recovery and browser history quotas remain
separate. Layered operations can use substantial process memory despite compact
handles. See the [contract](EDITABLE-ARTWORK.md), [MCP guide](MCP.md),
[browser guide](user/pixel-artwork.md) and [measured evaluation](evaluations/artwork-iteration.md).
Opt-in near-color/noise diagnostics and changed-pixel overlays remain deferred.
Validation evidence and limitations belong in [Validation](VALIDATION.md).
