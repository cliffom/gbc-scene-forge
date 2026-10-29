/** Fresh offline first-scene path through the installed-product UI. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chrome } from './chrome.ts';
import { record, string } from '../frontend/decode.mts';

const folder = await mkdtemp(join(tmpdir(), 'forge-first-use-'));
const server = spawn(
  process.env.FORGE_TEST_PYTHON ?? '.venv/bin/python',
  [
    '-I',
    '-m',
    'gbc_scene_forge',
    '--no-browser',
    '--project-root',
    join(folder, 'projects'),
    '--port',
    '0',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let browser: Chrome | undefined;
try {
  const url = await new Promise<string>((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(Error(`Startup timed out: ${logs}`)), 10000);
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
  const chrome = browser;
  const evaluate = chrome.evaluate.bind(chrome);
  const wait = chrome.wait.bind(chrome);
  const click = (id: string) => chrome.click(`document.getElementById(${JSON.stringify(id)})`);
  const set = (id: string, value: string) =>
    evaluate(`(() => {
    const control = document.getElementById(${JSON.stringify(id)});
    control.value = ${JSON.stringify(value)};
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
  })()`);
  await chrome.call('Target.createTarget', { url: 'about:blank' }, null).then(async (result) => {
    const attached = await chrome.call(
      'Target.attachToTarget',
      { targetId: result.targetId, flatten: true },
      null,
    );
    chrome.session = string(attached.sessionId);
  });
  await chrome.call('Page.enable');
  await chrome.call('Runtime.enable');
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await chrome.call('Page.navigate', { url });
  await wait("document.getElementById('project-form')?.hidden === false");
  await set('project-title', 'My first world');
  await set('project-starter', 'sample');
  await chrome.screenshot('first-use-project');
  await click('show-first-scene-guide');
  await wait("document.getElementById('first-scene-guide').open");
  await click('guide-action');
  assert.equal(await evaluate("document.getElementById('continue-guide').checked"), true);
  await chrome.click("document.querySelector('#project-form button.primary')");
  await wait(
    "location.pathname === '/projects/my-first-world/' && document.getElementById('first-scene-guide')?.open",
  );
  assert.equal(
    await evaluate("document.getElementById('guide-title').textContent"),
    'Bring in artwork',
  );
  assert.equal(await evaluate('location.search'), '');
  await click('guide-next');
  await chrome.screenshot('first-use-guide');
  await click('guide-action');
  await wait("document.getElementById('create-scene-dialog').open");
  await set('scene-title', 'First scene');
  await chrome.click("document.querySelector('#scene-form button.primary')");
  await wait("document.getElementById('status').textContent.includes('Scene created')");
  const id = string(await evaluate("document.getElementById('scenes').value"));
  await chrome.click("document.querySelector('#palette button.asset')");
  await chrome.pointer(4, 4, 'mousePressed');
  await chrome.pointer(4, 4, 'mouseReleased');
  await wait("document.getElementById('scene-save-state').textContent === 'Unsaved changes'");
  // The guide never mutates scene/history or clears unsaved edits.
  await click('show-first-scene-guide');
  await click('guide-next');
  await click('guide-next');
  await click('guide-close');
  await wait("document.getElementById('scene-save-state').textContent === 'Unsaved changes'");
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  const base = new URL('/projects/my-first-world/', url);
  const saved = record(await (await fetch(new URL(`api/scene/${id}`, base))).json());
  const manifest = record(
    JSON.parse(await readFile(join(folder, 'projects/my-first-world/forge.project.json'), 'utf8')),
  );
  assert.equal(manifest.name, 'My first world');
  assert.ok(JSON.stringify(saved).includes('sample/'));
  await chrome.call('Page.reload');
  await wait(
    "document.getElementById('status')?.textContent === 'Choose a scene, or import an atlas and create one.' && document.querySelectorAll('#scenes option').length === 4",
  );
  await set('scenes', id);
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  assert.deepEqual(record(await (await fetch(new URL(`api/scene/${id}`, base))).json()), saved);
  await click('show-first-scene-guide');
  assert.equal(
    await evaluate("document.getElementById('guide-title').textContent"),
    'Save and reopen',
  );
  await click('guide-next');
  await click('guide-close');
  await set('kind-filter', 'sprite');
  await chrome.click("document.querySelector('#palette button.asset:not([hidden])')");
  await chrome.pointer(32, 32, 'mousePressed');
  await chrome.pointer(32, 32, 'mouseReleased');
  await wait("!document.getElementById('animation-preview').hidden");
  await set('preview-animation', 'walk');
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  await click('preview-play');
  await wait("document.getElementById('preview-play').textContent.includes('Pause')");
  await click('preview-play');
  await evaluate(`window.__archive = null;
    URL.createObjectURL = blob => { window.__archive = blob; return 'blob:first-use'; };
    HTMLAnchorElement.prototype.click = function() {window.__filename = this.download;};`);
  await click('show-export');
  await click('export-confirm');
  await wait("window.__archive?.type === 'application/zip'");
  assert.ok(string(await evaluate('window.__filename')).endsWith('.zip'));
  assert.ok(Number(await evaluate('window.__archive.size')) > 1000);
  assert.equal(await evaluate("document.getElementById('scene-save-state').textContent"), 'Saved');
  // Storage-disabled browsers can still open and navigate the optional guide.
  await evaluate(
    `Object.defineProperty(window, 'localStorage', {get(){throw Error('Disabled');}}); void 0`,
  );
  await click('show-first-scene-guide');
  await click('guide-next');
  await click('guide-restart');
  await click('guide-close');
  assert.deepEqual(chrome.errors, []);
  console.log('First-use acceptance passed: sample, guide, paint, save/reopen, preview, export.');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
