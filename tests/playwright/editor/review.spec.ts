import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { test, editorReady } from '../support/browser-fixtures.ts';

test.use({ projectMode: 'sample' });

test('review mode expands the canvas and preserves edits, selection and history', async ({
  page,
  forge,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(forge.url);
  await editorReady(page);
  const toggle = page.locator('#review-mode');
  await expect(toggle).toBeDisabled();
  await page.locator('#scenes').selectOption({ index: 1 });
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  const viewport = page.locator('#viewport');
  const canvas = page.locator('#scene');
  const zoom = page.locator('#zoom');
  const selectedTool = page.locator('input[name=tool]:checked');
  const bounds = await viewport.boundingBox();
  assert(bounds);
  await page.screenshot({ path: testInfo.outputPath('editing.png') });

  // Keyboard entry/exit retains a reachable control and does not dirty a clean scene.
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveText('Return to editing');
  await expect(toggle).toBeFocused();
  await expect(viewport).toHaveAttribute('data-pan', 'true');
  const expanded = await viewport.boundingBox();
  assert(expanded);
  expect(expanded.width).toBeGreaterThan(bounds.width + 400);
  expect(expanded.height).toBeGreaterThan(bounds.height + 100);
  for (const selector of [
    '.masthead',
    '.document-bar',
    '.library',
    '.inspector',
    '.authoring-tools',
    '.composition-tools',
    '.snap-control',
  ]) {
    await expect(page.locator(selector).first()).toBeHidden();
  }
  await expect(zoom).toBeVisible();
  await expect(page.locator('#fit-scene')).toBeVisible();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveText('Review scene');
  await expect(toggle).toBeFocused();
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#redo')).toBeDisabled();

  // An authored edit and tile selection must survive every blocked authoring shortcut.
  const originalName = await page.locator('#layer-name').inputValue();
  await page.locator('#layer-name').fill('Review keeps my edits');
  await page.locator('#layer-name').press('Tab');
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await page.locator('input[name=tool][value=select]').check();
  await zoom.selectOption('2');
  const box = await canvas.boundingBox();
  assert(box);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 70, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#copy-selection')).toBeEnabled();
  const layer = await page.locator('#layers input:checked').inputValue();
  await toggle.click();
  await canvas.focus();
  for (const key of [
    'p',
    'f',
    'e',
    's',
    'h',
    'Delete',
    'Backspace',
    'ArrowRight',
    'ControlOrMeta+x',
    'ControlOrMeta+v',
    'ControlOrMeta+d',
    'ControlOrMeta+z',
    'ControlOrMeta+Shift+z',
    'ControlOrMeta+y',
    'ControlOrMeta+s',
  ]) {
    await page.keyboard.press(key);
  }
  await expect(selectedTool).toHaveValue('select');
  await expect(page.locator('#layer-name')).toHaveValue('Review keeps my edits');
  await expect(page.locator('#redo')).toBeDisabled();

  // Dragging the scene is always pan, with real pointer capture and no Space modifier.
  await zoom.selectOption('8');
  const view = await viewport.boundingBox();
  assert(view);
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.mouse.down();
  await expect(viewport).toHaveAttribute('data-panning', 'true');
  await page.mouse.move(view.x + view.width / 2 - 130, view.y + view.height / 2 - 90, { steps: 5 });
  await page.mouse.up();
  await expect(viewport).toHaveAttribute('data-panning', 'false');
  const scrolled = await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop]);
  expect(scrolled[0]).toBeGreaterThan(0);
  expect(scrolled[1]).toBeGreaterThan(0);
  const center = () =>
    canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) {
        throw Error('Expected scene canvas');
      }
      const view = document.getElementById('viewport');
      if (!view) {
        throw Error('Expected viewport');
      }
      const r = element.getBoundingClientRect(),
        v = view.getBoundingClientRect();
      return [
        ((v.left + view.clientWidth / 2 - r.left) / r.width) * element.width,
        ((v.top + view.clientHeight / 2 - r.top) / r.height) * element.height,
      ];
    });
  const beforeTransition = await center();
  await toggle.click();
  const afterTransition = await center();
  expect(Math.abs(afterTransition[0] - beforeTransition[0])).toBeLessThan(1);
  expect(Math.abs(afterTransition[1] - beforeTransition[1])).toBeLessThan(1);
  await toggle.click();
  const restoredCenter = await center();
  expect(Math.abs(restoredCenter[0] - beforeTransition[0])).toBeLessThan(1);
  expect(Math.abs(restoredCenter[1] - beforeTransition[1])).toBeLessThan(1);
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData('application/x-forge-asset', 'sample/grass/0/0');
    return data;
  });
  await canvas.dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  await page.mouse.wheel(0, 100);
  await expect(zoom).toHaveValue('6');
  await page.locator('#fit-scene').click();
  await expect(zoom).toHaveValue('fit');
  await page.screenshot({ path: testInfo.outputPath('review-desktop.png') });

  // Fit follows the available viewport after both layout and window size changes.
  for (const [width, height] of [
    [760, 640],
    [390, 640],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () =>
        canvas.evaluate((element) => {
          const r = element.getBoundingClientRect();
          const view = document.getElementById('viewport')?.getBoundingClientRect();
          if (!view) {
            return false;
          }
          return (
            r.left >= view.left &&
            r.right <= view.right &&
            r.top >= view.top &&
            r.bottom <= view.bottom &&
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight
          );
        }),
      )
      .toBe(true);
    await expect(toggle).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`) });
  }
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.library')).toBeVisible();
  await expect(selectedTool).toHaveValue('select');
  await expect(page.locator('#layers input:checked')).toHaveValue(layer);
  await expect(page.locator('#copy-selection')).toBeEnabled();
  await expect(page.locator('#layer-name')).toHaveValue('Review keeps my edits');
  // Only the original rename is in history. Undo returns to saved content; redo restores it.
  await page.locator('#undo').click();
  await expect(page.locator('#layer-name')).toHaveValue(originalName);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  await expect(page.locator('#layer-name')).toHaveValue('Review keeps my edits');
  await page.locator('#save').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await editorReady(page);
  await page.locator('#scenes').selectOption({ index: 1 });
  await expect(page.locator('#layer-name')).toHaveValue('Review keeps my edits');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('review mode exits safely after external scene deletion and editor disposal', async ({
  page,
  forge,
}) => {
  await page.goto(forge.url);
  await editorReady(page);
  await page.locator('#scenes').selectOption({ index: 1 });
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  const scene = await page.locator('#scenes').inputValue();
  await page.locator('#review-mode').click();
  // Review mode is transient mount state; disposal must restore the shared DOM.
  await page.evaluate(
    "(async () => { const module = await import('/project.js'); module.editor.dispose(); module.mountProjectEditor(); })()",
  );
  await editorReady(page);
  await expect(page.locator('body')).not.toHaveClass(/reviewing/);
  await expect(page.locator('#review-mode')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#scenes').selectOption(scene);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#review-mode').click();
  await page.locator('#viewport').focus();
  await promisify(execFile)(forge.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project(Path(sys.argv[1]))
p.scenes.delete(sys.argv[2], p.store.load_scene(sys.argv[2])['revision'], p.catalog()['revision'], confirm_broken_links=True)
`,
    forge.root,
    scene,
  ]);
  await expect(page.locator('#status')).toContainText('removed externally');
  await expect(page.locator('body')).not.toHaveClass(/reviewing/);
  await expect(page.locator('#review-mode')).toBeDisabled();
  await expect(page.locator('#scenes')).toBeVisible();
  await page.locator('#scenes').selectOption({ index: 1 });
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#review-mode')).toBeEnabled();
});
