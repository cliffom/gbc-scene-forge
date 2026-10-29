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
async function start(root: string, fixture = true, single = true, demo = false) {
  const args = demo
    ? ['-m', 'gbc_scene_forge.sample', '--root', root, '--reset', '--port', '0']
    : fixture
      ? [
          'tests/serve_standalone_fixture.py',
          '--root',
          root,
          ...(single ? ['--single-project'] : []),
        ]
      : [
          '-m',
          'gbc_scene_forge',
          '--no-browser',
          ...(single ? ['--project'] : ['--project-root']),
          root,
          '--port',
          '0',
        ];
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
      const match = /Editor\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(logs);
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
      'import-form': ['import-atlas-dialog', 'library-import'],
    };
    const target = dialogs[id];
    if (target && !(await evaluate(`document.getElementById('${target[0]}').open`))) {
      await click(target[1]);
    }
    await browser.click(`document.querySelector('#${id} button.primary')`);
  };
  const wait = browser.wait.bind(browser);
  const checkBuildLabel = async () => {
    const label = string(await evaluate("document.getElementById('app-version').textContent"));
    const version = /^version = "([^"]+)"$/m.exec(await readFile('pyproject.toml', 'utf8'))?.[1];
    assert(version);
    if (process.env.FORGE_BUILD_MODE === 'production') {
      assert.equal(label, version);
    } else {
      const { stdout } = await promisify(execFile)('git', ['rev-parse', '--short=7', 'HEAD']);
      assert.equal(label, `${version}-${process.env.FORGE_BUILD_COMMIT ?? stdout.trim()}`);
    }
    assert.equal(
      await evaluate(`(() => {
        const label = document.getElementById('app-version').getBoundingClientRect();
        const identity = document.querySelector('.build-identity');
        const identityBounds = identity.getBoundingClientRect();
        const content = document.querySelector('#workspace:not([hidden]), #project-start:not([hidden])').getBoundingClientRect();
        return label.width > 0 && label.left >= 0 && label.right <= innerWidth &&
          label.bottom <= innerHeight && label.bottom >= innerHeight - 12 &&
          label.top >= content.bottom &&
          identity.closest('.status-bar') !== null &&
          identity.textContent === document.getElementById('app-version').textContent &&
          !identity.textContent.includes('LOCAL PROJECT') &&
          label.top >= identityBounds.top && label.bottom <= identityBounds.bottom &&
          identityBounds.height <= parseFloat(getComputedStyle(identity).lineHeight) + 1;
      })()`),
      true,
    );
  };
  const set = async (id: string, value: string) => {
    await evaluate(
      `(() => { const control = document.getElementById(${JSON.stringify(id)}); control.value=${JSON.stringify(value)}; control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`,
    );
  };
  const chooseLayer = async (id: string) =>
    browser.click(`document.querySelector('#layers [data-layer-id="${id}"] .layer-choice')`);
  const chooseScene = async (id: string) => {
    await wait("document.getElementById('scenes')?.disabled === false");
    await set('scenes', id);
    await wait(
      `document.getElementById('scenes')?.value === ${JSON.stringify(id)} && document.getElementById('scenes')?.disabled === false`,
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
  // Exercise the multi-project launcher before the detailed single-project suite.
  await stop();
  const projectRoot = join(folder, 'projects');
  await start(projectRoot, false, false);
  await browser.call('Page.navigate', { url });
  await wait(
    "!document.getElementById('project-form')?.hidden && document.getElementById('status')?.textContent.includes('Choose a project')",
  );
  assert.equal(await evaluate("document.getElementById('folder-name').textContent"), 'projects');
  assert.equal(
    await evaluate("document.getElementById('folder-heading').textContent"),
    'Projects folder',
  );
  assert.equal(await evaluate("document.getElementById('folder-path').textContent"), projectRoot);
  await click('project-folder');
  await wait("document.getElementById('folder-popover').matches(':popover-open')");
  await evaluate(
    "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedFolder=value}}})",
  );
  await click('copy-folder');
  await wait("document.getElementById('folder-copy-status').textContent === 'Path copied.'");
  assert.equal(await evaluate('window.__copiedFolder'), projectRoot);
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await wait("!document.getElementById('folder-popover').matches(':popover-open')");
  for (const height of [1500, 700, 500]) {
    await browser.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.equal(
      await evaluate(`(() => {
        const start = document.getElementById('project-start');
        const visible = start.querySelectorAll('.welcome:not([hidden])');
        const form = document.getElementById('project-form').getBoundingClientRect();
        const header = document.querySelector('.masthead').getBoundingClientRect();
        const footer = document.querySelector('.status-bar').getBoundingClientRect();
        start.scrollTop = start.scrollHeight;
        const button = document.querySelector('#project-form button.primary').getBoundingClientRect();
        return visible.length === 1 &&
          form.top >= header.bottom && button.bottom <= footer.top &&
          document.documentElement.scrollHeight <= innerHeight;
      })()`),
      true,
      `Project launcher shows one panel and its create button is reachable at height ${height}`,
    );
    await evaluate("document.getElementById('project-start').scrollTop = 0");
  }
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const createProject = async (name: string, slug: string) => {
    if (await evaluate("document.getElementById('project-form').hidden")) {
      await click('show-new-project');
    }
    await set('project-title', name);
    await submit('project-form');
    await wait(
      `location.pathname === '/projects/${slug}/' && document.getElementById('project-name')?.textContent === ${JSON.stringify(name)} && !document.getElementById('switch-project')?.disabled`,
    );
  };
  const chooseProject = async (destination: string) => {
    await wait("document.getElementById('switch-project')?.disabled === false");
    await set('switch-project', destination);
  };
  const goProjects = async () => {
    await chooseProject('/');
    await wait("location.pathname === '/' && document.querySelector('#project-list a') !== null");
  };
  const openProject = async (slug: string) => {
    await browser.click(`document.querySelector('a[href="/projects/${slug}/"]')`);
    await wait(
      `location.pathname === '/projects/${slug}/' && document.getElementById('switch-project')?.hidden === false && document.getElementById('switch-project')?.disabled === false`,
    );
  };
  await createProject('Hello World', 'hello-world');
  await set('atlas-path', join(folder, 'input/terrain.atlas.json'));
  await submit('import-form');
  await wait("document.getElementById('status')?.textContent.includes('Atlas imported')");
  await set('scene-title', 'Home');
  await submit('scene-form');
  await wait("document.getElementById('status')?.textContent.includes('Scene created')");
  const renameLayer = async (name: string) => {
    await set('layer-name', name);
    await evaluate("document.getElementById('layer-name').dispatchEvent(new Event('change'))");
    await wait("document.getElementById('dirty')?.textContent === 'UNSAVED'");
  };
  await renameLayer('Saved before switching');
  await chooseProject('/');
  await wait("document.getElementById('switch-project-dialog')?.open");
  await browser.screenshot('project-switch-save');
  await click('switch-cancel');
  assert.equal(
    await evaluate("document.getElementById('switch-project').value"),
    '/projects/hello-world',
  );
  assert.equal(await evaluate('location.pathname'), '/projects/hello-world/');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await chooseProject('/');
  await click('switch-save');
  await wait("location.pathname === '/' && document.querySelector('#project-list a') !== null");
  const savedManifest = record(
    JSON.parse(await readFile(join(projectRoot, 'hello-world/forge.project.json'), 'utf8')),
  );
  const rootSceneId = string(record(array(savedManifest.scenes, record)[0]).id);
  const rootScenePath = join(projectRoot, `hello-world/scenes/${rootSceneId}.tmj`);
  let rootMap = record(JSON.parse(await readFile(rootScenePath, 'utf8')));
  assert.equal(record(array(rootMap.layers, record)[0]).name, 'Saved before switching');
  await createProject('Another World', 'another-world');
  assert.equal(
    await evaluate("document.getElementById('scene-name').textContent"),
    'No scene open',
  );
  assert.equal(
    await evaluate("document.querySelectorAll('#palette button[data-asset]').length"),
    0,
  );
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  await goProjects();
  assert.equal(await evaluate("document.getElementById('project-form').hidden"), true);
  assert.equal(
    await evaluate("document.querySelectorAll('#project-start .welcome:not([hidden])').length"),
    1,
  );
  await click('show-new-project');
  assert.equal(await evaluate("document.getElementById('project-picker').hidden"), true);
  assert.equal(await evaluate('document.activeElement.id'), 'project-title');
  await set('project-title', 'Unfinished project');
  await click('back-to-projects');
  assert.equal(await evaluate("document.getElementById('project-form').hidden"), true);
  assert.equal(await evaluate("document.getElementById('project-picker').hidden"), false);
  assert.equal(await evaluate("document.querySelectorAll('#project-list a').length"), 2);
  await click('show-new-project');
  assert.equal(
    await evaluate("document.getElementById('project-title').value"),
    'Unfinished project',
  );
  await click('back-to-projects');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await checkBuildLabel();
  await browser.screenshot('project-selector-version');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.screenshot('project-selector');
  await openProject('hello-world');
  assert.equal(
    await evaluate(`(() => {
      const project = document.getElementById('switch-project');
      const scene = document.getElementById('scenes');
      return project.value === '/projects/hello-world' &&
        project.selectedOptions[0].textContent === 'Hello World' &&
        project.closest('.document-bar') === scene.closest('.document-bar') &&
        project.getBoundingClientRect().right < scene.getBoundingClientRect().left &&
        !document.querySelector('.masthead select');
    })()`),
    true,
  );
  await browser.screenshot('project-dropdown');
  await chooseProject('/projects/another-world');
  await wait(
    "location.pathname === '/projects/another-world/' && document.getElementById('switch-project')?.value === '/projects/another-world'",
  );
  await chooseProject('/projects/hello-world');
  await wait(
    "location.pathname === '/projects/hello-world/' && document.getElementById('switch-project')?.value === '/projects/hello-world'",
  );
  assert.equal(
    await evaluate("document.getElementById('scene-name').textContent"),
    'No scene open',
  );
  await chooseScene(rootSceneId);
  await wait("document.getElementById('status')?.textContent === 'Scene opened.'");
  assert.equal(
    await evaluate("document.getElementById('layer-name').value"),
    'Saved before switching',
  );
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  await renameLayer('Keep this edit after a failed save');
  // External edit forces a real save conflict: switching must leave the edit in place.
  rootMap = { ...rootMap, properties: [{ name: 'external', type: 'string', value: 'changed' }] };
  await writeFile(rootScenePath, JSON.stringify(rootMap));
  await chooseProject('/projects/another-world');
  await click('switch-save');
  await wait(
    "document.querySelector('#switch-project-dialog .form-error')?.textContent.length > 0",
  );
  assert.equal(await evaluate('location.pathname'), '/projects/hello-world/');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  assert.equal(
    await evaluate("document.getElementById('layer-name').value"),
    'Keep this edit after a failed save',
  );
  await click('switch-discard');
  await wait(
    "location.pathname === '/projects/another-world/' && document.getElementById('switch-project')?.value === '/projects/another-world'",
  );
  await goProjects();
  await wait("document.querySelectorAll('#project-list a').length === 2");
  await stop();
  await start(projectRoot, false, false);
  await browser.call('Page.navigate', { url });
  await wait("document.querySelectorAll('#project-list a').length === 2");
  await openProject('another-world');
  assert.equal(await evaluate("document.querySelector('#scenes').options.length"), 1);
  assert.equal(await evaluate("document.getElementById('terrain-overlay').checked"), false);
  // Return to the direct-project fixture to exercise the full editor and legacy opening mode.
  await stop();
  await start(join(folder, 'world'));
  await browser.call('Page.navigate', { url });
  await wait("document.getElementById('status')?.textContent.includes('Name your project')");
  assert.equal(await evaluate("document.getElementById('folder-name').textContent"), 'world');
  assert.equal(
    await evaluate("document.getElementById('folder-heading').textContent"),
    'Project folder',
  );
  assert.equal(
    await evaluate("document.getElementById('folder-path').textContent"),
    join(folder, 'world'),
  );
  // A long path remains readable in the popover without widening the page.
  await click('project-folder');
  await wait("document.getElementById('folder-popover').matches(':popover-open')");
  await evaluate(
    "document.getElementById('folder-path').textContent='/very-long-project-folder/'.repeat(20)",
  );
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 980,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(`(() => {
    const panel=document.getElementById('folder-popover'),rect=panel.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && panel.scrollWidth <= panel.clientWidth;
  })()`);
  await browser.screenshot('standalone-project-folder');
  await evaluate(
    "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Clipboard unavailable')}}})",
  );
  await click('copy-folder');
  await wait(
    "document.getElementById('folder-copy-status').textContent.includes('Select the path')",
  );
  await click('project-folder');
  await evaluate(
    `document.getElementById('folder-path').textContent=${JSON.stringify(join(folder, 'world'))}`,
  );
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await wait("document.querySelector('.mark')?.naturalWidth === 64");
  assert.equal(
    await evaluate("getComputedStyle(document.querySelector('.mark')).imageRendering"),
    'pixelated',
  );
  await set('project-title', 'Acceptance world');
  await submit('project-form');
  await wait("document.getElementById('status')?.textContent.includes('Project created')");
  // Browser owns folder selection; choosing reads no atlas bytes and makes no picker HTTP requests.
  await click('library-import');
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
  assert.equal(await evaluate("document.querySelectorAll('#show-import').length"), 0);
  assert.equal(await evaluate("document.getElementById('scene-save-state').textContent"), 'Saved');
  assert.equal(
    await evaluate(
      "document.getElementById('save').disabled && !document.getElementById('save').classList.contains('primary')",
    ),
    true,
  );
  await click('fit-scene');
  assert.equal(await evaluate("document.getElementById('zoom').value"), 'fit');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await set('zoom', '3');
  await evaluate(`(() => {
    const canvas=document.getElementById('scene'), rect=canvas.getBoundingClientRect();
    const data=new DataTransfer();data.setData('application/x-forge-asset','actors/idle');
    canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data,
      clientX:rect.left+32*rect.width/canvas.width,clientY:rect.top+24*rect.height/canvas.height}));
  })()`);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  assert.equal(
    await evaluate("document.getElementById('scene-save-state').textContent"),
    'Unsaved changes',
  );
  assert.equal(
    await evaluate(
      "!document.getElementById('save').disabled && document.getElementById('save').classList.contains('primary')",
    ),
    true,
  );
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
  // Revert must retain the scene revision rewritten by atlas deletion.
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await browser.click("document.querySelector('#discard-dialog button[value=discard]')");
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await browser.pointer(28, 12);
  await browser.pointer(28, 12, 'mouseReleased');
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
  // Choosing the current scene is a no-op, even with unsaved edits.
  await browser.click('document.querySelector(\'[data-asset="terrain/earth"]\')');
  await browser.pointer(20, 12);
  await browser.pointer(20, 12, 'mouseReleased');
  await set('scenes', first);
  assert.equal(await evaluate("document.getElementById('switch-scene-dialog').open"), false);
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
  // Switching from the dropdown preserves edits on cancel and supports save/discard.
  assert.equal(await evaluate("document.getElementById('open')"), null);
  await renameLayer('River ground');
  await set('scenes', first);
  await wait("document.getElementById('switch-scene-dialog').open");
  assert.equal(await evaluate("document.getElementById('scenes').value"), second);
  await click('scene-switch-cancel');
  assert.equal(await evaluate("document.getElementById('layer-name').value"), 'River ground');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  await set('scenes', first);
  await wait("document.getElementById('switch-scene-dialog').open");
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await wait("!document.getElementById('switch-scene-dialog').open");
  assert.equal(await evaluate("document.getElementById('scenes').value"), second);
  await set('scenes', first);
  await wait("document.getElementById('switch-scene-dialog').open");
  await browser.screenshot('scene-switch-save');
  await click('scene-switch-save');
  await wait(
    `document.getElementById('scenes').value === ${JSON.stringify(first)} && !document.getElementById('switch-scene-dialog').open`,
  );
  assert.equal(
    record(array(record((await scene(second)).scene).layers, record)[0]).name,
    'River ground',
  );
  await chooseScene(second);
  await renameLayer('Discard this name');
  await set('scenes', first);
  await wait("document.getElementById('switch-scene-dialog').open");
  await click('scene-switch-discard');
  await wait(
    `document.getElementById('scenes').value === ${JSON.stringify(first)} && !document.getElementById('switch-scene-dialog').open`,
  );
  assert.equal(
    record(array(record((await scene(second)).scene).layers, record)[0]).name,
    'River ground',
  );
  await chooseScene(second);
  await renameLayer('Ground');
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
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
  assert.equal(
    await evaluate("document.getElementById('layer-context-text').textContent"),
    'Canopy is hidden',
  );
  await click('context-show-layer');
  assert.equal(await evaluate("document.getElementById('context-show-layer').hidden"), true);
  await click('undo');
  assert.equal(
    await evaluate("document.getElementById('layer-context-text').textContent"),
    'Canopy is hidden',
  );
  await click('layer-object');
  await set('layer-name', 'Foreground actors');
  await evaluate("document.getElementById('layer-name').dispatchEvent(new Event('change'))");
  await browser.click('document.querySelector(\'[data-asset="actors/idle"]\')');
  await browser.pointer(48, 24);
  await browser.pointer(48, 24, 'mouseReleased');
  await click('layer-remove');
  assert.equal(await evaluate("document.querySelectorAll('#layers input[type=radio]').length"), 3);
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
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('#layers .layer-name'), node => node.textContent)",
    ),
    ['Foreground actors', 'Canopy', 'Sprites', 'Ground'],
  );
  await evaluate("document.querySelector('#layers input:checked').focus()");
  for (const [key, code, expected] of [
    ['ArrowDown', 40, 'Canopy'],
    ['ArrowUp', 38, 'Foreground actors'],
  ] as const) {
    await browser.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    await browser.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    assert.equal(await evaluate("document.getElementById('layer-name').value"), expected);
    assert.equal(
      await evaluate("document.activeElement === document.querySelector('#layers input:checked')"),
      true,
    );
  }
  assert.equal(await evaluate("document.getElementById('layer-up').disabled"), true);
  const longLayerName =
    'Characters, markers and foreground objects with a long descriptive layer name';
  await set('layer-name', longLayerName);
  await evaluate("document.getElementById('layer-name').dispatchEvent(new Event('change'))");
  assert.equal(
    await evaluate(`(() => {
    const name = document.querySelector('#layers input:checked').closest('label').querySelector('.layer-name');
    return name.textContent === ${JSON.stringify(longLayerName)} && name.scrollWidth <= name.clientWidth && name.clientHeight > 30;
  })()`),
    true,
  );
  await browser.screenshot('standalone-layers-long-name');
  await click('undo');
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // Real pointer drags reorder inactive layers and form one undoable edit.
  const layerOrder = () =>
    evaluate(
      "Array.from(document.querySelectorAll('#layers .layer-row'), row => row.dataset.layerId)",
    );
  const startLayerDrag = async (id: string, target: string, after = false) => {
    await evaluate(`document.querySelector('#layers [data-layer-id="${id}"] .layer-grip')
      .scrollIntoView({block:'center', inline:'nearest', behavior:'instant'})`);
    await wait(`(() => {
      const grip = document.querySelector('#layers [data-layer-id="${id}"] .layer-grip');
      const rect = grip.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        ?.closest('.layer-grip') === grip;
    })()`);
    const points = array(
      await evaluate(`(() => {
      const handle = document.querySelector('#layers [data-layer-id="${id}"] .layer-grip').getBoundingClientRect();
      const target = document.querySelector('#layers [data-layer-id="${target}"]').getBoundingClientRect();
      return [handle.left + handle.width / 2, handle.top + handle.height / 2, target.top + target.height * ${after ? 0.8 : 0.2}];
    })()`),
      number,
    );
    await browser.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: points[0],
      y: points[1],
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await browser.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: points[0],
      y: points[2],
      buttons: 1,
    });
    return points;
  };
  const dropLayer = async (points: number[]) =>
    browser.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: points[0],
      y: points[2],
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  let dragPoints = await startLayerDrag('1', '3');
  // Chrome can acknowledge a mouse move before delivering its pointer event.
  await wait("document.getElementById('layers').dataset.dragging === 'true'");
  assert.equal(
    await evaluate("document.querySelector('#layers [data-drop=before]').dataset.layerId"),
    '3',
  );
  await browser.screenshot('standalone-layer-drag');
  await dropLayer(dragPoints);
  assert.deepEqual(await layerOrder(), ['4', '1', '3', '2']);
  assert.equal(await evaluate("document.querySelector('#layers input:checked').value"), '4');
  assert.equal(
    await evaluate("document.getElementById('scene-save-state').textContent"),
    'Unsaved changes',
  );
  await click('undo');
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await click('redo');
  assert.deepEqual(await layerOrder(), ['4', '1', '3', '2']);
  await click('undo');
  dragPoints = await startLayerDrag('4', '1', true);
  await dropLayer(dragPoints);
  assert.deepEqual(await layerOrder(), ['3', '2', '1', '4']);
  await click('undo');
  dragPoints = await startLayerDrag('1', '3');
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await dropLayer(dragPoints);
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // Leaving the list cancels, and long stacks scroll under a captured pointer.
  dragPoints = await startLayerDrag('1', '3');
  const outsideX = number(
    await evaluate("document.getElementById('layers').getBoundingClientRect().left - 20"),
  );
  await browser.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: outsideX,
    y: dragPoints[2],
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  await evaluate(
    "document.getElementById('layers').style.maxHeight='140px'; document.getElementById('layers').scrollTop=0",
  );
  dragPoints = await startLayerDrag('4', '3');
  const edgeY = number(
    await evaluate("document.getElementById('layers').getBoundingClientRect().bottom - 5"),
  );
  await browser.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: dragPoints[0],
    y: edgeY,
    buttons: 1,
  });
  await wait("document.getElementById('layers').scrollTop > 0");
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await dropLayer(dragPoints);
  await evaluate(
    "document.getElementById('layers').style.maxHeight=''; document.getElementById('layers').scrollTop=0",
  );
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await browser.screenshot('standalone-layers');
  // Visibility controls leave the active layer and its selected object unchanged.
  await browser.click(`document.querySelector('#layers [data-layer-id="4"] .layer-choice')`);
  await set('object-list', '2');
  const selectedNameBeforeToggle = await evaluate(
    "document.getElementById('selection-name').textContent",
  );
  await browser.click(`document.querySelector('#layers [data-layer-id="3"] .layer-eye')`);
  assert.equal(await evaluate("document.querySelector('#layers input:checked').value"), '4');
  assert.equal(
    await evaluate("document.getElementById('selection-name').textContent"),
    selectedNameBeforeToggle,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#layers [data-layer-id=\"3\"] .layer-eye').getAttribute('aria-pressed')",
    ),
    'true',
  );
  await click('undo');
  assert.equal(
    await evaluate(
      "document.querySelector('#layers [data-layer-id=\"3\"] .layer-eye').getAttribute('aria-pressed')",
    ),
    'false',
  );
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  // Fit stops at 1x for a tall scene, then adjusts when more space becomes available.
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 980,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('fit-scene');
  const sceneFits = `(() => {
    const scene = document.getElementById('scene').getBoundingClientRect();
    const viewport = document.getElementById('viewport').getBoundingClientRect();
    return scene.left >= viewport.left && scene.right <= viewport.right && scene.top >= viewport.top && scene.bottom <= viewport.bottom;
  })()`;
  await wait("document.getElementById('fit-zoom-option').textContent === 'Fit (1×)'");
  assert.equal(
    await evaluate(
      "document.getElementById('scene').getBoundingClientRect().height === document.getElementById('scene').height",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "document.getElementById('viewport').scrollHeight > document.getElementById('viewport').clientHeight",
    ),
    true,
  );
  await browser.screenshot('standalone-fit-scene');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(sceneFits);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  await set('zoom', '3');
  // Generic markers, areas, properties and per-instance sprite origins share layer history.
  await click('place-point');
  await browser.pointer(16, 48);
  await browser.pointer(16, 48, 'mouseReleased');
  assert.equal(await evaluate("document.getElementById('selection-kind').textContent"), 'POINT');
  assert.equal(
    await evaluate(`(() => {
    const inspector = document.querySelector('.inspector').getBoundingClientRect();
    const panel = document.getElementById('selection-panel').getBoundingClientRect();
    const scene = document.getElementById('scene-panel').getBoundingClientRect();
    const edit = document.getElementById('edit-object').getBoundingClientRect();
    return panel.top >= inspector.top && panel.top < scene.top && edit.bottom < inspector.bottom;
  })()`),
    true,
  );
  await browser.screenshot('standalone-selection-first');
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
  await chooseLayer('4');
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
  // Mouse-operated controls release focus so canvas shortcuts work immediately.
  const pointerClick = async (expression: string) => {
    const point = array(
      await evaluate(`(() => {
      const control=${expression}; control.scrollIntoView({block:'nearest'});
      const rect=control.getBoundingClientRect(); return [rect.left+rect.width/2,rect.top+rect.height/2];
    })()`),
      number,
    );
    await browser.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point[0],
      y: point[1],
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await browser.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point[0],
      y: point[1],
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  };
  await evaluate("document.getElementById('search').focus()");
  await pointerClick("document.querySelector('.tool:has(input[value=paint])')");
  assert.equal(await evaluate('document.activeElement.id'), 'scene');
  await pointerClick("document.querySelector('#layers input:checked').closest('.layer-choice')");
  assert.equal(await evaluate('document.activeElement.id'), 'scene');
  // Keyboard interaction keeps radio and dropdown focus available for navigation.
  await evaluate("document.querySelector('#layers input:checked').focus()");
  assert.equal(await evaluate('document.activeElement.name'), 'active-layer');
  await evaluate(
    "document.getElementById('zoom').focus(); document.getElementById('zoom').value='4'; document.getElementById('zoom').dispatchEvent(new Event('change',{bubbles:true}))",
  );
  assert.equal(await evaluate('document.activeElement.id'), 'zoom');
  await evaluate(
    "document.getElementById('zoom').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); document.getElementById('zoom').value='3'; document.getElementById('zoom').dispatchEvent(new Event('change',{bubbles:true}))",
  );
  assert.equal(await evaluate('document.activeElement.id'), 'scene');
  const originalLayerName = string(await evaluate("document.getElementById('layer-name').value"));
  await evaluate(
    "document.getElementById('layer-name').focus(); document.getElementById('layer-name').value='Uncommitted rename'",
  );
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  assert.equal(await evaluate("document.getElementById('layer-name').value"), originalLayerName);
  assert.equal(await evaluate('document.activeElement.id'), 'scene');
  await evaluate("document.getElementById('search').focus()");
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await browser.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  assert.equal(await evaluate('document.activeElement.id'), 'scene');
  // Space pans the workspace temporarily without switching tools or authoring.
  await evaluate("document.getElementById('viewport').scrollTop=0");
  const spaceKey = async (type: string) =>
    browser.call('Input.dispatchKeyEvent', {
      type,
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
  const navigationState = await evaluate(
    "[document.getElementById('dirty').textContent, document.getElementById('undo').disabled, document.getElementById('redo').disabled]",
  );
  await spaceKey('keyDown');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('scene')).cursor"), 'grab');
  assert.equal(await evaluate("document.querySelector('input[value=paint]').checked"), true);
  const panPoint = array(
    await evaluate(`(() => {
    const rect=document.getElementById('viewport').getBoundingClientRect();
    return [rect.left+12,rect.top+140];
  })()`),
    number,
  );
  assert.equal(
    await evaluate(`(() => {
      const viewport=document.getElementById('viewport');
      return viewport.scrollHeight > viewport.clientHeight;
    })()`),
    true,
    'The Space-pan fixture must have vertical scroll room',
  );
  await browser.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: panPoint[0],
    y: panPoint[1],
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  assert.equal(
    await evaluate("getComputedStyle(document.getElementById('viewport')).cursor"),
    'grabbing',
  );
  await browser.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: panPoint[0],
    y: panPoint[1] - 60,
    buttons: 1,
  });
  // Chrome may acknowledge the mouse move before delivering its pointer event.
  // Keep the drag active until the viewport has processed it.
  await wait("document.getElementById('viewport').scrollTop > 0");
  // Releasing Space mid-drag must not turn the remaining gesture into painting.
  await spaceKey('keyUp');
  assert.equal(
    await evaluate("getComputedStyle(document.getElementById('scene')).cursor"),
    'crosshair',
  );
  await browser.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: panPoint[0] + 50,
    y: panPoint[1] - 80,
    buttons: 1,
  });
  await browser.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: panPoint[0] + 50,
    y: panPoint[1] - 80,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  assert.deepEqual(
    await evaluate(
      "[document.getElementById('dirty').textContent, document.getElementById('undo').disabled, document.getElementById('redo').disabled]",
    ),
    navigationState,
  );
  await evaluate("document.getElementById('scene').focus()");
  await spaceKey('keyDown');
  await evaluate("window.dispatchEvent(new Event('blur'))");
  assert.equal(await evaluate("document.getElementById('viewport').dataset.pan"), 'false');
  await spaceKey('keyUp');
  await evaluate("document.getElementById('search').focus()");
  await spaceKey('keyDown');
  await spaceKey('keyUp');
  assert.equal(await evaluate("document.getElementById('viewport').dataset.pan"), 'false');
  await set('search', '');
  await evaluate(
    "document.getElementById('scene').focus(); document.getElementById('viewport').scrollTop=0",
  );
  // Wheel zoom retains the scene pixel under the cursor and never changes history.
  const wheelPoint = array(
    await evaluate(`(() => {
    const rect=document.getElementById('viewport').getBoundingClientRect();
    return [rect.left+rect.width/2,rect.top+rect.height/2];
  })()`),
    number,
  );
  const pixelUnderWheel = () =>
    evaluate(`(() => {
    const canvas=document.getElementById('scene'),rect=canvas.getBoundingClientRect();
    return [(${wheelPoint[0]}-rect.left)*canvas.width/rect.width,(${wheelPoint[1]}-rect.top)*canvas.height/rect.height];
  })()`);
  const beforeZoom = array(await pixelUnderWheel(), number);
  const wheel = async (deltaY: number) =>
    browser.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: wheelPoint[0],
      y: wheelPoint[1],
      deltaX: 0,
      deltaY,
    });
  await wheel(-100);
  await wait("document.getElementById('zoom').value === '4'");
  const afterZoom = array(await pixelUnderWheel(), number);
  assert.ok(Math.abs(beforeZoom[0] - afterZoom[0]) < 1);
  assert.ok(Math.abs(beforeZoom[1] - afterZoom[1]) < 1);
  await wheel(100);
  await wait("document.getElementById('zoom').value === '3'");
  await click('fit-scene');
  const fittedScale = number(
    await evaluate(
      "document.getElementById('scene').getBoundingClientRect().width / document.getElementById('scene').width",
    ),
  );
  await wheel(fittedScale > 1 ? 100 : -100);
  await wait("document.getElementById('zoom').value !== 'fit'");
  await set('zoom', '1');
  await wheel(100);
  assert.equal(await evaluate("document.getElementById('zoom').value"), '1');
  assert.equal(
    await evaluate(
      "Array.from(document.getElementById('zoom').options).every(option => !option.textContent.includes('%') && (option.value === 'fit' || Number(option.value) >= 1))",
    ),
    true,
  );
  await set('zoom', '8');
  await wheel(-100);
  assert.equal(await evaluate("document.getElementById('zoom').value"), '8');
  await set('zoom', '3');
  assert.deepEqual(
    await evaluate(
      "[document.getElementById('dirty').textContent, document.getElementById('undo').disabled, document.getElementById('redo').disabled]",
    ),
    navigationState,
  );
  await chooseScene(first);
  await wait("document.getElementById('status')?.textContent === 'Scene opened.'");
  // Explicit unchanged reimport retains placements and both scenes.
  await set('atlas-path', join(folder, 'input/terrain.atlas.json'));
  await click('library-import');
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
  await checkBuildLabel();
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
  await chooseScene(second);
  await wait("document.getElementById('status').textContent === 'Scene opened.'");
  assert.equal(await evaluate("document.querySelectorAll('#layers input[type=radio]').length"), 4);
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('#layers .layer-row[data-visible=false]')).some(row => row.textContent.includes('Canopy') && row.textContent.includes('Hidden'))",
    ),
    true,
  );
  await chooseLayer('4');
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
  await chooseScene(first);
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
  await chooseLayer('2');
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
  await chooseLayer('1');
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
  // A failed save while switching keeps the current scene and its selection.
  await set('scenes', second);
  await wait("document.getElementById('switch-scene-dialog').open");
  await click('scene-switch-save');
  await wait(
    "document.querySelector('#switch-scene-dialog .form-error').textContent.includes('Scene changed')",
  );
  assert.equal(await evaluate("document.getElementById('scenes').value"), first);
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  assert.equal(await readFile(mapPath, 'utf8'), before + '\n');
  await click('scene-switch-cancel');
  // Restore the external test edit, then explicitly delete the dirty scene.
  await writeFile(mapPath, before);
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  await browser.screenshot('standalone-delete-scene');
  await click('delete-scene-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted “Village”')");
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'NO SCENE');
  assert.equal(await evaluate("document.getElementById('scene').hidden"), true);
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  assert.equal(array(record((await catalog()).project).scenes, record).length, 1);
  await chooseScene(second);
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  await click('delete-scene-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted “River”')");
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'NO SCENE');
  assert.equal(await evaluate("document.getElementById('scene').hidden"), true);
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
  // Exercise the actual demo entry point and compare its artwork with Aseprite exports.
  await stop();
  await start(join(folder, 'demo'), false, true, true);
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.call('Page.navigate', { url });
  await wait("document.getElementById('project-name')?.textContent === 'Scene Forge demo'");
  await wait("!document.getElementById('scenes')?.disabled");
  if (await evaluate("document.getElementById('grid').checked")) {
    await click('grid');
  }
  for (const entry of array(record((await catalog()).project).scenes, record)) {
    const name = string(entry.name).toLowerCase();
    await chooseScene(string(entry.id));
    await wait(
      `document.getElementById('scene-name')?.textContent.startsWith(${JSON.stringify(string(entry.name) + ' ·')}) && document.getElementById('scenes')?.disabled === false`,
    );
    const data = string(await evaluate("document.getElementById('scene').toDataURL('image/png')"));
    const rendered = join(folder, `${name}.png`);
    await writeFile(rendered, Buffer.from(data.split(',')[1], 'base64'));
    await promisify(execFile)('.venv/bin/python', [
      '-c',
      `
import sys
from pathlib import Path
from gbc_scene_forge import png
width, height, expected = png.decode(Path(sys.argv[1]).read_bytes())
actual_width, actual_height, actual = png.decode(Path(sys.argv[2]).read_bytes())
assert (actual_width, actual_height) == (width, height) == (224, 160)
for y in range(height):
    for x in range(width):
        # The editor draws authoring guides for the spawn and trigger objects.
        if (110 <= x <= 122 and 130 <= y <= 142) or (166 <= x <= 178 and 70 <= y <= 82):
            continue
        i = (y * width + x) * 4
        assert expected[i:i+4] == actual[i:i+4], f'Artwork differs at {x},{y}'
`,
      `assets/demo/artwork/${name}.png`,
      rendered,
    ]);
    await browser.screenshot(`demo-${name}`);
  }
  // Use the published atlas conformance bundles in the real standalone editor.
  await stop();
  const paletteRoot = join(folder, 'palette-examples');
  await promisify(execFile)('.venv/bin/python', [
    'tests/prepare_palette_fixture.py',
    '--root',
    paletteRoot,
  ]);
  await start(paletteRoot, false);
  await browser.call('Page.navigate', { url });
  await wait("document.getElementById('project-name')?.textContent === 'GBC palette examples'");
  const paletteScenes = array(record((await catalog()).project).scenes, record);
  const passingPaletteScene = string(paletteScenes[0].id);
  const overPaletteScene = string(paletteScenes[1].id);
  await chooseScene(passingPaletteScene);
  await wait("document.getElementById('show-palettes').dataset.state === 'pass'");
  await click('show-palettes');
  await wait("document.getElementById('palette-dialog').open");
  assert.equal(
    await evaluate(
      "document.getElementById('palette-findings').textContent.includes('Background palettes: 8 required, 8 available (0 reserved)')",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "document.getElementById('palette-findings').textContent.includes('Sprite palettes: 2 required')",
    ),
    true,
  );
  await click('palette-preflight');
  await wait(
    "document.getElementById('palette-summary').textContent === 'GBC palette preflight passed.'",
  );
  await browser.screenshot('palette-preflight-passing');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 980,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(
    await evaluate(`(() => {
    const rect = document.getElementById('palette-dialog').getBoundingClientRect();
    const actions = document.getElementById('palette-preflight').getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && actions.bottom <= innerHeight;
  })()`),
    true,
  );
  await browser.screenshot('palette-preflight-compact');
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await set('palette-bg-reserved', '1');
  assert.equal(await evaluate("document.getElementById('palette-preflight').disabled"), true);
  assert.equal(await evaluate("document.getElementById('palette-findings').children.length"), 0);
  await click('palette-save-profile');
  await wait("document.getElementById('palette-summary').dataset.state === 'fail'");
  assert.equal(
    await evaluate(
      "document.getElementById('palette-findings').textContent.includes('7 available (1 reserved)')",
    ),
    true,
  );
  await set('palette-bg-reserved', '');
  await click('palette-save-profile');
  await wait("document.getElementById('palette-summary').dataset.state === 'unverified'");
  await click('palette-preflight');
  await wait(
    "document.getElementById('palette-summary').textContent === 'GBC palette preflight unverified.'",
  );
  await set('palette-bg-reserved', '0');
  await click('palette-save-profile');
  await wait("document.getElementById('palette-summary').dataset.state === 'pass'");
  await browser.click("document.querySelector('#palette-findings details summary')");
  await wait("document.querySelector('#palette-findings .palette-contributor') !== null");
  await evaluate(`window.__pollFetch = window.fetch; window.__palettePolls = 0;
    window.fetch = async (...args) => {
      const response = await window.__pollFetch(...args);
      if (String(args[0]).endsWith('/palette-report')) {
        await response.clone().text(); window.__palettePolls++;
      }
      return response;
    };`);
  await wait('window.__palettePolls > 0');
  assert.equal(await evaluate("document.querySelector('#palette-findings details').open"), true);
  await evaluate('window.fetch = window.__pollFetch');
  await browser.click("document.querySelector('#palette-findings .palette-contributor')");
  await wait("!document.getElementById('palette-dialog').open");
  assert.equal(
    await evaluate(
      "document.getElementById('status').textContent.startsWith('Palette contributor:')",
    ),
    true,
  );
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'SAVED');
  const paletteIndicatorWidth = await evaluate(
    "document.getElementById('show-palettes').getBoundingClientRect().width",
  );
  await browser.click('document.querySelector(\'[data-asset="reordered/swapped"]\')');
  await browser.pointer(4, 20);
  await browser.pointer(4, 20, 'mouseReleased');
  await wait("document.getElementById('show-palettes').dataset.state === 'fail'");
  assert.equal(
    await evaluate("document.getElementById('show-palettes').getBoundingClientRect().width"),
    paletteIndicatorWidth,
  );
  assert.equal(await evaluate("document.getElementById('dirty').textContent"), 'UNSAVED');
  // Hold an old passing response, then redo the over-budget edit before releasing it.
  await evaluate(`window.__paletteFetch = window.fetch;
    window.__holdPalette = true;
    window.fetch = async (...args) => {
      const response = await window.__paletteFetch(...args);
      if (String(args[0]).endsWith('/palette-report') && window.__holdPalette) {
        window.__holdPalette = false; window.__paletteHeld = true;
        await new Promise(resolve => window.__releasePalette = resolve);
        window.__paletteReleased = true;
      }
      return response;
    };`);
  await click('undo');
  await wait('window.__paletteHeld === true');
  await click('redo');
  await wait("document.getElementById('show-palettes').dataset.state === 'fail'");
  await evaluate('window.__releasePalette()');
  await wait('window.__paletteReleased === true');
  assert.equal(await evaluate("document.getElementById('show-palettes').dataset.state"), 'fail');
  await evaluate('window.fetch = window.__paletteFetch');
  await click('show-palettes');
  await click('palette-preflight');
  await wait(
    "document.getElementById('palette-summary').textContent === 'GBC palette preflight failed.'",
  );
  await browser.screenshot('palette-preflight-over-budget');
  await click('palette-close');
  await captureDownloads();
  await click('show-export');
  await set('export-scope', 'scene');
  await click('export-confirm');
  await wait('window.__exportBlob !== null');
  await click('undo');
  await wait("document.getElementById('show-palettes').dataset.state === 'pass'");
  await chooseScene(overPaletteScene);
  await wait("document.getElementById('show-palettes').dataset.state === 'fail'");
  // Reimport metadata must invalidate an existing report without changing the canvas.
  await click('library-import');
  await set(
    'atlas-path',
    join(process.cwd(), 'tests/fixtures/palette-semantics/mixed/mixed.atlas.json'),
  );
  await evaluate("document.getElementById('reimport').checked = true");
  await submit('import-form');
  await wait("document.getElementById('status').textContent.includes('Atlas imported')");
  await wait("document.getElementById('show-palettes').dataset.state === 'fail'");
  await wait(
    "document.getElementById('show-create').disabled === false && document.getElementById('dirty').textContent === 'SAVED'",
  );
  await evaluate('window.__paletteReloadMarker = true');
  await browser.call('Page.reload');
  await wait(
    "window.__paletteReloadMarker !== true && document.getElementById('project-name')?.textContent === 'GBC palette examples' && document.getElementById('status')?.textContent === 'Choose a scene, or import an atlas and create one.' && document.getElementById('scenes')?.disabled === false",
  );
  await chooseScene(passingPaletteScene);
  await wait("document.getElementById('show-palettes').dataset.state === 'pass'");
  const paletteManifestPath = join(paletteRoot, 'forge.project.json');
  const paletteManifestBytes = await readFile(paletteManifestPath, 'utf8');
  await writeFile(paletteManifestPath, paletteManifestBytes + '\n');
  await wait("document.getElementById('show-palettes').dataset.state === 'unverified'");
  await click('show-palettes');
  assert.equal(await evaluate("document.getElementById('palette-findings').children.length"), 0);
  assert.equal(
    await evaluate(
      "document.getElementById('palette-summary').textContent.includes('Project changed')",
    ),
    true,
  );
  await writeFile(paletteManifestPath, paletteManifestBytes);
  await wait("document.getElementById('palette-summary').dataset.state === 'pass'");
  await click('palette-enabled');
  await click('palette-save-profile');
  await wait(
    "document.getElementById('palette-summary').textContent === 'GBC palette checks are off.'",
  );
  assert.equal(await evaluate("document.getElementById('palette-preflight').disabled"), true);
  await click('palette-close');
  assert.deepEqual(browser.errors, []);
  console.log(
    'Standalone browser acceptance passed: project roots, selection, save/discard/cancel switching, failed-save preservation, project creation, atlas import/reimport, painting, layers, objects/properties, terrain/collision, portable exports, undo/redo, restart, moved directory, conflict preservation, and GBC palette budgets/preflight with stale-response protection.',
  );
} finally {
  await chrome?.close();
  await stop();
  await rm(folder, { recursive: true, force: true });
}
