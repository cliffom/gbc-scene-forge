/** Check real compiler failures cannot overwrite published browser modules. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
await test('compilation publishes only successful output and rejects stale/missing assets without tooling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-build-test-'));
  try {
    await cp(join(repository, 'frontend'), join(root, 'frontend'), { recursive: true });
    for (const name of [
      'tsconfig.json',
      'tsconfig.build.json',
      'package.json',
      'package-lock.json',
    ]) {
      await cp(join(repository, name), join(root, name));
    }
    await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    const build = () =>
      spawnSync('python3', [join(repository, 'tools/frontend_build.py'), '--root', root], {
        encoding: 'utf8',
      });
    const successful = build();
    assert.equal(successful.status, 0, successful.stdout + successful.stderr);
    const staticDir = join(root, 'src/gbc_scene_forge/static');
    const files = await readdir(staticDir);
    const before = await Promise.all(files.map((name) => readFile(join(staticDir, name), 'utf8')));
    await writeFile(join(root, 'frontend/invalid.ts'), 'export const invalid: string = 42;\n');
    const failed = build();
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout + failed.stderr, /TS2322/);
    assert.deepEqual(await readdir(staticDir), files);
    assert.deepEqual(
      await Promise.all(files.map((name) => readFile(join(staticDir, name), 'utf8'))),
      before,
    );
    // Also exercise tsc directly: noEmitOnError must prevent any output in the staging directory.
    const direct = spawnSync(
      process.execPath,
      [
        join(repository, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(root, 'tsconfig.build.json'),
        '--outDir',
        join(root, 'failed-output'),
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(direct.status, 0);
    await assert.rejects(readdir(join(root, 'failed-output')), { code: 'ENOENT' });
    await rm(join(root, 'frontend/invalid.ts'));
    await rm(join(root, 'node_modules'));
    const ensure = () =>
      spawnSync(
        'python3',
        [
          '-c',
          "import runpy,sys; from pathlib import Path; runpy.run_path(sys.argv[1])['ensure'](Path(sys.argv[2]))",
          join(repository, 'tools/frontend_build.py'),
          root,
        ],
        { encoding: 'utf8' },
      );
    assert.equal(ensure().status, 0, 'Verified precompiled assets must work without a compiler');
    await writeFile(
      join(root, 'frontend/app.ts'),
      (await readFile(join(root, 'frontend/app.ts'), 'utf8')) + '\n// changed source\n',
    );
    const stale = ensure();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Browser assets are missing or stale/);
    await rm(join(staticDir, 'app.js'));
    assert.notEqual(ensure().status, 0, 'Missing assets must never be accepted');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
