/** Deliberately delayed/failed Library reads exercise the real document ownership boundary. */
import { join } from 'node:path';
import { test, expect } from '../support/browser-fixtures.ts';
import { createOpeningFixture } from '../support/artwork-opening-fixture.ts';

for (const width of [1440, 760]) {
  test(`Library loading can be cancelled and superseded without a stale adoption at ${width}px`, async ({
    page,
    workspace,
  }, info) => {
    await page.setViewportSize({ width, height: width === 760 ? 640 : 1000 });
    const root = join(workspace.folder, 'project');
    createOpeningFixture(workspace.python, root);
    await page.goto(await workspace.start(root));
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received!: () => void;
    const requested = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route(
      '**/api/artwork-open',
      async (route) => {
        const response = await route.fetch();
        received();
        await delayed;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await page.locator('[data-asset="layered/artwork"]').click();
    await requested;
    await expect(page.locator('#art-loading-status')).toHaveText('Opening layered / artwork…');
    await expect(page.locator('#artwork-surface')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#art-setup')).toBeHidden();
    await expect(page.locator('#art-editor')).toBeHidden();
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#art-loading-cancel')).toBeEnabled();
    await page.screenshot({ path: info.outputPath('loading.png') });
    // Another asset abandons the read and acquires a new operation/document owner.
    await page.locator('[data-asset="small/artwork"]').click();
    await expect(page.locator('#art-editor')).toBeVisible();
    await expect(page.locator('#document-switcher')).toContainText('Small');
    const stale = page.waitForResponse((response) => response.url().endsWith('/api/artwork-open'));
    release();
    await stale;
    await expect(page.locator('#art-color')).toBeEnabled();
    await expect(page.locator('#art-loading')).toBeHidden();
    await expect(page.locator('#document-switcher')).toContainText('Small');
    // Explicit cancellation returns to the retained document with its controls usable.
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let fetched!: () => void;
    const fetchedResponse = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    await page.route(
      '**/api/artwork-open',
      async (route) => {
        const response = await route.fetch();
        fetched();
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await page.locator('[data-asset="large/artwork"]').click();
    await expect(page.locator('#art-loading-status')).toContainText('large');
    await fetchedResponse;
    await page.locator('#art-loading-cancel').focus();
    await page.locator('#art-loading-cancel').press('Enter');
    await expect(page.locator('#document-switcher')).toContainText('Small');
    await expect(page.locator('#art-color')).toBeEnabled();
    const abandoned = page.waitForResponse((response) =>
      response.url().endsWith('/api/artwork-open'),
    );
    finish();
    await abandoned;
    await expect(page.locator('#document-switcher')).toContainText('Small');
  });
}

test('failed opening can be retried while preserving another document and its history', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  createOpeningFixture(workspace.python, root);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="small/artwork"]').click();
  await page.locator('#art-color').fill('#ff0000');
  await page.locator('#art-canvas').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.route(
    '**/api/artwork-open',
    (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Artwork temporarily unavailable.' }),
      }),
    { times: 1 },
  );
  await page.locator('[data-asset="layered/artwork"]').click();
  await expect(page.locator('#art-loading-status')).toContainText('Could not open layered');
  await expect(page.locator('#artwork-surface')).toHaveAttribute('aria-busy', 'false');
  await expect(
    page.locator('.notification', { hasText: 'Artwork temporarily unavailable' }),
  ).toContainText('Retry opening');
  await expect(page.locator('#art-setup')).toBeHidden();
  await page.locator('#art-loading-retry').click();
  await expect(page.locator('#document-switcher')).toContainText('Layered');
  await expect(page.locator('#art-loading')).toBeHidden();
  await expect(
    page.locator('.notification', { hasText: 'Artwork temporarily unavailable' }),
  ).toHaveCount(0);
  await page.locator('[data-asset="small/artwork"]').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('#redo').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
});

test('failed outgoing checkpoints block replacement and retain exact local artwork', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  createOpeningFixture(workspace.python, root);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="small/artwork"]').click();
  let writing!: () => void;
  const written = new Promise<void>((resolve) => {
    writing = resolve;
  });
  let fail!: () => void;
  const failure = new Promise<void>((resolve) => {
    fail = resolve;
  });
  await page.route('**/api/artwork-draft-write', async (route) => {
    writing();
    await failure;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Checkpoint base changed.' }),
    });
  });
  await page.locator('#art-color').fill('#ff0000');
  await page.locator('#art-canvas').click({ position: { x: 8, y: 8 } });
  await page.locator('[data-asset="layered/artwork"]').click();
  await written;
  // Cancelling the read cannot suppress a failure from the outgoing write.
  await page.locator('#art-loading-cancel').click();
  fail();
  await expect(page.locator('#art-loading-status')).toContainText('Could not open');
  await expect(page.locator('.notification', { hasText: 'Could not open artwork' })).toContainText(
    'Checkpoint base changed',
  );
  await page.locator('#art-loading-cancel').click();
  await expect(page.locator('#document-switcher')).toContainText('Small');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.unroute('**/api/artwork-draft-write');
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('#redo').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('[data-asset="layered/artwork"]').click();
  await expect(page.locator('#document-switcher')).toContainText('Layered');
  await expect(page.locator('#art-color')).toBeEnabled();
});
