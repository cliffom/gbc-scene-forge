# Roadmap

Current baseline: standalone portable Tiled authoring with imported/native artwork,
editable tile and sprite sheets, native animation, scene/artwork documents,
artwork-free blockouts, optional MCP and conflict-aware recovery. See
[usage](STANDALONE.md) and the [changelog](CHANGELOG.md) for supported behavior.

Open milestone state was checked on 2026-11-04. The next requested release groups
[#211](https://github.com/cliffom/gbc-scene-forge/issues/211),
[#212](https://github.com/cliffom/gbc-scene-forge/issues/212) and
[#213](https://github.com/cliffom/gbc-scene-forge/issues/213) from
[milestone 23](https://github.com/cliffom/gbc-scene-forge/milestone/23).
Validation gaps live in the [single remaining-check list](VALIDATION.md#remaining-checks).

## MCP illustration iteration and review (milestone 23)

Prepare 0.35.0 with explicit draft comparison, directly viewable PNG inspection and
read-only archive recommendations. Complete review and release checks before
publication. Constrained palette reduction (#214) remains separate design work.

## Stabilization priorities

Milestone 17 retains independent-user work; milestone 19 owns policy/limit cleanup.
Milestone 18 remains open in GitHub with all three issues closed; no implementation
work remains assigned to it. These milestones have no promised release dates.

## Existing workflow usability and manual–MCP parity (milestone 17)

[Milestone 17](https://github.com/cliffom/gbc-scene-forge/milestone/17): complete
independent-user evaluation (#165) and findings-based remediation/retesting (#166)
using the [evaluation protocol](evaluations/workflow-usability.md) and maintained
[browser/MCP outcome matrix](AUTHORING-OUTCOMES.md). Participant-dependent
acceptance remains open until observations exist. Preserve browser-only, agent-only
and mixed authoring workflows; publication does not close the milestone.

## Explicit limits and policy constants (milestone 19)

[Milestone 19](https://github.com/cliffom/gbc-scene-forge/milestone/19), #171–#172:
replace unexplained values with named, owned policies and boundary coverage.
Separate format/hardware constraints from tunable interaction choices.
