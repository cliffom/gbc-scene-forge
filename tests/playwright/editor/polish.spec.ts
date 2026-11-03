/** Bounds and real input acceptance for the shared scene/pixel command hierarchy. */
import { expect, type Page } from '@playwright/test';
import { test, editorReady, paint } from '../support/browser-fixtures.ts';

const sizes = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [760, 640],
  [1440, 600],
] as const;

// Check actual control rectangles rather than a screenshot hash or CSS implementation detail.
async function boundedCommands(page: Page, container: string, controls: string) {
  const failures = await page.locator(container).evaluate((panel, selector) => {
    const bounds = panel.getBoundingClientRect();
    const nodes = [...panel.querySelectorAll<HTMLElement>(selector)].filter((n) =>
      n.checkVisibility(),
    );
    const problems: string[] = [];
    for (const [i, node] of nodes.entries()) {
      const a = node.getBoundingClientRect();
      const name = node.id || node.textContent?.trim() || 'unnamed control';
      if (
        a.left < bounds.left - 1 ||
        a.right > bounds.right + 1 ||
        a.top < bounds.top - 1 ||
        a.bottom > bounds.bottom + 1
      ) {
        problems.push(`${name} outside ${panel.id || panel.className}`);
      }
      for (const other of nodes.slice(i + 1)) {
        const b = other.getBoundingClientRect();
        if (
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        ) {
          problems.push(`${name} overlaps ${other.id || other.textContent?.trim()}`);
        }
      }
    }
    return problems;
  }, controls);
  expect(failures).toEqual([]);
}

