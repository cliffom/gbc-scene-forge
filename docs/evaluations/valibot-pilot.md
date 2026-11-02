# Valibot response-contract adoption

Issue #69 began with `decodeWorldSnapshot()` in `frontend/world/world.mts`.
Following the pilot, adoption now also covers project catalogs and saved scenes
in `frontend/project/project-contracts.mts`. Their structural schemas derive seven
output types: `WorldMarker`, `WorldScene`, `WorldSnapshot`, `Region`, `Atlas`,
`Project` and `Loaded`. Issue #75 extends this foundation to object properties,
scene objects, definitions, collision/tile metadata and palette/hardware profiles.
Transport and editor lifetime/adoption rules are unchanged.

## Decision and adoption direction

**Adopt Valibot progressively for structured frontend API response contracts.**
Runtime validation and output types now come from the same schemas, so changing a
response field no longer requires maintaining separate structural declarations.
The small shared helpers in `frontend/shared/schema.mts` amortize the compatibility
work established by the pilot across world, catalog and scene responses.

Migration remains incremental. Use schemas for response structure and keep
normalization and cross-field domain rules explicit. Scene dimensions/grid/layer
consistency, flat-scene conversion, animation duration lookup and stamp composition
remain visible in the project contract. Project contracts now compose the migrated
domain schemas directly. Three justified `decoded()` integrations remain: authored
world metadata, region-dependent animation manifests and stamp composition. Their
decisions and revisit conditions are recorded below. There is no reason to migrate
transport, cancellation or lifecycle code to a schema library.

## Bounded domain adoption (#75)

This inventory closes the response-contract migration scope for the 0.25.1
maintenance release. It is not a mandate to convert every primitive check.
No additional implementation issues are required. Future changes should revisit
the relevant row when its stated trigger occurs, with ownership remaining in the
domain. The inventory covers supported frontend response reads as of baseline
`6f637da74e5378eaab6d1a1ae03c57585ff6da3b`; historical connector code is excluded.

### Adopted contracts

The recommended order was preserved in separate commits: objects/properties
`d10a250`, definitions `cf6efb2`, metadata `05a0501`, profiles `14e792c`, then project
composition `6842b05`. Each public decoder still calls the shared first-error
parser. Eight output type declarations now derive from schemas: `ObjectProperty`,
`SceneObject`, `DefinitionField`, `ObjectDefinition`, `CollisionShape`,
`TileMetadata`, `MetadataSets` and `PaletteProfile`.

| Owner and callers | Previous duplication; normalization and rules retained | Coverage; benefit and effort |
| --- | --- | --- |
| [Objects](../../frontend/objects/objects.mts): saved scenes, object inspector, definition defaults | Property union and scene object shape repeated response decoding. Finite wire numbers remain broader than safe-integer authoring values. Numeric wire IDs become editor strings; missing kind means sprite, explicit `sprite` is rejected. Nullish names/class/properties default; definition/origin are absent only when undefined. Origin elements precede length and asset checks. Unknown fields drop. | New differential corpus, contracts/model/compositions/definitions and standalone acceptance. Inferred discriminated unions keep callers synchronized; medium effort because dispatch/error order is conditional. |
| [Definitions](../../frontend/objects/object-definitions.mts): catalog, definition editor and instance resolution | Field/library declarations repeated parsing. Undefined library defaults to empty; version 1 only. Kind/type precede identity/name checks. Height is read only with width. Defaults reuse property decoding before bounds/choices. Inheritance and retained overrides stay in `resolveDefinition`. | Differential corpus, definitions model/browser and blockout acceptance. Field/library types now follow structure; medium effort for conditional dimensions/defaults. Form-only `objectKind`/`fieldType` helpers retain their distinct error contract. |
| [Tile metadata](../../frontend/artwork/tile-metadata.mts): catalog, tile inspector, terrain and preview collision queries | Collision union, metadata and nested dictionary declarations repeated parsing. Terrain mask remains optional and finite; shape IDs precede kind, coordinates precede length checks. Nullish sets default to empty. Both dictionary levels retain every own key via `jsonDictionary`. Geometry, terrain ranges, unique IDs and polygon intersections remain authoring validation. | Differential corpus, terrain/model, terrain/standalone browser and preview models. One inferred collision union and metadata structure; medium effort for variant dispatch. |
| [Palette budgets](../../frontend/diagnostics/palette-budget.mts): catalog and budget panel form | Palette/hardware structure repeated interface fields. Nullish profile is disabled; versions 1/2 only. Version 1 ignores hardware. Version 2 layout precedes palette reservations, then hardware reservations. Unsupported ID short circuits sprite-height validation. Nullable finite integer slot limits stay 8/256/40. | Differential corpus, catalog, diagnostics browser and backend budget tests. Inferred hardware layout/profile prevents response type drift; medium effort for staged error order. |

