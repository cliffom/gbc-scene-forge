import assert from 'node:assert/strict';
import { array, record, string } from '../../../frontend/shared/decode.mts';
import { expect, type Page } from '@playwright/test';
import { test, editorReady, paint } from '../support/browser-fixtures.ts';

test.use({ projectMode: 'sample' });

async function openScene(page: Page, url: string) {
  await page.goto(url);
  await editorReady(page);
  await page.locator('#scenes').selectOption({ index: 1 });
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
}

async function panes(page: Page, library: boolean, inspector: boolean) {
  for (const [name, expanded] of [
    ['library', library],
    ['inspector', inspector],
  ] as const) {
    const toggle = page.locator(`#toggle-${name}`);
    if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) {
      await toggle.focus();
      await page.keyboard.press('Enter');
    }
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
    await expect(toggle).toHaveText(
      `${expanded ? 'Hide' : 'Show'} ${name === 'library' ? 'Library' : 'Inspector'}`,
    );
    await expect(page.locator(`#${name}-pane`)).toBeVisible({ visible: expanded });
  }
}

const combinations = [
  [true, true],
  [false, true],
  [true, false],
  [false, false],
] as const;

test('panes expand the viewport independently at supported widths and survive review and navigation', async ({
  page,
  forge,
}, info) => {
  await openScene(page, forge.url);
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [760, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await panes(page, true, true);
    const original = await page.locator('#viewport').evaluate((node) => node.clientWidth);
    const libraryWidth = await page
      .locator('#library-pane')
      .evaluate((node) => node.getBoundingClientRect().width);
    const inspectorWidth = await page
      .locator('#inspector-pane')
      .evaluate((node) => node.getBoundingClientRect().width);
    for (const [library, inspector] of combinations) {
      await panes(page, library, inspector);
      await expect
        .poll(() => page.locator('#viewport').evaluate((node) => node.clientWidth))
        .toBe(original + (library ? 0 : libraryWidth) + (inspector ? 0 : inspectorWidth));
      expect(
        await page.evaluate(() => {
          const viewport = document.getElementById('viewport');
          if (!viewport) {
            throw Error('Expected viewport');
          }
          const view = viewport.getBoundingClientRect();
          return (
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight &&
            view.height >= 160 &&
            view.right <= innerWidth
          );
        }),
      ).toBe(true);
      for (const id of ['toggle-library', 'toggle-inspector', 'review-mode', 'fit-scene', 'save']) {
        expect(
          await page.locator(`#${id}`).evaluate((node) => {
            const box = node.getBoundingClientRect();
            return (
              box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
            );
          }),
        ).toBe(true);
      }
      await page.locator('#fit-scene').click();
      await expect(page.locator('#zoom')).toHaveValue('fit');
      await expect
        .poll(() =>
          page.locator('#scene').evaluate((node) => {
            const viewport = document.getElementById('viewport');
            const container = document.getElementById('canvas-surround');
            if (!viewport || !container || !(node instanceof HTMLCanvasElement)) {
              throw Error('Expected scene viewport');
            }
            const surround = getComputedStyle(container);
            const available =
              viewport.clientWidth -
              parseFloat(surround.paddingLeft) -
              parseFloat(surround.paddingRight) -
              2;
            return node.getBoundingClientRect().width <= Math.max(node.width, available) + 1;
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(
          `panes-${width}-${library ? 'library' : 'no-library'}-${inspector ? 'inspector' : 'no-inspector'}.png`,
        ),
      });
      await page.locator('#review-mode').click();
      await expect(page.locator('#library-pane')).toBeHidden();
      await expect(page.locator('#inspector-pane')).toBeHidden();
      await page.locator('#review-mode').press('Escape');
      await expect(page.locator('#library-pane')).toBeVisible({ visible: library });
      await expect(page.locator('#inspector-pane')).toBeVisible({ visible: inspector });
      await expect(page.locator('#undo')).toBeDisabled();
      await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    }
  }
  await page.locator('#scenes').selectOption({ index: 2 });
  await expect(page.locator('#scene-name')).toContainText('Courtyard');
  await expect(page.locator('#toggle-library')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#toggle-inspector')).toHaveAttribute('aria-expanded', 'false');
  // Choices belong only to this mounted editor, so a reload starts expanded.
  await page.reload();
  await expect(page.locator('#toggle-library')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#toggle-inspector')).toHaveAttribute('aria-expanded', 'true');
});

test('pane transitions preserve dirty content, selection, brush, category, history and checkpoint', async ({
  page,
  forge,
}) => {
  await openScene(page, forge.url);
  await page.locator('#zoom').selectOption('2');
  const originalName = await page.locator('#layer-name').inputValue();
  await page.locator('#layer-name').fill('Pane state regression');
  await page.locator('#layer-name').press('Tab');
  await page.locator('[data-asset="sample/grass"]').first().click();
  await page.locator('input[name=tool][value=select]').check();
  const box = await page.locator('#scene').boundingBox();
  assert(box);
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 44, box.y + 44, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#copy-selection')).toBeEnabled();
  await page.locator('#stamps-tab').click();
  await expect(page.locator('#draft-status')).toHaveText('Draft checkpoint saved');
  const drafts = async () => {
    const catalog = record(
      await (await page.request.get(new URL('api/project', forge.url).href)).json(),
    );
    const response = await page.request.post(new URL('api/list-drafts', forge.url).href, {
      headers: { 'X-Scene-Token': string(catalog.token) },
      data: {},
    });
    expect(response.ok()).toBe(true);
    return array(record(await response.json()).drafts, record);
  };
  const checkpoint = await drafts();
  expect(checkpoint).toHaveLength(1);
  const state = () =>
    page.evaluate(() => ({
      tool: document.querySelector<HTMLInputElement>('input[name=tool]:checked')?.value,
      brush: document.getElementById('selected-brush')?.textContent,
      layer: document.querySelector<HTMLInputElement>('#layers input:checked')?.value,
      name: document.querySelector<HTMLInputElement>('#layer-name')?.value,
      selection: document.getElementById('selection-detail')?.textContent,
      category: document.querySelector('[role=tab][aria-selected=true]')?.id,
      dirty: document.getElementById('scene-save-state')?.textContent,
      undo: document.querySelector<HTMLButtonElement>('#undo')?.disabled,
      redo: document.querySelector<HTMLButtonElement>('#redo')?.disabled,
    }));
  const before = await state();
  for (const [library, inspector] of combinations) {
    await panes(page, library, inspector);
    expect(await state()).toEqual(before);
    await page.locator('#review-mode').click();
    await page.locator('#review-mode').click();
    expect(await state()).toEqual(before);
  }
  expect(await drafts()).toEqual(checkpoint);
  // The only history entry is still the authored layer-name change.
  await page.locator('#undo').click();
  await expect(page.locator('#layer-name')).toHaveValue(originalName);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  await expect(page.locator('#layer-name')).toHaveValue('Pane state regression');
  // Author through the expanded viewport with both panes closed. The selected
  // grass brush survives; a real pointer erases a known tile at its new position.
  await page.locator('#scene').focus();
  await page.keyboard.press('e');
  await paint(page, 4, 4);
  await expect(page.locator('#status')).not.toHaveAttribute('data-state', 'error');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#save').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  const id = await page.locator('#scenes').inputValue();
  const response = await page.request.get(
    new URL(`api/scene/${encodeURIComponent(id)}`, forge.url).href,
  );
  expect(response.ok()).toBe(true);
  const saved = record(record(await response.json()).scene);
  const ground = array(saved.layers, record)[0];
  expect(array(ground.cells, (row) => array(row, string))[0][0]).toBe('');
});

test('pane focus is safe, hidden controls leave Tab order, and guided reveal reopens Library', async ({
  page,
  forge,
}) => {
  await openScene(page, forge.url);
  await page.locator('#stamps-tab').click();
  await page.locator('#stamps').focus();
  // A programmatic activation keeps focus inside the pane until its hide handler runs.
  await page.locator('#toggle-library').evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) {
      throw Error('Expected pane toggle');
    }
    node.click();
  });
  await expect(page.locator('#toggle-library')).toBeFocused();
  await page.locator('#layer-name').focus();
  await page.locator('#toggle-inspector').evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) {
      throw Error('Expected pane toggle');
    }
    node.click();
  });
  await expect(page.locator('#toggle-inspector')).toBeFocused();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('#library-pane, #inspector-pane'),
      ),
    ).toBe(false);
  }
  await page.locator('#show-first-scene-guide').click();
  await page.locator('#guide-next').click();
  await expect(page.locator('#guide-action')).toBeEnabled();
  await page.locator('#guide-action').click();
  await expect(page.locator('#library-pane')).toBeVisible();
  await expect(page.locator('#artwork-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#import-atlas-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector-pane')).toBeHidden();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
});

