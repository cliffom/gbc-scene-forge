/** Resource ownership and replacement of the supported editor composition. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chrome } from './chrome.ts';
import { string } from '../frontend/decode.mts';

const folder = await mkdtemp(join(tmpdir(), 'forge-layout-'));
const root = join(folder, 'world');
const { stdout } = await promisify(execFile)('.venv/bin/python', [
  '-c',
  `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project.from_sample(Path(sys.argv[1]), title='Forest and village')
p.objects.save_stamp('Forest entrance with a long descriptive stamp name', dict(width=1, height=1, grid=8,
    cells=[['sample/grass/0/0']]), [0], p.catalog()['revision'])
print(p.catalog()['project']['scenes'][0]['id'])
`,
  root,
]);
const scene = stdout.trim();
const server = spawn(
  '.venv/bin/python',
  ['-m', 'gbc_scene_forge', '--no-browser', '--project', root, '--port', '0'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let browser: Chrome | undefined;
try {
  const url = await new Promise<string>((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(Error(`Startup timed out: ${logs}`)), 10000);
    server.once('error', reject);
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
  const target = await chrome.call('Target.createTarget', { url: 'about:blank' }, null);
  chrome.session = string(
    (await chrome.call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null))
      .sessionId,
  );
  await chrome.call('Page.enable');
  await chrome.call('Runtime.enable');
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await chrome.call('Page.navigate', { url });
  await chrome.wait(
    "document.getElementById('status')?.textContent === 'Choose a scene, or import an atlas and create one.'",
  );
  await chrome.evaluate(
    `document.getElementById('scenes').value=${JSON.stringify(scene)}; document.getElementById('scenes').dispatchEvent(new Event('change'));`,
  );
  await chrome.wait("document.getElementById('scene-save-state').textContent === 'Saved'");

  const evaluate = chrome.evaluate.bind(chrome);
  await evaluate(`(async()=>{window.__requests=[]; window.__fetch=window.fetch;
    window.fetch=(...args)=>{window.__requests.push(String(args[0]));return window.__fetch(...args)};
    window.__module=await import('/project.js'); window.__module.editor.dispose();
    document.activeElement?.blur();})()`);
  assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 0);
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.deepEqual(await evaluate('window.__requests'), []);
  // A replaced editor owns exactly one set of handlers, overlays and pollers.
  for (let attempt = 0; attempt < 2; attempt++) {
    await evaluate('window.__mounted=window.__module.mountProjectEditor()');
    await chrome.wait(
      "document.getElementById('status').textContent === 'Choose a scene, or import an atlas and create one.'",
    );
    assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 1);
    await evaluate(`window.__requests=[];
      document.getElementById('scenes').value=${JSON.stringify(scene)};
      document.getElementById('scenes').dispatchEvent(new Event('change'));`);
    await chrome.wait("document.getElementById('status').textContent === 'Scene opened.'");
    assert.equal(
      await evaluate("window.__requests.filter(url=>url.includes('/api/scene/')).length"),
      1,
    );
    await evaluate('window.__mounted.dispose();window.__requests=[]');
    assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 0);
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.deepEqual(await evaluate('window.__requests'), []);
  }
  // A load from a disposed editor must not overwrite its replacement, even if
  // a host's fetch wrapper ignores cancellation and delivers the old response late.
  await evaluate(`window.__held=false;window.fetch=async(...args)=>{
    const response=await window.__fetch(...args);
    if(String(args[0]).includes('/api/project')) {
      window.__held=true;
      await new Promise(resolve=>{window.__release=resolve});
    }
    return response;
  };window.__stale=window.__module.mountProjectEditor()`);
  await chrome.wait('window.__held');
  await evaluate(`window.__stale.dispose();window.fetch=window.__fetch;
    document.getElementById('status').textContent='Loading replacement';
    window.__mounted=window.__module.mountProjectEditor()`);
  await chrome.wait(
    "document.getElementById('status').textContent === 'Choose a scene, or import an atlas and create one.'",
  );
  await evaluate('window.__release()');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await evaluate("document.getElementById('status').textContent"),
    'Choose a scene, or import an atlas and create one.',
  );
  assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 1);
  await evaluate('window.__mounted.dispose()');
  assert.deepEqual(chrome.errors, []);
  console.log(
    'Editor lifecycle acceptance passed: disposal, remount, single handlers and stopped polling.',
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