Authoring models remain intentional: `NewObject` is input before an ID exists and
uses editor kinds; `SceneLayer`, native scene/draft/composition models, world
connections, preview state and form models represent edits rather than wire
validation. Do not infer these from raw wire inputs or move them into `shared/`.
Response-derived outputs may still be edited where structurally appropriate.

### Retained contracts and concrete revisit conditions

These are affirmative retain decisions, not unfinished migrations. Effort estimates
are relative implementation/compatibility effort, not calendar promises. No contract
is deferred without an owner or an identified trigger.

| Owner and callers | Structure, normalization/cross-field behavior and existing coverage | Decision, benefit/effort and revisit condition |
| --- | --- | --- |
| [Authored world](../../frontend/world/world.mts), `decodeWorld` bridge in project catalog | Small independent `World`/`Connection`/`Endpoint` authoring models; undefined default, version gate, position dictionaries, direction before identity, endpoint finite numbers. World model/contracts and world browser tests cover endpoint diagnostics and navigation. | **Retain.** Schema inference would couple authoring types to a small separate wire contract; medium effort, limited current reduction. Revisit when adding a world format/version or a second consumer requiring the same response-only structure. World-report snapshots already use schemas. |
| [Preview settings](../../frontend/preview/preview-settings.mts), workspace restore and animation preview | Independent persisted preference/editable state model, footprint checked before selections, selection dispatch before numeric defaults/mappings, pruning stays separate. Animation/movement model and standalone browser tests cover restore/pruning/collision behavior. Existing selection dictionary assignment semantics, including special keys, are unchanged. | **Retain.** Medium effort to preserve unusual order and dictionary behavior; no shared response type to remove. Revisit with a preference format change or second persisted-preference reader; establish a differential corpus before changing special-key behavior. |
| [Project manifest bridge](../../frontend/project/project-contracts.mts), catalog atlas animation normalization | `manifestSchema(regions)` supplies inferred region/frame shapes, but frame durations depend on sibling region lookup; validates region array before nested animation errors. Catalog contracts and animation/standalone tests cover fallback and errors. | **Retain** the integration, not duplicate validation. Replacing the bridge adds no structural benefit; low effort. Revisit when animation wire duration lookup changes or a standalone animation response needs reuse. |
| [Project stamp bridge](../../frontend/project/project-contracts.mts), catalog/compositions | Reuses saved-scene decoding, then composes native stamp payload with slots; scene-envelope failure precedes stamp identity/slots. No independent response interface. Contracts/compositions models and compositions browser cover it. | **Retain.** Low benefit/medium effort; reuse the owning scene decoder rather than copy it. Revisit if stamps gain their own response-only version/shape. |
| [Diagnostics view](../../frontend/diagnostics/diagnostics-view.mts) and [palette report rendering](../../frontend/diagnostics/palette-budget.mts), panels | Inline report/findings/pools/hardware/contributor checks and navigation; no separately declared complete wire report type. Presentational defaults and user-facing strings interleave with decoding. Backend diagnostics/budget and diagnostics browser tests cover reports and stale adoption. | **Retain.** High effort to extract a whole report while preserving rendering/error order, little duplicated type removal today. Revisit when a second frontend report consumer needs a reusable typed response, or report versioning changes. |
| [Artwork import](../../frontend/artwork/generic-import.mts) and [artwork editor](../../frontend/artwork/editor-artwork.mts), import/reimport dialogs | Inline preview counts/dependencies/errors, change lists and mutation revision reads; atlas manifest authoring parser in `atlas-import.mts` is separate from API response decoding. Atlas-import models, imports/standalone/terrain browser checks cover them. | **Retain.** Low structural duplication/medium effort; a new reusable import report or report-version change is the trigger to extract an owning schema. Keep user-supplied manifest authoring checks separate. |
| [Workspace](../../frontend/project/editor-workspace.mts), root/project catalogs, choices, unavailable entries and creation/deletion replies | Inline labels/identities/paths/revisions around `decodeProject`; no duplicate full wire interfaces. First-use, standalone and lifecycle browser checks, backend root/project tests. | **Retain.** Medium effort, little current type deletion. Revisit when root/choices responses gain a shared frontend consumer or versioned envelope. |
| [Recovery](../../frontend/project/editor-recovery.mts), [refresh](../../frontend/project/editor-refresh.mts), [scene actions](../../frontend/scene/editor-scene-actions.mts), [panels](../../frontend/editor/editor-panels.mts), [composition actions](../../frontend/editor/editor-compositions.mts), [editor startup](../../frontend/editor/project-editor.mts) | Inline draft lists, revision probes, snapshot/mutation acknowledgments (including stamp save/delete) and grid/zoom preferences; nested project/scene payloads delegate to their owning decoders. Identity/revision correlation, stale adoption and lifetime checks are stateful rules. Draft/contracts model tests and drafts/lifecycle/refresh browser tests cover them. | **Retain.** Small acknowledgments have no duplicate structural models; extracting the aggregate flows is high effort and outside response migration. Revisit when an acknowledgment is consumed in multiple domains or a new response envelope is introduced. Preserve correlation checks outside schemas. |
| [Blockout review](../../frontend/blockout/blockout-view.mts), review dialog | Inline SVG strings, dimensions, camera properties and revision identities; authoring camera-axis rules remain separate. Backend blockout and blockout browser cover the path. | **Retain.** Single reader, no duplicate full report declaration; medium effort. Revisit with a second review-report consumer or a versioned report change. |
| [HTTP errors](../../frontend/project/project-api.mts), native fetch adapter | Single `error` string check plus status, mandatory callbacks and mutation token. Contract/API and browser checks cover failure paths. | **Retain.** One scalar check has no structure to consolidate; low effort/no benefit. Revisit if the server introduces a typed multi-field error envelope. |

