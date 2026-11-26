/** Optional real browser rendering from the frozen executable; no Python child process. */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { array, record, string } from '../../../frontend/shared/decode.mts';
import { chooseSavedScene } from '../support/browser-fixtures.ts';

test('frozen runtime creates a sample and renders its saved scene', async ({ page }, testInfo) => {
  test.skip(!process.env.FORGE_TEST_BUNDLE, 'Set FORGE_TEST_BUNDLE to a built forge executable');
  const executable = resolve(string(process.env.FORGE_TEST_BUNDLE));
  const identity = record(
    JSON.parse(await readFile(join(dirname(executable), 'bundle.json'), 'utf8')),
  );
  const scratch = await mkdtemp(join(tmpdir(), 'forge-bundle-café-'));
  const root = join(scratch, 'projects café');
  const emptyPath = join(scratch, 'empty PATH');
  await mkdir(root);
  await mkdir(emptyPath);
  const server = spawn(
    executable,
    ['browser', '--project-root', root, '--no-browser', '--port', '0'],
    {
      cwd: dirname(executable),
      env: {
        ...process.env,
        PATH: emptyPath,
        PYTHONHOME: '/unavailable',
        PYTHONPATH: '/unavailable',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let diagnostics = '';
  let stdout = '';
  server.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
  try {
    const url = await new Promise<string>((ready, reject) => {
      const timer = setTimeout(
        () => reject(Error(`Bundle startup timed out: ${diagnostics}`)),
        15000,
      );
      server.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error(`Bundle exited ${code}: ${diagnostics}`));
      });
      server.stderr.on('data', (data: Buffer) => {
        diagnostics += data.toString();
        const match = /Editor\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(diagnostics);
        if (match) {
          clearTimeout(timer);
          ready(match[1]);
        }
      });
    });
    await page.goto(url);
    await page.locator('#project-title').fill('Bundled forest');
    await page.locator('#project-starter').selectOption('sample');
    await page.locator('#project-form button.primary').first().click();
    await expect(page).toHaveURL(/\/projects\/bundled-forest\/$/);
    await expect(page.locator('#app-version')).toHaveText(string(identity.version));
    const manifest = record(
      JSON.parse(await readFile(join(root, 'bundled-forest/forge.project.json'), 'utf8')),
    );
    const scenes = array(manifest.scenes, record);
    expect(scenes).toHaveLength(2);
    const sceneId = string(record(scenes[0]).id);
    await chooseSavedScene(page, sceneId);
    await expect(page.locator('#scene')).toBeVisible();
    await expect(page.locator('#palette button.asset').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('bundled-editor.png') });
    await page.reload();
    await chooseSavedScene(page, sceneId);
    await expect(page.locator('#scene')).toBeVisible();
    expect(stdout).toBe('');
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((done) => {
        const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
        server.once('exit', () => {
          clearTimeout(timer);
          done();
        });
        server.kill('SIGINT');
      });
    }
    await testInfo.attach('bundle.log', { body: diagnostics, contentType: 'text/plain' });
    await rm(scratch, { recursive: true, force: true });
  }
});
