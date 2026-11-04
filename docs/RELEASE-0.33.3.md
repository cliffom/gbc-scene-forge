# Scene Forge 0.33.3

Reduce artwork opening and layer visibility delays, addressing
[#202](https://github.com/cliffom/gbc-scene-forge/issues/202) and
[#207](https://github.com/cliffom/gbc-scene-forge/issues/207).

## Changes

- Layer metadata changes avoid unnecessary full-raster comparisons. Saved and
  checkpoint comparisons reuse decoded source baselines within a byte budget,
  while direct pixel mutations and hidden RGB still affect Modified state.
- Library opens immediately identify the selected artwork in the workspace.
  Cancel returns to the retained document; selecting another Library asset
  abandons the previous read. Late responses cannot replace the current artwork.
- Failed opens offer Retry opening and Return to document. Outgoing checkpoints
  still finish before replacement, and failed checkpoints preserve local history.
- The server avoids repeating native PNG decoding and layer composition for an
  already verified exact manifest. Every guarded read still checks the manifest
  revision and hashes every declared file; changed content invalidates the proof.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.33.3
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.33.3'
```

This compatible performance/loading fix adds no dependency, project migration or
wire-format change. Release preparation does not publish packages.

See the [artwork guide](user/pixel-artwork.md),
[performance evaluation](evaluations/artwork-opening.md) and
[validation record](VALIDATION.md) for measured scope and limitations.
