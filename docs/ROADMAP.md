# Roadmap

Current baseline: prepared Forge 0.25.1 authors standalone portable Tiled projects with
imported artwork or artwork-free blockouts, optional MCP, guarded browser refresh,
scene links and bounded wide/tall scenes. See [usage](STANDALONE.md) and the
[changelog](CHANGELOG.md) for supported behavior and compatibility.

Open issue and milestone state was checked on 2026-11-01. These are outcome-based
priorities, without promised release versions or dates. Measurements may justify
retaining an existing implementation. Validation gaps live in the
[single remaining-check list](VALIDATION.md#remaining-checks).

## Frontend contracts and infrastructure

- [#67](https://github.com/cliffom/gbc-scene-forge/issues/67): reconcile infrastructure adopt/retain/defer decisions with the completed routing and schema work.

See the [Valibot evaluation](evaluations/valibot-pilot.md). No transport, lifetime
or compatibility rewrite is implied by schema adoption.
