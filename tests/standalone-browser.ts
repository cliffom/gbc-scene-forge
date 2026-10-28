/** Full standalone workflow across server restarts and a moved project directory. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { record, string, array, number } from '../frontend/decode.mts';
import { Chrome } from './chrome.ts';

const folder = await mkdtemp(join(tmpdir(), 'forge-standalone-'));
let server: ChildProcess | undefined;
let chrome: Chrome | undefined;
let url = '';
async function start(root: string, fixture = true) {
  const args = fixture
    ? ['tests/serve_standalone_fixture.py', '--root', root]
    : ['-m', 'gbc_scene_forge', root, '--port', '0'];
  const child = spawn('.venv/bin/python', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  let logs = '';
  url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Server startup timed out: ${logs}`)), 10000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Error(`Server exited: ${logs}`));
    });
    child.stderr.on('data', (data: Buffer) => {
      logs += data.toString();
    });
    child.stdout.on('data', (data: Buffer) => {
      logs += data.toString();
      const match = /Scene Forge: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(logs);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
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
async function catalog() {
  return record(await (await fetch(new URL('/api/project', url))).json());
}
async function scene(id: string) {
  const response = await fetch(new URL(`/api/scene/${id}`, url));
  const body = record(await response.json());
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
try {
  await start(join(folder, 'world'));
  chrome = await Chrome.launch(process.argv[2]);
  const browser = chrome;
  const evaluate = browser.evaluate.bind(browser);
  const click = (id: string) => browser.click(`document.getElementById(${JSON.stringify(id)})`);
  const submit = async (id: string) => {
    const dialogs: Record<string, [string, string]> = {
      'scene-form': ['create-scene-dialog', 'show-create'],
      'import-form': ['import-atlas-dialog', 'show-import'],
    };
    const target = dialogs[id];
    if (target && !(await evaluate(`document.getElementById('${target[0]}').open`))) {
      await click(target[1]);
    }
    await browser.click(`document.querySelector('#${id} button.primary')`);
  };
  const wait = browser.wait.bind(browser);
  const set = async (id: string, value: string) => {
    await evaluate(
      `(() => { const control = document.getElementById(${JSON.stringify(id)}); control.value=${JSON.stringify(value)}; control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`,
    );
  };
  const captureDownloads = async () =>
    evaluate(`window.__exportBlob=null; window.__exportFilename=null;
    URL.createObjectURL=blob=>{window.__exportBlob=blob;return 'blob:export-test'};
    HTMLAnchorElement.prototype.click=function(){window.__exportFilename=this.download};`);
  async function unpackDownload(tag: string) {
    const encoded = string(
      await evaluate(
        `window.__exportBlob.arrayBuffer().then(buffer=>btoa(Array.from(new Uint8Array(buffer), byte=>String.fromCharCode(byte)).join('')))`,
      ),
    );
    const zipPath = join(folder, `${tag}.zip`),
      output = join(folder, `${tag}-export`);
    await writeFile(zipPath, Buffer.from(encoded, 'base64'));
    const { stdout } = await promisify(execFile)('.venv/bin/python', [
      '-c',
      `
import json, sys, zipfile
from pathlib import Path
from gbc_scene_forge.projects import Project
from gbc_scene_forge import png
root = Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    archive.extractall(root)
report = json.loads((root / 'export.json').read_bytes())
for scene in report['scenes']:
    path = root / scene['path']
    for ref in json.loads(path.read_bytes())['tilesets']:
        tileset = (path.parent / ref['source']).resolve()
        assert tileset.is_relative_to(root) and tileset.is_file()
        for tile in json.loads(tileset.read_bytes())['tiles']:
            image = (tileset.parent / tile['image']).resolve()
            assert image.is_relative_to(root) and image.is_file()
            width, height, _ = png.decode(image.read_bytes())
            assert (width, height) == (tile['imagewidth'], tile['imageheight'])
result = {'report': report, 'names': names, 'maps': {s['id']: json.loads((root/s['path']).read_bytes()) for s in report['scenes']}}
if (root/'forge.project.json').exists():
    project = Project(root)
    result['reopened'] = {s['id']: project.load_scene(s['id'])['scene'] for s in report['scenes']}
print(json.dumps(result))
`,
      zipPath,
      output,
    ]);
    return record(JSON.parse(stdout));
  }
  const target = string(
    (await browser.call('Target.createTarget', { url: 'about:blank' }, null)).targetId,
  );
  browser.session = string(
    (await browser.call('Target.attachToTarget', { targetId: target, flatten: true }, null))
      .sessionId,
  );
  await browser.call('Runtime.enable');
  await browser.call('Page.enable');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.call('Page.navigate', { url });
  await wait("document.getElementById('status')?.textContent.includes('Name your project')");
  await wait("document.querySelector('.mark')?.naturalWidth === 64");
  assert.equal(
    await evaluate("getComputedStyle(document.querySelector('.mark')).imageRendering"),
    'pixelated',
  );
  await set('project-title', 'Acceptance world');
  await submit('project-form');
  await wait("document.getElementById('status')?.textContent.includes('Project created')");
  // Browser owns folder selection; choosing reads no atlas bytes and makes no picker HTTP requests.
  await click('show-import');
  await set('atlas-path', '/tmp/keep-this-path.atlas.json');
  await evaluate(
    "window.showDirectoryPicker=async()=>{throw new DOMException('Cancelled','AbortError')}",
  );
  await click('browse-atlas');
  await wait("document.getElementById('status')?.textContent === 'Folder selection cancelled.'");
  assert.equal(
    await evaluate("document.getElementById('atlas-path').value"),
    '/tmp/keep-this-path.atlas.json',
  );
  await evaluate(
    "window.showDirectoryPicker=async()=>{throw new DOMException('Folder access denied.','NotAllowedError')}",
  );
  await click('browse-atlas');
  await wait(
    "document.querySelector('#import-form .form-error')?.textContent.includes('Folder access denied')",
  );
  const atlasText = await readFile(join(folder, 'input/terrain.atlas.json'), 'utf8');
  const atlasPng = (await readFile(join(folder, 'input/atlas.png'))).toString('base64');
  await evaluate(`(() => {
    const manifest=${JSON.stringify(atlasText)}, png=${JSON.stringify(atlasPng)};
    window.atlasReads=[];window.pickerRequests=[];
    const original=window.fetch.bind(window);
    window.fetch=(...args)=>{if(String(args[0]).includes('browse-atlas'))window.pickerRequests.push(String(args[0]));return original(...args);};
    const files=new Map([
      ['primary.atlas.json',new File([manifest],'primary.atlas.json')],
      ['second.atlas.json',new File([manifest],'second.atlas.json')],
      ['atlas.png',new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'atlas.png')],
      ['source.aseprite',new File(['unneeded'],'source.aseprite')],
    ]);
    window.showDirectoryPicker=async(options)=>{
      if(options.mode!=='read')throw Error('Folder access must be read-only');
      return {name:'Atlas folder',async *entries(){for(const [name] of files)yield[name,{kind:'file'}];},
        async getFileHandle(name){return{async getFile(){window.atlasReads.push(name);return files.get(name);}};}};
    };
  })()`);
  await click('browse-atlas');
  await wait("document.getElementById('status')?.textContent.includes('Choose an atlas manifest')");
  assert.equal(await evaluate("document.getElementById('atlas-manifest').value"), '');
  assert.deepEqual(await evaluate('window.atlasReads'), []);
  await set('atlas-manifest', 'second.atlas.json');
  assert.deepEqual(record((await catalog()).project).atlases, {});
  await browser.screenshot('standalone-browse-atlas');
  // Exercise the directory-input fallback with actual browser File objects.
  await evaluate(
    'window.folderPickerFixture=window.showDirectoryPicker;window.showDirectoryPicker=undefined',
  );
  await browser.call('Page.setInterceptFileChooserDialog', { enabled: true });
  await click('browse-atlas');
  const documentRoot = record((await browser.call('DOM.getDocument')).root);
  const folderInput = await browser.call('DOM.querySelector', {
    nodeId: number(documentRoot.nodeId),
    selector: '#atlas-folder-files',
  });
  await browser.call('DOM.setFileInputFiles', {
    nodeId: number(folderInput.nodeId),
    files: [join(folder, 'input')],
  });
  await wait("document.getElementById('status')?.textContent.includes('Atlas selected')");
  assert.equal(
    await evaluate("document.getElementById('atlas-manifest').value"),
    'terrain.atlas.json',
  );
  await browser.call('Page.setInterceptFileChooserDialog', { enabled: false });
  await evaluate('window.showDirectoryPicker=window.folderPickerFixture');
  // Failed imports stay in their dialog with an inline, actionable error.
  await set('atlas-path', join(folder, 'missing.atlas.json'));
  await submit('import-form');
  await wait("document.querySelector('#import-form .form-error')?.textContent.length > 0");
  assert.equal(await evaluate("document.getElementById('import-atlas-dialog').open"), true);
  await click('browse-atlas');
  await wait("document.getElementById('status')?.textContent.includes('Choose an atlas manifest')");
  await set('atlas-manifest', 'second.atlas.json');
  await submit('import-form');
  await wait("document.getElementById('status')?.textContent.includes('Atlas imported')");
  assert.deepEqual(await evaluate('window.atlasReads'), ['second.atlas.json', 'atlas.png']);
  assert.deepEqual(await evaluate('window.pickerRequests'), []);
  const actorManifestPath = join(folder, 'sprites/actors.atlas.json');
  const actorManifest = record(JSON.parse(await readFile(actorManifestPath, 'utf8')));
  actorManifest.cell_palettes = Array(16).fill(0);
  actorManifest.regions = [
    ...array(actorManifest.regions, record),
    { ...record(array(actorManifest.regions, record)[0]), name: 'step', x: 16 },
  ];
  await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
from pathlib import Path
import sys
from gbc_scene_forge import png
path = Path(sys.argv[1])
width, height, pixels = png.decode(path.read_bytes())
rows = []
for y in range(height):
    row = pixels[y * width * 4 : (y + 1) * width * 4]
    rows.append(row + row[16:] + row[:16])
path.write_bytes(png.encode(32, height, b''.join(rows)))
`,
    join(folder, 'sprites/atlas.png'),
  ]);
  actorManifest.animations = [
    { name: 'idle', frames: [{ region: 'idle' }, { region: 'idle', duration_ms: 240 }] },
    { name: 'stride_west', frames: [{ region: 'idle', duration_ms: 80 }] },
    { name: 'turn', frames: [{ region: 'step' }, { region: 'idle' }] },
  ];
  await writeFile(actorManifestPath, JSON.stringify(actorManifest));
  await set('atlas-path', join(folder, 'sprites/actors.atlas.json'));
  await submit('import-form');
  await wait("document.getElementById('import-report')?.textContent.includes('Imported actors')");
  assert.equal(await evaluate("document.getElementById('import-atlas-dialog').open"), false);
  await set('scene-title', 'Village');
  await set('width', '7');
  await set('height', '5');
  await submit('scene-form');
  await wait("document.getElementById('status')?.textContent.includes('Scene created')");
  assert.equal(await evaluate("document.getElementById('create-scene-dialog').open"), false);
  // Search and filters operate on the imported library without changing brushes or scene data.
  await set('search', 'idle');
  await evaluate("document.getElementById('search').dispatchEvent(new Event('input'))");
  assert.equal(
    await evaluate("document.querySelectorAll('#palette button:not([hidden])').length"),
    1,
  );
  await set('search', '');
  await evaluate("document.getElementById('search').dispatchEvent(new Event('input'))");
  await set('kind-filter', 'tile');
  await evaluate("document.getElementById('kind-filter').dispatchEvent(new Event('change'))");
  assert.equal(
    await evaluate("document.querySelectorAll('#palette button:not([hidden])').length"),
    2,
  );
  await set('kind-filter', '');
  await evaluate("document.getElementById('kind-filter').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('inspector-size').value"), '7 × 5 cells');
  await evaluate(`(() => {
    const canvas=document.getElementById('scene'), rect=canvas.getBoundingClientRect();
    const data=new DataTransfer();data.setData('application/x-forge-asset','actors/idle');
    canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data,
      clientX:rect.left+32*rect.width/canvas.width,clientY:rect.top+24*rect.height/canvas.height}));
  })()`);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  const first = string(record(array(record((await catalog()).project).scenes, record)[0]).id);
  const borderBefore = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(8,8,1,1).data)",
  );
  await browser.pointer(12, 12, 'mouseMoved');
  assert.equal(
    await evaluate("document.getElementById('coordinates').textContent"),
    'Cell 1, 1 · Pixel 12, 12',
  );
  assert.notDeepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(8,8,1,1).data)",
    ),
    borderBefore,
  );
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await browser.screenshot('standalone-grid-hover');
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
  assert.equal(
    await evaluate("document.getElementById('coordinates').textContent"),
    'Cell —, — · Pixel —, —',
  );
  assert.equal(
    await evaluate(
      "(() => { const p=document.getElementById('scene').getContext('2d').getImageData(8,8,1,1).data; return p[0]<=36 && p[1]<=40 && p[2]<=32; })()",
    ),
    true,
  );
  await browser.pointer(12, 12);
  await browser.pointer(12, 12, 'mouseReleased');
  await wait("document.getElementById('dirty')?.textContent === 'UNSAVED'");
  // Real canvas rendering of the independent black tile, away from grid lines.
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,12,1,1).data)",
    ),
    [0, 0, 0, 255],
  );
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await click('redo');
  await click('save');
  await wait("document.getElementById('status')?.textContent === 'Scene saved.'");
  assert.equal(
    array(record((await scene(first)).scene).cells, (row) => array(row, string))[1][1],
    'terrain/earth/0/0',
  );
  // Fill, selection erase and undo exercise the shared editing model through browser events.
  await browser.click("document.querySelector('input[value=fill]')");
  await browser.pointer(4, 4);
  await browser.pointer(4, 4, 'mouseReleased');
  await click('undo');
  await browser.click("document.querySelector('input[value=select]')");
  await browser.pointer(9, 9);
  await browser.pointer(14, 14, 'mouseMoved');
  await browser.pointer(14, 14, 'mouseReleased');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete'}))");
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // A sprite-only atlas exposes native-size regions independent of the 8px grid.
  await browser.click('document.querySelector(\'[data-asset="actors/idle"]\')');
  assert.equal(
    await evaluate("document.getElementById('paint-label').textContent"),
    'Place sprite',
  );
  assert.equal(await evaluate("document.getElementById('snap').checked"), true);
  await browser.pointer(29, 22);
  await browser.pointer(29, 22, 'mouseReleased');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 32, Y 24')",
    ),
    true,
  );
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 33, Y 24')",
    ),
    true,
  );
  await click('undo');
  await click('undo');
  // Alt bypasses snapping for placement and dragging, while selecting alone never moves a sprite.
  await browser.pointer(29, 22, 'mousePressed', 1);
  await browser.pointer(29, 22, 'mouseReleased', 1);
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 29, Y 22')",
    ),
    true,
  );
  await browser.click("document.querySelector('input[value=select]')");
  await browser.pointer(29, 12);
  await browser.pointer(29, 12, 'mouseReleased');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 29, Y 22')",
    ),
    true,
  );
  await browser.pointer(29, 12, 'mousePressed', 1);
  await browser.pointer(31, 15, 'mouseMoved', 1);
  await browser.pointer(31, 15, 'mouseReleased', 1);
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 31, Y 25')",
    ),
    true,
  );
  await click('undo');
  await browser.pointer(29, 12);
  await browser.pointer(31, 15, 'mouseMoved');
  await browser.pointer(31, 15, 'mouseReleased');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 32, Y 24')",
    ),
    true,
  );
  await click('undo');
  await click('undo');
  await browser.click('document.querySelector(\'[data-asset="actors/idle"]\')');
  await click('snap');
  await browser.pointer(29, 22);
  await browser.pointer(29, 22, 'mouseReleased');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 29, Y 22')",
    ),
    true,
  );
  await click('undo');
  await click('snap');
  await browser.pointer(55, 39);
  await browser.pointer(55, 39, 'mouseReleased');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 48, Y 32')",
    ),
    true,
  );
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await browser.pointer(32, 24);
  await browser.pointer(32, 24, 'mouseReleased');
  assert.equal(await evaluate("document.getElementById('selection-kind').textContent"), 'SPRITE');
  assert.equal(
    await evaluate("document.getElementById('selection-name').textContent"),
    'actors / idle',
  );
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(28,5,1,1).data)",
    ),
    [255, 255, 255, 255],
  );
  await browser.click("document.querySelector('input[value=select]')");
  await browser.pointer(32, 12);
  await browser.pointer(40, 20, 'mouseMoved');
  await browser.pointer(40, 20, 'mouseReleased');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
  await click('undo');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete'}))");
  await click('undo');
  await click('save');
  await wait("document.getElementById('status')?.textContent === 'Scene saved.'");
  const placed = array(record((await scene(first)).scene).objects, record);
  assert.deepEqual(placed, [{ id: 1, asset: 'actors/idle', x: 40, y: 32 }]);
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(38,17,1,1).data)",
    ),
    [255, 255, 255, 255],
  );
  await browser.click('document.querySelector(\'[data-delete-atlas="actors"]\')');
  await wait("document.getElementById('delete-atlas-dialog').open");
  assert.equal(await evaluate("document.getElementById('delete-atlas-confirm').disabled"), true);
  assert.equal(
    await evaluate(
      "document.querySelector('#delete-atlas-form .form-error').textContent.includes('open scene uses')",
    ),
    true,
  );
  await click('delete-atlas-cancel');
  // An unused atlas can be deleted without discarding the current scene's edits.
  await set('atlas-path', join(folder, 'spare/spare.atlas.json'));
  await submit('import-form');
  await wait("document.getElementById('import-report')?.textContent.includes('Imported spare')");
  await browser.click('document.querySelector(\'[data-asset="spare/earth"]\')');
  await browser.pointer(28, 12);
  await browser.pointer(28, 12, 'mouseReleased');
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await browser.pointer(28, 12);
  await browser.pointer(28, 12, 'mouseReleased');
  await set('atlas-filter', 'spare');
  await browser.click('document.querySelector(\'[data-delete-atlas="spare"]\')');
  await wait("document.getElementById('delete-atlas-dialog').open");
  assert.equal(await evaluate("document.getElementById('delete-atlas-history').hidden"), false);
  await click('delete-atlas-cancel');
  assert.equal(await evaluate("document.getElementById('undo').disabled"), false);
  assert.equal(Object.keys(record(record((await catalog()).project).atlases)).length, 3);
  await browser.click('document.querySelector(\'[data-delete-atlas="spare"]\')');
  await wait("document.getElementById('delete-atlas-dialog').open");
  await browser.screenshot('standalone-delete-atlas');
  await click('delete-atlas-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted atlas “spare”')");
  assert.equal(
    await evaluate("document.getElementById('atlas-filter').selectedOptions[0].textContent"),
    'All atlases',
  );
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  assert.equal(
    array(record((await scene(first)).scene).cells, (row) => array(row, string))[1][3],
    'terrain/earth/0/0',
  );
  assert.equal(
    record(JSON.parse(await readFile(join(folder, 'spare/spare.atlas.json'), 'utf8'))).id,
    'spare',
  );
  await assert.rejects(readFile(join(folder, 'world/assets/spare/atlas.png')), { code: 'ENOENT' });
  // Unsaved edits survive a canceled scene switch.
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await browser.pointer(20, 12);
  await browser.pointer(20, 12, 'mouseReleased');
  await click('open');
  await wait("document.getElementById('discard-dialog')?.open === true");
  await click('keep-editing');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await click('undo');
  await set('scene-title', 'River');
  await set('height', '32');
  await submit('scene-form');
  await wait("document.getElementById('status')?.textContent.includes('Scene created')");
  const second = string(record(array(record((await catalog()).project).scenes, record)[1]).id);
  assert.notEqual(first, second);
  assert.equal(
    array(record((await scene(second)).scene).cells, (row) => array(row, string))[1][1],
    '',
  );
  assert.deepEqual(record((await scene(second)).scene).objects, []);
  // Focusing a canvas taller than the viewport must not scroll it and offset
  // the placement away from the pointer's original scene coordinate.
  await browser.click('document.querySelector(\'[data-asset="actors/idle"]\')');
  await browser.pointer(32, 24);
  await browser.pointer(32, 24, 'mouseReleased');
  await click('save');
  await wait("document.getElementById('status')?.textContent === 'Scene saved.'");
  assert.deepEqual(record((await scene(second)).scene).objects, [
    { id: 1, asset: 'actors/idle', x: 32, y: 24 },
  ]);
  // Playback controls never dirty a saved scene, move its origin, or add history.
  const savedSprite = await scene(second);
  const selectionBeforePlayback = await evaluate(
    "document.getElementById('selection-detail').textContent",
  );
  const historyBeforePlayback = await evaluate(
    "['undo','redo'].map(id=>document.getElementById(id).disabled)",
  );
  const savedFramePixel = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(34,9,1,1).data)",
  );
  await set('preview-animation', 'turn');
  const alternateFramePixel = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(34,9,1,1).data)",
  );
  assert.notDeepEqual(alternateFramePixel, savedFramePixel);
  await click('deselect');
  await set('object-list', '1');
  // Selecting a restored, paused sequence must update the scene on that same draw.
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(34,9,1,1).data)",
    ),
    alternateFramePixel,
  );
  await set('preview-animation', 'idle');
  await wait("document.getElementById('preview-frame').textContent.includes('Frame 1 / 2')");
  await click('preview-previous');
  assert.match(
    string(await evaluate("document.getElementById('preview-frame').textContent")),
    /Frame 2 \/ 2.*240 ms.*Origin 8, 23/,
  );
  await click('preview-next');
  await evaluate(
    "document.getElementById('preview-next').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))",
  );
  await set('preview-speed', '0.25');
  await click('preview-play');
  await wait("document.getElementById('preview-frame').textContent.includes('Frame 2 / 2')");
  await click('preview-play');
  assert.equal(await evaluate("document.getElementById('preview-play').textContent"), 'Play');
  await click('preview-origin');
  await click('preview-origin');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  assert.equal(
    await evaluate("document.getElementById('selection-detail').textContent"),
    selectionBeforePlayback,
  );
  assert.deepEqual(
    await evaluate("['undo','redo'].map(id=>document.getElementById(id).disabled)"),
    historyBeforePlayback,
  );
  assert.deepEqual(await scene(second), savedSprite);
  await evaluate("document.getElementById('animation-preview').scrollIntoView({block:'center'})");
  await browser.screenshot('standalone-animation-preview');
  await set('preview-animation', '');
  assert.equal(await evaluate("document.getElementById('preview-play').disabled"), true);
  // Mappings are explicit, per asset, and independent of scene authoring history.
  await set('preview-action', 'idle');
  assert.match(
    string(await evaluate("document.getElementById('preview-mapping-status').textContent")),
    /No sequence mapped for idle \/ down/,
  );
  assert.equal(await evaluate("document.getElementById('preview-animation').disabled"), true);
  await evaluate("document.getElementById('preview-mappings').open = true");
  await set('preview-map-idle-down', 'idle');
  await set('preview-map-walk-left', 'stride_west');
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), 'idle');
  await set('preview-action', 'walk');
  assert.equal(await evaluate("document.getElementById('preview-play').disabled"), true);
  await set('preview-direction', 'left');
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), 'stride_west');
  assert.match(
    string(await evaluate("document.getElementById('preview-frame').textContent")),
    /Frame 1 \/ 1.*80 ms/,
  );
  await click('preview-play');
  await set('preview-direction', 'up');
  assert.equal(await evaluate("document.getElementById('preview-play').disabled"), true);
  await set('preview-direction', 'left');
  await set('preview-map-walk-left', '');
  assert.equal(await evaluate("document.getElementById('preview-play').disabled"), true);
  await set('preview-map-walk-left', 'stride_west');
  await evaluate("document.getElementById('preview-mappings').scrollIntoView({block:'center'})");
  await browser.screenshot('standalone-sequence-mappings');
  await set('preview-action', 'manual');
  assert.equal(await evaluate("document.getElementById('preview-animation').disabled"), false);
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), '');
  await set('preview-animation', 'idle');
  await set('preview-action', 'walk');
  await set('preview-action', 'manual');
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), 'idle');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  assert.deepEqual(await scene(second), savedSprite);
  assert.deepEqual(
    await evaluate("['undo','redo'].map(id=>document.getElementById(id).disabled)"),
    historyBeforePlayback,
  );
  await click('undo');
  assert.equal(await evaluate("document.getElementById('object-list').options.length"), 0);
  await click('redo');
  assert.equal(await evaluate("document.getElementById('object-list').options.length"), 1);
  await set('object-list', '1');
  assert.equal(await evaluate("document.getElementById('preview-map-idle-down').value"), 'idle');
  assert.equal(
    await evaluate("document.getElementById('preview-map-walk-left').value"),
    'stride_west',
  );
  await evaluate("document.getElementById('preview-mappings').open = false");
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // Keyboard/path movement renders a transient pose and never authors a new position.
  const originalSpritePixel = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
  );
  await evaluate("document.getElementById('preview-movement-settings').open = true");
  await set('preview-map-idle-down', 'idle');
  await set('preview-map-walk-down', 'stride_west');
  await set('preview-map-walk-right', 'stride_west');
  await click('preview-movement');
  await click('preview-check-collision');
  assert.equal(await evaluate("document.getElementById('preview-action').value"), 'idle');
  await set('preview-path', '44, 24\n44, 40');
  await click('preview-follow-path');
  await wait("document.getElementById('preview-action').value === 'walk'");
  await click('preview-pause-movement');
  const pausedMovement = await evaluate(
    "[document.getElementById('preview-position').textContent, document.getElementById('preview-frame').textContent]",
  );
  await evaluate('new Promise(resolve => setTimeout(resolve, 160))');
  assert.deepEqual(
    await evaluate(
      "[document.getElementById('preview-position').textContent, document.getElementById('preview-frame').textContent]",
    ),
    pausedMovement,
  );
  assert.equal(
    await evaluate("document.getElementById('preview-pause-movement').textContent"),
    'Resume movement',
  );
  await click('preview-pause-movement');
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), 'stride_west');
  await wait(
    "document.getElementById('preview-position').textContent.includes('X 44.0, Y 40.0') && document.getElementById('preview-action').value === 'idle'",
  );
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), 'idle');
  assert.notDeepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
    ),
    originalSpritePixel,
  );
  // Even with the placement brush active, scene gestures only focus movement controls.
  await browser.pointer(48, 24);
  await browser.pointer(48, 24, 'mouseReleased');
  assert.equal(await evaluate("document.getElementById('object-list').options.length"), 1);
  await evaluate(
    "document.getElementById('scene').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))",
  );
  await wait(
    "document.getElementById('preview-direction').value === 'left' && document.getElementById('preview-action').value === 'walk'",
  );
  await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft'}))");
  await wait("document.getElementById('preview-action').value === 'idle'");
  await evaluate(
    "document.getElementById('scene').dispatchEvent(new KeyboardEvent('keydown',{key:'d',bubbles:true}))",
  );
  await wait(
    "document.getElementById('preview-direction').value === 'right' && document.getElementById('preview-action').value === 'walk'",
  );
  await evaluate("window.dispatchEvent(new Event('blur'))");
  await wait("document.getElementById('preview-action').value === 'idle'");
  await set('preview-path', '52, 40');
  await click('preview-follow-path');
  await wait("document.getElementById('preview-position').textContent.includes('X 52.0, Y 40.0')");
  await set('preview-path', '55, 40');
  await click('preview-follow-path');
  await wait("document.getElementById('preview-position').textContent.includes('Blocked')");
  await evaluate(
    "document.getElementById('preview-movement-settings').scrollIntoView({block:'center'})",
  );
  await browser.screenshot('standalone-movement-preview');
  // Save preferences while displaced; saving must never bake in the current pose.
  await set('preview-speed', '2');
  await set('preview-move-speed', '64');
  await set('preview-footprint-width', '6');
  await click('save-preview-settings');
  await wait("document.getElementById('status').textContent.startsWith('Preview settings saved.')");
  const savedPreview = record(record(record((await catalog()).project).preview).sprite);
  assert.equal(savedPreview.playback_speed, 2);
  assert.equal(savedPreview.movement_speed, 64);
  assert.equal(record(savedPreview.footprint).width, 6);
  assert.equal(savedPreview.check_collisions, true);
  assert.equal(savedPreview.position, undefined);
  assert.equal(savedPreview.path, undefined);
  assert.equal(savedPreview.playing, undefined);
  assert.deepEqual(await scene(second), savedSprite);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await evaluate(
    "document.getElementById('save-preview-settings').scrollIntoView({block:'center'})",
  );
  await browser.screenshot('standalone-preview-settings');

  await click('preview-reset-position');
  assert.match(
    string(await evaluate("document.getElementById('preview-position').textContent")),
    /X 32.0, Y 24.0/,
  );
  await evaluate(
    "document.getElementById('scene').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
  );
  assert.equal(await evaluate("document.getElementById('preview-movement').checked"), false);
  assert.equal(await evaluate("document.getElementById('preview-action').value"), 'manual');
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), 'idle');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
    ),
    originalSpritePixel,
  );
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  assert.equal(
    await evaluate("document.getElementById('selection-detail').textContent"),
    selectionBeforePlayback,
  );
  assert.deepEqual(await scene(second), savedSprite);
  assert.deepEqual(
    await evaluate("['undo','redo'].map(id=>document.getElementById(id).disabled)"),
    historyBeforePlayback,
  );
  await evaluate("document.getElementById('preview-movement-settings').open = false");
  await click('undo');
  assert.equal(await evaluate("document.getElementById('object-list').options.length"), 0);
  await click('redo');
  assert.equal(await evaluate("document.getElementById('object-list').options.length"), 1);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // Named layers render in order, edit independently, and retain history through Save.
  const spritePixel = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
  );
  await click('layer-tile');
  await set('layer-name', 'Canopy');
  await evaluate("document.getElementById('layer-name').dispatchEvent(new Event('change'))");
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await browser.pointer(30, 9);
  await browser.pointer(30, 9, 'mouseReleased');
  const tilePixel = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
  );
  assert.notDeepEqual(tilePixel, spritePixel);
  await click('layer-down');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
    ),
    spritePixel,
  );
  await click('undo');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
    ),
    tilePixel,
  );
  await click('layer-visible');
  await browser.pointer(44, 25);
  await browser.pointer(44, 25, 'mouseReleased');
  assert.equal(
    await evaluate("document.getElementById('status').textContent"),
    'Show the active layer before editing it.',
  );
  await click('layer-object');
  await set('layer-name', 'Foreground actors');
  await evaluate("document.getElementById('layer-name').dispatchEvent(new Event('change'))");
  await browser.click('document.querySelector(\'[data-asset="actors/idle"]\')');
  await browser.pointer(48, 24);
  await browser.pointer(48, 24, 'mouseReleased');
  await click('layer-remove');
  assert.equal(await evaluate("document.getElementById('layers').options.length"), 3);
  await click('undo');
  assert.equal(await evaluate("document.getElementById('layer-name').value"), 'Foreground actors');
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  let layeredScene = record((await scene(second)).scene);
  const savedLayers = array(layeredScene.layers, record);
  assert.deepEqual(
    savedLayers.map((layer) => layer.name),
    ['Ground', 'Sprites', 'Canopy', 'Foreground actors'],
  );
  assert.equal(savedLayers[2].visible, false);
  assert.equal(array(savedLayers[2].cells, (row) => array(row, string))[3][5], '');
  assert.deepEqual(savedLayers[3].objects, [{ id: 2, asset: 'actors/idle', x: 48, y: 24 }]);
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await click('redo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await browser.screenshot('standalone-layers');
  // Generic markers, areas, properties and per-instance sprite origins share layer history.
  await click('place-point');
  await browser.pointer(16, 48);
  await browser.pointer(16, 48, 'mouseReleased');
  assert.equal(await evaluate("document.getElementById('selection-kind').textContent"), 'POINT');
  await click('edit-object');
  await wait("document.getElementById('object-dialog').open");
  await set('object-name', 'Discard me');
  await click('object-cancel');
  assert.equal(await evaluate("document.getElementById('selection-name').textContent"), 'spawn');
  await click('edit-object');
  await set('object-name', 'Entrance');
  async function addProperty(name: string, type: string, value: string | boolean) {
    await click('object-add-property');
    await evaluate(`(() => {
      const row = document.getElementById('object-properties').lastElementChild;
      const fields = row.querySelectorAll('input'), type = row.querySelector('select');
      fields[0].value = ${JSON.stringify(name)};
      type.value = ${JSON.stringify(type)}; type.dispatchEvent(new Event('change'));
      if (type.value === 'bool') fields[1].checked = ${JSON.stringify(value)};
      else fields[1].value = ${JSON.stringify(String(value))};
    })()`);
  }
  await addProperty('enabled', 'bool', true);
  await addProperty('facing', 'string', 'north');
  await addProperty('priority', 'int', '2');
  await addProperty('speed', 'float', '1.25');
  await addProperty('enabled', 'string', 'duplicate');
  await click('object-apply');
  assert.equal(
    await evaluate("document.getElementById('object-error').textContent.includes('unique')"),
    true,
  );
  await browser.click(
    "document.querySelector('#object-properties .object-property:last-child button')",
  );
  await browser.screenshot('standalone-object-properties');
  await click('object-apply');
  await wait("!document.getElementById('object-dialog').open");
  assert.equal(await evaluate("document.getElementById('selection-name').textContent"), 'Entrance');
  await click('undo');
  assert.equal(await evaluate("document.getElementById('selection-name').textContent"), 'spawn');
  await click('redo');
  assert.equal(await evaluate("document.getElementById('selection-name').textContent"), 'Entrance');
  await click('place-rectangle');
  await browser.pointer(32, 56);
  await browser.pointer(32, 56, 'mouseReleased');
  await click('edit-object');
  await set('object-name', 'Exit');
  await set('object-class', 'door-trigger');
  await set('object-width', '16');
  await set('object-height', '24');
  await addProperty('destination', 'string', 'room-b');
  await click('object-apply');
  await browser.click("document.querySelector('input[value=select]')");
  await browser.pointer(36, 60);
  await browser.pointer(44, 68, 'mouseMoved');
  await browser.pointer(44, 68, 'mouseReleased');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 40, Y 64')",
    ),
    true,
  );
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}))");
  await click('undo');
  await click('undo');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 32, Y 56')",
    ),
    true,
  );
  await click('remove-sprite');
  await click('undo');
  await set('object-list', '2');
  await evaluate("document.getElementById('object-list').dispatchEvent(new Event('change'))");
  await click('edit-object');
  await set('object-name', 'Guard');
  await set('object-class', 'npc');
  await click('object-default-origin');
  await set('object-origin-x', '4');
  await set('object-origin-y', '16');
  await click('object-apply');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('Origin 4, 16')",
    ),
    true,
  );
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  layeredScene = record((await scene(second)).scene);
  const authored = array(array(layeredScene.layers, record)[3].objects, record);
  assert.deepEqual(authored[0], {
    id: 2,
    asset: 'actors/idle',
    x: 48,
    y: 24,
    name: 'Guard',
    class: 'npc',
    origin: [4, 16],
  });
  assert.deepEqual(authored[1], {
    id: 3,
    kind: 'point',
    x: 16,
    y: 48,
    name: 'Entrance',
    class: 'spawn',
    properties: [
      { name: 'enabled', type: 'bool', value: true },
      { name: 'facing', type: 'string', value: 'north' },
      { name: 'priority', type: 'int', value: 2 },
      { name: 'speed', type: 'float', value: 1.25 },
    ],
  });
  assert.deepEqual(authored[2], {
    id: 4,
    kind: 'rectangle',
    x: 32,
    y: 56,
    width: 16,
    height: 24,
    name: 'Exit',
    class: 'door-trigger',
    properties: [{ name: 'destination', type: 'string', value: 'room-b' }],
  });
  await click('layer-visible');
  await click('place-point');
  await browser.pointer(8, 48);
  await browser.pointer(8, 48, 'mouseReleased');
  assert.equal(
    await evaluate("document.getElementById('status').textContent"),
    'Show the active layer before editing it.',
  );
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');

  // Shared tile metadata saves retain an unsaved scene and its undo history.
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await browser.pointer(12, 98);
  await browser.pointer(12, 98, 'mouseReleased');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await click('edit-tile');
  await wait("document.getElementById('tile-dialog').open");
  await set('tile-terrain', 'water');
  await evaluate("document.getElementById('tile-terrain').dispatchEvent(new Event('change'))");
  await click('tile-add-shape');
  await set('tile-y', '4');
  await set('tile-height', '4');
  await evaluate("document.getElementById('tile-height').dispatchEvent(new Event('change'))");
  await set('tile-shape-kind', 'ellipse');
  await click('tile-add-shape');
  await set('tile-x', '2');
  await set('tile-y', '0');
  await set('tile-width', '4');
  await set('tile-height', '4');
  await evaluate("document.getElementById('tile-height').dispatchEvent(new Event('change'))");
  await set('tile-shape-kind', 'polygon');
  await click('tile-add-shape');
  await set('tile-points', '0,0 8,8 0,8 7,0');
  await evaluate("document.getElementById('tile-points').dispatchEvent(new Event('change'))");
  await click('tile-save');
  assert.equal(
    await evaluate("document.getElementById('tile-error').textContent.includes('intersect')"),
    true,
  );
  assert.equal(await evaluate("document.getElementById('tile-dialog').open"), true);
  await set('tile-points', '0,8 8,8 8,0');
  await evaluate("document.getElementById('tile-points').dispatchEvent(new Event('change'))");
  await click('tile-undo');
  assert.equal(await evaluate("document.getElementById('tile-shapes').options.length"), 2);
  await click('tile-redo');
  assert.equal(await evaluate("document.getElementById('tile-shapes').options.length"), 3);
  await browser.screenshot('standalone-tile-metadata');
  await click('tile-save');
  await wait("!document.getElementById('tile-dialog').open");
  const tileMetadata = record(
    record(record(record((await catalog()).project).atlases).terrain).metadata,
  );
  const earthMetadata = record(record(tileMetadata['8'])['terrain/earth/0/0']);
  assert.equal(earthMetadata.terrain, 'water');
  assert.equal(earthMetadata.solid, true);
  assert.equal(array(earthMetadata.shapes, record).length, 3);
  assert.deepEqual(record((await scene(second)).scene), layeredScene);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // The collision overlay follows actual geometry and visible layers, independently of art.
  await browser.pointer(12, 98);
  await browser.pointer(12, 98, 'mouseReleased');
  const rawTile = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,102,1,1).data)",
  );
  await click('terrain-overlay');
  await evaluate("document.getElementById('terrain-overlay').dispatchEvent(new Event('change'))");
  assert.notDeepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,102,1,1).data)",
    ),
    rawTile,
  );
  await click('collision-overlay');
  await evaluate("document.getElementById('collision-overlay').dispatchEvent(new Event('change'))");
  assert.notDeepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,102,1,1).data)",
    ),
    rawTile,
  );
  // The canopy uses this same tile but is hidden, so its geometry must not cover the actor.
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
    ),
    [255, 255, 255, 255],
  );
  await browser.screenshot('standalone-collision-overlay');
  await click('layer-visible');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,102,1,1).data)",
    ),
    [36, 40, 32, 255],
  );
  await click('undo');
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await click('terrain-overlay');
  await evaluate("document.getElementById('terrain-overlay').dispatchEvent(new Event('change'))");
  await click('collision-overlay');
  await evaluate("document.getElementById('collision-overlay').dispatchEvent(new Event('change'))");
  await browser.click('document.querySelector(\'[data-asset="actors/idle"]\')');
  await click('edit-tile');
  await set('tile-terrain', 'actor');
  await evaluate("document.getElementById('tile-terrain').dispatchEvent(new Event('change'))");
  await set('tile-shape-kind', 'ellipse');
  await click('tile-add-shape');
  await set('tile-x', '4');
  await set('tile-y', '24');
  await set('tile-width', '8');
  await set('tile-height', '8');
  await evaluate("document.getElementById('tile-height').dispatchEvent(new Event('change'))");
  await click('tile-save');
  await wait("!document.getElementById('tile-dialog').open");
  const rawActor = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,28,1,1).data)",
  );
  await click('collision-overlay');
  await evaluate("document.getElementById('collision-overlay').dispatchEvent(new Event('change'))");
  assert.notDeepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,28,1,1).data)",
    ),
    rawActor,
  );
  await click('collision-overlay');
  await evaluate("document.getElementById('collision-overlay').dispatchEvent(new Event('change'))");
  await click('edit-tile');
  await set('tile-terrain', 'discarded');
  await evaluate("document.getElementById('tile-terrain').dispatchEvent(new Event('change'))");
  await click('tile-cancel');
  assert.equal(
    record(
      record(record(record(record((await catalog()).project).atlases).actors).metadata).sprites,
    )['actors/idle'] !== undefined,
    true,
  );
  // Downloads include explicit unsaved snapshots while preserving source files and history.
  await set('layers', '4');
  await set('object-list', '3');
  await click('edit-object');
  await set('object-name', 'Export-only entry');
  await click('object-apply');
  const exportRevision = string((await catalog()).revision);
  await captureDownloads();
  await click('show-export');
  assert.equal(await evaluate("document.getElementById('export-canvas').checked"), true);
  await browser.screenshot('standalone-export');
  await click('export-confirm');
  await wait("!document.getElementById('export-dialog').open && window.__exportBlob !== null");
  assert.equal(await evaluate('window.__exportBlob.type'), 'application/zip');
  assert.equal(await evaluate(`window.__exportFilename === 'forge-scene-${second}.zip'`), true);
  const sceneExport = await unpackDownload('scene');
  assert.equal(array(sceneExport.names, string).includes('forge.project.json'), false);
  assert.equal(array(record(sceneExport.report).scenes, record).length, 1);
  const exportedMap = record(record(sceneExport.maps)[second]);
  assert.equal(array(exportedMap.layers, record)[2].visible, false);
  const exportedObjects = array(array(exportedMap.layers, record)[3].objects, record);
  assert.equal(exportedObjects[1].name, 'Export-only entry');
  assert.deepEqual(exportedObjects[1].properties, authored[1].properties);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await captureDownloads();
  await click('show-export');
  await set('export-scope', 'project');
  await click('export-confirm');
  await wait("!document.getElementById('export-dialog').open && window.__exportBlob !== null");
  const projectExport = await unpackDownload('project');
  assert.equal(array(projectExport.names, string).includes('forge.project.json'), true);
  assert.equal(array(record(projectExport.report).scenes, record).length, 2);
  const reopened = record(record(projectExport.reopened)[second]);
  assert.equal(
    array(array(reopened.layers, record)[3].objects, record)[1].name,
    'Export-only entry',
  );
  assert.deepEqual(record((await scene(second)).scene), layeredScene);
  assert.equal(string((await catalog()).revision), exportRevision);
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // Excluding the canvas exports the saved version and leaves the draft intact.
  await click('redo');
  await captureDownloads();
  await click('show-export');
  await click('export-canvas');
  await click('export-confirm');
  await wait("!document.getElementById('export-dialog').open && window.__exportBlob !== null");
  const savedExport = await unpackDownload('saved-scene');
  const savedObjects = array(
    array(record(record(savedExport.maps)[second]).layers, record)[3].objects,
    record,
  );
  assert.equal(savedObjects[1].name, 'Entrance');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await browser.click('document.querySelector(\'[data-delete-atlas="terrain"]\')');
  await wait("document.getElementById('delete-atlas-dialog').open");
  assert.equal(await evaluate("document.getElementById('delete-atlas-confirm').disabled"), true);
  assert.equal(
    await evaluate(
      "document.querySelector('#delete-atlas-form .form-error').textContent.includes('open scene uses')",
    ),
    true,
  );
  assert.equal(Object.keys(record(record((await catalog()).project).atlases)).length, 2);
  await click('delete-atlas-cancel');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'h'}))");
  assert.equal(await evaluate("document.querySelector('input[value=pan]').checked"), true);
  await browser.pointer(32, 120);
  await browser.pointer(32, 80, 'mouseMoved');
  await browser.pointer(32, 80, 'mouseReleased');
  assert.equal(await evaluate("document.getElementById('viewport').scrollTop > 0"), true);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await set('scenes', first);
  await click('open');
  await wait("document.getElementById('status')?.textContent === 'Scene opened.'");
  // Explicit unchanged reimport retains placements and both scenes.
  await set('atlas-path', join(folder, 'input/terrain.atlas.json'));
  await click('show-import');
  await evaluate("document.getElementById('reimport').checked=true");
  await submit('import-form');
  await wait("document.getElementById('status')?.textContent.includes('Atlas imported')");
  assert.equal(
    array(record((await scene(first)).scene).cells, (row) => array(row, string))[1][1],
    'terrain/earth/0/0',
  );
  await browser.screenshot('standalone-project');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 980,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  assert.equal(await evaluate("document.getElementById('viewport').clientHeight > 200"), true);
  await browser.screenshot('standalone-compact');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Restart and move the entire project; import inputs are no longer available.
  await stop();
  await rename(join(folder, 'world'), join(folder, 'moved'));
  await rm(join(folder, 'input'), { recursive: true, force: true });
  await rm(join(folder, 'sprites'), { recursive: true, force: true });
  // Launch the production CLI, rather than recreating input assets through the fixture.
  const movedRoot = join(folder, 'moved');
  await start(movedRoot, false);
  await browser.call('Page.navigate', { url });
  await wait("document.getElementById('status')?.textContent.includes('Choose a scene')");
  assert.deepEqual(
    record(record(record(record(record((await catalog()).project).atlases).terrain).metadata)['8'])[
      'terrain/earth/0/0'
    ],
    earthMetadata,
  );
  assert.deepEqual(record((await scene(second)).scene), layeredScene);
  await set('scenes', second);
  await click('open');
  await wait("document.getElementById('status').textContent === 'Scene opened.'");
  assert.equal(await evaluate("document.getElementById('layers').options.length"), 4);
  assert.equal(
    await evaluate(
      "Array.from(document.getElementById('layers').options).some(option => option.textContent.includes('○ Canopy'))",
    ),
    true,
  );
  await set('layers', '4');
  await evaluate("document.getElementById('layers').dispatchEvent(new Event('change'))");
  await set('object-list', '3');
  await evaluate("document.getElementById('object-list').dispatchEvent(new Event('change'))");
  await click('edit-object');
  assert.equal(await evaluate("document.getElementById('object-name').value"), 'Entrance');
  assert.equal(
    await evaluate("document.querySelectorAll('#object-properties .object-property').length"),
    4,
  );
  assert.equal(
    await evaluate("document.querySelector('#object-properties input[type=checkbox]').checked"),
    true,
  );
  await click('object-cancel');
  await set('scenes', first);
  await click('open');
  await wait(
    "document.getElementById('status')?.textContent === 'Scene opened.' && document.getElementById('scene-name').textContent.startsWith('Village')",
  );
  assert.deepEqual(record((await scene(first)).scene).objects, placed);
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(38,17,1,1).data)",
    ),
    [255, 255, 255, 255],
  );
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,12,1,1).data)",
    ),
    [0, 0, 0, 255],
  );
  // Preview preferences survive server restart and moving the project directory.
  await set('layers', '2');
  await set('object-list', String(record(placed[0]).id));
  assert.equal(
    await evaluate("document.getElementById('preview-map-walk-left').value"),
    'stride_west',
  );
  assert.equal(await evaluate("document.getElementById('preview-speed').value"), '2');
  assert.equal(await evaluate("document.getElementById('preview-move-speed').value"), '64');
  assert.equal(await evaluate("document.getElementById('preview-footprint-width').value"), '6');
  assert.equal(await evaluate("document.getElementById('preview-check-collision').checked"), true);
  assert.equal(await evaluate("document.getElementById('preview-origin').checked"), true);
  assert.equal(await evaluate("document.getElementById('preview-movement').checked"), false);
  assert.equal(await evaluate("document.getElementById('preview-play').textContent"), 'Play');
  assert.equal(await evaluate("document.getElementById('preview-action').value"), 'manual');
  assert.equal(await evaluate("document.getElementById('preview-animation').value"), 'idle');
  assert.match(
    string(await evaluate("document.getElementById('preview-frame').textContent")),
    /Frame 1 \/ 2/,
  );
  const previewManifest = join(movedRoot, 'forge.project.json');
  const beforePreviewConflict = await readFile(previewManifest, 'utf8');
  await writeFile(previewManifest, beforePreviewConflict + '\n');
  await set('preview-speed', '0.5');
  await click('save-preview-settings');
  await wait("document.getElementById('status').textContent.includes('Project changed on disk')");
  assert.equal(await evaluate("document.getElementById('preview-speed').value"), '0.5');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  assert.equal(await readFile(previewManifest, 'utf8'), beforePreviewConflict + '\n');
  await writeFile(previewManifest, beforePreviewConflict);
  await set('preview-speed', '2');
  await set('layers', '1');
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  const mapPath = join(movedRoot, 'scenes', `${first}.tmj`);
  const before = await readFile(mapPath, 'utf8');
  // An external map edit causes a visible 409 and preserves the unsaved browser canvas.
  await writeFile(mapPath, before + '\n');
  await browser.pointer(20, 12);
  await browser.pointer(20, 12, 'mouseReleased');
  await captureDownloads();
  await click('show-export');
  await click('export-confirm');
  await wait(
    "document.querySelector('#export-form .form-error').textContent.includes('Scene changed on disk')",
  );
  assert.equal(await evaluate('window.__exportBlob'), null);
  await click('export-cancel');
  await click('save');
  await wait("document.getElementById('status')?.textContent.includes('Scene changed on disk')");
  assert.equal(await readFile(mapPath, 'utf8'), before + '\n');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await browser.screenshot('standalone-conflict');
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  assert.equal(await evaluate("document.getElementById('delete-scene-unsaved').hidden"), false);
  await click('delete-scene-cancel');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  await click('delete-scene-confirm');
  await wait(
    "document.querySelector('#delete-scene-form .form-error')?.textContent.includes('Scene changed')",
  );
  assert.equal(await readFile(mapPath, 'utf8'), before + '\n');
  await click('delete-scene-cancel');
  // Deleting a different scene preserves this canvas and its unsaved changes.
  await set('scenes', second);
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  assert.equal(
    await evaluate(
      "document.getElementById('delete-scene-description').textContent.includes('River')",
    ),
    true,
  );
  assert.equal(await evaluate("document.getElementById('delete-scene-unsaved').hidden"), true);
  await click('delete-scene-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted “River”')");
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  assert.equal(array(record((await catalog()).project).scenes, record).length, 1);
  // Restore the external test edit, then explicitly delete the last, dirty scene.
  await writeFile(mapPath, before);
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  await browser.screenshot('standalone-delete-scene');
  await click('delete-scene-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted “Village”')");
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'NO SCENE');
  assert.equal(await evaluate("document.getElementById('scene').hidden"), true);
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  assert.equal(array(record((await catalog()).project).scenes, record).length, 0);
  assert.equal(Object.keys(record(record((await catalog()).project).atlases)).length, 2);
  await assert.rejects(readFile(mapPath), { code: 'ENOENT' });
  for (const id of ['actors', 'terrain']) {
    await browser.click(`document.querySelector('[data-delete-atlas="${id}"]')`);
    await wait("document.getElementById('delete-atlas-dialog').open");
    await click('delete-atlas-confirm');
    await wait(`document.getElementById('status').textContent.includes('Deleted atlas “${id}”')`);
  }
  assert.deepEqual(record(record((await catalog()).project).atlases), {});
  assert.equal(await evaluate("document.getElementById('asset-count').textContent"), '0 / 0');
  assert.deepEqual(browser.errors, []);
  console.log(
    'Standalone browser acceptance passed: project creation, atlas import/reimport, painting, layers, objects/properties, terrain/collision, portable exports, undo/redo, restart, moved directory, and conflict preservation.',
  );
} finally {
  await chrome?.close();
  await stop();
  await rm(folder, { recursive: true, force: true });
}
