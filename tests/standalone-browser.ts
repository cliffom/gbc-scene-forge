/** Full standalone workflow across server restarts and a moved project directory. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
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
  return record(await (await fetch(new URL(`/api/scene/${id}`, url))).json());
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
  await browser.click('document.querySelector(\'[data-delete-atlas="terrain"]\')');
  await wait("document.getElementById('delete-atlas-dialog').open");
  await click('delete-atlas-confirm');
  await wait(
    "document.querySelector('#delete-atlas-form .form-error')?.textContent.includes('Village')",
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
  await set('scenes', first);
  await click('open');
  await wait("document.getElementById('status')?.textContent === 'Scene opened.'");
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
  const mapPath = join(movedRoot, 'scenes', `${first}.tmj`);
  const before = await readFile(mapPath, 'utf8');
  // An external map edit causes a visible 409 and preserves the unsaved browser canvas.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(mapPath, before + '\n');
  await browser.pointer(20, 12);
  await browser.pointer(20, 12, 'mouseReleased');
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
    'Standalone browser acceptance passed: project creation, atlas import/reimport, painting, fill, selection, undo/redo, independent scenes, restart, moved directory, and conflict preservation.',
  );
} finally {
  await chrome?.close();
  await stop();
  await rm(folder, { recursive: true, force: true });
}
