/** Display-name search and guarded import feedback through public browser controls. */
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { test, paint, chooseSavedScene } from '../support/browser-fixtures.ts';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 760, height: 640 },
]) {
  test(`Library search preserves authoring state at ${viewport.width}`, async ({
    page,
    workspace,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(await workspace.start(workspace.folder, false, true, true));
    await expect(page.locator('#scenes')).toBeEnabled();
    await chooseSavedScene(page, { label: 'Riverside' });
    await expect(page.locator('#status')).toHaveText('Scene opened.');
    await page.locator('#palette button.asset').first().click();
    let checkpoints = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/checkpoint-draft')) {
        checkpoints++;
      }
    });
    await paint(page, 4, 4);
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    // Select painted content so filtering must also preserve the live selection.
    if (await page.locator('#expand-scene-tools').isVisible()) {
      await page.locator('#expand-scene-tools').click();
    }
    await page.locator('label[title="Select (S)"]').click();
    const canvas = page.locator('#scene');
    await canvas.hover({ position: { x: 4, y: 4 } });
    await page.mouse.down();
    const bounds = await canvas.boundingBox();
    if (!bounds) {
      throw Error('Scene canvas is not visible');
    }
    await page.mouse.move(bounds.x + 25, bounds.y + 25);
    await page.mouse.up();
    await expect(page.locator('#deselect')).toBeEnabled();
    const state = () =>
      page.evaluate(() => ({
        brush: document.querySelector('#selected-brush')?.textContent,
        layers: document.querySelector('#layers')?.innerHTML,
        save: document.querySelector('#scene-save-state')?.textContent,
        selection: document.querySelector('#selection-panel')?.textContent,
        deselect: document.querySelector('#deselect')?.getAttribute('disabled'),
        undo: document.querySelector('#undo')?.getAttribute('disabled'),
        redo: document.querySelector('#redo')?.getAttribute('disabled'),
        canvas: (() => {
          const scene = document.querySelector('#scene');
          return scene instanceof HTMLCanvasElement ? scene.toDataURL() : null;
        })(),
      }));
    await expect(page.locator('#draft-status')).toHaveText('Draft checkpoint saved');
    const beforeCheckpoints = checkpoints;
    const before = await state();
    const inventory = page.locator('#palette button.asset');
    const total = await inventory.count();
    const search = page.getByRole('searchbox', { name: 'Search assets' });
    const visible = page.locator('#palette button.asset:not([hidden])');
    for (const query of ['hero idle', 'hero_idle', 'sample/hero_idle', 'HeRo IdLe']) {
      await search.fill(query);
      await expect(search).toBeFocused();
      await expect(visible).toHaveCount(1);
      await expect(visible).toHaveAttribute('data-asset', 'sample/hero_idle');
      await expect(page.locator('#asset-count')).toHaveText(`1 / ${total}`);
    }
    await page.locator('#library-options').evaluate((node) => {
      if (node instanceof HTMLDetailsElement) {
        node.open = true;
      }
    });
    await page.locator('#atlas-filter').selectOption('sample');
    await page.locator('#library-options').evaluate((node) => {
      if (node instanceof HTMLDetailsElement) {
        node.open = true;
      }
    });
    await page.locator('#kind-filter').selectOption('sprite');
    await expect(visible).toHaveCount(1);
    await page.locator('#library-options').evaluate((node) => {
      if (node instanceof HTMLDetailsElement) {
        node.open = true;
      }
    });
    await page.locator('#kind-filter').selectOption('tile');
    await expect(visible).toHaveCount(0);
    await expect(page.locator('#library-hint')).toContainText('No matching assets');
    await expect(page.locator('#asset-count')).toHaveText(`0 / ${total}`);
    await page.locator('#library-options').evaluate((node) => {
      if (node instanceof HTMLDetailsElement) {
        node.open = true;
      }
    });
    await page.locator('#kind-filter').selectOption('sprite');
    await search.fill('no such asset');
    await expect(visible).toHaveCount(0);
    await search.press('ControlOrMeta+A');
    await search.press('Backspace');
    await expect(visible).toHaveCount(2);
    await expect(page.locator('#asset-count')).toHaveText(`2 / ${total}`);
    await page.locator('#library-options').evaluate((node) => {
      if (node instanceof HTMLDetailsElement) {
        node.open = true;
      }
    });
    await page.locator('#atlas-filter').selectOption('');
    await page.locator('#library-options').evaluate((node) => {
      if (node instanceof HTMLDetailsElement) {
        node.open = true;
      }
    });
    await page.locator('#kind-filter').selectOption('');
    await expect(visible).toHaveCount(total);
    expect(await state()).toEqual(before);
    expect(checkpoints).toBe(beforeCheckpoints);
    await search.fill('hero idle');
    await visible.locator('.asset-name').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`search-${viewport.width}.png`) });
    await search.fill('');
    // One Undo still removes the single paint operation; search created no history.
    await page.locator('#undo').click();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await page.locator('#redo').click();
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  });

  test(`Import entry and corrected feedback at ${viewport.width}`, async ({
    page,
    workspace,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(await workspace.start(workspace.folder, true, true));
    await page.locator('#project-title').fill('Import feedback');
    await page.locator('#project-form button.primary').click();
    const entry = page.getByRole('button', { name: 'Import', exact: true });
    await expect(entry).toBeEnabled();
    await expect(page.locator('#library-hint')).toContainText('PNG tilesheets');
    await expect(page.locator('#library-hint')).toContainText('Tiled JSON maps');
    await expect(page.locator('#palette .library-empty')).toContainText('Create artwork with New');
    await page.screenshot({ path: testInfo.outputPath(`entry-${viewport.width}.png`) });
    await entry.click();
    await expect(
      page.getByRole('dialog', { name: 'Import artwork or map', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await entry.press('Enter');
    await expect(page.locator('#import-kind option')).toHaveText([
      'gbc-atlas bundle',
      'PNG tilesheet',
      'Tiled JSON map',
      'Forge export ZIP',
    ]);
    for (const [mode, fields] of [
      ['forge', 'forge-import-fields'],
      ['tiled', 'tiled-import-fields'],
      ['atlas', 'atlas-import-fields'],
      ['png', 'png-import-fields'],
    ]) {
      await page.locator('#import-kind').selectOption(mode);
      await expect(page.locator(`#${fields}`)).toBeVisible();
    }
    await page.locator('#generic-id').fill('checked');
    await page.locator('#generic-preflight').click();
    await expect(page.locator('#status')).toHaveText('Choose a PNG tilesheet.');
    await expect(page.locator('#import-form .form-error')).toHaveText('Choose a PNG tilesheet.');
    await expect(page.locator('#generic-apply')).toBeDisabled();
    const png = execFileSync(workspace.python, [
      '-c',
      "import sys;sys.path.insert(0,'tests');from support.atlas_fixture import image;sys.stdout.buffer.write(image(16,8,(12,45,67)))",
    ]);
    await page
      .locator('#sheet-file')
      .setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: png });
    await page.locator('#generic-preflight').click();
    await expect(page.locator('#generic-apply')).toBeEnabled();
    await expect(page.locator('#generic-report')).toContainText('2 tiles');
    await expect(page.locator('#import-form .form-error')).toBeEmpty();
    await expect(page.locator('#status')).toHaveText(
      'Preview checked. Choose Import checked content to confirm.',
    );
    await page.locator('#generic-apply').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`corrected-${viewport.width}.png`) });
    // Editing checked input invalidates confirmation and late errors cannot restore it.
    await page.locator('#sheet-margin').fill('1');
    await expect(page.locator('#generic-apply')).toBeDisabled();
    await expect(page.locator('#status')).toHaveText(
      'Preview confirmation cleared. Check the current source before importing.',
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived!: () => void;
    const pending = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route(
      '**/api/import-tilesheet',
      async (route) => {
        const response = await route.fetch();
        arrived();
        await held;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await page.locator('#generic-preflight').click();
    await pending;
    await page.locator('#sheet-margin').fill('0');
    release();
    await expect(page.locator('#generic-preflight')).toBeEnabled();
    await expect(page.locator('#import-form .form-error')).toBeEmpty();
    await expect(page.locator('#status')).toHaveText(
      'Preview confirmation cleared. Check the current source before importing.',
    );
    await expect(page.locator('#generic-apply')).toBeDisabled();
    // A successful reply for a source type that is no longer selected is stale too.
    const successHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const successPending = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route(
      '**/api/import-tilesheet',
      async (route) => {
        const response = await route.fetch();
        arrived();
        await successHeld;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await page.locator('#generic-preflight').click();
    await successPending;
    await page.locator('#import-kind').selectOption('tiled');
    release();
    await expect(page.locator('#generic-preflight')).toBeEnabled();
    await expect(page.locator('#generic-report')).toBeEmpty();
    await expect(page.locator('#generic-apply')).toBeDisabled();
    await page.locator('#import-kind').selectOption('png');
    await page.locator('#generic-preflight').click();
    await expect(page.locator('#generic-apply')).toBeEnabled();
    await page.keyboard.press('Escape');
    await entry.click();
    await expect(page.locator('#generic-report')).toBeEmpty();
    await expect(page.locator('#generic-apply')).toBeDisabled();
    await page.locator('#generic-preflight').click();
    await expect(page.locator('#generic-apply')).toBeEnabled();
    await page.locator('#generic-apply').click();
    await expect(page.locator('#import-atlas-dialog')).not.toBeVisible();
    await expect(page.locator('#status')).toContainText('Import complete');
    await expect(page.locator('#palette [data-atlas="checked"][data-asset]')).toHaveCount(2);
  });
}
