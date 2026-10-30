/** Freeze build identity into the browser bundle, including in installed distributions. */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';

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
// Clear artifacts from checkouts built before the historical frontend was removed.
for (const name of ['app.js', 'app.js.map', 'app.meta.json']) {
  await rm(`src/gbc_scene_forge/static/${name}`, { force: true });
}
await build({
  entryPoints: ['frontend/project.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: mode === 'production',
  outfile: 'src/gbc_scene_forge/static/project.js',
  define: { __FORGE_BUILD_LABEL__: JSON.stringify(label) },
});
await writeFile('src/gbc_scene_forge/static/build-info.json', JSON.stringify({ version: label }));
