# Scene Forge 0.28.0

Prepared compatible feature release for
[#140](https://github.com/cliffom/gbc-scene-forge/issues/140).

**Scene view filters** in editing and Review scene independently show tile
artwork, sprite artwork, geometry, gameplay markers and guides. Keep one mixed
scene and switch between artwork, blockout and combined inspection. Classification
uses portable typed properties/defaults and shape fallbacks, including mixed
object layers; authored hidden layers remain hidden. Filtered objects lose
selection/hit testing, hidden placement is blocked, and composition commands
require all categories visible. Filter choices never alter saves, exports,
recovery, dirty state, history, diagnostics or downstream gameplay inclusion.
The existing metadata controls are named **Artwork terrain** and **Artwork
collision** to distinguish them from blockout geometry.

The new read-only MCP `review_scene` tool produces bounded camera/overview SVGs
with embedded native-scale artwork and planning captions. It shares verified
saved/candidate reads, reports the unfiltered candidate snapshot and original
saved revisions, and rejects stale reviews. Artwork-only PNG and blockout-only
SVG review retain their contracts. No project/Tiled schema migration or new
runtime dependency is required; consumers define runtime semantics independently.

See the [single-scene workflow](user/review-mode.md#inspect-one-mixed-scene) and
[MCP contract](MCP.md#combined-scene-review). Validation and limits belong in the
[validation record](VALIDATION.md). Tagging and publication are separate.
