/** Real stdio-authored plan, browser edits, stale saves and independent draft recovery. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Chrome } from './chrome.ts';
import { array, record, string } from '../frontend/decode.mts';

const folder = await mkdtemp(join(tmpdir(), 'forge-mcp-'));
const python = process.env.FORGE_MCP_PYTHON || '.venv/bin/python';
let browser: Chrome | undefined;
let server: ReturnType<typeof spawn> | undefined;
try {
  const { stdout } = await promisify(execFile)(python, [
    'examples/mcp/opening_forest.py',
    '--root',
    join(folder, 'projects'),
    '--output',
    join(folder, 'review'),
  ]);
  const example = record(JSON.parse(stdout));
  const root = string(example.project);
  const id = string(example.scene_id);
  const serverProcess = spawn(
    '.venv/bin/python',
    ['-m', 'gbc_scene_forge', '--project', root, '--no-browser', '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server = serverProcess;
  const url = await new Promise<string>((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(Error(logs)), 10000);
    serverProcess.once('error', reject);
    serverProcess.stdout?.on('data', (data: Buffer) => {
      logs += data.toString();
      const match = /Editor\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(logs);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    serverProcess.stderr?.on('data', (data: Buffer) => {
      logs += data.toString();
    });
  });
  const catalog = async () => record(await (await fetch(new URL('api/project', url))).json());
  const saved = async () => record(await (await fetch(new URL(`api/scene/${id}`, url))).json());
  const objects = (scene: unknown) =>
    array(record(scene).layers, record).flatMap((layer) => array(layer.objects ?? [], record));
  const original = await saved();
  assert.equal(objects(original.scene).length, 22);
  assert.deepEqual(record((await catalog()).project).atlases, {});
  browser = await Chrome.launch(process.argv[2]);
  const chrome = browser;
  chrome.acceptBeforeUnload = true;
  const target = await chrome.call('Target.createTarget', { url: 'about:blank' }, null);
  chrome.session = string(
    (
      await chrome.call(
        'Target.attachToTarget',
        {
          targetId: target.targetId,
          flatten: true,
        },
        null,
      )
    ).sessionId,
  );
  await chrome.call('Page.enable');
  await chrome.call('Runtime.enable');
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const evaluate = chrome.evaluate.bind(chrome),
    wait = chrome.wait.bind(chrome);
  const click = (name: string) => chrome.click(`document.getElementById(${JSON.stringify(name)})`);
  const set = (name: string, value: string) =>
    evaluate(
      `(()=>{const e=document.getElementById(${JSON.stringify(name)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  await chrome.call('Page.navigate', { url });
  await wait(
    "document.getElementById('status')?.textContent==='Choose a scene, or import an atlas and create one.'",
  );
  await set('scenes', id);
  await wait("document.getElementById('scene-save-state').textContent==='Saved'");
  await click('blockout-tab');
  await click('blockout-review');
  await wait("document.getElementById('blockout-overview-image').naturalWidth===960");
  assert.equal(
    await evaluate("document.getElementById('blockout-camera-image').naturalWidth"),
    160,
  );
  await chrome.screenshot('mcp-forest-review');
  await click('blockout-review-close');
  // Edit the MCP-authored camera through normal browser controls and save/reopen.
  await click('blockout-camera-edit');
  await wait("document.getElementById('object-dialog').open");
  await set('object-x', '16');
  await click('object-apply');
  await click('save');
  await wait("document.getElementById('status').textContent==='Scene saved.'");
  assert.equal(objects((await saved()).scene).find((item) => item.id === 1)?.x, 16);
  assert.deepEqual(
    objects((await saved()).scene).filter((item) => item.id !== 1),
    objects(original.scene).filter((item) => item.id !== 1),
  );
  // Import/paint artwork through the browser without replacing any planning object.
  const planObjects = objects((await saved()).scene);
  const { stdout: source } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    "import sys;from pathlib import Path;sys.path.insert(0,'tests');from atlas_fixture import bundle;p,_=bundle(Path(sys.argv[1]));print(p)",
    join(folder, 'art'),
  ]);
  await click('artwork-tab');
  await click('library-import');
  await set('atlas-path', source.trim());
  await chrome.click("document.querySelector('#import-form button.primary')");
  await wait("document.getElementById('status').textContent.includes('Atlas imported')");
  await chrome.click("document.querySelector('#palette button.asset')");
  await set('zoom', '1');
  await chrome.pointer(8, 8);
  await chrome.pointer(8, 8, 'mouseReleased');
  await click('save');
  await wait("document.getElementById('status').textContent==='Scene saved.'");
  assert.deepEqual(objects((await saved()).scene), planObjects);
  await chrome.call('Page.reload');
  await wait(
    "document.getElementById('status')?.textContent==='Choose a scene, or import an atlas and create one.'",
  );
  await set('scenes', id);
  await wait("document.getElementById('scene-save-state').textContent==='Saved'");
  await click('blockout-tab');
  await click('blockout-camera-edit');
  await wait("document.getElementById('object-dialog').open");
  await set('object-x', '32');
  await click('object-apply');
  await wait("document.getElementById('draft-status').textContent==='Draft checkpoint saved'");
  const beforeAgent = await saved();
  const beforeProject = await catalog();
  const patrol = objects(beforeAgent.scene).find((item) => item.name === 'Forest patrol');
  // A separate MCP session saves while the browser has an unsaved camera edit.
  const child = spawn(python, ['tests/mcp_call.py', root, 'edit_scene'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (data: Buffer) => {
    logs += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    logs += data.toString();
  });
  child.stdin.end(
    JSON.stringify({
      project: 'project',
      project_revision: beforeProject.revision,
      scene_id: id,
      scene_revision: beforeAgent.revision,
      operations: [{ op: 'update', object_id: patrol?.id, changes: { x: 128 } }],
    }),
  );
  await once(child, 'exit');
  assert.equal(child.exitCode, 0, logs);
  const agentSaved = await saved();
  assert.equal(objects(agentSaved.scene).find((item) => item.name === 'Forest patrol')?.x, 128);
  await click('save');
  await wait("document.getElementById('status').textContent.includes('changed')");
  assert.deepEqual(await saved(), agentSaved);
  // Lose the tab so its checkpoint becomes recoverable by a fresh browser session.
  await chrome.call('Target.closeTarget', { targetId: target.targetId }, null);
  const recoveryTarget = await chrome.call('Target.createTarget', { url: 'about:blank' }, null);
  chrome.session = string(
    (
      await chrome.call(
        'Target.attachToTarget',
        { targetId: recoveryTarget.targetId, flatten: true },
        null,
      )
    ).sessionId,
  );
  await chrome.call('Page.enable');
  await chrome.call('Runtime.enable');
  await chrome.call('Page.navigate', { url });
  await wait("document.getElementById('recovery-dialog').open");
  await click('recovery-restore');
  await wait(
    "document.querySelector('#recovery-dialog .form-error').textContent.includes('changed')",
  );
  await evaluate(
    'window.__draftBlob=null;URL.createObjectURL=b=>{window.__draftBlob=b;return "blob:captured"};HTMLAnchorElement.prototype.click=function(){}',
  );
  await click('recovery-download');
  await wait('window.__draftBlob!==null');
  const draft = record(JSON.parse(string(await evaluate('window.__draftBlob.text()'))));
  assert.equal(objects(draft.scene).find((item) => item.id === 1)?.x, 32);
  assert.equal(objects(draft.scene).find((item) => item.name === 'Forest patrol')?.x, 112);
  await chrome.screenshot('mcp-draft-conflict');
  assert.deepEqual(chrome.errors, []);
  console.log(
    'MCP browser passed: real SDK forest, review, native edit/save/reopen, later artwork, concurrent agent write, stale browser save, recoverable draft download.',
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
