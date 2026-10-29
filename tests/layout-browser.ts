/** Layout and keyboard acceptance for the editor command hierarchy. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chrome } from './chrome.ts';
import { string } from '../frontend/shared/decode.mts';

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
  const click = (id: string) => chrome.click(`document.getElementById(${JSON.stringify(id)})`);
  const key = async (name: string) => {
    const codes: Record<string, number> = {
      Escape: 27,
      Enter: 13,
      Tab: 9,
      Home: 36,
      End: 35,
      ArrowLeft: 37,
      ArrowRight: 39,
    };
    await chrome.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
      key: name,
      code: name,
      windowsVirtualKeyCode: codes[name],
    });
    await chrome.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: name,
      code: name,
      windowsVirtualKeyCode: codes[name],
    });
  };
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [760, 640],
    [1440, 600],
  ]) {
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await chrome.screenshot(`editor-layout-${width}`);
    assert.equal(
      await evaluate(`(() => {
      const viewport = document.getElementById('viewport').getBoundingClientRect();
      const footer = document.querySelector('.status-bar').getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight && viewport.height >= 160 &&
        viewport.bottom <= footer.top;
    })()`),
      true,
      `Canvas and footer fit ${width}×${height}`,
    );
    // All visible single-value selects reserve arrow space and stay inside their panels.
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelectorAll('select:not([multiple]):not([size])')).filter(s => s.checkVisibility()).flatMap(s => {
      const r = s.getBoundingClientRect(), css = getComputedStyle(s);
      return parseFloat(css.paddingRight) >= 28 && r.left >= 0 && r.right <= innerWidth ? [] : [s.id];
    })`),
      [],
      `Dropdown arrow clearance at ${width}×${height}`,
    );
    await click('stamps-tab');
    assert.equal(await evaluate("document.getElementById('stamps-panel').hidden"), false);
    await evaluate(
      "document.getElementById('stamps').selectedIndex=1;document.getElementById('stamps').dispatchEvent(new Event('change'))",
    );
    assert.equal(
      await evaluate(`(() => {
      const select=document.getElementById('stamps'), panel=document.getElementById('stamps-panel');
      const r=select.getBoundingClientRect(), p=panel.getBoundingClientRect();
      return r.width >= 150 && r.left >= p.left && r.right <= p.right &&
        select.title === select.selectedOptions[0].textContent;
    })()`),
      true,
      `Long stamp names are bounded and available in full at ${width}`,
    );
    await chrome.screenshot(`editor-stamps-${width}`);
    await click('scene-commands');
    await chrome.wait("document.getElementById('scene-command-panel').matches(':popover-open')");
    assert.equal(
      await evaluate(`(() => {
      const r=document.getElementById('scene-command-panel').getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    })()`),
      true,
      `Command popover stays in ${width}×${height}`,
    );
    await key('Escape');
    await click('artwork-tab');
  }
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Rebuilding artwork on scene changes preserves the user's chosen library category.
  await click('stamps-tab');
  await evaluate(
    "document.getElementById('scenes').selectedIndex=2;document.getElementById('scenes').dispatchEvent(new Event('change'))",
  );
  await chrome.wait("document.getElementById('scene-name').textContent.startsWith('Courtyard ·')");
  assert.equal(
    await evaluate("document.getElementById('stamps-tab').getAttribute('aria-selected')"),
    'true',
  );
  await evaluate(
    `document.getElementById('scenes').value=${JSON.stringify(scene)};document.getElementById('scenes').dispatchEvent(new Event('change'))`,
  );
  await chrome.wait("document.getElementById('scene-name').textContent.startsWith('Riverside ·')");
  await click('artwork-tab');
  // Tabs follow the WAI keyboard pattern and keep a single Tab stop.
  await evaluate("document.getElementById('artwork-tab').focus()");
  await key('ArrowRight');
  assert.equal(await evaluate('document.activeElement.id'), 'objects-tab');
  assert.equal(await evaluate("document.getElementById('objects-panel').hidden"), false);
  await key('End');
  assert.equal(await evaluate('document.activeElement.id'), 'stamps-tab');
  await key('Home');
  assert.equal(await evaluate('document.activeElement.id'), 'artwork-tab');
  assert.equal(await evaluate('document.querySelectorAll(\'[role=tab][tabindex="0"]\').length'), 1);
  // Native popover dismissal and keyboard focus, then a command's modal autofocus.
  await evaluate("document.getElementById('scene-commands').focus()");
  await key('Enter');
  await chrome.wait("document.getElementById('scene-command-panel').matches(':popover-open')");
  await key('Escape');
  assert.equal(await evaluate('document.activeElement.id'), 'scene-commands');
  await click('scene-commands');
  await click('show-rename');
  await chrome.wait("document.getElementById('scene-manage-dialog').open");
  assert.equal(
    await evaluate("document.getElementById('scene-command-panel').matches(':popover-open')"),
    false,
  );
  assert.equal(await evaluate('document.activeElement.id'), 'scene-manage-name');
  await key('Escape');
  await click('project-commands');
  await chrome.screenshot('editor-project-commands');
  await click('show-diagnostics');
  await chrome.wait("document.getElementById('diagnostics-dialog').open");
  assert.equal(
    await evaluate("document.getElementById('project-command-panel').matches(':popover-open')"),
    false,
  );
  await key('Escape');
  // Palette problems remain visible even while the secondary commands are closed.
  await evaluate("document.getElementById('show-palettes').dataset.state='fail'");
  await chrome.wait(
    "document.getElementById('project-commands').getAttribute('aria-label').includes('exceeded')",
  );
  assert.equal(await evaluate("document.querySelector('.command-alert').checkVisibility()"), true);
  await chrome.screenshot('editor-palette-warning');
  await evaluate("document.getElementById('show-palettes').dataset.state='pending'");
  await click('objects-tab');
  await chrome.screenshot('editor-objects-desktop');
  await click('stamps-tab');
  await chrome.screenshot('editor-stamps-desktop');
  await click('place-stamp');
  assert.equal(
    await evaluate("document.getElementById('place-stamp').getAttribute('aria-pressed')"),
    'true',
  );
  assert.equal(
    await evaluate("document.getElementById('place-stamp').textContent"),
    'Stop placing',
  );
  await click('place-stamp');
  assert.equal(
    await evaluate("document.getElementById('place-stamp').getAttribute('aria-pressed')"),
    'false',
  );
  // The first-scene guide can reveal a control in a different library category.
  await click('show-first-scene-guide');
  for (let step = 0; step < 3; step++) {
    await click('guide-next');
  }
  assert.equal(await evaluate("document.getElementById('guide-action').disabled"), false);
  await click('guide-action');
  assert.equal(
    await evaluate("document.getElementById('artwork-tab').getAttribute('aria-selected')"),
    'true',
  );
  assert.equal(await evaluate("document.getElementById('scene-save-state').textContent"), 'Saved');
  await evaluate('document.activeElement.blur()');
  await chrome.screenshot('editor-layout-desktop');
  assert.deepEqual(chrome.errors, []);
  console.log('Editor layout acceptance passed.');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGINT');
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
