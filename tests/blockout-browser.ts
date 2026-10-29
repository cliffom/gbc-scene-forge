/** Artwork-free planning, native edits/history, camera review and later artwork integration. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chrome } from './chrome.ts';
import { array, number, record, string } from '../frontend/decode.mts';

const folder = await mkdtemp(join(tmpdir(), 'forge-blockout-'));
const root = join(folder, 'projects');
const server = spawn(
  '.venv/bin/python',
  ['-m', 'gbc_scene_forge', '--no-browser', '--project-root', root, '--port', '0'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let browser: Chrome | undefined;
try {
  const url = await new Promise<string>((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(Error(logs)), 10000);
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
  chrome.acceptBeforeUnload = true;
  const evaluate = chrome.evaluate.bind(chrome),
    wait = chrome.wait.bind(chrome);
  const click = (id: string) => chrome.click(`document.getElementById(${JSON.stringify(id)})`);
  const set = (id: string, value: string) =>
    evaluate(
      `(()=>{const c=document.getElementById(${JSON.stringify(id)});c.value=${JSON.stringify(value)};c.dispatchEvent(new Event(c.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  const checkLabels = async () => {
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    assert.equal(
      await evaluate(`(()=>{
      const labels=[...document.querySelectorAll('.blockout-label')];
      const canvas=document.getElementById('scene').getBoundingClientRect();
      const viewport=document.getElementById('viewport').getBoundingClientRect();
      return labels.length>0 && labels.every((node,index)=>{
        const rect=node.getBoundingClientRect(), style=getComputedStyle(node);
        return style.fontSize==='13px' && style.pointerEvents==='none' &&
          node.scrollWidth<=node.clientWidth &&
          rect.left>=Math.max(canvas.left,viewport.left) &&
          rect.top>=Math.max(canvas.top,viewport.top) &&
          rect.right<=Math.min(canvas.right,viewport.right)+1 &&
          rect.bottom<=Math.min(canvas.bottom,viewport.bottom)+1 &&
          labels.slice(index+1).every(other=>{
            const b=other.getBoundingClientRect();
            return rect.right<=b.left || b.right<=rect.left || rect.bottom<=b.top || b.bottom<=rect.top;
          });
      });
    })()`),
      true,
      'Display-resolution captions fit the visible scene without clipping or overlap',
    );
  };
  const role = (name: string) =>
    chrome.click(
      `document.querySelector('#blockout-presets [data-blockout-role=${JSON.stringify(name)}]')`,
    );
  const drag = async (x: number, y: number, toX: number, toY: number) => {
    await chrome.pointer(x, y);
    await chrome.pointer(toX, toY, 'mouseMoved');
    await chrome.pointer(toX, toY, 'mouseReleased');
  };
  const target = await chrome.call('Target.createTarget', { url: 'about:blank' }, null);
  chrome.session = string(
    (await chrome.call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null))
      .sessionId,
  );
  await chrome.call('Page.enable');
  await chrome.call('Runtime.enable');
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await chrome.call('Page.navigate', { url });
  await wait("document.getElementById('project-form')?.hidden===false");
  await set('project-title', 'Forest plan');
  await set('project-starter', 'blockout');
  await chrome.click("document.querySelector('#project-form button.primary')");
  await wait(
    "location.pathname==='/projects/forest-plan/' && document.getElementById('create-blockout-dialog')?.open",
  );
  assert.equal(await evaluate('document.activeElement.id'), 'blockout-title');
  const base = new URL('/projects/forest-plan/', url);
  const catalog = async () => record(await (await fetch(new URL('api/project', base))).json());
  await set('blockout-title', 'Opening forest');
  await set('blockout-width', '961');
  await click('blockout-create-confirm');
  await wait(
    "document.querySelector('#blockout-scene-form .form-error').textContent.includes('divisible')",
  );
  await set('blockout-width', '960');
  await set('blockout-units', 'cells');
  assert.equal(await evaluate("document.getElementById('blockout-width').value"), '120');
  assert.equal(
    await evaluate(
      "document.getElementById('blockout-create-metrics').textContent.includes('6.00 horizontal')",
    ),
    true,
  );
  await click('blockout-create-confirm');
  await wait("document.getElementById('status').textContent.startsWith('Blockout created')");
  const id = string(await evaluate("document.getElementById('scenes').value"));
  const saved = async () => record(await (await fetch(new URL(`api/scene/${id}`, base))).json());
  assert.deepEqual(record((await catalog()).project).atlases, {});
  assert.equal(await evaluate("document.querySelectorAll('#blockout-presets button').length"), 20);
  assert.equal(
    await evaluate("document.getElementById('blockout-tab').getAttribute('aria-selected')"),
    'true',
  );
  assert.ok(
    number(await evaluate("document.getElementById('scene').getBoundingClientRect().width")) < 960,
  );
  await set('zoom', '1');
  await role('solid');
  await drag(16, 224, 320, 256);
  await click('edit-object');
  await wait("document.getElementById('object-dialog').open");
  assert.equal(await evaluate("document.getElementById('object-width').value"), '304');
  await set('object-name', 'Forest ground');
  await click('object-apply');
  await chrome.click("document.querySelector('input[name=tool][value=select]')");
  await drag(320, 256, 352, 256);
  await click('edit-object');
  assert.equal(await evaluate("document.getElementById('object-width').value"), '336');
  await click('object-cancel');
  await click('undo');
  await click('edit-object');
  assert.equal(await evaluate("document.getElementById('object-width').value"), '304');
  await click('object-cancel');
  await click('redo');
  await click('edit-object');
  assert.equal(await evaluate("document.getElementById('object-width').value"), '336');
  await click('object-cancel');
  await role('water');
  await drag(368, 224, 432, 256);
  await role('climb');
  await drag(208, 144, 224, 224);
  for (const [name, x, y] of [
    ['spawn', 32, 216],
    ['enemy', 96, 216],
    ['reward', 224, 136],
    ['checkpoint', 480, 216],
  ] as const) {
    await role(name);
    await chrome.pointer(x, y);
    await chrome.pointer(x, y, 'mouseReleased');
  }
  // Moving the same camera object retains its identity and uses scene undo history.
  await click('blockout-camera-select');
  await drag(32, 32, 64, 56);
  await click('blockout-camera-edit');
  await wait("document.getElementById('object-dialog').open");
  assert.equal(await evaluate("document.getElementById('object-id').value"), '1');
  assert.equal(await evaluate("document.getElementById('object-x').value"), '32');
  await set('object-x', '0');
  await set('object-y', '136');
  await evaluate(
    "const c=document.querySelector('[data-field=scroll_y] input[aria-label=scroll_y]');c.checked=true;c.dispatchEvent(new Event('change'))",
  );
  await click('object-apply');
  const beforeReview = await catalog();
  await chrome.screenshot('blockout-authoring');
  await click('blockout-review');
  await wait(
    "document.getElementById('blockout-review-dialog').open && document.getElementById('blockout-camera-image').naturalWidth===160",
  );
  assert.equal(
    await evaluate("document.getElementById('blockout-overview-image').naturalWidth"),
    960,
  );
  assert.equal(
    await evaluate("document.getElementById('blockout-camera-image').naturalHeight"),
    136,
  );
  assert.equal(
    await evaluate(
      "document.getElementById('blockout-review-summary').textContent.includes('Y scrolls')",
    ),
    true,
  );
  assert.equal((await catalog()).revision, beforeReview.revision);
  assert.equal(
    array(record((await saved()).scene).layers, record).flatMap((layer) =>
      array(layer.objects ?? [], record),
    ).length,
    1,
    'Review includes unsaved content without saving it',
  );
  await chrome.screenshot('blockout-camera-review');
  await click('blockout-review-close');
  await click('save');
  await wait("document.getElementById('status').textContent==='Scene saved.'");
  const plan = await saved();
  const planLayers = array(record(plan.scene).layers, record);
  const planObjects = planLayers.flatMap((layer) => array(layer.objects ?? [], record));
  assert.equal(planObjects.length, 8);
  const camera = planObjects.find((item) => item.id === 1);
  assert.equal(camera?.y, 136);
  await chrome.call('Page.reload');
  await wait(
    "document.getElementById('status')?.textContent==='Choose a scene, or import an atlas and create one.'",
  );
  await set('scenes', id);
  await wait("document.getElementById('scene-save-state').textContent==='Saved'");
  assert.deepEqual(await saved(), plan);
  // Existing artwork intake and painting preserve every plan object and its typed fields.
  const { stdout: source } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `import sys;from pathlib import Path;sys.path.insert(0,'tests');from atlas_fixture import bundle;p,_=bundle(Path(sys.argv[1]));print(p)`,
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
  const withArt = await saved();
  await checkLabels();
  await chrome.screenshot('blockout-labels-with-artwork');
  assert.deepEqual(
    array(record(withArt.scene).layers, record).flatMap((layer) =>
      array(layer.objects ?? [], record),
    ),
    planObjects,
  );
  await evaluate(
    "window.__archive=null;URL.createObjectURL=blob=>{window.__archive=blob;return 'blob:export-test'};HTMLAnchorElement.prototype.click=function(){};",
  );
  await click('show-export');
  await set('export-scope', 'project');
  await click('export-confirm');
  await wait("window.__archive?.type==='application/zip'");
  const archive = string(
    await evaluate(
      "window.__archive.arrayBuffer().then(b=>btoa(Array.from(new Uint8Array(b),c=>String.fromCharCode(c)).join('')))",
    ),
  );
  await promisify(execFile)('.venv/bin/python', [
    '-c',
    `import io,sys,base64,zipfile,json;from gbc_scene_forge.formats import tiled;z=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.argv[1])));p=json.loads(z.read('forge.project.json'));s=tiled.decode(json.loads(z.read('scenes/'+sys.argv[2]+'.tmj')),p);assert len([o for l in s['layers'] for o in l.get('objects',[])])==8;assert p['atlases']`,
    archive,
    id,
  ]);
  // The accepted opening-forest example is data in an independent fixture, never an editor branch.
  const exampleRoot = join(root, 'forest-example');
  const { stdout: example } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `import sys;from pathlib import Path;sys.path.insert(0,'tests');from blockout_fixture import opening_forest;from gbc_scene_forge.project.application import Project;p=Project.create(Path(sys.argv[1]),'Opening forest example',starter='blockout');s,_=opening_forest(p);print(s['id'])`,
    exampleRoot,
  ]);
  await chrome.call('Page.navigate', { url: new URL('/projects/forest-example/', url).href });
  await wait(
    "document.getElementById('status')?.textContent==='Choose a scene, or import an atlas and create one.'",
  );
  await set('scenes', example.trim());
  await wait("document.getElementById('scene-save-state').textContent==='Saved'");
  await click('blockout-tab');
  await click('fit-scene');
  await chrome.screenshot('blockout-opening-forest');
  await checkLabels();
  // Display text stays crisp at every zoom and at both standard and Retina densities.
  for (const deviceScaleFactor of [1, 2]) {
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor,
      mobile: false,
    });
    for (const zoom of ['0.5', '1', '2', '4']) {
      await set('zoom', zoom);
      await checkLabels();
    }
  }
  await click('blockout-camera-select');
  await click('blockout-camera-edit');
  const longCameraName = 'Gameplay camera 160 × 136 with a deliberately long framing description';
  await set('object-name', longCameraName);
  await click('object-apply');
  await checkLabels();
  assert.equal(
    await evaluate(
      `document.querySelector('.blockout-label[data-priority="0"]')?.textContent.endsWith('…')`,
    ),
    true,
  );
  assert.equal(
    await evaluate("document.getElementById('selection-name').textContent"),
    longCameraName,
  );
  await evaluate("document.getElementById('viewport').scrollTo(80,160)");
  await checkLabels();
  assert.equal(
    await evaluate(`(()=>{
    const canvas=document.getElementById('scene').getBoundingClientRect();
    const label=document.querySelector('.blockout-label[data-object-id="1"]').getBoundingClientRect();
    return Math.abs(label.top-(canvas.top+136*4))<=64;
  })()`),
    true,
    'The selected camera caption follows its scene-space anchor while panning',
  );
  await chrome.screenshot('blockout-labels-4x-retina');
  await chrome.click('document.querySelector(\'#layers [data-layer-id="4"] input\')');
  const noteId = string(
    await evaluate(
      "[...document.getElementById('object-list').options].find(o=>o.textContent.includes('Stage pacing')).value",
    ),
  );
  await set('object-list', noteId);
  assert.equal(await evaluate("document.getElementById('selection-note').hidden"), false);
  assert.equal(
    await evaluate(
      "document.getElementById('selection-note').textContent.includes('full stage length remains undecided')",
    ),
    true,
  );
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('fit-scene');
  await checkLabels();
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1200,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await checkLabels();
  await chrome.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await checkLabels();
  await chrome.click('document.querySelector(\'#layers [data-layer-id="4"] .layer-eye\')');
  await checkLabels();
  assert.equal(
    await evaluate(
      `Boolean(document.querySelector('.blockout-label[data-object-id="${noteId}"]'))`,
    ),
    false,
  );
  await chrome.click('document.querySelector(\'#layers [data-layer-id="4"] .layer-eye\')');
  await evaluate(`window.__previewURLs=[];window.__revokedURLs=[];
    window.__createURL=URL.createObjectURL;window.__revokeURL=URL.revokeObjectURL;
    URL.createObjectURL=(blob)=>{const url=window.__createURL(blob);window.__previewURLs.push(url);return url};
    URL.revokeObjectURL=(url)=>{window.__revokedURLs.push(url);window.__revokeURL(url)};`);
  await click('blockout-review');
  await wait(
    "document.getElementById('blockout-review-dialog').open && document.getElementById('blockout-camera-image').naturalWidth===160",
  );
  await chrome.screenshot('blockout-opening-forest-review');
  assert.equal(await evaluate('window.__previewURLs.length'), 2);
  await evaluate(
    `(async()=>{const {editor}=await import('/project.js');editor.dispose();editor.dispose()})()`,
  );
  assert.deepEqual(await evaluate('window.__revokedURLs'), await evaluate('window.__previewURLs'));
  await evaluate('URL.createObjectURL=window.__createURL;URL.revokeObjectURL=window.__revokeURL');
  assert.deepEqual(chrome.errors, []);
  console.log(
    'Blockout browser passed: artwork-free start, units, drawing/resizing/undo, typed camera settings, unsaved SVG review, persistence/export, later artwork, forest example.',
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