test('pane changes retain a panned scene center and pointer cell coordinates', async ({
  page,
  forge,
}) => {
  await openScene(page, forge.url);
  await page.locator('#zoom').selectOption('8');
  const viewport = page.locator('#viewport');
  await viewport.evaluate((node) => node.scrollTo(400, 300));
  const center = () =>
    page.locator('#scene').evaluate((node) => {
      const view = document.getElementById('viewport');
      if (!view) {
        throw Error('Expected viewport');
      }
      const v = view.getBoundingClientRect(),
        c = node.getBoundingClientRect();
      return [
        (v.left + view.clientWidth / 2 - c.left) / 8,
        (v.top + view.clientHeight / 2 - c.top) / 8,
      ];
    });
  const before = await center();
  for (const [library, inspector] of [...combinations, [true, true]] as const) {
    await panes(page, library, inspector);
    const after = await center();
    expect(Math.abs(after[0] - before[0])).toBeLessThan(1);
    expect(Math.abs(after[1] - before[1])).toBeLessThan(1);
    const point = await viewport.boundingBox();
    assert(point);
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
    await expect(page.locator('#coordinates')).toHaveText(
      `Cell ${Math.floor(before[0] / 8)}, ${Math.floor(before[1] / 8)} · Pixel ${Math.floor(before[0])}, ${Math.floor(before[1])}`,
    );
  }
  await expect(page.locator('#undo')).toBeDisabled();
});