### Compatibility corpus and reproducibility

Before replacements, `9b55e28` established the
[domain corpus](../../tests/frontend/project/domain-contracts.ts) against baseline
`6f637da74e5378eaab6d1a1ae03c57585ff6da3b`. The expanded final corpus contains
7,655 cases across eight decoder boundaries, including scene/catalog integration.
It generates single-field substitutions at nested paths and explicit multi-error
cases: absent versus explicit undefined/null, variants/versions, finite/safe-integer
boundaries, negative zero, invalid booleans, conditional dimensions/origins/defaults,
unknown fields and special keys at both metadata dictionary levels. Both original
and candidate run against the same locked Valibot/runtime. Output structures and
first error messages compare exactly, and both inputs must remain unmodified on
success or rejection. Candidate frontend revision: `6842b05`.

Ordinary tests pin a canonical SHA-256 fingerprint of all original outcomes,
including undefined and negative zero, so archives without Git still check
regressions. On a mismatch, use differential mode for the decoder/case index.
Update corpus expectations only after comparing the relevant baseline; a hash
pass alone does not establish a new contract. JSON payloads plus explicit
non-finite/undefined numeric probes are in scope; sparse arrays, custom prototypes,
getters and other non-JSON side effects are outside it.

```sh
FORGE_CONTRACT_BASELINE=6f637da74e5378eaab6d1a1ae03c57585ff6da3b \
  make test-frontend-domain-contracts
```

The Courtyard integration smoke uses normal project sample copying and Tiled
loading, leaving the tracked demo unchanged. After the corpus has created its
ignored output directory, reproduce with:

```sh
.venv/bin/python - <<'PY'
import json
import tempfile
from pathlib import Path
from gbc_scene_forge.project.application import Project
with tempfile.TemporaryDirectory() as folder:
    project = Project.from_sample(Path(folder) / 'demo')
    Path('build/contracts-compat/courtyard.json').write_text(json.dumps({
        'catalog': project.catalog()['project'],
        'scene': project.scenes.load('694f19d2-ce59-4263-87f0-3d517f329434'),
    }))
PY
FORGE_CONTRACT_DEMO=build/contracts-compat/courtyard.json \
  make test-frontend-domain-contracts
```

The smoke asserts tile/object layer loading, sprite/point/rectangle kinds, custom
properties and atlas catalog adoption. Definitions/inheritance, terrain rules,
budgets, preview and world tests supplement these synthetic structural probes.

### Current cumulative and marginal cost

