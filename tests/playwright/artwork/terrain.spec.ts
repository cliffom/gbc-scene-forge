import { expect } from '@playwright/test';
/** Four-neighbor terrain configuration and painting against a real native project. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { array, record, string } from '../../../frontend/shared/decode.mts';

import {
  clickControl,
  setControl,
  scenePoint,
  test,
  waitForUI,
} from '../support/browser-fixtures.ts';
test('terrain: Four-neighbor terrain configuration and painting against a real native project.', async ({
  page,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  const python = process.env.FORGE_TEST_PYTHON ?? '.venv/bin/python';
  const sceneId = execFileSync(
    python,
    [
      '-c',
      `
import sys, base64
sys.path.insert(0, 'tests')
from gbc_scene_forge.artwork.png import encode
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork.metadata import DEFAULT
p = Project.create(sys.argv[1], 'Terrain workshop')
r = lambda: p.catalog()['revision']
pixels = bytearray()
for y in range(8):
    for x in range(128):
        mask, col = x // 8, x % 8
        road = (3 <= col <= 4 and (3 <= y <= 4 or y < 3 and mask & 1 or y > 4 and mask & 4)) or (3 <= y <= 4 and (col < 3 and mask & 8 or col > 4 and mask & 2))
        pixels.extend((202,181,118,255) if road else (64,110,68,255))
p.artwork.import_tilesheet({'id': 'roads', 'png': base64.b64encode(encode(128,8,bytes(pixels))).decode(), 'grid':8, 'margin':0, 'spacing':0}, r())
for mask in range(16):
    p.artwork.set_metadata('roads', '8', f'roads/tile_{mask}_0/0/0', dict(DEFAULT, terrain='road', terrain_mask=mask), r())
print(p.scenes.create('Terrain paths', 8, 6, 8, r())['id'])
`,
      join(folder, 'project'),
    ],
    { encoding: 'utf8' },
  ).trim();
  const url = await workspace.start(join(folder, 'project'), true);
  const evaluate = (expression: string) => page.evaluate(expression),
    wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  const set = (id: string, value: string) => setControl(page, id, value);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await wait(
    "document.getElementById('status')?.textContent.includes('Choose a scene') && document.getElementById('scenes')?.disabled === false",
  );
  await set('scenes', sceneId);
  await wait("document.getElementById('status').textContent === 'Scene opened.'");
  // Rules are authored in the existing metadata dialog, and undo is local until Save.
  await click('artwork-tab');
  await page.locator('[data-asset="roads/tile_1_0"]').first().click();
  await click('edit-tile');
  await expect(page.locator('#tile-transition')).toBeChecked();
  await click('tile-north');
  await click('tile-east');
  await expect(page.locator('#tile-transition-mask')).toHaveText('Connection mask: 2');
  await click('tile-undo');
  await click('tile-undo');
  await expect(page.locator('#tile-north')).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('terrain-transition-editor' + '.png') });
  await click('tile-save');
  await wait("!document.getElementById('tile-dialog').open");
  await evaluate("document.getElementById('terrain-tools').open = true");
  await set('terrain-brush', 'road');
  assert.ok(
    string(await evaluate("document.getElementById('terrain-report').textContent")).includes(
      'All 16',
    ),
  );
  async function paint(x: number, y: number) {
    await (async () => {
      const point = await scenePoint(page, x * 8 + 4, y * 8 + 4);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
    })();
    await (async () => {
      const point = await scenePoint(page, x * 8 + 4, y * 8 + 4);
      await page.mouse.move(point.x, point.y);
      await page.mouse.up();
    })();
  }
  await set('zoom', '8');
  await paint(1, 1);
  await paint(2, 1);
  await paint(2, 2);
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  async function cells() {
    const loaded = record(await (await fetch(new URL(`api/scene/${sceneId}`, url))).json());
    const scene = record(loaded.scene);
    const values =
      scene.layers === undefined ? scene.cells : record(array(scene.layers, record)[0]).cells;
    return array(values, (row) => array(row, string));
  }
  let saved = await cells();
  assert.equal(saved[1][1], 'roads/tile_2_0/0/0');
  assert.equal(saved[1][2], 'roads/tile_12_0/0/0');
  assert.equal(saved[2][2], 'roads/tile_1_0/0/0');
  await page.screenshot({ path: testInfo.outputPath('terrain-brush-workflow' + '.png') });
  await page.locator('input[name=tool][value=erase]').first().click();
  await paint(2, 1);
  await click('undo');
  await click('redo');
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  saved = await cells();
  assert.equal(saved[1][1], 'roads/tile_0_0/0/0');
  assert.equal(saved[1][2], '');
  assert.equal(saved[2][2], 'roads/tile_0_0/0/0');
  await page.reload();
  await wait(
    "document.getElementById('status')?.textContent === 'Scene opened.' && document.getElementById('scenes')?.disabled === false",
  );
  await set('scenes', sceneId);
  await wait("document.getElementById('status').textContent === 'Scene opened.'");
  await set('terrain-brush', 'road');
  assert.ok(
    string(await evaluate("document.getElementById('terrain-report').textContent")).includes(
      'All 16',
    ),
  );
  // External adoption retains the terrain brush and the user's current tool.
  await page.locator('input[name=tool][value=select]').first().click();
  execFileSync(python, [
    '-c',
    `
import sys
from gbc_scene_forge.project.application import Project
p = Project(sys.argv[1])
c = p.catalog()
v = dict(c['project']['atlases']['roads']['metadata']['8']['roads/tile_15_0/0/0'], terrain='trail')
p.artwork.set_metadata('roads', '8', 'roads/tile_15_0/0/0', v, c['revision'])
`,
    join(folder, 'project'),
  ]);
  await click('check-external');
  await wait("document.getElementById('status').textContent.includes('External changes loaded')");
  await expect(page.locator('#terrain-brush')).toHaveValue('road');
  assert.equal(
    await evaluate("document.querySelector('input[name=tool]:checked').value"),
    'select',
  );
  assert.ok(
    string(await evaluate("document.getElementById('terrain-report').textContent")).includes(
      'Missing masks: 15',
    ),
  );
  assert.deepEqual(await cells(), saved);

  console.log(
    'Terrain browser acceptance passed: rule editor, painting, neighbor erase, history, save/reopen and external brush restoration.',
  );
});
