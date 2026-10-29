/** Unsaved work survives a lost browser, server restart and project move. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Chrome } from './chrome.ts';
import { array, record, string } from '../frontend/decode.mts';

const folder = await mkdtemp(join(tmpdir(), 'forge-draft-'));
let root = join(folder, 'world');
let server: ChildProcess | undefined;
let browser: Chrome | undefined;
let url = '';
async function start() {
  const child = spawn(
    '.venv/bin/python',
    ['-m', 'gbc_scene_forge', '--no-browser', '--project', root, '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server = child;
  url = await new Promise<string>((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(Error(`Startup timed out: ${logs}`)), 10000);
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
}
async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  server = undefined;
}
async function post(route: string, data: unknown = {}) {
  const catalog = record(await (await fetch(new URL('api/project', url))).json());
  const response = await fetch(new URL(`api/${route}`, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Scene-Token': string(catalog.token) },
    body: JSON.stringify(data),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return record(await response.json());
}
try {
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
sys.path.insert(0, 'tests')
from atlas_fixture import bundle, sprite_bundle
from gbc_scene_forge.project.application import Project
root = Path(sys.argv[1])
p = Project.create(root, 'Draft recovery example')
for source in (bundle(root.parent / 'art')[0], sprite_bundle(root.parent / 'actors')[0]):
    p.artwork.import_atlas(source, p.catalog()['revision'])
a = p.scenes.create('Room', 12, 10, 8, p.catalog()['revision'])
b = p.scenes.create('Other room', 12, 10, 8, p.catalog()['revision'])
print(json.dumps({'first': a['id'], 'second': b['id']}))
`,
    root,
  ]);
  const ids = record(JSON.parse(stdout));
  const first = string(ids.first);
  await start();
  browser = await Chrome.launch(process.argv[2]);
  const chrome = browser;
  chrome.acceptBeforeUnload = true;
  const evaluate = chrome.evaluate.bind(chrome);
  const wait = chrome.wait.bind(chrome);
  const click = (id: string) => chrome.click(`document.getElementById(${JSON.stringify(id)})`);
  async function newTab() {
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
    await wait(
      "document.getElementById('project-name')?.textContent === 'Draft recovery example' && document.getElementById('scenes')?.disabled === false",
    );
    return target;
  }
  async function chooseScene(id = first) {
    await evaluate(
      `(() => { const e = document.getElementById('scenes'); e.value = ${JSON.stringify(id)}; e.dispatchEvent(new Event('change')); })()`,
    );
    await wait(
      `document.getElementById('scenes').value === ${JSON.stringify(id)} && document.getElementById('show-create').disabled === false`,
    );
  }
  async function paint(x = 4, y = 4) {
    await evaluate("document.getElementById('draft-status').textContent = ''");
    await chrome.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
    await chrome.pointer(x, y);
    await chrome.pointer(x, y, 'mouseReleased');
    await wait("document.getElementById('draft-status').textContent === 'Draft checkpoint saved'");
  }
  console.log('Draft browser: creating two independent tab checkpoints');
  const firstTarget = await newTab();
  await chooseScene();
  await paint();
  const original = await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8');
  let drafts = array((await post('list-drafts')).drafts, record);
  assert.equal(drafts.length, 1);
  const sourceDraft = drafts[0];
  // Another tab sees the first tab's draft but owns a separate checkpoint.
  const secondTarget = await newTab();
  await wait("document.getElementById('recovery-dialog').open");
  await click('recovery-later');
  await chooseScene();
  await wait("document.getElementById('recovery-dialog').open");
  await click('recovery-later');
  await paint(20, 20);
  drafts = array((await post('list-drafts')).drafts, record);
  assert.equal(drafts.length, 2);
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  drafts = array((await post('list-drafts')).drafts, record);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, sourceDraft.id);
  // Restore the base bytes so the first tab's saved-revision guard matches again.
  await writeFile(join(root, 'scenes', `${first}.tmj`), original);
  // Lose both browser targets without running page unload/cleanup handlers.
  await chrome.call('Target.closeTarget', { targetId: secondTarget }, null);
  await chrome.call('Target.closeTarget', { targetId: firstTarget }, null);
  console.log('Draft browser: restarting after closing tabs');
  await stop();
  const moved = join(folder, 'moved-world');
  await rename(root, moved);
  root = moved;
  await start();
  await newTab();
  await wait("document.getElementById('recovery-dialog').open");
  await chrome.screenshot('draft-recovery');
  await click('recovery-restore');
  await wait("document.getElementById('status').textContent.includes('Draft restored')");
  assert.equal(await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8'), original);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  // Revert must return to committed content rather than reopen the recovered draft.
  console.log('Draft browser: checking recovered Revert and write retries');
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await chrome.click("document.querySelector('#discard-dialog button[value=discard]')");
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  // A live tab resumes under a new identity after another tab removes its checkpoint.
  await paint(12, 12);
  const removed = array((await post('list-drafts')).drafts, record)[0];
  await post('delete-draft', removed);
  await paint(20, 12);
  const replacement = array((await post('list-drafts')).drafts, record);
  assert.equal(replacement.length, 1);
  assert.notEqual(replacement[0].id, removed.id);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await chrome.click("document.querySelector('#discard-dialog button[value=discard]')");
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  // Persist a first write but lose its acknowledgement, then explicitly discard it.
  await evaluate(`window.__cleanupFetch = window.fetch; window.__loseCheckpoint = true;
    window.fetch = async (...args) => {
      const response = await window.__cleanupFetch(...args);
      if (String(args[0]).endsWith('/api/checkpoint-draft') && window.__loseCheckpoint) {
        window.__loseCheckpoint = false;
        throw Error('simulated lost acknowledgement');
      }
      return response;
    };`);
  await chrome.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await chrome.pointer(28, 12);
  await chrome.pointer(28, 12, 'mouseReleased');
  await wait(
    "document.getElementById('draft-status').textContent.includes('lost acknowledgement')",
  );
  assert.equal(array((await post('list-drafts')).drafts, record).length, 1);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await chrome.click("document.querySelector('#discard-dialog button[value=discard]')");
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  await evaluate('window.fetch = window.__cleanupFetch');
  // New draft, failed writes and automatic retries; preview remains transient.
  await evaluate(
    `window.__draftFetch = window.fetch; window.fetch = (...args) => String(args[0]).endsWith('/api/checkpoint-draft') ? Promise.resolve(new Response(JSON.stringify({error:'simulated disk full'}), {status:400, headers:{'Content-Type':'application/json'}})) : window.__draftFetch(...args);`,
  );
  await chrome.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await chrome.pointer(4, 4);
  await chrome.pointer(4, 4, 'mouseReleased');
  await wait("document.getElementById('draft-status').textContent.includes('simulated disk full')");
  await evaluate('window.fetch = window.__draftFetch');
  await wait("document.getElementById('draft-status').textContent === 'Draft checkpoint saved'");
  const checkpoint = array((await post('list-drafts')).drafts, record)[0];
  // Reload retains the draft and offers explicit choices.
  console.log('Draft browser: reloading with a checkpoint');
  await chrome.call('Page.reload');
  await wait("document.getElementById('recovery-dialog')?.open");
  await click('recovery-restore');
  await wait("document.getElementById('status').textContent.includes('Draft restored')");
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  assert.notEqual(await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8'), original);
  // Playback moves only a transient pose; checkpoints retain authored sprite coordinates.
  await chrome.click('document.querySelector(\'[data-asset="actors/idle"]\')');
  await chrome.pointer(40, 32);
  await chrome.pointer(40, 32, 'mouseReleased');
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  await evaluate(
    "(() => { const e = document.getElementById('object-list'); e.value = '1'; e.dispatchEvent(new Event('change')); })()",
  );
  await evaluate("document.getElementById('preview-movement-settings').open = true");
  await click('preview-movement');
  await evaluate(
    "(() => { const e = document.getElementById('preview-path'); e.value = '64, 32'; e.dispatchEvent(new Event('input')); })()",
  );
  await click('preview-follow-path');
  await wait("document.getElementById('preview-position').textContent.includes('X 64.0, Y 32.0')");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await click('preview-movement');
  await paint(72, 64);
  const previewDraft = array((await post('list-drafts')).drafts, record)[0];
  const previewSnapshot = record((await post('download-draft', previewDraft)).scene);
  const sprite = array(
    array(previewSnapshot.layers, record).find((layer) => layer.type === 'objectgroup')?.objects,
    record,
  )[0];
  assert.equal(sprite.x, 40);
  assert.equal(sprite.y, 32);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await chrome.click("document.querySelector('#discard-dialog button[value=discard]')");
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  // A stale scene blocks restore but still supports download and confirmed discard.
  console.log('Draft browser: checking conflict, download and discard');
  const catalog = record(await (await fetch(new URL('api/project', url))).json());
  const current = record(await (await fetch(new URL(`api/scene/${first}`, url))).json());
  const draft = await post('checkpoint-draft', {
    id: checkpoint.id,
    revision: null,
    project_id: record(catalog.project).id,
    scene_id: first,
    name: 'Room',
    scene_revision: current.revision,
    project_revision: catalog.revision,
    scene: current.scene,
  });
  const currentBytes = await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8');
  await writeFile(join(root, 'scenes', `${first}.tmj`), currentBytes + '\n');
  await click('show-recovery');
  await wait("document.getElementById('recovery-dialog').open");
  await click('recovery-restore');
  await wait(
    "document.querySelector('#recovery-dialog .form-error').textContent.includes('changed')",
  );
  await chrome.screenshot('draft-recovery-conflict');
  await evaluate(
    'window.__draftBlob = null; URL.createObjectURL = blob => { window.__draftBlob = blob; return "blob:captured"; }; HTMLAnchorElement.prototype.click = function() {};',
  );
  await click('recovery-download');
  await wait('window.__draftBlob !== null');
  const downloaded = record(JSON.parse(string(await evaluate('window.__draftBlob.text()'))));
  assert.equal(downloaded.scene_id, first);
  assert.deepEqual(downloaded.scene, current.scene);
  assert.equal(draft.revision, array((await post('list-drafts')).drafts, record)[0].revision);
  await evaluate('window.confirm = () => false');
  await click('recovery-discard');
  assert.equal(array((await post('list-drafts')).drafts, record).length, 1);
  await evaluate('window.confirm = () => true');
  await click('recovery-discard');
  await wait("!document.getElementById('recovery-dialog').open");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  assert.equal(await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8'), currentBytes + '\n');
  assert.deepEqual(chrome.errors, []);
  console.log(
    'Draft browser acceptance passed: tab isolation, crash/restart/move, restore/revert/save, failed writes and retries, reload, stale revision preservation, download and confirmed discard.',
  );
} finally {
  await browser?.close();
  await stop();
  await rm(folder, { recursive: true, force: true });
}
