# Roadmap

Current baseline: standalone portable Tiled authoring with imported/native artwork,
editable tile and sprite sheets, native animation, scene/artwork documents,
artwork-free blockouts, optional MCP and conflict-aware recovery. See
[usage](STANDALONE.md) and the [changelog](CHANGELOG.md) for supported behavior.

Open issue state was checked on 2026-11-04. Remaining work centers on independent-user
evaluation and findings-based usability fixes (milestone 17), plus constrained
palette-reduction design (#214 in milestone 23). Version 0.36.0 is prepared for
selective MCP pixel cleanup (#218); publication is separate.
Validation gaps live in the [single remaining-check list](VALIDATION.md#remaining-checks).

## Constrained palette reduction (milestone 23)

[#214](https://github.com/cliffom/gbc-scene-forge/issues/214) remains experimental:
separate general automatic refinement from exact-color protection, establish a
bounded contract and evaluate visual tradeoffs before product implementation.
Temporary experiments do not establish that pinning is necessary for readability.

## Existing workflow usability and manual–MCP parity (milestone 17)

[Milestone 17](https://github.com/cliffom/gbc-scene-forge/milestone/17): complete
independent-user evaluation (#165) and findings-based remediation/retesting (#166)
using the [evaluation protocol](evaluations/workflow-usability.md) and maintained
[browser/MCP outcome matrix](AUTHORING-OUTCOMES.md). Participant-dependent
acceptance remains open until observations exist. Preserve browser-only, agent-only
and mixed authoring workflows; publication does not close the milestone.
