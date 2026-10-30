/** Fresh offline first-scene path through the installed-product UI. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { record } from '../frontend/shared/decode.mts';
import { test, editorReady, paint } from './browser-fixtures.ts';

test('first scene: sample, guide, paint, save/reopen, preview and export', async ({
  page,
  forge,
}, testInfo) => {
  const click = (id: string) => page.locator('#' + id).click();
  await page.goto(forge.url);
  await expect(page.locator('#project-form')).toBeVisible();
  await page.locator('#project-title').fill('My first world');
  await page.locator('#project-starter').selectOption('sample');
  await page.screenshot({ path: testInfo.outputPath('first-use-project.png') });
  await click('show-first-scene-guide');
  await expect(page.locator('#first-scene-guide')).toBeVisible();
  await click('guide-action');
  await expect(page.locator('#continue-guide')).toBeChecked();
  await page.locator('#project-form button.primary').first().click();
  await expect(page).toHaveURL(/\/projects\/my-first-world\/$/);
  await expect(page.locator('#first-scene-guide')).toBeVisible();
  await expect(page.locator('#guide-title')).toHaveText('Bring in artwork');
  assert.equal(new URL(page.url()).search, '');
  await expect(page.locator('#app-version')).toHaveText(
    execFileSync(
      forge.python,
      ['-I', '-c', 'from gbc_scene_forge.build_info import build_version; print(build_version())'],
      { encoding: 'utf8' },
    ).trim(),
  );
  await click('guide-next');
  await page.screenshot({ path: testInfo.outputPath('first-use-guide.png') });
  await click('guide-action');
  await expect(page.locator('#create-scene-dialog')).toBeVisible();
  await page.locator('#scene-title').fill('First scene');
  await page.locator('#scene-form button.primary').first().click();
  await expect(page.locator('#status')).toContainText('Scene created');
  const id = await page.locator('#scenes').inputValue();
  await page.locator('#palette button.asset').first().click();
  await paint(page, 4, 4);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  // The guide never mutates scene/history or clears unsaved edits.
  await click('show-first-scene-guide');
  await click('guide-next');
  await click('guide-next');
  await click('guide-close');
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await click('save');
  await expect(page.locator('#status')).toHaveText('Scene saved.');
  const base = new URL('/projects/my-first-world/', forge.url);
  const saved = record(await (await fetch(new URL(`api/scene/${id}`, base))).json());
  const manifest = record(
    JSON.parse(await readFile(join(forge.root, 'my-first-world/forge.project.json'), 'utf8')),
  );
  assert.equal(manifest.name, 'My first world');
  assert.ok(JSON.stringify(saved).includes('sample/'));
  await page.reload();
  await expect(page.locator('#scenes option')).toHaveCount(4);
  await editorReady(page);
  await page.locator('#scenes').selectOption(id);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  assert.deepEqual(record(await (await fetch(new URL(`api/scene/${id}`, base))).json()), saved);
  await click('show-first-scene-guide');
  await expect(page.locator('#guide-title')).toHaveText('Save and reopen');
  await click('guide-next');
  await click('guide-close');
  await page.locator('#kind-filter').selectOption('sprite');
  await page.locator('#palette button.asset:not([hidden])').first().click();
  await paint(page, 32, 32);
  await expect(page.locator('#animation-preview')).toBeVisible();
  await page.locator('#preview-animation').selectOption('walk');
  await click('save');
  await expect(page.locator('#status')).toHaveText('Scene saved.');
  await click('preview-play');
  await expect(page.locator('#preview-play')).toContainText('Pause');
  await click('preview-play');
  const downloadPending = page.waitForEvent('download');
  await click('show-export');
  await click('export-confirm');
  const download = await downloadPending;
  assert.ok(download.suggestedFilename().endsWith('.zip'));
  const archive = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of archive) {
    if (!(chunk instanceof Buffer)) {
      throw Error('Expected download bytes');
    }
    bytes += chunk.length;
  }
  assert.ok(bytes > 1000);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  // Storage-disabled browsers can still open and navigate the optional guide.
  await page.evaluate(
    `Object.defineProperty(window, 'localStorage', {get(){throw Error('Disabled');}}); void 0`,
  );
  await click('show-first-scene-guide');
  await click('guide-next');
  await click('guide-restart');
  await click('guide-close');
});
