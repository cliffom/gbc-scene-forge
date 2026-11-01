# Documentation policy

Keep each record with its owner:

| Record | Owns | Excludes |
| --- | --- | --- |
| [Changelog](CHANGELOG.md) and `RELEASE-<version>.md` notes | Release changes, upgrade and compatibility boundaries | Test diaries and outstanding validation tasks |
| [Validation](VALIDATION.md) | Scoped observations, evidence links, failures, limitations and one Remaining checks list | Conversational development history and repeated feature descriptions |
| [Roadmap](ROADMAP.md) | Current baseline, open priorities and intended outcomes | Delivered release history and duplicate validation checklists |
| [Releasing](RELEASING.md) | Current build, verification and publication procedures | Per-release implementation history |
| User guides and architecture docs | Current usage, contracts and ownership | Rolling progress logs |
| Evaluations and coverage inventories | Detailed methods, raw tables, design decisions and provenance | A second validation task ledger |

## Evidence and historical records

Each level-two validation entry requires exactly four nonempty bullet fields in
this order: **Scope**, **Method**, **Result**, **Limits**. Scope identifies the
version/revision, date and environment actually known. State missing provenance
explicitly; never invent a revision or imply that historical checks ran again.
Method distinguishes synthetic automation, service measurements, human inspection
and user reports. Result reports what happened, including material failures.
Limits describes untested cases, unavailable tools and the bounds of each claim.

Preserve attribution, revision hashes, evidence links, material regressions and
historical compatibility boundaries when condensing records. Link the original
committed record for traceability. A local pass report or ignored `build/` path
is not an archived artifact or independently inspectable CI result. Link a specific
CI run when making a CI-pass claim. Technical evaluations may retain detailed
measurements; validation links to them and states their scope and limits.

Maintain outstanding validation tasks only under **Remaining checks** in
`VALIDATION.md`, grouping by issue where applicable. Closing an issue, publishing
a release or having an automated test does not complete an unperformed human or
external-tool check. Keep unavailable checks unchecked. Do not confuse a proposed
optimization with implemented behavior or a static budget with runtime proof.

## Checks and review

Run `make docs-check` for every change. It checks repository Markdown links and
Markdown heading anchors, direct documentation-index coverage, required policy
links, ordered evidence fields, checklist ownership, unique versioned release
headings with matching release-note files, and release history kept out of the
roadmap and release procedure. Fenced examples do not count as prose or evidence.
New Markdown files, including untracked files, are included in checkout checks;
ignored build outputs and dependency trees are excluded.

Review remains responsible for accuracy, concision, evidence quality and issue
state. The checker does not certify claims, fetch external URLs or measure product
behavior. Documentation-only validation belongs in the change/PR report; it does
not warrant a product-validation entry, a version bump or new UI screenshots.
User-visible changes require appropriate guide updates and actual UI inspection;
report the viewports/states checked and remaining gaps.
