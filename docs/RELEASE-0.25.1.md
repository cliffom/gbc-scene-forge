# Scene Forge 0.25.1

This maintenance release establishes domain-owned response schemas for object
properties and scene objects, object definitions, tile/collision metadata and
palette/hardware profiles. Project catalogs and saved scenes compose those schemas
directly, reducing the independent structures future fixes must keep synchronized.
It resolves [#75](https://github.com/cliffom/gbc-scene-forge/issues/75).

Existing decoder callbacks, accepted inputs, defaults, error messages/order,
normalization and authoring rules remain compatible. Project, Tiled and draft
formats are unchanged; no migration is required. HTTP transport, editor lifetime,
revision/conflict protection and browser navigation retain their existing owners.

The [contract inventory](evaluations/valibot-pilot.md#bounded-domain-adoption-75)
documents deliberate retain decisions and concrete revisit conditions for world
metadata, preview preferences, reports and small acknowledgments. Future contract
changes have a reusable differential corpus and a production bundle measurement
command; see [frontend guidance](FRONTEND-ARCHITECTURE.md#response-schemas) and the
[validation record](VALIDATION.md#domain-response-contract-foundation-75).

Install with `python -m pip install --upgrade gbc-scene-forge==0.25.1`;
include `[mcp]` for optional MCP tools. Valibot remains pinned at 1.5.0 and bundled
with its existing license notice. Installed editors require neither Node/npm nor
runtime package/CDN access. This prepares 0.25.1; tagging and publication are
separate steps.
