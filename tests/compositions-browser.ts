/** Real keyboard/pointer clipboard editing, library persistence and atomic bounds checks. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Chrome } from './chrome.ts';
import { record, string } from '../frontend/shared/decode.mts';
const folder = await mkdtemp(join(tmpdir(), 'forge-compositions-'));
const root = join(folder, 'world');
let server: ChildProcess | undefined;
let browser: Chrome | undefined;
try {
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
  const child = spawn(
    '.venv/bin/python',
    ['-m', 'gbc_scene_forge', '--no-browser', '--project', root, '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server = child;
  const url = await new Promise<string>((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(Error(`Startup timeout: ${logs}`)), 10000);
    child.once('error', reject);
    child.stdout.on('data', (data: Buffer) => {
      logs += data.toString();
      const match = /Editor\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(logs);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      logs += data.toString();
    });
  });
  browser = await Chrome.launch(process.argv[2]);
  const chrome = browser;
  chrome.acceptBeforeUnload = true;
  const evaluate = chrome.evaluate.bind(chrome),
    wait = chrome.wait.bind(chrome);
  const click = (id: string) => chrome.click(`document.getElementById(${JSON.stringify(id)})`);
  const key = async (key: string, modifiers = 0) => {
    await chrome.call('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers });
    await chrome.call('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
  };
  const choose = async (id: string) => {
    await wait(
      "document.getElementById('scenes')?.disabled === false && !document.getElementById('show-create').disabled",
    );
    await evaluate(
      `(() => { const s = document.getElementById('scenes'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`,
    );
    await wait(
      `document.getElementById('scene-name').textContent.startsWith(${JSON.stringify(id === first ? 'Room ·' : id === second ? 'Other room ·' : 'Missing layers ·')}) && !document.getElementById('show-create').disabled`,
    );
  };
  const saved = async (id: string): Promise<unknown> =>
    JSON.parse(await readFile(join(root, 'scenes', `${id}.tmj`), 'utf8'));
  const target = string(
    (await chrome.call('Target.createTarget', { url: 'about:blank' }, null)).targetId,
  );
  chrome.session = string(
    (await chrome.call('Target.attachToTarget', { targetId: target, flatten: true }, null))
      .sessionId,
  );
  await chrome.call('Runtime.enable');
  await chrome.call('Page.enable');
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await chrome.call('Page.navigate', { url });
  await wait("document.getElementById('project-name')?.textContent === 'Reusable rooms'");
  await choose(first);
  await click('select-all-layers');
  await chrome.click('document.querySelector(\'input[value="select"]\')');
  await chrome.pointer(1, 1);
  await chrome.pointer(15, 7, 'mouseMoved');
  await chrome.pointer(15, 7, 'mouseReleased');
  await key('c', 2);
  await key('x', 2);
  await wait("document.getElementById('status').textContent === 'Selection cut.'");
  await key('z', 2);
  await wait("!document.getElementById('redo').disabled");
  await key('z', 2 | 8); // redo
  await key('z', 2); // restore original again
  // Re-select; clockwise transform must preserve IDs and properties through save.
  await chrome.pointer(1, 1);
  await chrome.pointer(15, 7, 'mouseMoved');
  await chrome.pointer(15, 7, 'mouseReleased');
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
  await chrome.click('document.querySelector(\'input[value="select"]\')');
  await chrome.pointer(1, 1);
  await chrome.pointer(7, 15, 'mouseMoved');
  await chrome.pointer(7, 15, 'mouseReleased');
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
  await chrome.pointer(32, 16);
  await chrome.pointer(32, 16, 'mouseReleased');
  await chrome.pointer(48, 24);
  await chrome.pointer(48, 24, 'mouseReleased');
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
  await chrome.screenshot('standalone-compositions');
  // Clipboard is independent of the stamp and survives a compatible scene switch.
  await choose(second);
  await evaluate("document.getElementById('scene').focus()");
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
  await evaluate("document.getElementById('scene').focus()");
  await key('v', 2);
  await wait("document.getElementById('status').textContent.includes('matching layer: Markers')");
  assert.equal(await evaluate("document.getElementById('scene-save-state').textContent"), 'Saved');
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  await choose(first);
  // Edge transforms and stamp placements reject the entire change.
  await chrome.click('document.querySelector(\'input[value="select"]\')');
  await chrome.pointer(89, 65);
  await chrome.pointer(95, 79, 'mouseMoved');
  await chrome.pointer(95, 79, 'mouseReleased');
  await click('rotate-selection');
  await wait(
    "document.getElementById('status').textContent.includes('entire composition must fit')",
  );
  assert.equal(await evaluate("document.getElementById('scene-save-state').textContent"), 'Saved');
  await click('place-stamp');
  await chrome.pointer(95, 79);
  await chrome.pointer(95, 79, 'mouseReleased');
  await wait(
    "document.getElementById('status').textContent.includes('entire composition must fit')",
  );
  await key('Escape');
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  // Clipboard shortcuts in text inputs never mutate authored content.
  await evaluate(
    "document.getElementById('layer-name').focus(); document.getElementById('layer-name').select()",
  );
  await key('x', 2);
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  // Multi-object selection with Shift-click duplicates both objects in one history entry.
  await chrome.click('document.querySelector(\'input[value="select"]\')');
  await chrome.click('document.querySelector(\'[data-layer-id="2"] .layer-choice\')');
  await chrome.pointer(7, 1);
  await chrome.pointer(7, 1, 'mouseReleased');
  await chrome.pointer(5, 9, 'mousePressed', 8);
  await chrome.pointer(5, 9, 'mouseReleased', 8);
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
  await chrome.call('Page.reload');
  await wait("document.getElementById('scene-name')?.textContent === 'No scene open'");
  await wait("document.getElementById('stamps')?.options.length === 2");
  await choose(first);
  assert.equal(await evaluate("document.querySelectorAll('#object-list option').length"), 0); // tile layer active
  // Scene management keeps current edits and history independent of project transactions.
  const setValue = async (id: string, value: string) =>
    evaluate(
      `(() => { const field = document.getElementById(${JSON.stringify(id)}); field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('input')); })()`,
    );
  const cancelDialog = async (id: string) =>
    chrome.click(`document.querySelector('#${id} [data-close]')`);
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
  assert.equal(await evaluate("document.getElementById('scene-save-state').textContent"), 'Saved');
  await click('show-resize');
  await setValue('resize-width', '14');
  await setValue('resize-height', '12');
  await click('resize-confirm');
  await wait("document.getElementById('scene-name').textContent.includes('14 × 12')");
  await click('show-rename');
  await setValue('scene-manage-name', 'Courtyard');
  await click('scene-manage-confirm');
  await wait("document.getElementById('scene-name').textContent.startsWith('Courtyard ·')");
  assert.equal(
    await evaluate("document.getElementById('scene-save-state').textContent"),
    'Unsaved changes',
  );
  assert.equal(await evaluate("document.getElementById('undo').disabled"), false);
  assert.equal(record(await saved(first)).width, 12); // rename did not save canvas
  const duplicate = async (name: string, canvas: boolean) => {
    await click('show-duplicate-scene');
    await setValue('scene-manage-name', name);
    if (canvas) {
      await click('duplicate-canvas');
      await chrome.screenshot('scene-duplicate-dialog');
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
  assert.equal(await evaluate("document.getElementById('scenes').value"), first);
  assert.equal(
    await evaluate("document.getElementById('scene-save-state').textContent"),
    'Unsaved changes',
  );
  await click('undo');
  await wait("document.getElementById('scene-name').textContent.includes('12 × 10')");
  assert.equal(await evaluate("document.getElementById('scene-save-state').textContent"), 'Saved');
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
  await chrome.call('Page.reload');
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
  await chrome.screenshot('scene-management');
  // Cropping requires confirmation, then remains one undoable edit.
  await click('show-resize');
  await setValue('resize-width', '1');
  await setValue('resize-height', '1');
  await chrome.screenshot('scene-resize-preview');
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
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 980,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait('document.documentElement.scrollWidth <= innerWidth');
  await chrome.screenshot('scene-management-compact');
  assert.deepEqual(chrome.errors, []);
  console.log('Composition and scene management browser acceptance passed');
} catch (error) {
  if (browser) {
    console.error(
      await browser.evaluate(
        "({status:document.getElementById('status')?.textContent, error:document.querySelector('dialog[open] .form-error')?.textContent})",
      ),
    );
  }
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
