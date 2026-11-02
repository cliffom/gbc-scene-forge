import { expect } from '@playwright/test';
/** Real world dragging, link authoring, navigation and endpoint lifecycle. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { array, record, string } from '../../../frontend/shared/decode.mts';
import { clickControl, setControl, test, waitForUI } from '../support/browser-fixtures.ts';
test('world: Real world dragging, link authoring, navigation and endpoint lifecycle.', async ({
  page,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  const root = join(folder, 'world');
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project.create(Path(sys.argv[1]), 'Connected rooms')
d = p.objects.save_definition(dict(name='Door', kind='point', fields=[]), p.catalog()['revision'])['definition_id']
ids = []
for name in ('Forest', 'Cave'):
    loaded = p.scenes.create(name, 12, 10, 8, p.catalog()['revision'])
    scene = dict(width=12, height=10, grid=8, next_layer_id=3, next_object_id=3, layers=[
        dict(id=1, name='Ground', type='tilelayer', visible=True, cells=[['']*12 for _ in range(10)]),
        dict(id=2, name='Doors', type='objectgroup', visible=name=='Forest', objects=[
            dict(id=1, kind='point', x=8, y=8, name='South exit', definition=d),
            dict(id=2, kind='point', x=24, y=8, name='North entrance', definition=d)])])
    p.scenes.save(loaded['id'], scene, loaded['revision'], p.catalog()['revision'])
    ids.append(loaded['id'])
print(json.dumps(ids))
`,
    root,
  ]);
  const ids: unknown = JSON.parse(stdout);
  assert(Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
  const [first, second] = ids.map(string);
  const url = await workspace.start(root, false, true);
  const evaluate = (expression: string) => page.evaluate(expression),
    wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  const choose = async (id: string) => {
    await wait("!document.getElementById('scenes').disabled");
    await page.locator('#scenes').selectOption(id);
    await wait(
      `document.getElementById('scene-name').textContent.startsWith(${JSON.stringify(id === first ? 'Forest ·' : 'Cave ·')}) && !document.getElementById('show-world').disabled`,
    );
  };
  const set = async (id: string, value: string) => setControl(page, id, value);
  const manifest = async () =>
    record(JSON.parse(await readFile(join(root, 'forge.project.json'), 'utf8')));
  const openWorld = async () => {
    await wait("!document.getElementById('show-world').disabled");
    await click('show-world');
    await wait(
      "document.getElementById('world-dialog').open && !document.getElementById('show-world').disabled",
    );
  };
  const saveWorld = async () => {
    await click('world-save');
    await wait("document.getElementById('world-state').textContent==='World saved'");
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await wait("document.getElementById('project-name')?.textContent === 'Connected rooms'");
  await choose(first);
  await openWorld();
  assert.equal(await evaluate("document.querySelectorAll('#world-map [data-scene]').length"), 2);
  // A real pointer drag, followed by precise coordinate editing.
  await evaluate("document.getElementById('world-map').scrollIntoView({block:'center'})");
  const rect = record(
    await evaluate(
      `(() => {const r=document.querySelector('#world-map [data-scene="${first}"] rect').getBoundingClientRect();return {x:r.x+20,y:r.y+20};})()`,
    ),
  );
  const x = Number(rect.x),
    y = Number(rect.y);
  for (const [type, px, py] of [
    ['mousePressed', x, y],
    ['mouseMoved', x + 55, y + 30],
    ['mouseReleased', x + 55, y + 30],
  ] as const) {
    await (async () => {
      await page.mouse.move(px, py);
      if (type === 'mousePressed') {
        await page.mouse.down();
      }
      if (type === 'mouseReleased') {
        await page.mouse.up();
      }
    })();
  }
  assert.notEqual(await evaluate("document.getElementById('world-x').value"), '0');
  await set('world-x', '-140');
  await set('world-y', '60');
  await click('world-position');
  await set('world-link-name', 'Forest passage');
  await set('world-source-scene', first);
  await set('world-source-object', '1');
  await set('world-destination-scene', second);
  await set('world-destination-object', '2');
  await set('world-direction', 'two-way');
  await click('world-link-apply');
  await wait("document.querySelectorAll('.world-link').length===1");
  await expect(page.locator('#world-findings')).toHaveText('All connection endpoints are valid.');
  await saveWorld();
  const stored = record((await manifest()).world),
    positions = record(stored.positions);
  assert.deepEqual(positions[first], { x: -140, y: 60 });
  assert(positions[second]);
  assert(Array.isArray(stored.connections));
  const link = record(stored.connections[0]);
  assert.equal(link.direction, 'two-way');
  assert.deepEqual(link.source, { scene: first, object: 1 });
  assert.deepEqual(link.destination, { scene: second, object: 2 });
  await evaluate("document.getElementById('world-dialog').scrollTop=0");
  await page.screenshot({ path: testInfo.outputPath('world-view' + '.png') });
  // Follow selects the exact object and its hidden layer without changing visibility.
  await page
    .locator('.world-link button')
    .filter({ hasText: /^Follow/ })
    .first()
    .click();
  await wait(
    "document.getElementById('scene-name').textContent.startsWith('Cave ·') && !document.getElementById('show-world').disabled",
  );
  await expect(page.locator('#object-list')).toHaveValue('2');
  await expect(page.locator('#edit-object')).toBeDisabled();
  await expect(page.locator('#remove-sprite')).toBeDisabled();
  assert.match(
    String(await evaluate("document.getElementById('status').textContent")),
    /hidden layer/,
  );
  const cave = record(JSON.parse(await readFile(join(root, 'scenes', `${second}.tmj`), 'utf8')));
  assert(Array.isArray(cave.layers));
  assert.equal(record(cave.layers[1]).visible, false);
  // Metadata edits preserve a dirty scene and undo history.
  await click('show-resize');
  await set('resize-width', '13');
  await click('resize-confirm');
  await wait("document.getElementById('scene-save-state').textContent==='Unsaved changes'");
  await openWorld();
  await page.locator('.world-link button').first().click(); // Edit
  await set('world-link-name', 'Cave trail');
  await set('world-direction', 'one-way');
  await click('world-link-apply');
  await saveWorld();
  await click('world-close');
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await expect(page.locator('#undo')).toBeEnabled();
  // Following a source endpoint respects the existing save/discard/cancel flow.
  await click('toggle-inspector');
  await expect(page.locator('#inspector-pane')).toBeHidden();
  await openWorld();
  await page
    .locator('.world-link button')
    .filter({ hasText: /^Source$/ })
    .first()
    .click();
  await wait("document.getElementById('switch-scene-dialog').open");
  await click('scene-switch-cancel');
  assert.match(
    String(await evaluate("document.getElementById('scene-name').textContent")),
    /^Cave/,
  );
  await openWorld();
  await page
    .locator('.world-link button')
    .filter({ hasText: /^Source$/ })
    .first()
    .click();
  await wait("document.getElementById('switch-scene-dialog').open");
  await click('scene-switch-save');
  await wait(
    "document.getElementById('scene-name').textContent.startsWith('Forest ·') && !document.getElementById('show-world').disabled",
  );
  await expect(page.locator('#object-list')).toHaveValue('1');
  await expect(page.locator('#inspector-pane')).toBeVisible();
  const updatedCave = record(
    JSON.parse(await readFile(join(root, 'scenes', `${second}.tmj`), 'utf8')),
  );
  assert.equal(updatedCave.width, 13);
  // Renaming preserves endpoints; duplicating creates no implicit links.
  await click('show-rename');
  await set('scene-manage-name', 'Woodland');
  await click('scene-manage-confirm');
  await wait(
    "document.getElementById('scene-name').textContent.startsWith('Woodland ·') && !document.getElementById('show-world').disabled",
  );
  await click('show-duplicate-scene');
  await set('scene-manage-name', 'Woodland copy');
  await click('scene-manage-confirm');
  await wait(
    "document.querySelectorAll('#scenes option').length===4 && !document.getElementById('show-world').disabled",
  );
  assert.equal(record((await manifest()).world).connections instanceof Array, true);
  assert.equal(array(record((await manifest()).world).connections, record).length, 1);
  // Removing an endpoint requires explicit confirmation at Save; cancellation retains disk state.
  await set('object-list', '1');
  await click('remove-sprite');
  await evaluate('window.confirm=message=>{window.__confirmation=message;return false}');
  await click('save');
  await wait("document.getElementById('status').textContent.includes('save cancelled')");
  assert.match(String(await evaluate('window.__confirmation')), /Cave trail/);
  let map = record(JSON.parse(await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8')));
  assert(Array.isArray(map.layers));
  assert.equal(array(record(map.layers[1]).objects, record).length, 2);
  await evaluate('window.confirm=()=>true');
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent==='Saved'");
  await openWorld();
  assert.match(
    String(await evaluate("document.getElementById('world-findings').textContent")),
    /Object was removed/,
  );
  await page.screenshot({ path: testInfo.outputPath('world-broken-endpoint' + '.png') });
  // Repair to a different endpoint, then navigate from the finding and save/reopen.
  await page.locator('.world-link button').first().click();
  await set('world-source-object', '2');
  await click('world-link-apply');
  await saveWorld();
  await expect(page.locator('#world-findings')).toHaveText('All connection endpoints are valid.');
  await click('world-close');
  await openWorld();
  await page.locator('.world-link button').first().click();
  await set('world-link-name', 'Discard this world edit');
  await click('world-link-apply');
  await evaluate('window.confirm=()=>false');
  await click('world-close');
  await expect(page.locator('#world-dialog')).toHaveJSProperty('open', true);
  await evaluate('window.confirm=()=>true');
  await click('world-close');
  await openWorld();
  assert.match(
    String(await evaluate("document.getElementById('world-links').textContent")),
    /Cave trail/,
  );
  assert.doesNotMatch(
    String(await evaluate("document.getElementById('world-links').textContent")),
    /Discard this/,
  );
  await click('world-close');
  // Scene deletion explicitly names affected connections and retains their diagnostic references.
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  assert.match(
    String(await evaluate("document.getElementById('delete-scene-links').textContent")),
    /Cave trail/,
  );
  await click('delete-scene-confirm');
  await wait(
    "document.getElementById('scene-name').textContent==='No scene open' && !document.getElementById('show-world').disabled",
  );
  await openWorld();
  assert.match(
    String(await evaluate("document.getElementById('world-findings').textContent")),
    /Scene is missing/,
  );
  await click('world-close');
  await page.reload();
  await wait("document.getElementById('project-name')?.textContent === 'Connected rooms'");
  await openWorld();
  assert.match(
    String(await evaluate("document.getElementById('world-findings').textContent")),
    /Scene is missing/,
  );
  await page.setViewportSize({ width: 600, height: 900 });
  await wait(
    "document.getElementById('world-dialog').scrollWidth<=document.getElementById('world-dialog').clientWidth",
  );
  await page.screenshot({ path: testInfo.outputPath('world-view-compact' + '.png') });
  // A direct map edit makes the captured graph snapshot stale; failed save keeps the draft.
  const secondPath = join(root, 'scenes', `${second}.tmj`);
  map = record(JSON.parse(await readFile(secondPath, 'utf8')));
  await writeFile(secondPath, JSON.stringify(map) + '\n');
  await page.locator('.world-link button').first().click();
  await set('world-link-name', 'Unsaved repair');
  await click('world-link-apply');
  await click('world-save');
  await wait("document.getElementById('world-error').textContent.includes('changed on disk')");
  assert.equal(array(record((await manifest()).world).connections, record)[0].name, 'Cave trail');
  assert.match(
    String(await evaluate("document.getElementById('world-state').textContent")),
    /Unsaved/,
  );
  // Expected 409 from the deliberate stale-snapshot case is reported in the UI.

  console.log('World layout and connection browser acceptance passed');
});
