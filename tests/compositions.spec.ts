import { expect } from '@playwright/test';
/** Real keyboard/pointer clipboard editing, library persistence and atomic bounds checks. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { record, string } from '../frontend/shared/decode.mts';
import { clickControl, scenePoint, setControl, test, waitForUI } from './browser-fixtures.ts';
test('compositions: Real keyboard/pointer clipboard editing, library persistence and atomic bounds checks.', async ({
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
sys.path.insert(0, 'tests')
from atlas_fixture import bundle
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import png
p = Project.create(Path(sys.argv[1]), 'Reusable rooms')
source, _ = bundle(p.root.parent / 'art')
pixels = b''.join(bytes([((0, 82), (165, 255))[y // 4][(x % 8) // 4]] * 3 + [255]) for y in range(8) for x in range(16))
(source.parent / 'atlas.png').write_bytes(png.encode(16, 8, pixels))
p.artwork.import_atlas(source, p.catalog()['revision'])
ids = []
for name in ('Room', 'Other room', 'Missing layers'):
    loaded = p.scenes.create(name, 12, 10, 8, p.catalog()['revision'])
    scene = loaded['scene']
    if name != 'Missing layers':
        scene['cells'][0][:2] = ['terrain/earth/0/0', 'terrain/stone/0/0']
        scene = dict(width=12, height=10, grid=8, next_layer_id=3, next_object_id=3, layers=[
            dict(id=1, name='Ground', type='tilelayer', visible=True, cells=scene['cells']),
            dict(id=2, name='Markers', type='objectgroup', visible=True, objects=[
                dict(id=1, kind='point', x=1, y=1, name='spawn', properties=[dict(name='door', type='string', value='north')]),
                dict(id=2, kind='rectangle', x=9, y=1, width=3, height=4, name='trigger')])])
        p.scenes.save(loaded['id'], scene, loaded['revision'], p.catalog()['revision'])
    ids.append(loaded['id'])
print(json.dumps(ids))
`,
    root,
  ]);
  const ids: unknown = JSON.parse(stdout);
  assert(Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
  const [first, second, missing] = ids.map(string);
  const url = await workspace.start(root, false, true);
  const evaluate = (expression: string) => page.evaluate(expression),
    wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  const key = async (key: string, modifiers = 0) => {
    await page.keyboard.press(
      (modifiers & 2 ? 'Control+' : '') +
        (modifiers & 1 ? 'Alt+' : '') +
        (modifiers & 8 ? 'Shift+' : '') +
        key,
    );
  };
  const choose = async (id: string) => {
    await wait(
      "document.getElementById('scenes')?.disabled === false && !document.getElementById('show-create').disabled",
    );
    await page.locator('#scenes').selectOption(id);
    await wait(
      `document.getElementById('scene-name').textContent.startsWith(${JSON.stringify(id === first ? 'Room ·' : id === second ? 'Other room ·' : 'Missing layers ·')}) && !document.getElementById('show-create').disabled`,
    );
  };
  const saved = async (id: string): Promise<unknown> =>
    JSON.parse(await readFile(join(root, 'scenes', `${id}.tmj`), 'utf8'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await wait("document.getElementById('project-name')?.textContent === 'Reusable rooms'");
  await choose(first);
  await click('select-all-layers');
  await page.locator('input[value="select"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 1, 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 15, 7);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 15, 7);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await key('c', 2);
  await key('x', 2);
  await wait("document.getElementById('status').textContent === 'Selection cut.'");
  await key('z', 2);
  await wait("!document.getElementById('redo').disabled");
  await key('z', 2 | 8); // redo
  await key('z', 2); // restore original again
  // Re-select; clockwise transform must preserve IDs and properties through save.
  await (async () => {
    const point = await scenePoint(page, 1, 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 15, 7);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 15, 7);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('rotate-selection');
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  const rotated = record(await saved(first));
  const rotatedLayers = rotated.layers;
  assert(Array.isArray(rotatedLayers));
  const tileData = record(rotatedLayers[0]).data;
  assert(Array.isArray(tileData));
  assert.equal(Number(tileData[0]) >>> 29, 5);
  const rotatedObjects = record(rotatedLayers[1]).objects;
  assert(Array.isArray(rotatedObjects));
  assert.deepEqual(
    rotatedObjects.map((o) => record(o).id),
    [1, 2],
  );
  // Inspect asymmetric tile pixels independently of selection tint and object outlines.
  await click('deselect');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(1, 1, 1, 1).data)",
    ),
    [165, 165, 165, 255],
  );
  await page.locator('input[value="select"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 1, 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 7, 15);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 7, 15);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  // Save an authored mixed composition to the library, then place it twice.
  await evaluate("window.prompt = () => 'Doorway'");
  await click('save-stamp');
  await wait(
    "document.getElementById('status').textContent === 'Reusable stamp saved in the project.'",
  );
  const manifest = record(JSON.parse(await readFile(join(root, 'forge.project.json'), 'utf8')));
  assert(Array.isArray(manifest.stamps) && manifest.stamps.length === 1);
  await evaluate(
    "document.getElementById('stamps').selectedIndex = 1; document.getElementById('stamps').dispatchEvent(new Event('change'))",
  );
  await click('place-stamp');
  await (async () => {
    const point = await scenePoint(page, 32, 16);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 32, 16);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await (async () => {
    const point = await scenePoint(page, 48, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 48, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await key('Escape');
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  const placedLayers = record(await saved(first)).layers;
  assert(Array.isArray(placedLayers));
  const placedObjects = record(placedLayers[1]).objects;
  assert(Array.isArray(placedObjects));
  assert.equal(placedObjects.length, 6);
  assert.deepEqual(
    placedObjects.map((o) => record(o).id),
    [1, 2, 3, 4, 5, 6],
  );
  await page.screenshot({ path: testInfo.outputPath('standalone-compositions' + '.png') });
  // Clipboard is independent of the stamp and survives a compatible scene switch.
  await choose(second);
  await page.locator('#scene').focus();
  await key('v', 2);
  await wait("document.getElementById('status').textContent.startsWith('Composition placed.')");
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  const pasted = record(await saved(second)).layers;
  assert(Array.isArray(pasted));
  const pastedObjects = record(pasted[1]).objects;
  assert(Array.isArray(pastedObjects));
  assert.equal(pastedObjects.length, 4);
  const copiedPoint = record(pastedObjects[2]);
  assert.equal(copiedPoint.name, 'spawn');
  assert.deepEqual(copiedPoint.properties, [{ name: 'door', type: 'string', value: 'north' }]);
  // Failed cross-scene layer mapping must not dirty or partially paint the scene.
  await choose(missing);
  await page.locator('#scene').focus();
  await key('v', 2);
  await wait("document.getElementById('status').textContent.includes('matching layer: Markers')");
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await choose(first);
  // Edge transforms and stamp placements reject the entire change.
  await page.locator('input[value="select"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 89, 65);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 95, 79);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 95, 79);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('rotate-selection');
  await wait(
    "document.getElementById('status').textContent.includes('entire composition must fit')",
  );
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await click('place-stamp');
  await (async () => {
    const point = await scenePoint(page, 95, 79);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 95, 79);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await wait(
    "document.getElementById('status').textContent.includes('entire composition must fit')",
  );
  await key('Escape');
  await expect(page.locator('#undo')).toBeDisabled();
  // Clipboard shortcuts in text inputs never mutate authored content.
  await evaluate(
    "document.getElementById('layer-name').focus(); document.getElementById('layer-name').select()",
  );
  await key('x', 2);
  await expect(page.locator('#undo')).toBeDisabled();
  // Multi-object selection with Shift-click duplicates both objects in one history entry.
  await page.locator('input[value="select"]').first().click();
  await page.locator('[data-layer-id="2"] .layer-choice').first().click();
  await (async () => {
    const point = await scenePoint(page, 7, 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 7, 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await (async () => {
    const point = await scenePoint(page, 5, 9);
    await page.keyboard.down('Shift');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.keyboard.up('Meta');
  })();
  await (async () => {
    const point = await scenePoint(page, 5, 9);
    await page.keyboard.down('Shift');
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.keyboard.up('Meta');
  })();
  await key('d', 2);
  await wait("document.getElementById('status').textContent.startsWith('Composition placed.')");
  await key('z', 2);
  await key('z', 10);
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  const multi = record(await saved(first)).layers;
  assert(Array.isArray(multi));
  const multiObjects = record(multi[1]).objects;
  assert(Array.isArray(multiObjects));
  assert.equal(multiObjects.length, 8);
  // Reload retains the project library and transformed/duplicated placements.
  await page.reload();
  await wait("document.getElementById('scene-name')?.textContent === 'No scene open'");
  await wait("document.getElementById('stamps')?.options.length === 2");
  await choose(first);
  assert.equal(await evaluate("document.querySelectorAll('#object-list option').length"), 0); // tile layer active
  // Scene management keeps current edits and history independent of project transactions.
  const setValue = async (id: string, value: string) => setControl(page, id, value);
  const cancelDialog = async (id: string) => page.locator(`#${id} [data-close]`).first().click();
  await click('show-rename');
  await setValue('scene-manage-name', 'Canceled rename');
  await cancelDialog('scene-manage-dialog');
  assert.equal(
    await evaluate("document.getElementById('scene-name').textContent.startsWith('Room ·')"),
    true,
  );
  await click('show-resize');
  await setValue('resize-width', '14');
  await setValue('resize-height', '12');
  await cancelDialog('resize-scene-dialog');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await click('show-resize');
  await setValue('resize-width', '14');
  await setValue('resize-height', '12');
  await click('resize-confirm');
  await wait("document.getElementById('scene-name').textContent.includes('14 × 12')");
  await click('show-rename');
  await setValue('scene-manage-name', 'Courtyard');
  await click('scene-manage-confirm');
  await wait("document.getElementById('scene-name').textContent.startsWith('Courtyard ·')");
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await expect(page.locator('#undo')).toBeEnabled();
  assert.equal(record(await saved(first)).width, 12); // rename did not save canvas
  const duplicate = async (name: string, canvas: boolean) => {
    await click('show-duplicate-scene');
    await setValue('scene-manage-name', name);
    if (canvas) {
      await click('duplicate-canvas');
      await page.screenshot({ path: testInfo.outputPath('scene-duplicate-dialog' + '.png') });
    }
    await click('scene-manage-confirm');
    await wait(
      "!document.getElementById('scene-manage-dialog').open && !document.getElementById('show-duplicate-scene').disabled",
    );
    return string(
      await evaluate(
        `Array.from(document.getElementById('scenes').options).find(o => o.textContent === ${JSON.stringify(name)}).value`,
      ),
    );
  };
  await click('show-duplicate-scene');
  await cancelDialog('scene-manage-dialog');
  const savedCopy = await duplicate('Saved courtyard', false);
  const canvasCopy = await duplicate('Expanded courtyard', true);
  assert.equal(record(await saved(savedCopy)).width, 12);
  assert.equal(record(await saved(canvasCopy)).width, 14);
  await expect(page.locator('#scenes')).toHaveValue(first);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await click('undo');
  await wait("document.getElementById('scene-name').textContent.includes('12 × 10')");
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await click('redo');
  await wait("document.getElementById('scene-name').textContent.includes('14 × 12')");
  // Wait for the current canvas and project revision, not an earlier success label.
  await wait(`(async () => {
    const catalog = await (await fetch('api/project')).json();
    const post = async (route, payload) => (await fetch('api/' + route, {method:'POST', headers:{'Content-Type':'application/json','X-Scene-Token':catalog.token}, body:JSON.stringify(payload)})).json();
    const listing = await post('list-drafts', {});
    for (const entry of listing.drafts) {
      const draft = await post('download-draft', entry);
      if (draft.scene_id === ${JSON.stringify(first)} && draft.scene.width === 14 && draft.project_revision === catalog.revision) return true;
    }
    return false;
  })()`);
  await page.reload();
  await wait(
    "document.getElementById('recovery-dialog')?.open && !document.getElementById('show-create').disabled",
  );
  await click('recovery-restore');
  await wait("document.getElementById('status').textContent.includes('Draft restored')");
  assert.equal(
    await evaluate("document.getElementById('scene-name').textContent.includes('14 × 12')"),
    true,
  );
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  assert.equal(record(await saved(first)).width, 14);
  await page.screenshot({ path: testInfo.outputPath('scene-management' + '.png') });
  // Cropping requires confirmation, then remains one undoable edit.
  await click('show-resize');
  await setValue('resize-width', '1');
  await setValue('resize-height', '1');
  await page.screenshot({ path: testInfo.outputPath('scene-resize-preview' + '.png') });
  await click('resize-confirm');
  await wait(
    "document.querySelector('#resize-scene-dialog .form-error').textContent.includes('Confirm')",
  );
  assert.equal(record(await saved(first)).width, 14);
  await click('resize-confirm-loss');
  await click('resize-confirm');
  await wait("document.getElementById('scene-name').textContent.includes('1 × 1')");
  await click('undo');
  await wait("document.getElementById('scene-name').textContent.includes('14 × 12')");
  await click('redo');
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  const cropped = record(await saved(first));
  assert.equal(cropped.width, 1);
  assert.equal(cropped.height, 1);
  const croppedLayers = cropped.layers;
  assert(Array.isArray(croppedLayers));
  const croppedObjects = record(croppedLayers[1]).objects;
  assert(Array.isArray(croppedObjects));
  assert(croppedObjects.every((o) => record(o).point === true)); // rectangles beyond edge removed
  // A disk change after the dialog opens is rejected without losing the canvas.
  await click('show-rename');
  await setValue('scene-manage-name', 'Must not rename');
  const mapPath = join(root, 'scenes', `${first}.tmj`);
  const external = (await readFile(mapPath, 'utf8')) + '\n';
  await writeFile(mapPath, external);
  await click('scene-manage-confirm');
  await wait(
    "document.querySelector('#scene-manage-dialog .form-error').textContent.includes('changed on disk')",
  );
  assert.equal(await readFile(mapPath, 'utf8'), external);
  assert.equal(
    await evaluate("document.getElementById('scene-name').textContent.startsWith('Courtyard ·')"),
    true,
  );
  await cancelDialog('scene-manage-dialog');
  // Compact layout retains all controls without horizontal page overflow.
  await page.setViewportSize({ width: 980, height: 760 });
  await wait('document.documentElement.scrollWidth <= innerWidth');
  await page.screenshot({ path: testInfo.outputPath('scene-management-compact' + '.png') });

  console.log('Composition and scene management browser acceptance passed');
});
