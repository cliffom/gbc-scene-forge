# Roadmap

Current baseline: prepared Forge 0.25.1 authors standalone portable Tiled projects with
imported artwork or artwork-free blockouts, optional MCP, guarded browser refresh,
scene links and bounded wide/tall scenes. See [usage](STANDALONE.md) and the
[changelog](CHANGELOG.md) for supported behavior and compatibility.

Open issue and milestone state was checked on 2026-11-01. These are outcome-based
priorities, without promised release versions or dates. Measurements may justify
retaining an existing implementation. Validation gaps live in the
[single remaining-check list](VALIDATION.md#remaining-checks).

## Editor usability and UI cleanup

- [#117](https://github.com/cliffom/gbc-scene-forge/issues/117): scoped review recorded in the [usability evaluation](evaluations/editor-usability.md); follow-up implementations remain separate.
- [#123](https://github.com/cliffom/gbc-scene-forge/issues/123): first, match artwork search against visible asset names while retaining raw-ID searches and filters.
- [#124](https://github.com/cliffom/gbc-scene-forge/issues/124): next, remove stale import-preflight errors after a successful correction.
- [#125](https://github.com/cliffom/gbc-scene-forge/issues/125): then, name the existing import entry and empty-state guidance for artwork and maps.

Preserve standalone authoring, pane/Review behavior, keyboard access and guarded
import/recovery. These focused findings do not imply a broad visual redesign.
