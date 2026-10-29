/** Read-only findings, unsaved navigation, assumptions and stale-result handling. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Chrome } from './chrome.ts';
import { string } from '../frontend/shared/decode.mts';
const folder = await mkdtemp(join(tmpdir(), 'forge-diagnostics-'));
const root = join(folder, 'world');
let server: ChildProcess | undefined;
let browser: Chrome | undefined;
try {
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project.create(Path(sys.argv[1]), 'Connected rooms')
d = p.objects.save_definition(dict(name='Door', kind='point', fields=[dict(name='target', type='string', required=True)]), p.catalog()['revision'])['definition_id']
ids = []
for name in ('Forest', 'Cave'):
    loaded = p.scenes.create(name, 12, 10, 8, p.catalog()['revision'])
    scene = dict(width=12, height=10, grid=8, next_layer_id=3, next_object_id=3, layers=[
        dict(id=1, name='Ground', type='tilelayer', visible=True, cells=[['']*12 for _ in range(10)]),
        dict(id=2, name='Doors', type='objectgroup', visible=True, objects=[
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
      `(() => {const s=document.getElementById('scenes');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(
      `document.getElementById('scene-name').textContent.startsWith(${JSON.stringify(id === first ? 'Forest ·' : 'Cave ·')}) && !document.getElementById('show-world').disabled`,
    );
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
  const original = await readFile(join(root, 'forge.project.json'), 'utf8');
  const openDiagnostics = async () => {
    await click('show-diagnostics');
    await wait("document.getElementById('diagnostics-dialog').open");
  };
  const runReport = async () => {
    await chrome.click("document.getElementById('diagnostics-run')");
    await wait(
      "!document.getElementById('diagnostics-run').disabled && document.querySelectorAll('#diagnostics-findings li').length > 0",
    );
    assert.equal(await evaluate("document.getElementById('diagnostics-error').textContent"), '');
  };
  await openDiagnostics();
  await runReport();
  assert.equal(
    await evaluate(
      "document.querySelectorAll('#diagnostics-findings [data-code=required]').length",
    ),
    4,
  );
  assert.match(
    String(await evaluate("document.getElementById('diagnostics-state').textContent")),
    /fail/,
  );
  // Shared server checks include both scenes; the dialog names each location.
  assert.match(
    String(await evaluate("document.getElementById('diagnostics-findings').textContent")),
    /Cave/,
  );
  await mkdir('docs/screenshots/diagnostics', { recursive: true });
  await chrome.screenshot('project-diagnostics');
  await copyFile(
    'build/reports/scene-editor/project-diagnostics.png',
    'docs/screenshots/diagnostics/report.png',
  );
  // Inspect an object in the current scene without changing its contents.
  await chrome.click("document.querySelector('#diagnostics-findings [data-code=required] button')");
  await wait("!document.getElementById('diagnostics-dialog').open");
  assert.match(String(await evaluate("document.getElementById('status').textContent")), /selected/);
  assert.equal(await readFile(join(root, 'forge.project.json'), 'utf8'), original);
  // Make an unsaved object edit, then inspect another scene and cancel switching.
  await click('edit-object');
  await wait("document.getElementById('object-dialog').open");
  await evaluate("document.getElementById('object-name').value='Edited spawn'");
  await click('object-apply');
  await wait("!document.getElementById('object-dialog').open");
  const undoBefore = await evaluate("document.getElementById('undo').disabled");
  await openDiagnostics();
  await evaluate(
    "(() => {const s=document.querySelector('#diagnostics-form select[name=movement]');s.value='grid-four-way';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await runReport();
  assert.match(
    String(await evaluate("document.getElementById('diagnostics-findings').textContent")),
    /Reachability needs/,
  );
  await chrome.click(
    "Array.from(document.querySelectorAll('#diagnostics-findings li')).find(e=>e.textContent.includes('Cave') && e.dataset.code==='required').querySelector('button')",
  );
  await wait("document.getElementById('switch-scene-dialog').open");
  await click('scene-switch-cancel');
  await wait("!document.getElementById('switch-scene-dialog').open");
  assert.match(
    String(await evaluate("document.getElementById('scene-name').textContent")),
    /Forest/,
  );
  assert.equal(await evaluate("document.getElementById('undo').disabled"), undoBefore);
  // Change options invalidates old results immediately, before another run.
  await openDiagnostics();
  await runReport();
  await evaluate(
    "(() => {const i=document.querySelector('#diagnostics-form input[name=include_hidden]');i.checked=true;i.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  assert.equal(await evaluate("document.querySelectorAll('#diagnostics-findings li').length"), 0);
  await runReport();
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(
    await evaluate(
      "document.getElementById('diagnostics-dialog').scrollWidth <= document.getElementById('diagnostics-dialog').clientWidth + 1",
    ),
    true,
  );
  // External scene writes invalidate a previously generated finding on Inspect.
  const path = join(root, 'scenes', `${second}.tmj`);
  const contents = await readFile(path, 'utf8');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, contents + '\n');
  await chrome.click("document.querySelector('#diagnostics-findings [data-code=required] button')");
  await wait("document.getElementById('diagnostics-state').textContent.includes('stale')");
  assert.equal(await evaluate("document.querySelectorAll('#diagnostics-findings li').length"), 0);
  assert.equal(await readFile(join(root, 'forge.project.json'), 'utf8'), original);
  assert.deepEqual(chrome.errors, []);
  console.log('Project diagnostics browser acceptance passed');
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
