# Valibot response-contract adoption

Issue #69 began with `decodeWorldSnapshot()` in `frontend/world/world.mts`.
Following the pilot, adoption now also covers project catalogs and saved scenes
in `frontend/project/project-contracts.mts`. Their structural schemas derive seven
output types: `WorldMarker`, `WorldScene`, `WorldSnapshot`, `Region`, `Atlas`,
`Project` and `Loaded`. Transport and editor lifetime/adoption rules are unchanged.

## Decision and adoption direction

**Adopt Valibot progressively for structured frontend API response contracts.**
Runtime validation and output types now come from the same schemas, so changing a
response field no longer requires maintaining separate structural declarations.
The small shared helpers in `frontend/shared/schema.mts` amortize the compatibility
work established by the pilot across world, catalog and scene responses.

Migration remains incremental. Use schemas for response structure and keep
normalization and cross-field domain rules explicit. Scene dimensions/grid/layer
consistency, flat-scene conversion, animation duration lookup and stamp composition
remain visible in the project contract. The `decoded()` bridge delegates objects,
definitions, tile metadata, palette profiles and authored world metadata to their
existing domain decoders; it does not duplicate their rules. Future conversions
can replace those bridges within their owning domains with focused regression
coverage. There is no reason to migrate transport, cancellation or lifecycle code
to a schema library.

The initial pilot alone did not reduce source lines: its removed interfaces and
decoder occupied 56 lines / 1,466 UTF-8 bytes, versus 56 lines / 1,968 bytes for the
first implementation (excluding the import). Line count alone understates the maintenance benefit of eliminating duplicated
type definitions, and subsequent contracts reuse library code.
No runtime performance improvement is claimed.

## Compatibility and remaining integration

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

The compatibility corpus in `tests/contracts.ts` exercises normalized output,
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

## Bundle measurements

Measured with Node 24.22.1, esbuild 0.28.2, ESM/browser/ES2022, a fixed production
build label of `0.16.0`, source maps enabled, and gzip level 9. Each comparison
uses the same current editor entry and build options, substituting the corresponding world and
project-contract modules for each baseline. Source maps are emitted but excluded from the JS
byte counts. The normal build is not minified; minification is an additional
comparison, not a change to the shipped build configuration.

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
