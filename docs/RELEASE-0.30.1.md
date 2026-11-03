# Scene Forge 0.30.1

Prepared patch release for clearer artwork save scope and the existing browser/MCP
handoff. Publication is separate.

## Changes

- New independent artwork review explains that Confirm save adds a Library entry
  and placement is separate; shared edits and selected variations retain their
  distinct reference consequences.
- Review exposes affected scene names/counts and a bounded list of saved source
  locations. It explicitly labels incomplete location pages, while the scene
  summary includes every affected scanned scene.
- The disabled shared-edit command for imported artwork is associated with its
  editable-copy explanation and has a contextual tooltip.
- Checkpoint messages distinguish saved content from unsaved artwork when
  reviewing an untouched original or undoing back to its saved base.
- The maintained [outcome matrix](AUTHORING-OUTCOMES.md) documents browser/MCP
  routes, saved/candidate boundaries, limits and intentional or missing capabilities.
  The [evaluation protocol](evaluations/workflow-usability.md) supports future
  independent-user sessions without claiming that synthetic checks replace them.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.30.1
# Optional local stdio server:
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.30.1'
```

Existing projects need no migration. Portable formats, exact RGBA and timing,
revision guards, review receipts, local histories and recovery boundaries are
retained. This release adds no MCP tools or unpublished-candidate browser inbox.
Milestone 17's independent-user evaluation and participant-dependent remediation
remain open; release preparation does not imply completion of those tasks.

Checks and limitations belong in [Validation](VALIDATION.md); current priorities
belong in the [roadmap](ROADMAP.md).
