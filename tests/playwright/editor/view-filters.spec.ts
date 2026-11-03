import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { record, string } from '../../../frontend/shared/decode.mts';
import { test, editorReady, paint, clickControl } from '../support/browser-fixtures.ts';

test.use({ projectMode: 'sample' });

test('mixed scene view filters preserve content/history and prevent invisible authoring', async ({
  page,
  forge,
}, testInfo) => {
  const seeded = await promisify(execFile)(forge.python, [
    '-I',
    '-c',
    `
import json, sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.planning import blockout
p = Project(Path(sys.argv[1]))
loaded = p.planning.create_blockout('Mixed view', dict(width=256,height=160,grid=8,camera_width=160,camera_height=136), p.catalog()['revision'])
scene = loaded['scene']
scene['layers'][0]['cells'] = [['sample/grass/0/0'] * 32 for _ in range(20)]
for role, name, x, y in [('solid','Ground',16,112), ('enemy','Enemy start',64,64), ('patrol','Activity bounds',48,48), ('note','Design note',200,32)]:
    doc = p.catalog()['project']
    definition = next(d for d in doc['object_definitions']['definitions'] if any(f['name']=='blockout_role' and f.get('default')==role for f in d['fields']))
    scene, _ = blockout.place(scene, doc, definition['id'], x, y, name=name, layer_id=2)
scene['layers'][1]['name'] = 'Mixed objects'
for item in [dict(asset='sample/hero_idle',x=160,y=80,name='Sprite art'), dict(kind='point',x=24,y=32,name='Unknown point'), dict(kind='rectangle',x=128,y=112,width=16,height=16,name='Unknown geometry')]:
    scene['layers'][1]['objects'].append(dict(id=scene['next_object_id'], **item))
    scene['next_object_id'] += 1
scene['layers'][2]['visible'] = False
scene['layers'][2]['objects'] = [dict(id=scene['next_object_id'],kind='point',x=8,y=8,name='Authored hidden')]
scene['next_object_id'] += 1
p.scenes.save(loaded['id'], scene, loaded['revision'], p.catalog()['revision'])
print(json.dumps(dict(id=loaded['id'])))
`,
    forge.root,
  ]);
  const sceneId = string(record(JSON.parse(seeded.stdout)).id);
  await page.goto(forge.url);
  await editorReady(page);
  await page.locator('#scenes').selectOption(sceneId);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('.scene-view-controls summary').click();
  const snapshot = () =>
    page.locator('#scene').evaluate((node) => {
      if (!(node instanceof HTMLCanvasElement)) {
        throw Error('Expected canvas');
      }
      return node.toDataURL();
    });
  const labels = page.locator('#blockout-labels');
  // Inspect captions at 2x; backend checks pin review cameras to native 1x pixels.
  await page.locator('#zoom').selectOption('2');
  await page.locator('#grid').uncheck();
  const combined = await snapshot();
  await expect(labels).toContainText('Enemy start');
  await expect(labels).toContainText('Activity bounds');
  await page.locator('#layers [data-layer-id="2"] .layer-choice').click();
  await page.locator('input[name=tool][value=select]').check();
  await paint(page, 64, 64);
  await expect(page.locator('#remove-sprite')).toBeEnabled();
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      writes.push(request.url());
    }
  });
  await page.locator('#view-gameplay').uncheck();
  await expect(labels).not.toContainText('Enemy start');
  await expect(labels).not.toContainText('Activity bounds');
  await expect(page.locator('#remove-sprite')).toBeDisabled();
  await paint(page, 64, 64);
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#view-geometry').uncheck();
  await page.locator('#view-guides').uncheck();
  await expect(labels).not.toContainText('Ground');
  const artwork = await snapshot();
  expect(artwork).not.toBe(combined);
  await page.screenshot({ path: testInfo.outputPath('artwork-only.png') });
  await page.locator('#view-tiles').uncheck();
  await page.locator('#view-sprites').uncheck();
  const empty = await snapshot();
  expect(empty).not.toBe(artwork);
  for (const key of ['geometry', 'gameplay', 'guides']) {
    await page.locator(`#view-${key}`).check();
  }
  const blockout = await snapshot();
  expect(blockout).not.toBe(empty);
  await expect(labels).toContainText('Enemy start');
  // Hidden tile layers cannot be painted; no mutation or Undo entry is created.
  await page.locator('#layers [data-layer-id="1"] .layer-choice').click();
  await page.locator('input[name=tool][value=erase]').check();
  await paint(page, 8, 8);
  await expect(page.locator('#status')).toContainText('Show Tile artwork');
  await expect(page.locator('#undo')).toBeDisabled();
  for (const key of ['tiles', 'sprites']) {
    await page.locator(`#view-${key}`).check();
  }
  expect(await snapshot()).toBe(combined);
  await expect(page.locator('#layers [data-layer-id="3"]')).toHaveAttribute(
    'data-visible',
    'false',
  );
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  expect(writes).toEqual([]);

  // The same controls remain reachable in Review scene at desktop and narrow widths.
  await page.locator('#review-mode').click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Gameplay markers', { exact: true })).toBeVisible();
    await page.locator('#view-geometry').uncheck();
    await page.locator('#view-geometry').check();
    await page.screenshot({ path: testInfo.outputPath(`combined-review-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#review-mode').click();
  // Filters also preserve an existing authored edit, Undo and Redo.
  await page.locator('#layer-name').fill('Renamed artwork');
  await page.locator('#layer-name').press('Tab');
  await page.locator('#view-gameplay').uncheck();
  await page.locator('#undo').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await clickControl(page, 'save');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await expect(page.locator('#layer-name')).toHaveValue('Renamed artwork');
  await page.locator('.scene-view-controls summary').click();
  await expect(page.locator('#view-gameplay')).toBeChecked();
  await expect(labels).toContainText('Enemy start');
  await expect(page.locator('#layers [data-layer-id="3"]')).toHaveAttribute(
    'data-visible',
    'false',
  );
});
