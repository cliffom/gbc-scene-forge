import { revealArtworkControl, reviewArtwork, saveArtwork } from '../support/artwork-controls.ts';
/** Bounds and real input acceptance for the shared scene/pixel command hierarchy. */
import { expect, type Page } from '@playwright/test';
import { test, clickControl, editorReady, paint } from '../support/browser-fixtures.ts';

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
    const nodes = [...panel.querySelectorAll<HTMLElement>(selector)].filter(
      (n) => n.checkVisibility() && !n.closest('.art-swatches'),
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

  test('save and export are keyboard-accessible in their menus, shortcuts and guide', async ({
    page,
    forge,
  }, info) => {
    await page.setViewportSize({ width: 760, height: 640 });
    await page.goto(forge.url);
    await editorReady(page);
    await page.locator('#scenes').selectOption({ index: 1 });
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await expect(page.locator('.document-actions > button')).toHaveText([
      'Scene actions',
      'Project tools!',
    ]);
    await expect(page.locator('#save')).toBeHidden();
    await expect(page.locator('#show-export')).toBeHidden();
    await page.locator('#layer-name').fill('Save through the scene menu');
    await page.locator('#layer-name').press('Tab');
    await page.locator('#scene-commands').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(page.locator('#save')).toBeFocused();
    await expect(page.locator('#save')).toHaveAccessibleName('Save scene');
    await boundedCommands(page, '#scene-command-panel', 'button');
    await page.screenshot({ path: info.outputPath('scene-save-menu.png') });
    await page.keyboard.press('Enter');
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await expect(page.locator('#save')).toBeHidden();
    for (const shortcut of ['Control+s', 'Meta+s']) {
      await page.locator('#layer-name').fill(`Save through ${shortcut}`);
      await page.locator('#scene').focus();
      await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
      await page.keyboard.press(shortcut);
      await expect(page.locator('#scene-save-state')).toHaveText('Saved');
      await expect(page.locator('#save')).toBeHidden();
    }
    await page.locator('#layer-name').fill('Save through the guide');
    await page.locator('#layer-name').press('Tab');
    await page.locator('#show-first-scene-guide').click();
    await page.locator('#guide-restart').click();
    for (let i = 0; i < 4; i++) {
      await page.locator('#guide-next').click();
    }
    await expect(page.locator('#guide-text')).toContainText('Scene actions → Save scene');
    await page.locator('#guide-action').click();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await page.locator('#show-first-scene-guide').click();
    await page.locator('#guide-next').click();
    await page.locator('#guide-next').click();
    await expect(page.locator('#guide-text')).toContainText('Project tools → Export');
    await page.locator('#guide-action').click();
    await expect(page.locator('#export-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#project-commands').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(page.locator('#show-export')).toBeFocused();
    await boundedCommands(page, '#project-command-panel', 'button, label');
    await page.screenshot({ path: info.outputPath('project-export-menu.png') });
    await page.keyboard.press('Enter');
    await expect(page.locator('#export-dialog')).toBeVisible();
    await expect(page.locator('#project-command-panel')).toBeHidden();
  });

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

  test('toolbar resizing preserves keyboard focus without taking it from other controls', async ({
    page,
    forge,
  }) => {
    await page.goto(forge.url);
    await editorReady(page);
    await page.locator('#scenes').selectOption({ index: 1 });
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    const expand = page.locator('#expand-scene-tools');
    await page.setViewportSize({ width: 1280, height: 900 });
    const paint = page.getByRole('radio', { name: 'Paint', exact: true });
    await paint.focus();
    await page.setViewportSize({ width: 760, height: 640 });
    await expect(paint).toBeHidden();
    await expect(expand).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(paint).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(paint).toBeHidden();

    // The trigger itself disappears when all commands fit on the first row.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#toggle-library').click();
    await page.locator('#toggle-inspector').click();
    await expect(expand).toBeHidden();
    await page.setViewportSize({ width: 760, height: 640 });
    await expect(expand).toBeVisible();
    await expand.focus();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('#review-mode')).toBeFocused();

    await page.locator('#toggle-library').click();
    await page.locator('#toggle-inspector').click();
    await paint.focus();
    await page.locator('#scenes').focus();
    await page.setViewportSize({ width: 760, height: 640 });
    await expect(page.locator('#scenes')).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
    await paint.focus();
    await paint.evaluate((node) => node.blur());
    await page.setViewportSize({ width: 760, height: 640 });
    await expect(page.locator('body')).toBeFocused();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  });

  test('Inspector collapse stays reachable after scrolling and with selection first', async ({
    page,
    forge,
  }, info) => {
    await page.goto(forge.url);
    await editorReady(page);
    await page.locator('#scenes').selectOption({ index: 1 });
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    const inspector = page.locator('#inspector-pane');
    const toggle = page.locator('#toggle-inspector');
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const selected of [false, true]) {
        if (!selected) {
          await page.locator('#scene').focus();
          await page.keyboard.press('Escape');
          await expect(inspector).not.toHaveClass(/has-selection/);
        }
        if (selected) {
          await page.locator('#fit-scene').click();
          const expand = page.locator('#expand-scene-tools');
          if (
            (await expand.isVisible()) &&
            (await expand.getAttribute('aria-expanded')) === 'false'
          ) {
            await expand.click();
          }
          await page.getByRole('radio', { name: 'Select', exact: true }).check();
          await paint(page, 12, 12);
          await expect(inspector).toHaveClass(/has-selection/);
        }
        await inspector.evaluate((node) => (node.scrollTop = node.scrollHeight));
        expect(await inspector.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
        expect(
          await toggle.evaluate((node) => {
            const r = node.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return r.top >= 0 && r.bottom <= innerHeight && !!hit && node.contains(hit);
          }),
        ).toBe(true);
        const scroll = await inspector.evaluate((node) => node.scrollTop);
        // Use the physical pointer: locator.click would scroll an offscreen arrow into view.
        const rect = await toggle.boundingBox();
        if (!rect) {
          throw Error('Expected Inspector toggle bounds');
        }
        await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await expect(inspector).toBeHidden();
        await toggle.click();
        await expect(inspector).toBeVisible();
        expect(await inspector.evaluate((node) => node.scrollTop)).toBe(scroll);
      }
      await page.screenshot({ path: info.outputPath(`inspector-scrolled-${width}-${height}.png`) });
    }
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
    await page.locator('#art-existing-mode').click();
    await expect(page.locator('#artwork-heading')).toHaveText('Open artwork');
    await expect(page.locator('#document-switcher')).toBeHidden();
    await expect(page.locator('#art-source-help')).not.toBeEmpty();
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
    await page.locator('#art-new-mode').click();
    await expect(page.locator('#artwork-heading')).toHaveText('New artwork');
    await expect(page.locator('#document-switcher')).toBeHidden();
    await (await revealArtworkControl(page, 'art-id')).fill('toolbar_tile');
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
    await reviewArtwork(page);
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
        await boundedCommands(page, '.art-toolbar', '.tool,button');
        await boundedCommands(
          page,
          '.art-toolbar',
          'input[type=color],input[type=number],select,button,.pixel-view-controls>label:last-child',
        );
        await boundedCommands(page, '#art-editor>.dialog-actions', 'button');
        const bottoms = await page
          .locator('.color-controls')
          .evaluate((node) =>
            ['#art-color', '#art-alpha', '#art-transparent'].map(
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
    await revealArtworkControl(page, 'art-drafts');
    await expect(page.getByRole('button', { name: 'Recover copy', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('recovery.png') });
    await revealArtworkControl(page, 'art-drafts');
    await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
    await expect(page.locator('#art-canvas')).toBeFocused();
    await reviewArtwork(page);
    await expect(page.locator('#art-save')).toBeEnabled();
    await saveArtwork(page);
    await page.locator('#art-close').click();
    await expect(page.locator('#artwork-dialog')).not.toBeVisible();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  });
  test('artwork setup has clear navigation, complete Library labels and name-derived identity', async ({
    page,
    forge,
  }, info) => {
    await page.goto(forge.url);
    await editorReady(page);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      const browse = page.locator('#art-browse');
      await expect(browse).toHaveText('Browse / recover');
      expect(
        await browse.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const bounds = node.getBoundingClientRect();
          return (
            [...range.getClientRects()].every(
              (rect) =>
                rect.left >= bounds.left &&
                rect.right <= bounds.right &&
                rect.top >= bounds.top &&
                rect.bottom <= bounds.bottom,
            ) && node.scrollWidth <= node.clientWidth
          );
        }),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#show-artwork').click();
    await expect(page.locator('#document-switcher')).toBeHidden();
    const name = page.locator('#art-name');
    const id = await revealArtworkControl(page, 'art-id');
    await name.fill("Player's Sprite");
    await expect(id).toHaveValue('players_sprite');
    await name.fill('Player’s Sprite!');
    await expect(id).toHaveValue('players_sprite');
    await name.fill('  Café   Hero  ');
    await expect(id).toHaveValue('cafe_hero');
    await name.fill('123 Hero');
    await expect(id).toHaveValue('art_123_hero');
    await name.fill('!!!');
    await expect(id).toHaveValue('artwork');
    await name.fill("Player's Sprite");
    await page.screenshot({ path: info.outputPath('name-derived-identity.png') });
    await id.fill('my_player');
    await name.fill("Player's Artwork");
    await expect(id).toHaveValue('my_player');
    await page.locator('#art-create').click();
    await expect(page.locator('#document-switcher')).toHaveText("Player's Artwork ▾");
    await page.locator('#show-artwork').click();
    await expect(page.locator('#document-switcher')).toHaveText('Documents ▾');
    await expect(await revealArtworkControl(page, 'art-id')).toHaveValue('new_artwork');
  });

  test('Inspector keyboard traversal keeps controls below the sticky heading', async ({
    page,
    forge,
  }) => {
    await page.setViewportSize({ width: 760, height: 640 });
    await page.goto(forge.url);
    await editorReady(page);
    await page.locator('#scenes').selectOption({ label: 'Riverside' });
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await page.locator('#show-recovery').focus();
    for (const key of ['Shift+Tab', 'Tab']) {
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press(key);
        expect(
          await page.evaluate(() => {
            const active = document.activeElement;
            if (
              !(active instanceof HTMLElement) ||
              !active.closest('#inspector-pane') ||
              active.closest('#inspector-heading')
            ) {
              return true;
            }
            const target = active.closest('.layer-row') ?? active;
            const r = target.getBoundingClientRect();
            const heading = document.getElementById('inspector-heading');
            if (!heading) {
              throw Error('Missing Inspector heading');
            }
            const header = heading.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return r.top >= header.bottom && !!hit && target.contains(hit);
          }),
        ).toBe(true);
      }
    }
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
  await reviewArtwork(page);
  await expect(page.locator('#art-save')).toBeEnabled();
  await saveArtwork(page);
  await page.locator('#art-close').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  await page.locator('#empty-create').click();
  await page.locator('#scene-title').fill('My first scene');
  await page.locator('#scene-form button.primary').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#palette .asset').first().click();
  await paint(page, 4, 4);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await clickControl(page, 'save');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#scene-name')).toContainText('My first scene');
  await clickControl(page, 'show-export');
  await page.locator('#export-scope').selectOption('project');
  const download = page.waitForEvent('download');
  await page.locator('#export-confirm').click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  await expect(page.locator('#first-scene-guide')).toBeHidden();
});
