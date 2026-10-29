# Valibot response-contract pilot

Issue #69 follows the selective dependency evaluation in #67. This pilot changes
only `decodeWorldSnapshot()` and its three output types in
`frontend/world/world.mts`. The world-report response has nested scenes, markers
and findings, a revision dictionary, missing visibility defaults and a wire-to-model
rename. Existing world metadata, scene/catalog decoders, HTTP transport and editor
lifetime/adoption rules remain unchanged.

## Decision

**Adopt the bounded pilot; defer a broad conversion of existing contracts.**
Schemas now define both runtime validation and `WorldMarker`, `WorldScene` and
`WorldSnapshot` through `InferOutput`. The three handwritten type declarations
are gone. Required fields and nested shapes can be edited in one place, with
strict TypeScript checking the consumers.

This is a modest maintenance improvement, not an overall source-size reduction.
At base commit `2c023fe52e39576ca9115bfed49422bc6a192c25`, the replaced interfaces
and decoder occupied 56 lines / 1,466 UTF-8 bytes; the replacement schemas, private
compatibility helper, inferred types and decoder occupy 56 lines / 1,968 bytes
(excluding the new import). Compatibility code offsets the removed traversal and
type declarations. No claim of a runtime performance improvement is made.

Keep the remaining small decoders until a new or substantially revised response
can show a clearer benefit. A separately scoped follow-up could evaluate the
catalog's nested atlas/animation contract, including its normalization rules and
error ordering. It should repeat these compatibility and bundle measurements;
this pilot does not authorize that migration or a shared schema framework.

## Compatibility and remaining integration

The existing `(unknown) => WorldSnapshot` decoder boundary stays intact. Valibot
validates the nested shapes; the model still owns the revision rename and marker
visibility normalization. Parsing aborts on the first issue, preserving field
order and the existing user-visible error messages.

Two default library behaviors differ from the old JSON decoder:

- `object()` accepts arrays as objects and reports missing keys separately from
  value errors. The private `snapshotObject()` helper first uses the existing
  JSON `record()` check, then projects known keys (including missing values as
  `undefined`) before schema validation. This keeps array rejection, missing-field
  messages and unknown-field removal. It is local to this response contract.
- `record()` filters certain dictionary keys. Revision entries are instead
  validated as string tuples and rebuilt with `Object.fromEntries()`, preserving
  every own key, including `__proto__`, without assigning through a prototype setter.

Missing/non-true visibility remains `false`; only literal `true` becomes `true`.
Numeric fields remain finite numbers without introducing new integer/range rules.
Unknown fields are dropped at each structured level. The parser returns new
structures without mutating the response. Cross-scene endpoint diagnostics remain
in the existing domain code.

The compatibility corpus in `tests/contracts.ts` exercises normalized output,
missing fields, nested malformed data, non-finite numbers, special revision keys
and first-error behavior. The same assertions were also run against the original
decoder bundled from the base commit; both passed. The scope is JSON response
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
uses the same current editor entry and build options, substituting only the base
world module for the baseline. Source maps are emitted but excluded from the JS
byte counts. The normal build is not minified; minification is an additional
comparison, not a change to the shipped build configuration.

| Editor JavaScript | Before | Pilot | Increase |
| --- | ---: | ---: | ---: |
| Normal bundle | 388,000 B | 399,511 B | 11,511 B (2.97%) |
| Normal bundle, gzip | 86,146 B | 88,595 B | 2,449 B (2.84%) |
| Minified bundle | 216,826 B | 221,831 B | 5,005 B (2.31%) |
| Minified bundle, gzip | 67,250 B | 68,813 B | 1,563 B (2.32%) |

These are complete editor bundle measurements, not the package's unpacked size
or an advertised minimal schema example. They support keeping this bounded pilot,
but do not justify converting all decoders solely to reduce lines of code.

Reproduce from this checkout after `npm ci` (Git must contain the base commit):

```sh
node --input-type=module <<'JS'
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
const oldWorld = execFileSync('git', [
  'show', '2c023fe52e39576ca9115bfed49422bc6a192c25:frontend/world/world.mts',
], { encoding: 'utf8' });
for (const minify of [false, true]) {
  for (const baseline of [true, false]) {
    const result = await build({
      entryPoints: ['frontend/project.ts'], bundle: true, format: 'esm',
      platform: 'browser', target: 'es2022', sourcemap: true, outfile: 'project.js',
      write: false, minify,
      define: { __FORGE_BUILD_LABEL__: JSON.stringify('0.16.0') },
      plugins: baseline ? [{ name: 'baseline-world', setup(build) {
        build.onLoad({ filter: /[/\\]world\.mts$/ }, ({ path }) => ({
          contents: oldWorld, loader: 'ts', resolveDir: dirname(path),
        }));
      } }] : [],
    });
    const js = result.outputFiles.find((file) => file.path.endsWith('/project.js')).contents;
    console.log({ baseline, minify, bytes: js.length,
      gzipBytes: gzipSync(js, { level: 9 }).length });
  }
}
JS
```

Validation gates are `make lint test build check-dist`, world/standalone browser
acceptance and existing disposal/refresh checks. Build tests verify Valibot is
bundled and source-mapped; installed-wheel checks verify notices and assets.
This behavior-preserving pilot keeps package/runtime version 0.16.0 under the
internal-refactor policy; a future release must choose an unpublished version.
