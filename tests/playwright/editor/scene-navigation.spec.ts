import { cp, mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test, editorReady } from '../support/browser-fixtures.ts';

for (const single of [true, false]) {
  test(`scene links and guarded history (${single ? 'direct' : 'workspace'})`, async ({
    page,
    workspace,
  }, testInfo) => {
    const root = workspace.folder + '/fixture';
    const project = single ? root : root + '/world';
    await mkdir(project, { recursive: true });
    await cp('tests/playwright/support/fixtures/editor/project', project, { recursive: true });
    const url = await workspace.start(root, true, single);
    await page.goto(url);
    if (!single) {
      await page.locator('#project-list a').first().click();
    }
    await editorReady(page);
    const base = page.url();
    const ids = await page
      .locator('#scenes option')
      .evaluateAll((options) =>
        options
          .map((option) => (option instanceof HTMLOptionElement ? option.value : ''))
          .filter(Boolean),
      );
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const choose = async (id: string) => {
      await page.locator('#scenes').selectOption(id);
      await expect(page.locator('#scenes')).toBeEnabled();
      await expect(page.locator('#scenes')).toHaveValue(id);
      await expect(page).toHaveURL(base + 'scenes/' + id);
    };
    await choose(ids[0]);
    await choose(ids[1]);
    await page.evaluate(() => history.back());
    await expect(page.locator('#scenes')).toHaveValue(ids[0]);
    await expect(page).toHaveURL(base + 'scenes/' + ids[0]);
    await page.evaluate(() => history.forward());
    await expect(page.locator('#scenes')).toHaveValue(ids[1]);
    await expect(page).toHaveURL(base + 'scenes/' + ids[1]);
    await page.locator('#layer-name').fill('Unsaved navigation test');
    await page.locator('#layer-name').dispatchEvent('change');
    await expect(page.locator('#dirty')).toHaveText('UNSAVED');
    await expect(page.locator('#scenes')).toBeEnabled();
    await page.evaluate(() => history.back());
    await expect(page.locator('#discard-dialog')).toBeVisible();
    await expect(page).toHaveURL(base + 'scenes/' + ids[1]);
    await page.locator('#discard-dialog button').filter({ hasText: 'Keep editing' }).click();
    await expect(page.locator('#scenes')).toHaveValue(ids[1]);
    await expect(page.locator('#dirty')).toHaveText('UNSAVED');
    await expect(page.locator('#scenes')).toBeEnabled();
    await page.evaluate(() => history.back());
    await expect(page.locator('#discard-dialog')).toBeVisible();
    await page.locator('#discard-dialog button').filter({ hasText: 'Discard' }).click();
    await expect(page.locator('#scenes')).toHaveValue(ids[0]);
    await expect(page).toHaveURL(base + 'scenes/' + ids[0]);
    await page.reload();
    await expect(page.locator('#scenes')).toHaveValue(ids[0]);
    await expect(page.locator('#scenes')).toBeEnabled();
    const tab = await page.context().newPage();
    await tab.goto(page.url());
    await expect(tab.locator('#scenes')).toHaveValue(ids[0]);
    await tab.close();
    await page.screenshot({ path: testInfo.outputPath('scene-url.png') });
    await testInfo.attach('Scene opened from URL', {
      path: testInfo.outputPath('scene-url.png'),
      contentType: 'image/png',
    });
    await page.goto(base + 'scenes/missing-scene');
    await expect(page.locator('#status')).toContainText('Scene not found');
    await expect(page.locator('#scenes')).toBeEnabled();
    await choose(ids[0]);
    await page.goto(base + 'scenes/%25invalid');
    await expect(page.locator('#status')).toContainText('Invalid scene ID');
    await page.goto(base);
    await editorReady(page);
    await expect(page.locator('#scenes')).toHaveValue('');
    await choose(ids[0]);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(base);
    await expect(page.locator('#scenes')).toHaveValue('');
    await expect(page.locator('#empty-scene')).toBeVisible();
    await choose(ids[0]);
    await page.locator('#scene-commands').click();
    await page.locator('#show-delete').click();
    await page.locator('#delete-scene-confirm').click();
    await expect(page).toHaveURL(base);
    await expect(page.locator('#scenes')).toBeEnabled();
    await page.evaluate(() => history.back());
    await expect(page.locator('#status')).toContainText('Scene not found');
    await expect(page).toHaveURL(base);
    await expect(page.locator('#scenes')).toHaveValue('');
    await page.goto(base + 'scenes/');
    await expect(page.locator('#status')).toContainText('Invalid scene URL');
  });
}
