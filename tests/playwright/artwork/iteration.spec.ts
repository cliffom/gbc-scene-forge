/** Layer sources, wheel navigation and isolated local history in the real editor. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from '../support/browser-fixtures.ts';
import { revealArtworkControl, saveArtwork } from '../support/artwork-controls.ts';

test('wheel zoom preserves pointer coordinates and layers survive local undo, save and reopen', async ({
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
p=Project.create(Path(sys.argv[1]),'Iteration')
c=p.artwork.documents.create('picture','Picture','sprite',375,525,p.catalog()['revision'])
p.artwork.documents.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#art-zoom').selectOption('2');
  const viewport = page.locator('#art-viewport');
  await viewport.evaluate((n) => n.scrollBy(40, 25));
  const box = await viewport.boundingBox();
  if (!box) {
    throw Error('Expected viewport');
  }
  const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const anchor = async () => {
    const canvas = await page.locator('#art-canvas').boundingBox();
    if (!canvas) {
      throw Error('Expected canvas');
    }
    return [(pointer.x - canvas.x) / canvas.width, (pointer.y - canvas.y) / canvas.height];
  };
  await page.mouse.move(pointer.x, pointer.y);
  const before = await anchor();
  await page.mouse.wheel(0, -100);
  await expect(page.locator('#art-zoom')).toHaveValue('4');
  const after = await anchor();
  expect(Math.abs(after[0] - before[0])).toBeLessThan(0.002);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(0.002);
  await page.mouse.wheel(0, 100);
  await expect(page.locator('#art-zoom')).toHaveValue('2');
  const minimum = await page.locator('#art-zoom option').first().getAttribute('value');
  if (!minimum) {
    throw Error('Expected supported zoom');
  }
  await page.locator('#art-zoom').selectOption(minimum);
  await page.mouse.wheel(0, 10000);
  await expect(page.locator('#art-zoom')).toHaveValue(minimum);
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(page.locator('#art-undo')).toBeDisabled();
  await page.locator('#art-zoom').selectOption('2');
  await (await revealArtworkControl(page, 'art-layer-add')).click();
  await expect(page.locator('#art-layer option')).toHaveCount(2);
  await page.locator('#art-layer-name').fill('Glow');
  await page.locator('#art-layer-opacity').fill('128');
  await page.locator('#art-layer-update').click();
  await page.locator('#art-color').fill('#ff0000');
  await page.locator('#art-canvas').click({ position: { x: 12, y: 12 } });
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await page.locator('#art-undo').click();
  await page.locator('#art-redo').click();
  await page.locator('#art-layer-locked').check();
  await page.locator('#art-layer-update').click();
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  // Several local Undo steps can coalesce before their next durable checkpoint.
  for (let i = 0; i < 3; i++) {
    await page.locator('#art-undo').click();
  }
  await expect(page.locator('#art-layer-name')).toHaveValue('Layer');
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  for (let i = 0; i < 3; i++) {
    await page.locator('#art-redo').click();
  }
  await expect(page.locator('#art-layer-locked')).toBeChecked();
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await page.screenshot({ path: info.outputPath('layers-and-wheel.png') });
  await saveArtwork(page);
  await page.reload();
  await page.locator('[data-asset="picture/artwork"]').click();
  await revealArtworkControl(page, 'art-layer');
  await expect(page.locator('#art-layer option')).toHaveText(['Base', 'Glow']);
  await page.locator('#art-layer').selectOption({ label: 'Glow' });
  await expect(page.locator('#art-layer-opacity')).toHaveValue('128');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(page.locator('#art-layer-update')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('layers-compact.png') });
});
