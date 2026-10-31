/** Saved inventory discovery without replacing browser authoring state. */
import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, paint } from '../support/browser-fixtures.ts';

const execute = promisify(execFile);
const create = async (python: string, root: string, title: string) => {
  await execute(python, [
    '-I',
    '-c',
    'import sys; from pathlib import Path; from gbc_scene_forge.project.application import Project; Project.create(Path(sys.argv[1]), sys.argv[2], starter="sample")',
    root,
    title,
  ]);
};
const addScene = async (python: string, root: string, title: string) => {
  const { stdout } = await execute(python, [
    '-I',
    '-c',
    'import sys; from pathlib import Path; from gbc_scene_forge.project.application import Project; p=Project(Path(sys.argv[1])); s=p.planning.create_blockout(sys.argv[2], {}, p.catalog()["revision"]); print(s["id"])',
    root,
    title,
  ]);
  return stdout.trim();
};

test('discovers filesystem projects, preserves forms, and updates project dropdown', async ({
  page,
  forge,
}, testInfo) => {
  await page.goto(forge.url);
  await expect(page.locator('#project-form')).toBeVisible();
  await page.locator('#project-title').fill('Unfinished project');
  await create(forge.python, join(forge.root, 'external'), 'External world');
  await expect(page.locator('#back-to-projects')).toBeVisible();
  await expect(page.locator('#project-title')).toHaveValue('Unfinished project');
  await expect(page.locator('#project-form')).toBeVisible();
  await page.locator('#back-to-projects').click();
  await expect(page.locator('#project-list')).toContainText('External world');
  await page.locator('#project-list a').click();
  await expect(page.locator('#scenes')).toBeEnabled();
  await create(forge.python, join(forge.root, 'second'), 'Second world');
  await expect(page.locator('#switch-project option')).toContainText([
    'External world',
    'Second world',
    'Choose or create project…',
  ]);
  await expect(page.locator('#switch-project')).toHaveValue('/projects/external');
  await expect(page.locator('#scenes')).toHaveValue('');
  const broken = join(forge.root, 'broken');
  await mkdir(broken);
  await writeFile(join(broken, 'forge.project.json'), 'invalid');
  await expect(page.locator('#inventory-status')).toContainText('broken');
  await expect(page.locator('#switch-project option')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('project-discovery.png') });
});

test('discovers projects from the empty chooser without navigation', async ({
  page,
  forge,
}, testInfo) => {
  await page.goto(forge.url);
  await expect(page.locator('#project-form')).toBeVisible();
  await page.locator('#project-title').blur();
  await create(forge.python, join(forge.root, 'first'), 'First world');
  await expect(page.locator('#project-picker')).toBeVisible();
  await expect(page.locator('#project-list')).toContainText('First world');
  await expect(page).toHaveURL(forge.url);
  await page.screenshot({ path: testInfo.outputPath('new-project-discovery.png') });
  const manifest = join(forge.root, 'first', 'forge.project.json');
  const original = await readFile(manifest);
  await writeFile(manifest, 'incomplete');
  await expect(page.locator('#unavailable-projects')).toContainText('first');
  await writeFile(manifest, original);
  await expect(page.locator('#project-list')).toContainText('First world');
  await expect(page.locator('#unavailable-projects')).toHaveText('');
});

test('discovers the first scene in an empty project and enables navigation', async ({
  page,
  forge,
}) => {
  const root = join(forge.root, 'empty');
  await execute(forge.python, [
    '-I',
    '-c',
    'import sys; from pathlib import Path; from gbc_scene_forge.project.application import Project; Project.create(Path(sys.argv[1]), "Empty")',
    root,
  ]);
  await page.goto(new URL('/projects/empty/', forge.url).href);
  await expect(page.locator('#project-name')).toHaveText('Empty');
  await expect(page.locator('#scenes')).toBeDisabled();
  const id = await addScene(forge.python, root, 'First external scene');
  await expect(page.locator('#scenes')).toBeEnabled();
  await expect(page.locator(`#scenes option[value="${id}"]`)).toHaveCount(1);
  await page.locator('#scenes').selectOption(id);
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await expect(page.locator('#scenes')).toHaveValue(id);
});

