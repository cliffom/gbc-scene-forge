# Scene Forge 0.33.1

Refine Library source management and artwork layer controls from
[PR #203](https://github.com/cliffom/gbc-scene-forge/pull/203).

## Changes

- Library rows show wrapping source names beside thumbnails and distinct region
  names underneath. Repeated headings and generic artwork/kind labels are removed.
- **Source actions…** groups shared editing/copies, **Update source…** and
  **Delete source…** in Library. Update preselects the source; deletion retains
  confirmation and saved-scene reference guards. Inspector no longer repeats the
  project asset inventory.
- Layer **Visible** and **Locked** checkboxes apply immediately, each with its
  own Undo step. Unlock a layer before changing its visibility or other content.
- **Apply name / opacity** commits those fields separately. Toggling visibility
  or locking preserves pending entries without applying them; switching layers
  or documents loads the newly selected layer's values.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.33.1
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.33.1'
```

No project, Tiled, artwork or MCP schema changes are introduced. Existing projects
need no migration. The measured delay when toggling large layered artwork remains
tracked in [#202](https://github.com/cliffom/gbc-scene-forge/issues/202); this release
does not implement that performance optimization.

Current usage belongs in the [artwork guide](user/pixel-artwork.md) and
[import guide](user/import-artwork.md); observed checks and outstanding validation
belong in [Validation](VALIDATION.md).
