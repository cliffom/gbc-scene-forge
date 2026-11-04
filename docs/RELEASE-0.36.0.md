# Scene Forge 0.36.0

Add selective MCP pixel-art cleanup and exact constraints for
[#218](https://github.com/cliffom/gbc-scene-forge/issues/218).

## Changes

- Analyze small color islands with an explicit editable rectangle, protected
  pixels/rectangles, connectivity, distance and neighbor-support thresholds.
  Default diagonal connectivity helps preserve thin lines; findings remain
  suggestions whose artistic intent needs review.
- Preview only explicitly selected finding IDs against an exact candidate/profile
  proposal. Return an unsaved native candidate, target-source before/after PNGs,
  a magenta change map and exact native coordinate changes. Full envelopes and
  recoverable compact handles use the existing lifecycle.
- Validate actual output against geometry/base/metadata, source alpha and hidden
  RGB, protected pixels, locks, other layers and optional exact source/composite
  palette/count constraints. Impossible output constraints and stale proposals
  reject without saving. Review and commit remain separate existing operations.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.36.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.36.0'
```

This compatible feature release adds no mandatory dependency, native-format
migration or browser UI. Ordinary import, palette conversion, editing and saving
retain their behavior. Cleanup profiles apply to explicit cleanup requests, not
all future edits or exports. Browser drafts and Undo remain independent.

Semantic recognition, automatic outline repair, silhouette scoring and connected
color-plane consolidation are unsupported. Small intentional highlights can be
suggested for removal; protect them and inspect the preview. A synthetic fixture
records that failure rather than treating every changed pixel as an improvement.

See [MCP cleanup](MCP.md#selective-pixel-cleanup), the
[official-SDK example](../examples/mcp/pixel_cleanup.py),
[bounded evaluation](evaluations/pixel-cleanup.md), [validation](VALIDATION.md)
and [release procedure](RELEASING.md). Publication remains separate.
