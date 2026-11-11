# Roadmap

Current baseline: standalone portable Tiled authoring with imported/native artwork,
editable tile and sprite sheets, native animation, scene/artwork documents,
artwork-free blockouts, optional MCP and conflict-aware recovery. See
[usage](STANDALONE.md) and the [changelog](CHANGELOG.md) for supported behavior.

Open issue state was checked on 2026-11-05. Remaining work centers on independent-user
evaluation and findings-based usability fixes (milestone 17), focused artwork setup
and agent-draft presentation (#237), and constrained palette-reduction design
(#214 in milestone 23).
Validation gaps live in the [single remaining-check list](VALIDATION.md#remaining-checks).

## Self-contained Codex authoring plugin (milestone 25)

[Milestone 25](https://github.com/cliffom/gbc-scene-forge/milestone/25) aims for
task-based onboarding to Forge's design tools through a self-contained local
plugin. The [runtime feasibility investigation](evaluations/plugin-feasibility.md)
informs packaging and explicit project selection; native client visual acceptance
remains an initial gate. Issue branches and PRs use
`milestone/25-codex-authoring-plugin` as their base. Prepare the integration PR to
`main` only after milestone completion; issue PRs do not publish milestone releases.

## Editor discovery, scope and working space (milestone 24)

[Milestone 24](https://github.com/cliffom/gbc-scene-forge/milestone/24) follows the
[November baseline](evaluations/usability-review-2026-11.md). The focused #237
follow-up separates creation, saved artwork and unpublished agent drafts after
direct feedback on the current setup presentation. Integrated synthetic validation
belongs to #224; independent discovery observations and participant-supported follow-up remain
#165/#166. See the [validation record](VALIDATION.md) for measured scope and limits.

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
