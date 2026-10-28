/** Freeze build identity into the browser bundle, including in installed distributions. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const mode = process.env.FORGE_BUILD_MODE ?? 'development';
if (!['development', 'production'].includes(mode)) {
  throw Error('FORGE_BUILD_MODE must be development or production');
}
const metadata = await readFile('pyproject.toml', 'utf8');
const version = /^version = "([^"]+)"$/m.exec(metadata)?.[1];
if (!version) {
  throw Error('Missing project version in pyproject.toml');
}
let label = version;
if (mode !== 'production') {
  const commit =
    process.env.FORGE_BUILD_COMMIT ??
    execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw Error('FORGE_BUILD_COMMIT must be a Git commit identifier (7–40 hexadecimal characters)');
  }
  label += `-${commit}`;
}
for (const entry of ['app', 'project']) {
  const result = await build({
    entryPoints: [`frontend/${entry}.ts`],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    metafile: entry === 'app',
    outfile: `src/gbc_scene_forge/static/${entry}.js`,
    define: { __FORGE_BUILD_LABEL__: JSON.stringify(label) },
  });
  if (result.metafile) {
    await writeFile('src/gbc_scene_forge/static/app.meta.json', JSON.stringify(result.metafile));
  }
}
