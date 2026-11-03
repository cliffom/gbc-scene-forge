/** Transient selection preserves options; authored names/history refresh exact labels. */
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import {
  test,
  expect,
  editorReady,
  clickControl,
  setControl,
} from '../support/browser-fixtures.ts';

test('object options survive transient updates and follow rename, history and layers', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  await cp('tests/playwright/support/fixtures/editor/project', root, { recursive: true });
  const url = await workspace.start(root);
  await page.goto(url);
  await editorReady(page);
  await page.locator('#scenes').selectOption({ label: 'Village' });
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page
    .getByRole('radio', { name: 'Sprites Objects · Visible', exact: true })
    .locator('..')
    .click();
  await setControl(page, 'object-list', '1');
  const option = await page.locator('#object-list option').first().elementHandle();
  expect(option).not.toBeNull();
  await page.locator('input[name=tool][value=select]').check();
  await page.locator('input[name=tool][value=paint]').check();
  expect(await option?.evaluate((node) => node.isConnected)).toBe(true);
  await clickControl(page, 'edit-object');
  await page.locator('#object-name').fill('Renamed actor');
  await page.locator('#object-apply').click();
  await expect(page.locator('#object-list option').first()).toHaveText('Renamed actor · #1');
  await page.locator('#undo').click();
  await expect(page.locator('#object-list option').first()).not.toHaveText('Renamed actor · #1');
  await page.locator('#redo').click();
  await expect(page.locator('#object-list option').first()).toHaveText('Renamed actor · #1');
  await page
    .getByRole('radio', { name: 'Ground Tiles · Visible', exact: true })
    .locator('..')
    .click();
  await expect(page.locator('#object-list option')).toHaveCount(0);
  await page
    .getByRole('radio', { name: 'Sprites Objects · Visible', exact: true })
    .locator('..')
    .click();
  await expect(page.locator('#object-list option').first()).toHaveText('Renamed actor · #1');
});