test.describe('editor polish', () => {
  test.use({ projectMode: 'sample' });

  test('scene command groups stay bounded with every pane configuration and desktop scaling', async ({
    page,
    forge,
  }, info) => {
    await page.goto(forge.url);
    await editorReady(page);
    await page.locator('#scenes').selectOption({ index: 1 });
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const library of [true, false]) {
        for (const inspector of [true, false]) {
          for (const [name, expanded] of [
            ['library', library],
            ['inspector', inspector],
          ] as const) {
            const toggle = page.locator(`#toggle-${name}`);
            if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) {
              await toggle.click();
            }
          }
          await boundedCommands(
            page,
            '.canvas-toolbar',
            '.tool, button, .zoom-controls>label, .selection-scope',
          );
          expect(
            await page.locator('.canvas-toolbar').evaluate((n) => n.clientHeight),
          ).toBeLessThanOrEqual(50);
          const expand = page.locator('#expand-scene-tools');
          if (await expand.isVisible()) {
            const zoomTop = await page
              .locator('#zoom')
              .evaluate((n) => n.getBoundingClientRect().top);
            await expand.focus();
            await page.keyboard.press('Enter');
            await expect(page.locator('#scene-secondary-tools')).toBeVisible();
            await expect(page.locator('#scene-drawing-tools')).toBeVisible();
            await boundedCommands(
              page,
              '.canvas-toolbar',
              '.tool, button, .zoom-controls>label, .selection-scope',
            );
            expect(await page.locator('#zoom').evaluate((n) => n.getBoundingClientRect().top)).toBe(
              zoomTop,
            );
            expect(
              await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
            ).toBe(true);
            await page.keyboard.press('Escape');
            await expect(expand).toHaveAttribute('aria-expanded', 'false');
            await expect(expand).toBeFocused();
          }
          // Edge anchors remain reachable without covering commands or the canvas.
          for (const name of ['library', 'inspector']) {
            expect(
              await page.locator(`#toggle-${name}`).evaluate((node, side) => {
                const r = node.getBoundingClientRect();
                const workbench = document.querySelector('.workbench')?.getBoundingClientRect();
                const pane = document.getElementById(`${side}-pane`);
                const heading = document.getElementById(`${side}-heading`)?.getBoundingClientRect();
                const p = pane?.getBoundingClientRect();
                const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return (
                  workbench &&
                  node.contains(target) &&
                  r.left >= 0 &&
                  r.right <= innerWidth &&
                  (side === 'library' ? r.right <= workbench.left : r.left >= workbench.right) &&
                  (pane?.hidden ||
                    (p &&
                      heading &&
                      r.left >= heading.left &&
                      r.right <= heading.right &&
                      r.top >= heading.top &&
                      r.bottom <= heading.bottom &&
                      // Open panes meet the workbench directly, with no arrow column.
                      (side === 'library'
                        ? p.right === workbench.left
                        : p.left === workbench.right)))
                );
              }, name),
            ).toBe(true);
          }
          if (library) {
            await boundedCommands(page, '#library-heading', 'h2, button');
          }
          if (inspector) {
            await boundedCommands(page, '#inspector-heading', 'h2, #dirty, button');
          }
          expect(
            await page.locator('#viewport').evaluate((n) => n.clientHeight),
          ).toBeGreaterThanOrEqual(160);
          if (library && inspector) {
            await page.screenshot({ path: info.outputPath(`scene-${width}-${height}.png`) });
          }
        }
      }
    }
    // Native radios keep arrow navigation; switching tools does not modify the scene.
    const paint = page.getByRole('radio', { name: 'Paint', exact: true });
    await paint.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Fill', exact: true })).toBeChecked();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    const density = await page.context().newCDPSession(page);
    await density.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 640,
      deviceScaleFactor: 1.25,
      mobile: false,
    });
    await boundedCommands(
      page,
      '.canvas-toolbar',
      '.tool, button, .zoom-controls>label, .selection-scope',
    );
    await page.screenshot({ path: info.outputPath('scene-scaled.png') });
    await density.detach();
  });

  test('project path icons copy from the header and popover, with a selectable fallback', async ({
    page,
    context,
    forge,
  }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(forge.url);
    await editorReady(page);
    const path = await page.locator('#folder-path').textContent();
    expect(path).toBeTruthy();
    const headerCopy = page.locator('#copy-project-folder');
    await expect(headerCopy).toHaveAccessibleName('Copy project folder path');
    await headerCopy.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#project-copy-status')).toHaveText('Path copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(path);
    await expect(page.locator('#folder-popover')).toBeHidden();
    await expect(headerCopy).toBeFocused();

    await page.locator('#project-folder').click();
    await page.locator('#copy-folder').click();
    await expect(page.locator('#folder-copy-status')).toHaveText('Path copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(path);
    await page.screenshot({ path: info.outputPath('folder-copy-success.png') });
    await page.keyboard.press('Escape');
    // Permission failures expose a manual path without requiring an extra search.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error('Clipboard unavailable')),
        },
      });
    });
    await headerCopy.click();
    await expect(page.locator('#folder-popover')).toBeVisible();
    await expect(page.locator('#folder-copy-status')).toContainText('Select the path');
    await expect(page.locator('#copy-folder')).toBeEnabled();
    await expect(headerCopy).toHaveAttribute('title', 'Copy project folder path');
    await page.setViewportSize({ width: 760, height: 640 });
    await page.locator('#folder-path').evaluate((node) => {
      node.textContent = '/long-project-name/'.repeat(20);
    });
    await boundedCommands(page, '#folder-popover', '#folder-path, #copy-folder');
    await boundedCommands(page, '.masthead', '#project-folder, #copy-project-folder, .github-link');
    await page.screenshot({ path: info.outputPath('folder-copy-compact.png') });
  });

  test('collapsed tools reflect shortcuts and library choices without hiding viewing controls', async ({
    page,
    forge,
  }, info) => {
    await page.goto(forge.url);
    await editorReady(page);
    await page.locator('#scenes').selectOption({ index: 1 });
    await page.setViewportSize({ width: 760, height: 640 });
    const expand = page.locator('#expand-scene-tools');
    await page.locator('#scene').focus();
    await page.keyboard.press('e');
    await expect(expand).toHaveAccessibleName('Expand tools (Erase)');
    await page.locator('[data-asset="sample/grass"]').first().click();
    await expect(expand).toHaveAccessibleName('Expand tools (Paint)');
    await expand.click();
    await page.getByRole('radio', { name: 'Select', exact: true }).check();
    await expect(expand).toHaveAccessibleName('Collapse tools (Select)');
    await page.screenshot({ path: info.outputPath('toolbar-expanded-compact.png') });
    await expand.click();
    await expect(page.getByRole('radio', { name: 'Select', exact: true })).toBeHidden();
    await page.locator('#review-mode').click();
    await expect(expand).toBeHidden();
    await page.locator('#review-mode').press('Escape');
    await expect(expand).toHaveAccessibleName('Expand tools (Select)');
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  });

  test('artwork setup, tools, review and recovery fit short/narrow windows and retain keyboard input', async ({
    page,
    forge,
  }, info) => {
    await page.goto(forge.url);
    await editorReady(page);
    await page.locator('#scenes').selectOption({ index: 1 });
    await page.locator('#show-artwork').click();
    await expect(page.locator('#art-source')).toBeEnabled();
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.locator('#art-source').focus();
      await page.locator('#art-source').scrollIntoViewIfNeeded();
      expect(
        await page.locator('#art-source').evaluate((node) => {
          const r = node.getBoundingClientRect();
          const panel = document.getElementById('art-setup')?.getBoundingClientRect();
          return (
            panel &&
            r.left - 4 >= panel.left &&
            r.right + 4 <= panel.right &&
            r.top - 4 >= panel.top &&
            r.bottom + 4 <= panel.bottom
          );
        }),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`setup-${width}-${height}.png`) });
    }
    await page.locator('#art-id').fill('toolbar_tile');
    await page
      .locator('#art-name')
      .fill('A long artwork name for a reusable terrain variation and recovery checkpoint');
    await page.locator('#art-width').fill('8');
    await page.locator('#art-height').fill('8');
    await page.locator('#art-create').click();
    await expect(page.locator('#art-canvas')).toBeFocused();
    await expect(page.locator('#art-setup')).toBeHidden();
    // Select any of the eight tools in one click, without opening a dropdown.
    await page.getByRole('radio', { name: 'Rectangle outline', exact: true }).click();
    await expect(page.locator('#art-canvas')).toBeFocused();
    const pencil = page.getByRole('radio', { name: 'Pencil', exact: true });
    await pencil.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Eraser', exact: true })).toBeFocused();
    await expect(page.getByRole('radio', { name: 'Eraser', exact: true })).toBeChecked();
    await pencil.check();
    await page.locator('#art-canvas').click({ position: { x: 8, y: 8 } });
    await expect(page.getByRole('button', { name: 'Undo', exact: true }).last()).toBeEnabled();
    await page.locator('#art-review').click();
    await expect(page.locator('#art-save')).toBeEnabled();
    const density = await page.context().newCDPSession(page);
    for (const [width, height, scale] of [...sizes.map(([w, h]) => [w, h, 1]), [1024, 640, 1.25]]) {
      await page.setViewportSize({ width, height });
      await density.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      });
      for (const help of [false, true]) {
        await page.locator('.art-help').evaluate((node, open) => {
          if (!(node instanceof HTMLDetailsElement)) {
            throw Error('Expected drawing help disclosure');
          }
          node.open = open;
        }, help);
        await boundedCommands(page, '.pixel-toolbar', '.tool,button');
        await boundedCommands(
          page,
          '.art-tools',
          'input[type=color],input[type=number],select,button,.pixel-view-controls>label:last-child',
        );
        await boundedCommands(page, '#art-editor>.dialog-actions', 'button');
        const bottoms = await page
          .locator('.art-tools')
          .evaluate((node) =>
            ['#art-color', '#art-alpha', '#art-transparent', '#art-zoom'].map(
              (id) => node.querySelector(id)?.getBoundingClientRect().bottom ?? 0,
            ),
          );
        expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1);
        expect(
          await page.locator('.art-canvas-scroll').evaluate((node) => node.clientHeight),
        ).toBeGreaterThanOrEqual(120);
        expect(
          await page.locator('#artwork-dialog').evaluate((node) => {
            const r = node.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.top >= 0 &&
              r.right <= innerWidth &&
              r.bottom <= innerHeight &&
              node.scrollHeight <= node.clientHeight
            );
          }),
        ).toBe(true);
      }
      await page.screenshot({ path: info.outputPath(`pixels-${width}-${height}-${scale}.png`) });
    }
    await density.detach();
    await page.locator('#art-close').click();
    await page.locator('#show-artwork').click();
    await expect(page.getByRole('button', { name: 'Recover copy', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('recovery.png') });
    await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
    await expect(page.locator('#art-canvas')).toBeFocused();
    await page.locator('#art-review').click();
    await expect(page.locator('#art-save')).toBeEnabled();
    await page.locator('#art-save').click();
    await expect(page.locator('#artwork-dialog')).toBeHidden();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  });
});

