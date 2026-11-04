# Scene Forge 0.35.0

Improve MCP illustration iteration and review, addressing
[#211](https://github.com/cliffom/gbc-scene-forge/issues/211),
[#212](https://github.com/cliffom/gbc-scene-forge/issues/212) and
[#213](https://github.com/cliffom/gbc-scene-forge/issues/213).

## Changes

- Compare an explicit before-candidate with the after-candidate during inspection.
  Full envelopes and retained handles retain exact project/owner identities.
  Geometry must match; choosing a visual baseline never rebases either draft or
  changes the after-candidate's saved-base commit receipt.
- Request directly viewable PNG contact sheets alongside the existing SVG default.
  Both formats label coordinates, integer scale and exact comparison revisions,
  embed revision/completeness metadata, and offer a composite RGBA change overlay.
  Hidden layer-only edits require native-source inspection; they do not appear in
  a composite overlay. Existing resource, cache and inline-image budgets apply.
- Generate read-only archive recommendations grouped by owner, document UUID and
  atlas ID. See exact saved matches, uncertain alternatives, record sizes and
  estimated reclaimable retention bytes. Select handles explicitly and optionally
  pass the unchanged plan to reject changed evidence before durable archiving.
  Stale bases alone never establish supersession or disposable work.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.35.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.35.0'
```

This compatible feature release adds no mandatory runtime dependency or native
format migration. SVG and saved-original comparison remain the defaults.
Archive calls without a plan remain supported; all calls resolve selected exact
identities under a coherent read lock before writing the durable archive.
Recommendations neither evict drafts nor increase quotas. Archive files remain
outside the retained quota and project exports. Publication remains separate.

See the [MCP guide](MCP.md#contact-sheet-inspection),
[validation record](VALIDATION.md) and [release procedure](RELEASING.md).
