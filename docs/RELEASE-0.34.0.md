# Scene Forge 0.34.0

Improve MCP static illustration production, addressing
[#201](https://github.com/cliffom/gbc-scene-forge/issues/201).

## Changes

- Inspect retained record/byte usage, capacity and per-candidate sizes. Exact saved
  content evidence compares the native descriptor, metadata, composite and every
  editable layer; a composite match alone does not establish a match.
- Archive selected candidates into a durable project-local ZIP before optional
  explicit release. Recover archives after restart and download bounded chunks;
  failures report which records remain. Draft quotas and deliberate cleanup stay unchanged.
- Prepare independent static documents with nearest-neighbor scaling or anchored
  canvas crop/pad. Retain layers and transform origins; sheet flattening requires
  an explicit choice. Existing saved references stay on their original artwork.
- Convert to a declared RGB palette or exact RGBA budget with opt-in no-dither
  quantization, preserving alpha and hidden transparent RGB. Reports disclose
  dimensions, color counts, choices and lossy behavior.
- Import aligned PNG layers in one bounded operation; export an artwork ZIP with
  exact native candidate recovery, composite/layer PNGs, palette and metadata.
- Apply atomic candidate batches spanning layer creation, targeted patches/raster
  drawing and final locks. Retain only the final compact result; invalid batches
  retain no successful prefix. Review and commit remain separate.
- Inspect coordinate-labelled before/after contact sheets and optional exact-RGBA
  changed-pixel overlays, bound to candidate/base revisions and a review receipt.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.34.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.34.0'
```

This compatible feature release adds no runtime dependency or native document
migration. Existing tools, candidate envelopes and reviewed commit contracts remain.
Candidate listings add storage and saved-content metadata; extract the documented
handle fields when passing a listing item to a candidate tool. Archives live
outside the retained-candidate quota and project exports; copy them explicitly
when moving projects. Preparing a resized copy does not replace saved placements.
Publication remains separate from this release preparation.

See the [MCP workflow](MCP.md#static-illustration-production),
[measurement and limitations](evaluations/illustration-production.md) and
[validation record](VALIDATION.md).
