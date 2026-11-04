# Roadmap

Current baseline: standalone portable Tiled authoring with imported/native artwork,
editable tile and sprite sheets, native animation, scene/artwork documents,
artwork-free blockouts, optional MCP and conflict-aware recovery. See
[usage](STANDALONE.md) and the [changelog](CHANGELOG.md) for supported behavior.

Open milestone state was checked on 2026-11-03. The user selected
[milestone 21](https://github.com/cliffom/gbc-scene-forge/milestone/21), human–agent
artwork iteration, for the next release. Its scoped implementation/evaluation
precedes the remaining priority order **17 → 18 → 19**;
these outcomes have no promised dates. Validation gaps live in the
[single remaining-check list](VALIDATION.md#remaining-checks).

## Existing workflow usability and manual–MCP parity (milestone 17)

[Milestone 17](https://github.com/cliffom/gbc-scene-forge/milestone/17): complete
independent-user evaluation (#165) and findings-based remediation/retesting (#166)
using the [evaluation protocol](evaluations/workflow-usability.md) and maintained
[browser/MCP outcome matrix](AUTHORING-OUTCOMES.md). Participant-dependent
acceptance remains open until observations exist. Preserve browser-only, agent-only
and mixed authoring workflows; publication does not close the milestone.

## Authoring maintainability and correctness (milestone 18)

[Milestone 18](https://github.com/cliffom/gbc-scene-forge/milestone/18), #168–#170:
clarify ownership, simplify code organization and strengthen correctness around
existing authoring and persistence contracts.

## Explicit limits and policy constants (milestone 19)

[Milestone 19](https://github.com/cliffom/gbc-scene-forge/milestone/19), #171–#172:
replace unexplained values with named, owned policies and boundary coverage.
Separate format/hardware constraints from tunable interaction choices.
