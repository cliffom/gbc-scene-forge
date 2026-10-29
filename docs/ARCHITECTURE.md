# Python backend ownership

Forge is a standalone authoring application. Its stable boundaries are the CLI,
HTTP and MCP contracts, the project manifest/native Tiled files, and portable
exports. Internal Python module paths are implementation details.

## Domain map

| Package | Owns | Public entry points and tests |
| --- | --- | --- |
| `project` | Workspace/project lifecycle, manifest schema, coherent saved reads, service composition, draft recovery and refresh revisions | `project.application.Project`, `ProjectRoot`, `ProjectStore.read_session`; project/workspace/update tests |
| `scenes` | Scene lifecycle and canonical candidate editing | `SceneService`; scene/project and MCP authoring tests |
| `scene_objects` | Native object/property rules, definitions, reusable stamps and preview preferences | Model/definition functions and `ObjectService`; object/definition/preview/composition tests |
| `artwork` | Atlas intake, images, stable tile identities, metadata and atlas mutations | `ArtworkService`, atlas loading; atlas/project/tile metadata tests |
| `planning` | Blockout geometry/cameras and world layouts/connections | Pure blockout/world rules and `PlanningService`; blockout/world tests |
| `analysis` | Diagnostics, object validation and optional palette-budget reports | `ReportService`; diagnostics/palette/definition tests |
| `formats` | Tiled encoding/decoding and portable export | Tiled functions and export operation; export/Tiled interoperability tests |
| `storage` | Declared paths, file primitives, transaction journal, interrupted-write recovery | `Transactions`; transaction/draft/recovery tests |
| `core` | Shared error classes, validation, serialization, identities and typed boundary records | Small explicit modules; boundary/type checks |
| `adapters` | CLI arguments, HTTP routing/security/responses, MCP schema/resources/error translation and console presentation | Installed entry points and transport tests; browser/installed-wheel acceptance |
| `legacy` | Unsupported connector v1, document/Apply/build integration and its demo | Historical reference only; isolated legacy fixtures/tests |

Domain packages use shared primitives and other domain rules, never transport
adapters. Service modules compose these rules with project persistence.
`project.application.Project` constructs the services; it does not implement their operations. Supported domain package
`__init__` files contain no eager service imports and stay small so importing a
model does not initialize its services.
The sample copier belongs to project lifecycle; its CLI belongs to adapters.

Existing native JSON payloads are intentionally retained at format boundaries. Typed saved-read records describe identity and revision contracts;
this change does not replace the wire format with a parallel class hierarchy.

## Transaction contract

`ProjectStore.read_session()` owns one filesystem lock and yields a read session
with a single validated manifest/revision. Use that session's scene reads when
several files must come from one cooperating-writer snapshot. Do not call a second
locking operation inside a session. Reports revalidate revisions after computation
so non-cooperating edits cannot turn stale results into authoritative reports.

Mutations prepare against an expected manifest and the relevant scene/asset
revisions, then `ProjectStore.commit()` calls the durable transaction journal.
The journal checks all expectations under its own lock before applying any file.
Preparation is optimistic; its checks do not replace the final journal guards.
Save acknowledgments identify the exact bytes committed, never a subsequent
writer's state. Existing manifest, history and checkpoint formats remain intact.

Refresh probes cache bounded hashes for declared files; coherent snapshots share
the saved-read API. Draft checkpoints remain independent of committed history and
can retain stale local work; restoration must validate the original saved base.
Neither a transport nor a report may bypass these rules by reaching into private
storage internals.

## Maintenance and validation

Put a new rule in its domain, a use case in that domain's service, and request
parsing in the adapter. Share operations, not transport capabilities: HTTP and MCP
may expose different subsets without duplicating domain behavior. Keep exceptions
specific internally and translate them at the transport boundary. JSON formatting
and path security have one maintained implementation.

Run `make lint test build check-dist`, full browser acceptance, and optional-SDK
MCP tests/browser acceptance. The Python compatibility matrix installs the built
wheel on 3.10–3.14. Scoped mypy checks cover shared primitives and saved-read
contracts; dynamic domain payloads retain their existing runtime validation until
there is a concrete reason to expand the typed boundary. No runtime dependency or
project migration is introduced. See [RELEASING.md](RELEASING.md).

Legacy code remains isolated for source reference and existing independent
fixtures, not as a compatibility requirement. Supported imports and launchers
must not import it. The root `__main__` and `mcp_server` modules are intentionally
thin, stable module launchers. Do not move domain logic back into the old flat module layout
or add connector compatibility shims.

The companion [frontend architecture](FRONTEND-ARCHITECTURE.md) describes the supported
browser composition, state owners, controller ports and resource lifecycle.
