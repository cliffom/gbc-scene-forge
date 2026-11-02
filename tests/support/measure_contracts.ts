/** Full-editor production costs at successive contract revisions; no generated assets changed. */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const sources = [
  'frontend/objects/objects.mts',
  'frontend/objects/object-definitions.mts',
  'frontend/artwork/tile-metadata.mts',
  'frontend/diagnostics/palette-budget.mts',
  'frontend/project/project-contracts.mts',
];
const refs = process.argv.slice(2);
if (!refs.length) {
  throw Error('Usage: node tests/support/measure_contracts.ts BASE_REF [STEP_REF ... WORKTREE]');
}
for (const ref of refs) {
  const contents = async (path: string) =>
    ref === 'WORKTREE'
      ? readFile(path, 'utf8')
      : execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  const result = await build({
    entryPoints: ['frontend/project.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    outfile: 'project.js',
    write: false,
    minify: true,
    define: { __FORGE_BUILD_LABEL__: JSON.stringify('0.25.1') },
    plugins: [
      {
        name: 'revision',
        setup(build) {
          build.onLoad({ filter: /[/\\]frontend[/\\].*\.(mts|ts)$/ }, async ({ path }) => ({
            contents: await contents(relative(process.cwd(), path)),
            loader: 'ts',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  const js = result.outputFiles.find((file) => file.path.endsWith('/project.js'));
  if (!js) {
    throw Error('Missing editor bundle');
  }
  const source = (await Promise.all(sources.map(contents))).join('');
  console.log(
    JSON.stringify({
      ref,
      bytes: js.contents.length,
      gzipBytes: gzipSync(js.contents, { level: 9 }).length,
      sourceLines: source.split('\n').length - 1,
      sourceBytes: Buffer.byteLength(source),
    }),
  );
}
