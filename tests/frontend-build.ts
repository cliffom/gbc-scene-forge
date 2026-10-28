/** Verify the actual npm/esbuild pipeline, including transitive imports and failed builds. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { record, array, string } from '../frontend/decode.mts';

const repository = fileURLToPath(new URL('../', import.meta.url));
await test('esbuild bundles nested modules, emits source maps and preserves assets after type errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-bundle-test-'));
  try {
    await cp(join(repository, 'frontend'), join(root, 'frontend'), { recursive: true });
    for (const name of ['tsconfig.json', 'package.json', 'package-lock.json', 'pyproject.toml']) {
      await cp(join(repository, name), join(root, name));
    }
    await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    await mkdir(join(root, 'frontend/nested'));
    const helper = join(root, 'frontend/nested/probe.mts');
    await writeFile(helper, "export const probe = 'nested dependency';\n");
    const app = join(root, 'frontend/app.ts');
    await writeFile(
      app,
      (await readFile(app, 'utf8')) +
        "\nimport { probe } from './nested/probe.mts';\nconsole.log(probe);\n",
    );
    const build = (mode = 'development', commit = 'a1b2c3d') =>
      spawnSync('npm', ['run', 'build'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, FORGE_BUILD_MODE: mode, FORGE_BUILD_COMMIT: commit },
      });
    const successful = build();
    assert.equal(successful.status, 0, successful.stdout + successful.stderr);
    const staticDir = join(root, 'src/gbc_scene_forge/static');
    assert.deepEqual(await readdir(staticDir), [
      'app.js',
      'app.js.map',
      'app.meta.json',
      'build-info.json',
      'project.js',
      'project.js.map',
    ]);
    const bundle = await readFile(join(staticDir, 'app.js'), 'utf8');
    const version = /^version = "([^"]+)"$/m.exec(
      await readFile(join(root, 'pyproject.toml'), 'utf8'),
    )?.[1];
    assert(version);
    assert((await readFile(join(staticDir, 'project.js'), 'utf8')).includes(`${version}-a1b2c3d`));
    assert.equal(
      string(
        record(JSON.parse(await readFile(join(staticDir, 'build-info.json'), 'utf8'))).version,
      ),
      `${version}-a1b2c3d`,
    );
    const production = build('production');
    assert.equal(production.status, 0, production.stdout + production.stderr);
    const releaseBundle = await readFile(join(staticDir, 'project.js'), 'utf8');
    assert(releaseBundle.includes(`versionLabel.textContent = "${version}"`));
    assert(!releaseBundle.includes(`${version}-a1b2c3d`));
    assert.equal(
      string(
        record(JSON.parse(await readFile(join(staticDir, 'build-info.json'), 'utf8'))).version,
      ),
      version,
    );
    assert.notEqual(build('invalid').status, 0);
    assert.notEqual(build('development', '').status, 0);
    assert.match(bundle, /nested dependency/);
    assert.doesNotMatch(bundle, /from ["']\.\//);
    const metadata = record(JSON.parse(await readFile(join(staticDir, 'app.meta.json'), 'utf8')));
    assert('frontend/nested/probe.mts' in record(metadata.inputs));
    const sourceMap = record(JSON.parse(await readFile(join(staticDir, 'app.js.map'), 'utf8')));
    assert(array(sourceMap.sources, string).some((name) => name.endsWith('nested/probe.mts')));
    await writeFile(helper, "export const probe = 'updated nested dependency';\n");
    assert.equal(build().status, 0);
    assert.match(await readFile(join(staticDir, 'app.js'), 'utf8'), /updated nested dependency/);
    const files = await readdir(staticDir);
    const before = await Promise.all(files.map((name) => readFile(join(staticDir, name), 'utf8')));
    await writeFile(helper, 'export const probe: string = 42;\n');
    const failed = build();
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout + failed.stderr, /TS2322/);
    assert.deepEqual(
      await Promise.all(files.map((name) => readFile(join(staticDir, name), 'utf8'))),
      before,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
