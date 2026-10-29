/** Saved-file refresh with a real stdio MCP writer and protected browser edits. */
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
    [
      '-m',
      'gbc_scene_forge',
      '--project-root',
      join(folder, 'projects'),
      '--no-browser',
      '--port',
      '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server = serverProcess;
  const serverUrl = await new Promise<string>((resolve, reject) => {
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
  const url = new URL(`projects/${root.split('/').at(-1)}/`, serverUrl).href;
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
  const post = async (route: string, body: Record<string, unknown>) => {
    const result = await fetch(new URL(`api/${route}`, url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scene-Token': string((await catalog()).token),
      },
      body: JSON.stringify(body),
    });
    assert.equal(result.status, 200, await result.clone().text());
    return record(await result.json());
  };
  async function agent(name: string, args: Record<string, unknown>) {
    const child = spawn(python, ['tests/mcp_call.py', root, name], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', (data: Buffer) => {
      logs += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      logs += data.toString();
    });
    child.stdin.end(JSON.stringify({ project: 'project', ...args }));
    await once(child, 'exit');
    assert.equal(child.exitCode, 0, logs);
    return record(JSON.parse(logs));
  }
  async function moveCamera(x: number) {
    await evaluate("document.getElementById('status').textContent=''");
    const scene = await saved();
    return agent('edit_scene', {
      project_revision: (await catalog()).revision,
      scene_revision: scene.revision,
      scene_id: id,
      operations: [{ op: 'update', object_id: 1, changes: { x } }],
    });
  }
  const tick = () => evaluate("window.dispatchEvent(new Event('focus'))");
  const cameraX = () => evaluate("document.getElementById('object-x').value");
  async function inspectCamera(x: number) {
    await click('blockout-camera-edit');
    await wait("document.getElementById('object-dialog').open");
    assert.equal(await cameraX(), String(x));
    await click('object-cancel');
  }
  await click('blockout-tab');
  // Keep browser Undo available after our own save; an external adoption must
  // clear it while preserving the camera selection and active camera layer.
  await click('blockout-camera-edit');
  await set('object-x', '8');
  await click('object-apply');
  await click('save');
  await wait("document.getElementById('status').textContent==='Scene saved.'");
  assert.equal(await evaluate("document.getElementById('undo').disabled"), false);
  const selected = await evaluate(
    "[document.getElementById('selection-name').textContent,document.getElementById('layers').querySelector('input:checked')?.value]",
  );
  await set('zoom', '4');
  await evaluate(
    "document.activeElement?.blur();document.getElementById('viewport').scrollTo(250,80)",
  );
  const scroll = await evaluate(
    "[document.getElementById('viewport').scrollLeft,document.getElementById('viewport').scrollTop]",
  );
  console.log('Refresh: clean real MCP saves and preserved view');
  await moveCamera(16);
  await tick();
  await wait("document.getElementById('status').textContent.includes('External changes loaded')");
  assert.equal(await evaluate("document.getElementById('zoom').value"), '4');
  assert.deepEqual(
    await evaluate(
      "[document.getElementById('viewport').scrollLeft,document.getElementById('viewport').scrollTop]",
    ),
    scroll,
  );
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  assert.deepEqual(
    await evaluate(
      "[document.getElementById('selection-name').textContent,document.getElementById('layers').querySelector('input:checked')?.value]",
    ),
    selected,
  );
  await inspectCamera(16);
  // A form owns unfinished values even while the underlying scene is clean.
  console.log('Refresh: unfinished forms and dirty edit protection');
  await click('blockout-camera-edit');
  await set('object-x', '32');
  await moveCamera(24);
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await cameraX(), '32');
  await click('object-apply');
  await wait("document.getElementById('dirty').textContent==='UNSAVED'");
  await wait("document.getElementById('draft-status').textContent==='Draft checkpoint saved'");
  await evaluate(
    `window.__probeCount=0;window.__realFetch=window.fetch;window.fetch=(...args)=>{if(String(args[0]).includes('/api/revisions'))window.__probeCount++;return window.__realFetch(...args)}`,
  );
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await evaluate('window.__probeCount'), 0);
  await click('save');
  await wait("document.getElementById('status').textContent.includes('changed')");
  assert.equal(objects((await saved()).scene).find((item) => item.id === 1)?.x, 24);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await chrome.click("document.querySelector('#discard-dialog button[value=discard]')");
  await wait("document.getElementById('dirty').textContent==='SAVED'");
  await tick();
  await wait("document.getElementById('status').textContent.includes('External changes loaded')");
  await inspectCamera(24);
  console.log('Refresh: hidden tabs make no revision requests');
  await evaluate(
    `window.__probeCount=0;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await evaluate('window.__probeCount'), 0);
  await evaluate(
    "delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))",
  );
  console.log('Refresh: opt-out and manual checks');
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await click('auto-refresh');
  await moveCamera(40);
  await evaluate('window.__probeCount=0');
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await evaluate('window.__probeCount'), 0);
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await click('check-external');
  await wait("document.getElementById('status').textContent.includes('External changes loaded')");
  await inspectCamera(40);
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await click('auto-refresh');
  // Hold a snapshot response while the user opens a form. Releasing it must
  // neither overwrite the form nor mark that external revision as adopted.
  console.log('Refresh: edits begun during an in-flight snapshot');
  await evaluate(
    `window.__release=null;window.fetch=async(...args)=>{const response=await window.__realFetch(...args);if(String(args[0]).includes('/api/snapshot'))await new Promise(resolve=>window.__release=resolve);return response}`,
  );
  await moveCamera(48);
  await tick();
  await wait('window.__release!==null');
  await evaluate(
    `window.__heldProbes=0;window.__heldFetch=window.fetch;window.fetch=(...args)=>{if(String(args[0]).includes('/api/revisions'))window.__heldProbes++;return window.__heldFetch(...args)}`,
  );
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await evaluate('window.__heldProbes'), 0);
  await click('blockout-camera-edit');
  await set('object-x', '56');
  await evaluate('window.__release();window.fetch=window.__realFetch');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await cameraX(), '56');
  await click('object-cancel');
  await tick();
  await wait("document.getElementById('status').textContent.includes('External changes loaded')");
  await inspectCamera(48);
  console.log('Refresh: connection recovery and rapid successive writes');
  await evaluate(
    `window.fetch=(...args)=>String(args[0]).includes('/api/revisions')?Promise.reject(Error('Simulated offline')):window.__realFetch(...args)`,
  );
  await tick();
  await wait("document.getElementById('sync-status').textContent.includes('Simulated offline')");
  await moveCamera(64);
  await moveCamera(72);
  await evaluate("window.fetch=window.__realFetch;window.dispatchEvent(new Event('online'))");
  await wait("document.getElementById('sync-status').hidden");
  await inspectCamera(72);
  // Project-only writes update inventories even with no scene revision change.
  const currentProject = await catalog();
  const definition = array(
    record(record(currentProject.project).object_definitions).definitions,
    record,
  )[0];
  await agent('save_object_definition', {
    project_revision: currentProject.revision,
    definition: { ...definition, name: 'Updated blockout definition' },
  });
  await tick();
  await wait(
    "document.getElementById('object-definition-brush').textContent.includes('Updated blockout definition')",
  );
  // Artwork import uses a separate native writer (not a new browser import).
  await promisify(execFile)('.venv/bin/python', [
    '-c',
    "import sys;from pathlib import Path;sys.path.insert(0,'tests');from atlas_fixture import bundle;from gbc_scene_forge.projects import Project;p,_=bundle(Path(sys.argv[2]));w=Project(sys.argv[1]);w.import_atlas(p,w.catalog()['revision'])",
    root,
    join(folder, 'external-art'),
  ]);
  await tick();
  await wait('document.querySelector(\'#palette [data-asset="terrain/earth"]\')!==null');
  await inspectCamera(72);
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await chrome.screenshot('external-refresh');
  await evaluate("document.getElementById('project-command-panel').hidePopover()");
  console.log('Refresh: scene creation and external deletion');
  await agent('create_scene', {
    project_revision: (await catalog()).revision,
    name: 'Second plan',
    width: 20,
    height: 18,
    grid: 8,
  });
  await tick();
  await wait("document.getElementById('scenes').textContent.includes('Second plan')");
  const current = await saved();
  await post('delete-scene', {
    id,
    revision: current.revision,
    project_revision: (await catalog()).revision,
    confirm_broken_links: true,
  });
  await tick();
  await wait("document.getElementById('status').textContent.includes('removed externally')");
  assert.equal(await evaluate("document.getElementById('save').disabled"), true);
  assert.equal(await evaluate("document.getElementById('canvas-surround').hidden"), true);
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await chrome.screenshot('external-scene-deleted');
  assert.deepEqual(chrome.errors, []);
  console.log(
    'Refresh browser passed: real MCP saves, view preservation, forms, paused dirty polling, save conflicts, manual checks, in-flight edits, reconnect, inventories and deletion.',
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