test.describe('scene inventory in a directly opened project', () => {
  test.use({ projectMode: 'sample' });

  test('validates files and discovers scenes while empty and dirty, preserving undo and revision guards', async ({
    page,
    forge,
  }, testInfo) => {
    await page.goto(forge.url);
    await expect(page.locator('#scenes')).toBeEnabled();
    const first = await addScene(forge.python, forge.root, 'External empty');
    await expect(page.locator(`#scenes option[value="${first}"]`)).toHaveText('External empty');
    await expect(page.locator('#scenes')).toHaveValue('');
    // Keep an invalid saved map out of the list; repair becomes discoverable.
    const path = join(forge.root, 'scenes', `${first}.tmj`);
    const content = await readFile(path);
    await writeFile(path, 'invalid');
    await expect(page.locator('#inventory-status')).toContainText(first);
    await expect(page.locator(`#scenes option[value="${first}"]`)).toHaveCount(0);
    await writeFile(path, content);
    await expect(page.locator(`#scenes option[value="${first}"]`)).toHaveCount(1);
    await expect(page.locator('#inventory-status')).toBeHidden();
    await page.locator('#scenes').selectOption({ label: 'Riverside' });
    await expect(page.locator('#status')).toHaveText('Scene opened.');
    const active = await page.locator('#scenes').inputValue();
    await page.locator('#palette button.asset').first().click();
    await paint(page, 4, 4);
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    const second = await addScene(forge.python, forge.root, 'External dirty');
    await expect(page.locator(`#scenes option[value="${second}"]`)).toHaveText('External dirty');
    await expect(page.locator('#scenes')).toHaveValue(active);
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await expect(page.locator('#undo')).toBeEnabled();
    await page.locator('#scenes').selectOption(second);
    await expect(page.locator('#switch-scene-description')).toContainText('External dirty');
    await page.screenshot({ path: testInfo.outputPath('dirty-scene-discovery.png') });
    await page.locator('#scene-switch-cancel').click();
    await expect(page.locator('#scenes')).toHaveValue(active);
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Project changed');
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await page.locator('#undo').click();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    // A choice discovered while dirty must be usable before snapshot adoption.
    await page.locator('#scenes').selectOption(second);
    await expect(page.locator('#status')).toHaveText('Scene opened.');
    await expect(page.locator('#scenes')).toHaveValue(second);
  });

  test('defers hidden and focused dropdown updates and coalesces in-flight checks', async ({
    page,
    forge,
  }) => {
    await page.goto(forge.url);
    await expect(page.locator('#scenes')).toBeEnabled();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await addScene(forge.python, forge.root, 'Hidden discovery');
    await page.waitForTimeout(2300);
    await expect(page.locator(`#scenes option[value="${hidden}"]`)).toHaveCount(0);
    await page.evaluate(
      "delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))",
    );
    await expect(page.locator(`#scenes option[value="${hidden}"]`)).toHaveCount(1);
    await page.locator('#scenes').focus();
    const focused = await addScene(forge.python, forge.root, 'Focused discovery');
    await page.waitForTimeout(2300);
    await expect(page.locator(`#scenes option[value="${focused}"]`)).toHaveCount(0);
    await page.locator('#scenes').blur();
    await expect(page.locator(`#scenes option[value="${focused}"]`)).toHaveCount(1);
    let count = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/choices', async (route) => {
      count++;
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => count).toBe(1);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForTimeout(2300);
    expect(count).toBe(1);
    release();
    await page.unrouteAll({ behavior: 'wait' });
  });

  test('honors pause, retries failed requests and cleans up on disposal', async ({
    page,
    forge,
  }) => {
    await page.goto(forge.url);
    await expect(page.locator('#scenes')).toBeEnabled();
    await page.locator('#project-commands').click();
    await page.locator('#auto-refresh').uncheck();
    const id = await addScene(forge.python, forge.root, 'Paused discovery');
    // An explicit check works even with auto refresh off.
    await page.locator('#project-commands').click();
    await page.locator('#check-external').click();
    await expect(page.locator(`#scenes option[value="${id}"]`)).toHaveCount(1);
    await page.route('**/api/choices', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Temporary failure"}',
      }),
    );
    await page.locator('#project-commands').click();
    await page.locator('#auto-refresh').check();
    await expect(page.locator('#inventory-status')).toContainText('Temporary failure');
    await page.unroute('**/api/choices');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#inventory-status')).toBeHidden();
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/choices')) {
        requests.push(request.url());
      }
    });
    await page.evaluate(
      "(async () => { const module = await import('/project.js'); module.editor.dispose(); })()",
    );
    const count = requests.length;
    await page.waitForTimeout(2300);
    expect(requests).toHaveLength(count);
  });
});
