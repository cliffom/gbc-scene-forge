# Roadmap

Current baseline: Forge 0.20.0 authors standalone portable Tiled projects with
imported artwork or artwork-free blockouts, optional MCP, guarded browser refresh,
scene links and bounded wide/tall scenes. See [usage](STANDALONE.md) and the
[changelog](CHANGELOG.md) for supported behavior and compatibility.

Open issue and milestone state was checked on 2026-10-31. These are outcome-based
priorities, without promised release versions or dates. Measurements may justify
retaining an existing implementation. Validation gaps live in the
[single remaining-check list](VALIDATION.md#remaining-checks).

## Editor interaction efficiency

Reduce repeated serialization and unnecessary UI/hover work while preserving
immediate authored feedback, undo/redo, recovery and external-refresh protection:

- [#77](https://github.com/cliffom/gbc-scene-forge/issues/77): measure dirty-state serialization and reduce repeated work.
- [#90](https://github.com/cliffom/gbc-scene-forge/issues/90): separate hover feedback from full UI updates.
- [#91](https://github.com/cliffom/gbc-scene-forge/issues/91): assess coalescing redundant transient hover redraws.

## Large-scene scalability

Measure representative dense scenes and preserve composition, atomic history,
persistence and recovery while reducing cost:

- [#78](https://github.com/cliffom/gbc-scene-forge/issues/78): profile full-scene undo storage and document memory bounds.
- [#92](https://github.com/cliffom/gbc-scene-forge/issues/92): assess static artwork caching with explicit invalidation.
- [#93](https://github.com/cliffom/gbc-scene-forge/issues/93): cull offscreen rendering while retaining overlays and sprite extents.

The [repainting](evaluations/canvas-repainting.md) and
[wide-scene](evaluations/wide-scenes.md) measurements establish scoped baselines;
the canvas sizing cleanup did not show a uniform timing gain.

## Frontend contracts and infrastructure

- [#75](https://github.com/cliffom/gbc-scene-forge/issues/75): extend Valibot response schemas within owning domains, preserving normalization and error behavior.
- [#67](https://github.com/cliffom/gbc-scene-forge/issues/67): reconcile infrastructure adopt/retain/defer decisions with the completed routing and schema work.

See the [Valibot evaluation](evaluations/valibot-pilot.md). No transport, lifetime
or compatibility rewrite is implied by schema adoption.
