# Scene Forge 0.12.0

Author saved projects through a local Model Context Protocol (MCP) interface.
This release completes [#51](https://github.com/cliffom/gbc-scene-forge/issues/51)
with an optional stdio server, native authoring tools and a reproducible real-client
blockout example built on #46.

- Discover declared projects, scenes, imported assets, definitions, stamps and
  world data. Create projects and scenes, edit native content, and manage typed
  definitions, reusable stamps and world layout through existing project services.
- Place, update, duplicate or delete objects in bounded atomic batches. Inspect
  dry-run candidates and before/after summaries before saving with expected revisions.
- Retrieve revision-matched full-route and camera SVG previews, structured
  diagnostics, opt-in palette reports and portable Tiled ZIP exports.
- Keep browser drafts and Undo independent. Concurrent saved edits retain conflict
  checks and recoverable drafts; agent writes use native durable transactions.
- Follow the documented SDK-client example to create the opening forest, revise
  three objects, review two camera views, reopen and verify exported geometry,
  definitions, typed properties and stable identities. Add artwork later without
  replacing the plan.

The ordinary offline browser editor retains no required runtime Python dependencies.
Install the optional extra only when using MCP:

```sh
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.12.0'
gbc-scene-forge-mcp --project-root /absolute/path/to/projects
```

For browser-only authoring:

```sh
python -m pip install --upgrade gbc-scene-forge==0.12.0
gbc-scene-forge
```

See [Local MCP authoring](MCP.md) for client setup, tool schemas, authorization,
limits, draft/revision handling, deferred capabilities and the reproducible example.
The server is local stdio only; artwork import and several convenience operations
remain browser workflows. Planning previews do not simulate game physics or certify
hardware fit. Existing projects keep manifest format version 1.
