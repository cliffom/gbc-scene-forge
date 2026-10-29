/** Four-neighbor terrain configuration and painting against a real native project. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chrome } from './chrome.ts';
import { array, record, string } from '../frontend/shared/decode.mts';

const folder = await mkdtemp(join(tmpdir(), 'forge-terrain-'));
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
const server = spawn(
  python,
  ['tests/serve_standalone_fixture.py', '--root', join(folder, 'project'), '--single-project'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let browser: Chrome | undefined;
try {
  const url = await new Promise<string>((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(Error(logs)), 10000);
    server.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on('exit', () => {
      clearTimeout(timer);
      reject(Error(logs));
    });
    server.stderr.on('data', (data: Buffer) => {
      logs += data.toString();
    });
    server.stdout.on('data', (data: Buffer) => {
      logs += data.toString();
      const match = /Editor\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(logs);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await Chrome.launch(process.argv[2]);
  const chrome = browser,
    evaluate = chrome.evaluate.bind(chrome),
    wait = chrome.wait.bind(chrome);
  const click = (id: string) => chrome.click(`document.getElementById(${JSON.stringify(id)})`);
  async function set(id: string, value: string) {
    await evaluate(
      `(() => {const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', {bubbles:true}));})()`,
    );
  }
  const target = await chrome.call('Target.createTarget', { url: 'about:blank' }, null);
  const attached = await chrome.call(
    'Target.attachToTarget',
    { targetId: target.targetId, flatten: true },
    null,
  );
  chrome.session = string(attached.sessionId);
  await chrome.call('Page.enable');
  await chrome.call('Runtime.enable');
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await chrome.call('Page.navigate', { url });
  await wait(
    "document.getElementById('status')?.textContent.includes('Choose a scene') && document.getElementById('scenes')?.disabled === false",
  );
  await set('scenes', sceneId);
  await wait("document.getElementById('status').textContent === 'Scene opened.'");
  // Rules are authored in the existing metadata dialog, and undo is local until Save.
  await chrome.click('document.querySelector(\'[data-asset="roads/tile_1_0"]\')');
  await click('edit-tile');
  assert.equal(await evaluate("document.getElementById('tile-transition').checked"), true);
  await click('tile-north');
  await click('tile-east');
  assert.equal(
    await evaluate("document.getElementById('tile-transition-mask').textContent"),
    'Connection mask: 2',
  );
  await click('tile-undo');
  await click('tile-undo');
  assert.equal(await evaluate("document.getElementById('tile-north').checked"), true);
  await chrome.screenshot('terrain-transition-editor');
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
    await chrome.pointer(x * 8 + 4, y * 8 + 4);
    await chrome.pointer(x * 8 + 4, y * 8 + 4, 'mouseReleased');
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
  await chrome.screenshot('terrain-brush-workflow');
  await chrome.click("document.querySelector('input[name=tool][value=erase]')");
  await paint(2, 1);
  await click('undo');
  await click('redo');
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  saved = await cells();
  assert.equal(saved[1][1], 'roads/tile_0_0/0/0');
  assert.equal(saved[1][2], '');
  assert.equal(saved[2][2], 'roads/tile_0_0/0/0');
  await chrome.call('Page.reload');
  await wait(
    "document.getElementById('status')?.textContent.includes('Choose a scene') && document.getElementById('scenes')?.disabled === false",
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
  await chrome.click("document.querySelector('input[name=tool][value=select]')");
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
  assert.equal(await evaluate("document.getElementById('terrain-brush').value"), 'road');
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
  assert.deepEqual(chrome.errors, []);
  console.log(
    'Terrain browser acceptance passed: rule editor, painting, neighbor erase, history, save/reopen and external brush restoration.',
  );
} catch (error) {
  if (browser) {
    console.error(
      await browser.evaluate(
        "({status:document.getElementById('status')?.textContent, dialogs:[...document.querySelectorAll('dialog[open]')].map(d => d.id)})",
      ),
      browser.errors,
    );
    await browser.screenshot('terrain-failure');
  }
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
