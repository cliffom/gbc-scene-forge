/** Native RGBA sources remain usable through the existing scene authoring browser. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  expect,
  paint,
  test,
  clickControl,
  chooseSavedScene,
} from '../support/browser-fixtures.ts';

test('native artwork: load, place, save and reopen generated tiles', async ({
  page,
  workspace,
}, testInfo) => {
  const root = join(workspace.folder, 'native');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project.create(Path(sys.argv[1]), 'Native pixels')
a = p.artwork.documents
c = a.create('grass', 'Grass', 'tile', 8, 8, p.catalog()['revision'])
c = a.edit(c, [{'x': x, 'y': y, 'rgba': [24, 160, 48, 255]} for y in range(8) for x in range(8)])
a.save(c)
s = p.scenes.create('Native room', 4, 4, 8, p.catalog()['revision'])
s['scene']['cells'][0][0] = 'grass/artwork/0/0'
p.scenes.save(s['id'], s['scene'], s['revision'], p.catalog()['revision'])`,
    root,
  ]);
  const url = await workspace.start(root);
  await page.goto(url);
  await expect(page.locator('#scenes')).toBeEnabled();
  await chooseSavedScene(page, { label: 'Native room' });
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('[data-asset="grass/artwork"]').click();
  await paint(page, 12, 12);
  await clickControl(page, 'save');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#scenes')).toHaveValue(/.+/);
  await expect(page.locator('[data-asset="grass/artwork"]')).toBeVisible();
  const color = await page.locator('#scene').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw Error('Expected canvas');
    }
    const context = element.getContext('2d');
    if (!context) {
      throw Error('Expected canvas context');
    }
    return [...context.getImageData(12, 12, 1, 1).data];
  });
  expect(color).toEqual([24, 160, 48, 255]);
  await page.screenshot({ path: testInfo.outputPath('native-artwork.png') });
});
