# Roadmap

Current baseline: standalone portable Tiled authoring with imported/native artwork,
editable tile and sprite sheets, native animation, scene/artwork documents,
artwork-free blockouts, optional MCP and conflict-aware recovery. See
[usage](STANDALONE.md) and the [changelog](CHANGELOG.md) for supported behavior.

Open milestone state was checked on 2026-11-03. Stabilization of existing workflows
precedes new authoring features. Priority order is **20 → 17 → 18 → 19**;
these outcomes have no promised dates. Validation gaps live in the
[single remaining-check list](VALIDATION.md#remaining-checks).

## Artwork editor interaction polish (milestone 20)

[Milestone 20](https://github.com/cliffom/gbc-scene-forge/milestone/20), #173–#176:
hover targets, toolbar density, document selection prominence and canvas panning,
based on direct editor use. Preserve the measured performance improvements and
exact pixel/history/recovery contracts while preparing the next release.

## Existing workflow usability and manual–MCP parity (milestone 17)

[Milestone 17](https://github.com/cliffom/gbc-scene-forge/milestone/17), #165–#167:
improve discovery and the manual/agent handoff for the existing feature set.
Preserve manual-only, agent-only and mixed authoring workflows.

## Authoring maintainability and correctness (milestone 18)

[Milestone 18](https://github.com/cliffom/gbc-scene-forge/milestone/18), #168–#170:
clarify ownership, simplify code organization and strengthen correctness around
existing authoring and persistence contracts.

## Explicit limits and policy constants (milestone 19)

[Milestone 19](https://github.com/cliffom/gbc-scene-forge/milestone/19), #171–#172:
replace unexplained values with named, owned policies and boundary coverage.
Separate format/hardware constraints from tunable interaction choices.
