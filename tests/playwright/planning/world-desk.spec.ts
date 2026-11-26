import assert from 'node:assert/strict';
import { appendFile, cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, paint, test } from '../support/browser-fixtures.ts';

test.use({ initialDesk: 'world' });

test('World desk retains its camera, scene draft and history across scene visits', async ({
  page,
  workspace,
}, testInfo) => {
  const root = join(workspace.folder, 'world');
  await cp('assets/demo/project', root, { recursive: true });
  const url = await workspace.start(root);
  await page.goto(url);
  const desk = page.locator('#world-dialog');
  const river = desk.getByRole('button', { name: 'Select Riverside' });
  const court = desk.getByRole('button', { name: 'Select Courtyard' });
  await expect(river).toBeVisible();
  const riverId = await river.getAttribute('data-scene');
  const sceneFile = join(root, 'scenes', riverId + '.tmj');
  const saved = await readFile(sceneFile, 'utf8');
  const map = desk.locator('#world-map');
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
  };
  const card = await river.boundingBox();
  assert(card);
  await drag(card.x + 30, card.y + 20, 25, 30);
  await expect(desk.locator('#world-save')).toBeEnabled();
  const placement = await desk.locator('#world-x').inputValue();
  await desk.locator('#world-save').click();
  await expect(desk.locator('#world-save')).toBeDisabled();
  const bounds = await map.boundingBox();
  assert(bounds);
  await drag(bounds.x + 10, bounds.y + 10, 46, 24);
  const panned = await map.getAttribute('viewBox');
  assert(panned);
  await page.mouse.wheel(0, -120);
  await expect(map).not.toHaveAttribute('viewBox', panned);
  const camera = await map.getAttribute('viewBox');
  assert(camera);
  const before = await Promise.all([river.boundingBox(), court.boundingBox()]);
  await expect(desk.locator('#world-save')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('world-desk.png') });

  await river.dblclick();
  await expect(page).toHaveURL(new RegExp('/scenes/' + riverId + '$'));
  const tile = page.locator('#palette button.asset').first();
  await tile.click();
  await paint(page, 4, 4);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await page.locator('#zoom').selectOption('2');
  await page.locator('#show-world').click();
  await expect(river).toBeFocused();
  await expect(map).toHaveAttribute('viewBox', camera);
  expect(await Promise.all([river.boundingBox(), court.boundingBox()])).toEqual(before);
  await river.press('Space');
  await desk.locator('#world-open').press('Enter');
  await expect(desk).toBeHidden();
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  expect(await readFile(sceneFile, 'utf8')).toBe(saved);
  await page.locator('#undo').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#redo').click();

  const switchToCourt = async () => {
    await page.locator('#show-world').click();
    await expect(map).toHaveAttribute('viewBox', camera);
    await court.click();
    await desk.locator('#world-open').click();
    await expect(page.locator('#switch-scene-dialog')).toBeVisible();
  };
  await switchToCourt();
  await page.locator('#scene-switch-cancel').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await switchToCourt();
  await page.locator('#scene-switch-discard').click();
  await expect(page.locator('#scene-name')).toContainText('Courtyard');
  expect(await readFile(sceneFile, 'utf8')).toBe(saved);

  await page.goto(url + 'scenes/' + riverId);
  await expect(desk).toBeHidden();
  await tile.click();
  await paint(page, 4, 4);
  await page.locator('#show-world').click();
  await expect(desk.locator('#world-x')).toHaveValue(placement);
  await desk.locator('#world-x').fill('72');
  await desk.locator('#world-position').click();
  await court.dblclick();
  await page.locator('#scene-switch-save').click();
  await expect(page.locator('#scene-name')).toContainText('Courtyard');
  expect(await readFile(sceneFile, 'utf8')).not.toBe(saved);
  await page.locator('#show-world').click();
  await river.click();
  await expect(desk.locator('#world-x')).toHaveValue('72');
  await desk.locator('#world-save').click();
  await expect(desk.locator('#world-save')).toBeDisabled();

  await page.goto(url + 'scenes/' + riverId);
  await tile.click();
  await page.keyboard.press('e');
  await paint(page, 4, 4);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await page.locator('#show-world').click();
  await court.dblclick();
  await appendFile(sceneFile, '\n');
  await page.locator('#scene-switch-save').click();
  await expect(page.locator('#switch-scene-dialog .form-error')).not.toBeEmpty();
  await page.locator('#scene-switch-cancel').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await expect(page.locator('#undo')).toBeEnabled();
});