Measured locally on 2026-11-01 with Node 24.22.1, esbuild 0.28.2 and Valibot 1.5.0,
using the full editor entry, ESM/browser/ES2022, minification, source maps excluded
from byte counts, gzip level 9 and fixed production label `0.25.1` for every row.
Each revision supplies all frontend modules against the same locked dependencies.
Git must contain these PR commits to reproduce intermediate stages; the source
archive supports `WORKTREE` measurements and the pinned corpus without Git.

| Stage/revision | Minified JS | Gzip | Marginal JS / gzip |
| --- | ---: | ---: | ---: |
| Current pre-#75 baseline `6f637da` | 238,560 B | 74,124 B | — |
| Objects `d10a250` | 239,008 B | 74,238 B | +448 / +114 B |
| Definitions `cf6efb2` | 239,645 B | 74,463 B | +637 / +225 B |
| Metadata `05a0501` | 239,621 B | 74,381 B | −24 / −82 B |
| Profiles `14e792c` | 239,954 B | 74,476 B | +333 / +95 B |
| Direct composition `6842b05` | 239,845 B | 74,432 B | −109 / −44 B |

Cumulative #75 cost is **+1,285 B minified / +308 B gzip (0.42%)**. The five
affected source modules together change from 1,183 lines / 41,702 UTF-8 bytes to
1,217 lines / 42,910 bytes: **+34 lines / +1,208 bytes**, despite removing eight
independent output declarations and four transitional domain bridges. This is a
maintenance/ownership improvement, not a source-size or runtime-speed claim.
Dispatch, optional-field omission, normalization and staged layout checks remain
explicit compatibility integration. Shared helpers and dependency versions are
unchanged. Historical pilot numbers below are context, not this baseline.

```sh
node tests/support/measure_contracts.ts \
  6f637da d10a250 cf6efb2 05a0501 14e792c 6842b05
```

