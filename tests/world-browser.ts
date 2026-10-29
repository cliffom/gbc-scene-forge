/** Real world dragging, link authoring, navigation and endpoint lifecycle. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Chrome } from './chrome.ts';
import { array, record, string } from '../frontend/decode.mts';
const folder = await mkdtemp(join(tmpdir(), 'forge-world-'));
const root = join(folder, 'world');
let server: ChildProcess | undefined;
let browser: Chrome | undefined;
try {
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
from gbc_scene_forge.projects import Project
p = Project.create(Path(sys.argv[1]), 'Connected rooms')
d = p.save_object_definition(dict(name='Door', kind='point', fields=[]), p.catalog()['revision'])['definition_id']
ids = []
for name in ('Forest', 'Cave'):
    loaded = p.create_scene(name, 12, 10, 8, p.catalog()['revision'])
    scene = dict(width=12, height=10, grid=8, next_layer_id=3, next_object_id=3, layers=[
        dict(id=1, name='Ground', type='tilelayer', visible=True, cells=[['']*12 for _ in range(10)]),
        dict(id=2, name='Doors', type='objectgroup', visible=name=='Forest', objects=[
            dict(id=1, kind='point', x=8, y=8, name='South exit', definition=d),
            dict(id=2, kind='point', x=24, y=8, name='North entrance', definition=d)])])
    p.save_scene(loaded['id'], scene, loaded['revision'], p.catalog()['revision'])
    ids.append(loaded['id'])
print(json.dumps(ids))
`,
    root,
  ]);
  const ids: unknown = JSON.parse(stdout);
  assert(Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
  const [first, second] = ids.map(string);
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
  const choose = async (id: string) => {
    await wait("!document.getElementById('scenes').disabled");
    await evaluate(
      `(() => {const s=document.getElementById('scenes');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change'));})()`,
    );
    await wait(
      `document.getElementById('scene-name').textContent.startsWith(${JSON.stringify(id === first ? 'Forest ·' : 'Cave ·')}) && !document.getElementById('show-world').disabled`,
    );
  };
  const set = async (id: string, value: string) =>
    evaluate(
      `(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'));})()`,
    );
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
    await chrome.call('Input.dispatchMouseEvent', {
      type,
      x: px,
      y: py,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
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
  assert.equal(
    await evaluate("document.getElementById('world-findings').textContent"),
    'All connection endpoints are valid.',
  );
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
  await chrome.screenshot('world-view');
  // Follow selects the exact object and its hidden layer without changing visibility.
  await chrome.click(
    "Array.from(document.querySelectorAll('.world-link button')).find(b=>b.textContent.startsWith('Follow'))",
  );
  await wait(
    "document.getElementById('scene-name').textContent.startsWith('Cave ·') && !document.getElementById('show-world').disabled",
  );
  assert.equal(await evaluate("document.getElementById('object-list').value"), '2');
  assert.equal(await evaluate("document.getElementById('edit-object').disabled"), true);
  assert.equal(await evaluate("document.getElementById('remove-sprite').disabled"), true);
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
  await chrome.click("document.querySelector('.world-link button')"); // Edit
  await set('world-link-name', 'Cave trail');
  await set('world-direction', 'one-way');
  await click('world-link-apply');
  await saveWorld();
  await click('world-close');
  assert.equal(
    await evaluate("document.getElementById('scene-save-state').textContent"),
    'Unsaved changes',
  );
  assert.equal(await evaluate("document.getElementById('undo').disabled"), false);
  // Following a source endpoint respects the existing save/discard/cancel flow.
  await openWorld();
  await chrome.click(
    "Array.from(document.querySelectorAll('.world-link button')).find(b=>b.textContent==='Source')",
  );
  await wait("document.getElementById('switch-scene-dialog').open");
  await click('scene-switch-cancel');
  assert.match(
    String(await evaluate("document.getElementById('scene-name').textContent")),
    /^Cave/,
  );
  await openWorld();
  await chrome.click(
    "Array.from(document.querySelectorAll('.world-link button')).find(b=>b.textContent==='Source')",
  );
  await wait("document.getElementById('switch-scene-dialog').open");
  await click('scene-switch-save');
  await wait(
    "document.getElementById('scene-name').textContent.startsWith('Forest ·') && !document.getElementById('show-world').disabled",
  );
  assert.equal(await evaluate("document.getElementById('object-list').value"), '1');
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
  await chrome.screenshot('world-broken-endpoint');
  // Repair to a different endpoint, then navigate from the finding and save/reopen.
  await chrome.click("document.querySelector('.world-link button')");
  await set('world-source-object', '2');
  await click('world-link-apply');
  await saveWorld();
  assert.equal(
    await evaluate("document.getElementById('world-findings').textContent"),
    'All connection endpoints are valid.',
  );
  await click('world-close');
  await openWorld();
  await chrome.click("document.querySelector('.world-link button')");
  await set('world-link-name', 'Discard this world edit');
  await click('world-link-apply');
  await evaluate('window.confirm=()=>false');
  await click('world-close');
  assert.equal(await evaluate("document.getElementById('world-dialog').open"), true);
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
  await chrome.call('Page.reload');
  await wait("document.getElementById('project-name')?.textContent === 'Connected rooms'");
  await openWorld();
  assert.match(
    String(await evaluate("document.getElementById('world-findings').textContent")),
    /Scene is missing/,
  );
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    "document.getElementById('world-dialog').scrollWidth<=document.getElementById('world-dialog').clientWidth",
  );
  await chrome.screenshot('world-view-compact');
  // A direct map edit makes the captured graph snapshot stale; failed save keeps the draft.
  const secondPath = join(root, 'scenes', `${second}.tmj`);
  map = record(JSON.parse(await readFile(secondPath, 'utf8')));
  await writeFile(secondPath, JSON.stringify(map) + '\n');
  await chrome.click("document.querySelector('.world-link button')");
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
  assert.deepEqual(
    chrome.errors.filter((e) => !e.includes('409')),
    [],
  );
  console.log('World layout and connection browser acceptance passed');
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
