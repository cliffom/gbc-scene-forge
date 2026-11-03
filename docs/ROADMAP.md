# Roadmap

Current baseline: standalone portable Tiled authoring with imported or native pixel
artwork, artwork-free blockouts, optional MCP, guarded browser refresh, scene
links, bounded wide/tall scenes and transfer from Forge export ZIPs. See
[usage](STANDALONE.md) and the [changelog](CHANGELOG.md) for supported behavior and compatibility.

Open issue and milestone state was checked on 2026-11-02. These are outcome-based
priorities, without promised release versions or dates. Measurements may justify
retaining an existing implementation. Validation gaps live in the
[single remaining-check list](VALIDATION.md#remaining-checks).

## Native pixel artwork (milestone 14)

The integrated [editable artwork contract](EDITABLE-ARTWORK.md) and
[workflow evaluation](evaluations/artwork-workflows.md) define the current scope.

Preserve external import/reimport, portable scenes, metadata, optional target
constraints and recoverable work across writers. Advanced animation and full
Aseprite parity remain outside this milestone.

## Editor usability and UI cleanup

- [#144](https://github.com/cliffom/gbc-scene-forge/issues/144): implement coherent scene/pixel toolbars, fix clipped/misaligned controls and validate efficient manual workflows across desktop sizes. See the [polish evaluation](evaluations/editor-polish.md).
- [#117](https://github.com/cliffom/gbc-scene-forge/issues/117): scoped review recorded in the [usability evaluation](evaluations/editor-usability.md); follow-up implementations remain separate.
- [#123](https://github.com/cliffom/gbc-scene-forge/issues/123): first, match artwork search against visible asset names while retaining raw-ID searches and filters.
- [#124](https://github.com/cliffom/gbc-scene-forge/issues/124): next, remove stale import-preflight errors after a successful correction.
- [#125](https://github.com/cliffom/gbc-scene-forge/issues/125): then, finish source-type and empty-state guidance for artwork, maps and Forge exports.

Preserve standalone authoring, pane/Review behavior, keyboard access and guarded
import/recovery. The current polish pass targets the existing feature set and manual editing efficiency.
