import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { test, expect } from '../support/browser-fixtures.ts';
import { revealArtworkControl, saveArtwork } from '../support/artwork-controls.ts';
import type { Feedback } from '../../../frontend/editor/editor-notifications.mts';

declare global {
  interface Window {
    notices: {
      feedback: Feedback;
      other: Feedback;
      owner: string;
      draws: number;
      pending: ReturnType<Feedback['capture']>;
      dispose(): void;
    };
  }
}

test('locked-layer warnings coalesce, pause, expire, dismiss and clear after unlocking or switching', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.create(Path(sys.argv[1]),'Notifications')
a=p.artwork.documents
for key in ['picture','other']:
 c=a.create(key,key,'sprite',16,16,p.catalog()['revision'])
 base=layers.item('Base');base['locked']=True
 a.save(layers.edit(c,[base]))
`,
    root,
  ]);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  await page.clock.install();
  const canvas = page.locator('#art-canvas');
  const warning = page.locator('.notification', { hasText: 'Layer is locked. Unlock it to edit.' });
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(warning).toHaveCount(1);
  await expect(warning).toHaveAttribute('data-severity', 'warning');
  await expect(canvas).toBeFocused();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.clock.fastForward(3000);
  await canvas.click({ position: { x: 8, y: 8 } });
  await page.clock.fastForward(3000);
  await expect(warning).toHaveCount(1);
  const hoverBounds = await warning.boundingBox();
  if (!hoverBounds) {
    throw Error('Expected warning card');
  }
  await page.mouse.move(hoverBounds.x + 12, hoverBounds.y + 12);
  await page.clock.fastForward(7000);
  await expect(warning).toBeVisible();
  await page.screenshot({ path: info.outputPath('toast-desktop.png') });
  await page.setViewportSize({ width: 760, height: 640 });
  await expect(warning).toBeVisible();
  const box = await warning.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 760).toBeTruthy();
  await page.screenshot({ path: info.outputPath('toast-compact.png') });
  const dismiss = warning.getByRole('button', { name: 'Dismiss notification' });
  await dismiss.focus();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(7000);
  await expect(warning).toBeVisible();
  await dismiss.press('Enter');
  await expect(warning).toHaveCount(0);
  await canvas.click({ position: { x: 8, y: 8 } });
  await page.mouse.move(0, 0);
  await page.clock.fastForward(5100);
  await expect(warning).toHaveCount(0);
  await canvas.click({ position: { x: 8, y: 8 } });
  await revealArtworkControl(page, 'art-layer-locked');
  await page.locator('#art-layer-locked').uncheck();
  await expect(warning).toHaveCount(0);
  await page.locator('#art-layer-locked').check();
  await canvas.click({ position: { x: 8, y: 8 } });
  await page.locator('[data-asset="other/artwork"]').click();
  await expect(warning).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('checkpoint, review and save failures clear after successful button or keyboard retries', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Checkpoint notifications')
a=p.artwork.documents
a.save(a.create('picture','Picture','sprite',16,16,p.catalog()['revision']))
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  await page.route('**/api/artwork-draft-write', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'disk full' }),
    }),
  );
  await page.locator('#art-color').fill('#ff0000');
  await page.locator('#art-canvas').click({ position: { x: 8, y: 8 } });
  const failure = page.locator('.notification', { hasText: 'Checkpoint failed:' });
  await expect(failure).toContainText('disk full');
  await expect(failure.locator('[role=alert]')).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(12000);
  await expect(failure).toBeVisible();
  await page.unroute('**/api/artwork-draft-write');
  await page.locator('#art-canvas').click({ position: { x: 16, y: 16 } });
  await page.clock.runFor(500);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await expect(failure).toHaveCount(0);
  await page.route('**/api/artwork-review', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'review temporarily failed' }),
    }),
  );
  const reviewFailure = page.locator('.notification', { hasText: 'review temporarily failed' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await Promise.all([
      page.waitForResponse('**/api/artwork-review'),
      page.locator('#art-canvas').press('Control+s'),
    ]);
    await expect(page.locator('#save')).toBeEnabled();
    await expect(reviewFailure).toHaveCount(1);
  }
  await page.unroute('**/api/artwork-review');
  await page.locator('#art-canvas').press('Control+s');
  await expect(page.locator('#art-comparison')).toBeVisible();
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await expect(reviewFailure).toHaveCount(0);
  await page.route('**/api/artwork-save', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'saved base changed' }),
    }),
  );
  const saveFailure = page.locator('.notification', { hasText: 'saved base changed' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await Promise.all([
      page.waitForResponse('**/api/artwork-save'),
      page.locator('#art-canvas').press('Control+s'),
    ]);
    await expect(page.locator('#save')).toBeEnabled();
    await expect(saveFailure).toHaveCount(1);
  }
  await page.clock.fastForward(12000);
  await expect(saveFailure).toBeVisible();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.unroute('**/api/artwork-save');
  await saveArtwork(page);
  await expect(saveFailure).toHaveCount(0);
});

test('notification ownership, modal access, timer isolation and disposal use the mounted lifetime', async ({
  page,
}) => {
  // Exercise the real component independently of any one domain controller.
  await page.goto('about:blank');
  await page.setContent(
    '<button id="draw">Draw</button><main id="workbench" style="height:500px"><section id="scene-surface"><div id="viewport" hidden></div></section></main><dialog><input aria-label="Name"></dialog>',
  );
  await page.addStyleTag({
    content: readFileSync('src/gbc_scene_forge/static/project.css', 'utf8'),
  });
  const source = ['frontend/editor/editor-lifetime.mts', 'frontend/editor/editor-notifications.mts']
    .map(
      (file) =>
        transpileModule(readFileSync(file, 'utf8'), {
          compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ESNext },
        }).outputText,
    )
    .join('\n');
  await page.addScriptTag({
    type: 'module',
    content:
      source +
      `
const lifetime = new EditorLifetime();
const center = createNotifications(lifetime, document.getElementById('workbench'));
window.notices = { owner: 'one', draws: 0, dispose: () => lifetime.dispose() };
document.getElementById('workbench').addEventListener('pointerdown', () => window.notices.draws++);
window.notices.feedback = center.channel('test-message', () => window.notices.owner);
window.notices.other = center.channel('other-message');
`,
  });
  await page.waitForFunction(() => Boolean(window.notices));
  await page.clock.install();
  await page.locator('#draw').focus();
  await page.evaluate(() => {
    window.notices.feedback.warning('Error: First warning');
    window.notices.pending = window.notices.feedback.capture();
  });
  await expect(page.locator('#draw')).toBeFocused();
  await expect(page.getByText('First warning')).toBeVisible();
  const initial = await page.locator('.notifications').boundingBox();
  expect(initial && initial.x >= 0 && initial.x + initial.width <= 1440).toBeTruthy();
  if (!initial) {
    throw Error('Expected notification bounds');
  }
  await page.mouse.click(initial.x + 12, initial.y + 12);
  expect(await page.evaluate(() => window.notices.draws)).toBe(1);
  await page.mouse.move(0, 0);
  await page.clock.fastForward(3000);
  await page.evaluate(() => {
    window.notices.feedback.show('Newer notice');
    window.notices.pending.error('Stale failure');
    window.notices.other.error('Save failed. Local work retained.', 'save');
  });
  await expect(page.getByText('Stale failure')).toHaveCount(0);
  await page.clock.fastForward(2100);
  await expect(page.getByText('Newer notice')).toBeVisible();
  await page.evaluate(() => {
    window.notices.pending = window.notices.feedback.capture();
    window.notices.owner = 'two';
    window.notices.feedback.sync();
    window.notices.pending.error('Wrong document');
    document.querySelector('dialog')?.showModal();
  });
  await expect(page.getByText('Newer notice')).toHaveCount(0);
  await expect(page.getByText('Wrong document')).toHaveCount(0);
  await page.evaluate(() => {
    window.notices.feedback.error('Earlier save error', 'save');
    const pending = window.notices.feedback.capture();
    window.notices.feedback.error('New save error', 'save');
    pending.clear('save');
  });
  await expect(page.getByText('New save error')).toBeVisible();
  await page.clock.fastForward(10000);
  const failure = page.locator('dialog .notification', { hasText: 'Save failed.' });
  await expect(failure).toBeVisible();
  await failure.getByRole('button', { name: 'Dismiss notification' }).focus();
  await expect(failure.getByRole('button')).toBeFocused();
  await failure.getByRole('button').press('Enter');
  await expect(failure).toHaveCount(0);
  await page.evaluate(() => {
    window.notices.feedback.show('Pending timeout');
    window.notices.dispose();
    window.notices.feedback.error('After disposal');
  });
  await page.clock.fastForward(6000);
  await expect(page.locator('.notifications')).toHaveCount(0);
});
