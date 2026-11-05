# Scene Forge 0.37.0

Add explicit document closure for [#222](https://github.com/cliffom/gbc-scene-forge/issues/222).

## Changes

- **Close document**, beside Save, closes the active Scene or Artwork without
  deleting saved scenes or artwork. The artwork Document actions entry uses the
  same protected flow.
- Modified work offers save, keep a recoverable draft, discard, or cancel.
  Artwork keeps its review and Confirm save requirements; Cancel closing returns
  to ordinary editing. Failed or uncertain persistence retains local work.
- Closing removes the artwork from retained documents and activates the last
  remaining artwork, the open scene or an empty workspace. Unrelated documents
  and their histories remain available. Kept drafts can be recovered; closed
  documents do not retain their in-memory Undo history.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.37.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.37.0'
```

This compatible editor feature adds no storage/Tiled/MCP schema changes or
mandatory dependencies. Saved content remains available to reopen. Scene closure
uses the existing project-relative URL and browser-history protections.

See [document navigation](user/pixel-artwork.md#sheets-animations-and-the-shared-workbench),
[validation](VALIDATION.md) and [release procedure](RELEASING.md).
Publication remains separate.
