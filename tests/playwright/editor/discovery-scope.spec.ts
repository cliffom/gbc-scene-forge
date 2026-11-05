/** Milestone 24 P1: visible task entries, browsing space and exact drawing boundaries. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { record, string } from '../../../frontend/shared/decode.mts';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  activateScene,
  chooseSavedScene,
  paint,
} from '../support/browser-fixtures.ts';
import { revealArtworkControl, saveArtwork } from '../support/artwork-controls.ts';

const seed = `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.from_sample(Path(sys.argv[1]),title='Discovery and scope')
a=p.artwork.documents
frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*16,y=0,width=16,height=16,origin=[4,8]) for i in range(2)]
a.save(a.create_sheet('player','Player poses','sprite',32,16,p.catalog()['revision'],frames=frames,sequences=[]))
`;

async function pixels(page: Page) {
  await expect(page.locator('#art-canvas')).toBeVisible();
  const control = await revealArtworkControl(page, 'art-download');
  const download = page.waitForEvent('download');
  await control.click();
  const path = await (await download).path();
  if (!path) {
    throw Error('Expected downloaded work');
  }
  const work = record(JSON.parse(await readFile(path, 'utf8')));
  await page.locator('.art-document-actions > summary').click();
  return Buffer.from(string(work.current_rgba), 'base64');
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 800, height: 640 },
]) {
  test(`saved-scene entry and sixteen-card browsing at ${viewport.width}`, async ({
    page,
    workspace,
  }, info) => {
    const root = join(workspace.folder, 'project');
    execFileSync(workspace.python, ['-I', '-c', seed, root]);
    await page.setViewportSize(viewport);
    await page.goto(await workspace.start(root));
    await expect(page.locator('#empty-open')).toBeVisible();
    await expect(page.locator('#document-switcher')).toContainText('Documents');
    await page.screenshot({ path: info.outputPath('entry.png') });
    await page.locator('#empty-open').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#scenes')).toBeFocused();
    await page.keyboard.press('r');
    await page.keyboard.press('Enter');
    await expect(page.locator('#document-switcher')).toContainText('Riverside · Scene');
    const measurements = await page.locator('#palette').evaluate((palette) => {
      const box = (r?: DOMRect) =>
        r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      const area = palette.getBoundingClientRect();
      const cards = [...palette.querySelectorAll('.asset')].map((n) => n.getBoundingClientRect());
      return {
        totalCards: cards.length,
        fullyVisibleCards: cards.filter((r) => r.top >= area.top && r.bottom <= area.bottom).length,
        firstAsset: box(cards[0]),
        drawingViewport: box(document.getElementById('viewport')?.getBoundingClientRect()),
      };
    });
    expect(measurements.totalCards).toBe(16);
    expect(measurements.fullyVisibleCards).toBeGreaterThan(
      viewport.width === 800 ? 0 : viewport.width === 1280 ? 2 : 4,
    );
    await writeFile(
      info.outputPath('measurements.json'),
      JSON.stringify({ viewport, ...measurements }, null, 2),
    );
    await page.screenshot({ path: info.outputPath('scene.png') });
    await page.locator('[data-asset="sample/flowers"]').click();
    await paint(page, 4, 4);
    await expect(page.locator('#document-state')).toHaveText('Modified');
    await page.locator('#save').click();
    await expect(page.locator('#document-state')).toHaveText('Saved');
    await page.locator('#close-document').click();
    await expect(page.locator('#empty-open')).toBeVisible();
    await page.locator('#empty-open').click();
    await page.locator('#scenes').selectOption({ label: 'Riverside' });
    await expect(page.locator('#document-state')).toHaveText('Saved');
    // Search remains the first task even with larger, long-named result sets.
    await page.locator('#search').fill('player');
    await expect(page.locator('#palette .asset:not([hidden])')).toHaveCount(2);
    await page.locator('#library-options > summary').click();
    await page.locator('#kind-filter').selectOption('sprite');
    await page.locator('#library-options > summary').click();
    await page.locator('#search').fill('');
    await expect(page.locator('#kind-filter')).toHaveValue('sprite');
  });
}

test('named pose constrains exact pixels; explicit sheet view and retained view survive save and reopen', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, ['-I', '-c', seed, root]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="player/f1"]').click();
  await expect(page.locator('#art-frame-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#art-drawing-scope')).toHaveText('Editing frame: Pose 1');
  await page.locator('#art-dock > summary').click();
  await expect(page.locator('#art-frame')).toBeVisible();
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  const expected = Buffer.alloc(32 * 16 * 4);
  expected.set([204, 119, 68, 255], (32 + 17) * 4);
  expect(await pixels(page)).toEqual(expected);
  await page.locator('#undo').click();
  expect(await pixels(page)).toEqual(Buffer.alloc(expected.length));
  await page.locator('#redo').click();
  await page.locator('#art-sheet-view').click();
  await expect(page.locator('#art-drawing-scope')).toHaveText('Editing entire sheet');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  expected.set([204, 119, 68, 255], (32 + 1) * 4);
  expect(await pixels(page)).toEqual(expected);
  await chooseSavedScene(page, { label: 'Riverside' });
  await expect(page.locator('#scene-name')).toContainText('Riverside ·');
  await expect(page.locator('#scene-surface')).toBeVisible();
  await page.locator('[data-asset="player/f1"]').click();
  await page.locator('#library-source-actions').click();
  await expect(page.locator('#library-edit-artwork')).toHaveAttribute('title', 'Edit player/f1');
  await page.locator('#library-edit-artwork').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await expect(page.locator('#art-sheet-view')).toHaveAttribute('aria-pressed', 'true');
  expect(await pixels(page)).toEqual(expected);
  await saveArtwork(page);
  await page.locator('#close-document').click();
  await activateScene(page);
  await expect(page.locator('#scene-surface')).toBeVisible();
  // In a scene the Library card selects a brush; open the selected native source explicitly.
  await page.locator('[data-asset="player/f1"]').click();
  await page.locator('#library-source-actions').click();
  await page.locator('#library-edit-artwork').click();
  await expect(page.locator('#art-frame')).toHaveValue('f1');
  await expect(page.locator('#art-frame-view')).toHaveAttribute('aria-pressed', 'true');
  expect(await pixels(page)).toEqual(expected);
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 800, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#art-drawing-scope')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`frame-${viewport.width}.png`) });
  }
});

test('larger long-name library keeps search, filters and source commands keyboard accessible', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Larger Library')
a=p.artwork.documents
frames=[dict(id=f'long_named_pose_{i}',name=f'Long named character pose {i} for a larger library',kind='sprite',x=(i%8)*16,y=(i//8)*16,width=16,height=16,origin=[4,8]) for i in range(64)]
a.save(a.create_sheet('long_named_character_collection','Larger library','sprite',128,128,p.catalog()['revision'],frames=frames,sequences=[]))
`,
    root,
  ]);
  await page.setViewportSize({ width: 800, height: 640 });
  await page.goto(await workspace.start(root));
  await expect(page.locator('#empty-open')).toBeHidden();
  await expect(page.locator('#palette .asset')).toHaveCount(64);
  await page.locator('#search').focus();
  await page.keyboard.type('long named pose 63');
  await expect(page.locator('#palette .asset:not([hidden])')).toHaveCount(1);
  await page.locator('#palette .asset:not([hidden])').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#art-frame')).toHaveValue('long_named_pose_63');
  await expect(page.locator('#art-frame-view')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#library-source-actions').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#source-command-panel')).toBeVisible();
  await expect(page.locator('#library-edit-artwork')).toBeInViewport();
  await expect(page.locator('#library-copy-source')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('large-library-source.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-source-actions')).toBeFocused();
});