test('first-use authoring from visible controls: empty artwork, draw, place, save, reopen and export', async ({
  page,
  forge,
}) => {
  await page.goto(forge.url);
  await page.locator('#project-title').fill('Empty artwork workshop');
  await page.locator('#project-form button.primary').click();
  await expect(page.locator('#show-artwork')).toBeEnabled();
  await page.locator('#show-artwork').click();
  await expect(page.locator('#art-source')).toBeDisabled();
  await expect(page.locator('#art-source')).toContainText('No artwork yet');
  await expect(page.locator('#art-open')).toBeDisabled();
  await expect(page.locator('#art-duplicate')).toBeDisabled();
  await expect(page.locator('#art-create')).toBeEnabled();
  await page.locator('#art-width').fill('8');
  await page.locator('#art-height').fill('8');
  await page.locator('#art-create').click();
  await page.locator('#art-canvas').click({ position: { x: 8, y: 8 } });
  await page.locator('#art-review').click();
  await expect(page.locator('#art-save')).toBeEnabled();
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).toBeHidden();
  await page.locator('#empty-create').click();
  await page.locator('#scene-title').fill('My first scene');
  await page.locator('#scene-form button.primary').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#palette .asset').first().click();
  await paint(page, 4, 4);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await page.locator('#save').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#scene-name')).toContainText('My first scene');
  await page.locator('#show-export').click();
  await page.locator('#export-scope').selectOption('project');
  const download = page.waitForEvent('download');
  await page.locator('#export-confirm').click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  await expect(page.locator('#first-scene-guide')).toBeHidden();
});