Use `WORKTREE` as a final argument to measure subsequent changes with the same
label. Tests, browser/package evidence and limits are owned by the
[validation record](../VALIDATION.md#domain-response-contract-foundation-75).

The initial pilot alone did not reduce source lines: its removed interfaces and
decoder occupied 56 lines / 1,466 UTF-8 bytes, versus 56 lines / 1,968 bytes for the
first implementation (excluding the import). Line count alone understates the maintenance benefit of eliminating duplicated
type definitions, and subsequent contracts reuse library code.
No runtime performance improvement is claimed.

## Initial pilot compatibility

The existing `decodeWorldSnapshot`, `decodeProject` and `decodeLoaded` callback
boundaries stay intact. Valibot validates the nested shapes; the model still owns the revision rename and marker
visibility normalization. Parsing aborts on the first issue, preserving field
order and the existing user-visible error messages.

Two default library behaviors differ from the old JSON decoder:

- `object()` accepts arrays as objects and reports missing keys separately from
  value errors. The shared `jsonObject()` helper first uses the existing
  JSON `record()` check, then projects known keys (including missing values as
  `undefined`) before schema validation. This keeps array rejection, missing-field
  messages and unknown-field removal. The helper is reused by the migrated contracts.
- `record()` filters certain dictionary keys. Dictionary entries are instead
  validated as string tuples and rebuilt with `Object.fromEntries()`, preserving
  every own key, including `__proto__`, without assigning through a prototype setter.

World-marker missing/non-true visibility remains `false`; only literal `true` becomes `true`.
Numeric fields retain finite-number checks and existing scene integer/range rules.
Unknown fields are dropped at each structured level. The parser returns new
structures without mutating the response. Cross-scene endpoint diagnostics remain
in the existing domain code.

The compatibility corpus in `tests/frontend/project/contracts.ts` exercises normalized output,
missing fields, nested malformed data, non-finite numbers, special revision keys,
first-error behavior, scene defaults, atlas mappings/animation fallbacks and stamp
composition. The same assertions were also run against the original decoders
bundled from the base commit; both passed. The scope is JSON response
payloads, plus explicit non-finite-number rejection, rather than arbitrary JS
objects with side effects or sparse arrays.

## Dependency assessment

Valibot **1.5.0** is pinned in `package.json` and `package-lock.json`. Official
[package metadata](https://registry.npmjs.org/valibot/1.5.0) declares MIT licensing,
ESM/CJS exports and an optional TypeScript >=5 peer; Forge uses TypeScript 5.9.3
and its existing ESM/esbuild pipeline. There are **no transitive runtime npm
dependencies**. The [release history](https://github.com/open-circle/valibot/releases)
shows stable 1.x releases from March 2025 through the September 9, 2026 release of
1.5.0. This is evidence of current maintenance, not a guarantee of future API
stability; keep updates deliberate and run the compatibility corpus on upgrades.

The [object documentation](https://valibot.dev/guides/objects/),
[record documentation](https://valibot.dev/api/record/) and
[type inference guide](https://valibot.dev/guides/infer-types/) describe the
relevant library behavior. Zod Mini remains a credible alternative, but adding a
second implementation to this pilot would not resolve its main cost: preserving
Forge's established boundary behavior.

Valibot is a **bundled browser dependency**, not a Python runtime dependency.
Node/npm are needed to develop or rebuild the editor. Esbuild includes the used
functions in the self-contained editor bundle; there is no runtime CDN/package
import. The installed Python application still needs no Node or npm. The full MIT
notice is included in `static/third-party-notices.txt` in both distributions;
installed-wheel smoke tests check its presence. Existing esbuild/TypeScript and
lint tools remain development dependencies. npm's lockfile marks TypeScript as
`devOptional` because it also satisfies Valibot's optional peer.

## Historical pilot bundle measurements

Measured with Node 24.22.1, esbuild 0.28.2, ESM/browser/ES2022, a fixed production
build label of `0.16.0`, source maps enabled, and gzip level 9. Each comparison
uses the same current editor entry and build options, substituting the corresponding world and
project-contract modules for each baseline. Source maps are emitted but excluded from the JS
byte counts. At the time of this evaluation the normal build was not minified; minification
was an additional comparison. Since 0.16.2, production builds are minified; see
[build identity](../RELEASING.md#ui-build-identity).

| Editor JavaScript | Before Valibot | Initial world pilot | World + catalog + scenes |
| --- | ---: | ---: | ---: |
| Normal bundle | 388,000 B | 399,511 B | 402,115 B |
| Normal bundle, gzip | 86,146 B | 88,595 B | 88,930 B |
| Minified bundle | 216,826 B | 221,831 B | 223,248 B |
| Minified bundle, gzip | 67,250 B | 68,813 B | 69,200 B |

The complete migration adds 2,784 bytes gzip (3.23%) to the normal editor bundle
relative to the original implementation, or 1,950 bytes gzip (2.90%) minified.
Extending the initial pilot adds only 335 / 387 gzip bytes respectively. These are
complete editor measurements, not the package's unpacked size or an advertised
minimal schema example. The marginal cost supports progressive adoption rather
than treating the initial library cost as a charge repeated for every contract.

Reproduce from this checkout after `npm ci` (Git must contain the base commit):

```sh
node --input-type=module <<'JS'
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { dirname, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
for (const minify of [false, true]) {
  for (const ref of [
    '2c023fe52e39576ca9115bfed49422bc6a192c25', // Before Valibot
    '1890a98d370024ead89f2d95cf18f098ccf2a671', // Initial world pilot
    null, // Current checkout
  ]) {
    const result = await build({
      entryPoints: ['frontend/project.ts'], bundle: true, format: 'esm',
      platform: 'browser', target: 'es2022', sourcemap: true, outfile: 'project.js',
      write: false, minify,
      define: { __FORGE_BUILD_LABEL__: JSON.stringify('0.16.0') },
      plugins: ref ? [{ name: 'baseline-contracts', setup(build) {
        build.onLoad({ filter: /[/\\](world|project-contracts)\.mts$/ }, ({ path }) => ({
          contents: execFileSync('git', ['show', `${ref}:${relative(process.cwd(), path)}`],
            { encoding: 'utf8' }),
          loader: 'ts', resolveDir: dirname(path),
        }));
      } }] : [],
    });
    const js = result.outputFiles.find((file) => file.path.endsWith('/project.js')).contents;
    console.log({ ref: ref ?? 'current', minify, bytes: js.length,
      gzipBytes: gzipSync(js, { level: 9 }).length });
  }
}
JS
```

Validation gates are `make lint test build check-dist`, world/standalone browser
acceptance and existing disposal/refresh checks. Build tests verify Valibot is
bundled and source-mapped; installed-wheel checks verify notices and assets.
This behavior-preserving migration is included in the explicitly requested
0.16.1 maintenance release. The measurements above retain a fixed 0.16.0 label
for comparison with the original implementation and initial pilot.
