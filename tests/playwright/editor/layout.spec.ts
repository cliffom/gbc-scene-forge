import { expect } from '@playwright/test';
/** Layout and keyboard acceptance for the editor command hierarchy. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { clickControl, test, waitForUI } from '../support/browser-fixtures.ts';
test('layout: Layout and keyboard acceptance for the editor command hierarchy.', async ({
  page,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  const root = join(folder, 'world');
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project.from_sample(Path(sys.argv[1]), title='Forest and village')
p.objects.save_stamp('Forest entrance with a long descriptive stamp name', dict(width=1, height=1, grid=8,
    cells=[['sample/grass/0/0']]), [0], p.catalog()['revision'])
print(p.catalog()['project']['scenes'][0]['id'])
`,
    root,
  ]);
  const scene = stdout.trim();
  const url = await workspace.start(root);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await waitForUI(
    page,
    "document.getElementById('status')?.textContent === 'Choose a scene, or import an atlas and create one.' && document.getElementById('scenes')?.disabled === false",
  );
  await page.evaluate(
    `document.getElementById('scenes').value=${JSON.stringify(scene)}; document.getElementById('scenes').dispatchEvent(new Event('change'));`,
  );
  await waitForUI(page, "document.getElementById('scene-save-state').textContent === 'Saved'");
  const evaluate = (expression: string) => page.evaluate(expression);
  const click = (id: string) => clickControl(page, id);
  const key = async (name: string) => {
    await page.keyboard.down(name);
    await page.keyboard.up(name);
  };
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [760, 640],
    [1440, 600],
  ]) {
    await page.setViewportSize({ width: width, height: height });
    await page.screenshot({ path: testInfo.outputPath(`editor-layout-${width}` + '.png') });
    assert.equal(
      await evaluate(`(() => {
      const viewport = document.getElementById('viewport').getBoundingClientRect();
      const footer = document.querySelector('.status-bar').getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight && viewport.height >= 160 &&
        viewport.bottom <= footer.top;
    })()`),
      true,
      `Canvas and footer fit ${width}×${height}`,
    );
    // All visible single-value selects reserve arrow space and stay inside their panels.
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelectorAll('select:not([multiple]):not([size])')).filter(s => s.checkVisibility()).flatMap(s => {
      const r = s.getBoundingClientRect(), css = getComputedStyle(s);
      return parseFloat(css.paddingRight) >= 28 && r.left >= 0 && r.right <= innerWidth ? [] : [s.id];
    })`),
      [],
      `Dropdown arrow clearance at ${width}×${height}`,
    );
    await click('stamps-tab');
    await expect(page.locator('#stamps-panel')).toHaveJSProperty('hidden', false);
    await page.locator('#stamps').selectOption({ index: 1 });
    assert.equal(
      await evaluate(`(() => {
      const select=document.getElementById('stamps'), panel=document.getElementById('stamps-panel');
      const r=select.getBoundingClientRect(), p=panel.getBoundingClientRect();
      return r.width >= 150 && r.left >= p.left && r.right <= p.right &&
        select.title === select.selectedOptions[0].textContent;
    })()`),
      true,
      `Long stamp names are bounded and available in full at ${width}`,
    );
    await page.screenshot({ path: testInfo.outputPath(`editor-stamps-${width}` + '.png') });
    await click('scene-commands');
    await waitForUI(
      page,
      "document.getElementById('scene-command-panel').matches(':popover-open')",
    );
    // The native open state precedes the toggle handler that positions the panel.
    await expect(page.locator('#scene-commands')).toHaveAttribute('aria-expanded', 'true');
    assert.equal(
      await evaluate(`(() => {
      const r=document.getElementById('scene-command-panel').getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    })()`),
      true,
      `Command popover stays in ${width}×${height}`,
    );
    await key('Escape');
    await expect(page.locator('#scene-commands')).toHaveAttribute('aria-expanded', 'false');
    await click('artwork-tab');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Rebuilding artwork on scene changes preserves the user's chosen library category.
  await click('stamps-tab');
  await page.locator('#scenes').selectOption({ index: 2 });
  await waitForUI(
    page,
    "document.getElementById('scene-name').textContent.startsWith('Courtyard ·')",
  );
  assert.equal(
    await evaluate("document.getElementById('stamps-tab').getAttribute('aria-selected')"),
    'true',
  );
  await page.locator('#scenes').selectOption(scene);
  await waitForUI(
    page,
    "document.getElementById('scene-name').textContent.startsWith('Riverside ·')",
  );
  await click('artwork-tab');
  // Tabs follow the WAI keyboard pattern and keep a single Tab stop.
  await page.locator('#artwork-tab').focus();
  await key('ArrowRight');
  assert.equal(await evaluate('document.activeElement.id'), 'objects-tab');
  await expect(page.locator('#objects-panel')).toHaveJSProperty('hidden', false);
  await key('End');
  assert.equal(await evaluate('document.activeElement.id'), 'stamps-tab');
  await key('Home');
  assert.equal(await evaluate('document.activeElement.id'), 'artwork-tab');
  assert.equal(await evaluate('document.querySelectorAll(\'[role=tab][tabindex="0"]\').length'), 1);
  // Native popover dismissal and keyboard focus, then a command's modal autofocus.
  await page.locator('#scene-commands').focus();
  await key('Enter');
  await waitForUI(page, "document.getElementById('scene-command-panel').matches(':popover-open')");
  await key('Escape');
  assert.equal(await evaluate('document.activeElement.id'), 'scene-commands');
  await click('scene-commands');
  await click('show-rename');
  await waitForUI(page, "document.getElementById('scene-manage-dialog').open");
  assert.equal(
    await evaluate("document.getElementById('scene-command-panel').matches(':popover-open')"),
    false,
  );
  assert.equal(await evaluate('document.activeElement.id'), 'scene-manage-name');
  await key('Escape');
  await click('project-commands');
  await page.screenshot({ path: testInfo.outputPath('editor-project-commands' + '.png') });
  await click('show-diagnostics');
  await waitForUI(page, "document.getElementById('diagnostics-dialog').open");
  assert.equal(
    await evaluate("document.getElementById('project-command-panel').matches(':popover-open')"),
    false,
  );
  await key('Escape');
  // Palette problems remain visible even while the secondary commands are closed.
  await evaluate("document.getElementById('show-palettes').dataset.state='fail'");
  await waitForUI(
    page,
    "document.getElementById('project-commands').getAttribute('aria-label').includes('exceeded')",
  );
  assert.equal(await evaluate("document.querySelector('.command-alert').checkVisibility()"), true);
  await page.screenshot({ path: testInfo.outputPath('editor-palette-warning' + '.png') });
  await evaluate("document.getElementById('show-palettes').dataset.state='pending'");
  await click('objects-tab');
  await page.screenshot({ path: testInfo.outputPath('editor-objects-desktop' + '.png') });
  await click('stamps-tab');
  await page.screenshot({ path: testInfo.outputPath('editor-stamps-desktop' + '.png') });
  await click('place-stamp');
  assert.equal(
    await evaluate("document.getElementById('place-stamp').getAttribute('aria-pressed')"),
    'true',
  );
  await expect(page.locator('#place-stamp')).toHaveText('Stop placing');
  await click('place-stamp');
  assert.equal(
    await evaluate("document.getElementById('place-stamp').getAttribute('aria-pressed')"),
    'false',
  );
  // The first-scene guide can reveal a control in a different library category.
  await click('show-first-scene-guide');
  for (let step = 0; step < 3; step++) {
    await click('guide-next');
  }
  await expect(page.locator('#guide-action')).toBeEnabled();
  await click('guide-action');
  assert.equal(
    await evaluate("document.getElementById('artwork-tab').getAttribute('aria-selected')"),
    'true',
  );
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await evaluate('document.activeElement.blur()');
  await page.screenshot({ path: testInfo.outputPath('editor-layout-desktop' + '.png') });

  console.log('Editor layout acceptance passed.');
});

test('project chooser: complete hover and keyboard boundaries while scrolling and zooming', async ({
  page,
  workspace,
}, testInfo) => {
  const root = join(workspace.folder, 'projects');
  await promisify(execFile)(workspace.python, [
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
for n in range(15):
    Project.create(Path(sys.argv[1]) / f'world-{n:02}', f'World {n:02}')
`,
    root,
  ]);
  await page.goto(await workspace.start(root, false, false));
  const cards = page.locator('#project-list .project-card');
  await expect(cards).toHaveCount(15);
  const density = await page.context().newCDPSession(page);
  // Chromium-only desktop zoom emulation: browser zoom changes CSS viewport and DPR
  // together. Playwright's viewport API alone cannot emulate that relationship.
  for (const [width, height, zoom] of [
    [1440, 1000, 1],
    [760, 640, 1],
    [1440, 1000, 1.25],
  ]) {
    await density.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width / zoom),
      height: Math.round(height / zoom),
      deviceScaleFactor: zoom,
      mobile: false,
    });
    for (const index of [0, 7, 14]) {
      const card = cards.nth(index);
      await card.scrollIntoViewIfNeeded();
      const before = await card.boundingBox();
      const scrollWidth = await page
        .locator('#project-list')
        .evaluate((element) => element.scrollWidth);
      await card.hover();
      await expect(card).toHaveCSS('outline-offset', '-2px');
      await expect(card).toHaveCSS('outline-style', 'solid');
      await expect(card).toHaveCSS('outline-width', '2px');
      expect(await card.boundingBox()).toEqual(before);
      expect(await page.locator('#project-list').evaluate((element) => element.scrollWidth)).toBe(
        scrollWidth,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1440 && zoom === 1 && index === 0) {
        // Reproduce the shipped rule solely for before/after review evidence.
        const rule = await page.evaluate(() => {
          const sheet = document.styleSheets[0];
          return sheet.insertRule(
            '.project-card:hover {outline-offset: 0 !important}',
            sheet.cssRules.length,
          );
        });
        await page.screenshot({ path: testInfo.outputPath('chooser-before.png') });
        await page.evaluate((index) => document.styleSheets[0].deleteRule(index), rule);
        await page.screenshot({ path: testInfo.outputPath('chooser-after.png') });
      }
      await page.screenshot({ path: testInfo.outputPath(`chooser-${width}-${zoom}-${index}.png`) });
    }
    // Tab into the chooser from its preceding control and traverse the entire list.
    await page.locator('#project-starter').focus();
    let visited = 0;
    for (let step = 0; step < 40 && visited < 15; step++) {
      await page.keyboard.press('Tab');
      const index = await cards.evaluateAll((elements) =>
        elements.findIndex((element) => element === document.activeElement),
      );
      if (index < 0) {
        continue;
      }
      visited++;
      await expect(cards.nth(index)).toBeFocused();
      expect(await cards.nth(index).evaluate((element) => element.matches(':focus-visible'))).toBe(
        true,
      );
      await expect(cards.nth(index)).toHaveCSS('outline-offset', '-2px');
      expect(
        await cards.nth(index).evaluate((element) => {
          const r = element.getBoundingClientRect();
          const p = element.parentElement?.getBoundingClientRect();
          return (
            p &&
            r.left >= p.left &&
            r.right <= p.right &&
            r.top >= p.top - 1 &&
            r.bottom <= p.bottom + 1
          );
        }),
      ).toBe(true);
    }
    expect(visited).toBe(15);
  }
  await density.detach();
});
