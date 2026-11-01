import { expect } from '@playwright/test';
/** Full standalone workflow across server restarts and a moved project directory. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { array, number, record, string } from '../../../frontend/shared/decode.mts';
import {
  clickControl,
  scenePoint,
  setControl,
  test,
  waitForUI,
} from '../support/browser-fixtures.ts';

test('project launcher, switching, save conflicts and restart', async ({
  page,
  workspace,
}, testInfo) => {
  test.setTimeout(180000);
  const { folder } = workspace;
  let url = '';
  const start = async (root: string, fixture = true, single = true, demo = false) => {
    url = await workspace.start(root, fixture, single, demo);
  };
  const stop = () => workspace.stop();

  const evaluate = (expression: string) => page.evaluate(expression);
  const click = (id: string) => clickControl(page, id);
  const submit = async (id: string) => {
    const dialogs: Record<string, [string, string]> = {
      'scene-form': ['create-scene-dialog', 'show-create'],
      'import-form': ['import-atlas-dialog', 'library-import'],
    };
    const target = dialogs[id];
    if (target && !(await evaluate(`document.getElementById('${target[0]}').open`))) {
      await click(target[1]);
    }
    await page
      .locator(id === 'import-form' ? '#atlas-apply' : '#' + id + ' button.primary')
      .first()
      .click();
  };
  const wait = (expression: string) => waitForUI(page, expression);
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
  const set = (id: string, value: string) => setControl(page, id, value);
  const renameLayer = async (name: string) => {
    await set('layer-name', name);
    await wait("document.getElementById('dirty')?.textContent === 'UNSAVED'");
  };

  const chooseScene = async (id: string) => {
    await wait("document.getElementById('scenes')?.disabled === false");
    await set('scenes', id);
    await wait(
      `document.getElementById('scenes')?.value === ${JSON.stringify(id)} && document.getElementById('scenes')?.disabled === false`,
    );
  };

  // Exercise the multi-project launcher before the detailed single-project suite.
  await stop();
  await start(join(folder, 'world'));
  const projectRoot = join(folder, 'projects');
  await start(projectRoot, false, false);
  await page.goto(url);
  await wait(
    "!document.getElementById('project-form')?.hidden && document.getElementById('status')?.textContent.includes('Choose a project')",
  );
  await expect(page.locator('#folder-name')).toHaveText('projects');
  await expect(page.locator('#folder-heading')).toHaveText('Projects folder');
  await expect(page.locator('#folder-path')).toHaveText(projectRoot);
  await click('project-folder');
  await wait("document.getElementById('folder-popover').matches(':popover-open')");
  await evaluate(
    "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedFolder=value}}})",
  );
  await click('copy-folder');
  await wait("document.getElementById('folder-copy-status').textContent === 'Path copied.'");
  assert.equal(await evaluate('window.__copiedFolder'), projectRoot);
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await wait("!document.getElementById('folder-popover').matches(':popover-open')");
  for (const height of [1500, 700, 500]) {
    await page.setViewportSize({ width: 1440, height: height });
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
  await page.setViewportSize({ width: 1440, height: 1000 });
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
    await page.locator(`a[href="/projects/${slug}/"]`).first().click();
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

  await renameLayer('Saved before switching');
  await chooseProject('/');
  await wait("document.getElementById('switch-project-dialog')?.open");
  await page.screenshot({ path: testInfo.outputPath('project-switch-save' + '.png') });
  await click('switch-cancel');
  await expect(page.locator('#switch-project')).toHaveValue('/projects/hello-world');
  assert.equal(
    await evaluate('location.pathname'),
    `/projects/hello-world/scenes/${string(await evaluate("document.getElementById('scenes').value"))}`,
  );
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
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
  await expect(page.locator('#scene-name')).toHaveText('No scene open');
  assert.equal(
    await evaluate("document.querySelectorAll('#palette button[data-asset]').length"),
    0,
  );
  await expect(page.locator('#undo')).toBeDisabled();
  await goProjects();
  await expect(page.locator('#project-form')).toHaveJSProperty('hidden', true);
  assert.equal(
    await evaluate("document.querySelectorAll('#project-start .welcome:not([hidden])').length"),
    1,
  );
  await click('show-new-project');
  await expect(page.locator('#project-picker')).toHaveJSProperty('hidden', true);
  assert.equal(await evaluate('document.activeElement.id'), 'project-title');
  await set('project-title', 'Unfinished project');
  await click('back-to-projects');
  await expect(page.locator('#project-form')).toHaveJSProperty('hidden', true);
  await expect(page.locator('#project-picker')).toHaveJSProperty('hidden', false);
  assert.equal(await evaluate("document.querySelectorAll('#project-list a').length"), 2);
  await click('show-new-project');
  await expect(page.locator('#project-title')).toHaveValue('Unfinished project');
  await click('back-to-projects');
  await page.setViewportSize({ width: 760, height: 640 });
  await checkBuildLabel();
  await page.screenshot({ path: testInfo.outputPath('project-selector-version' + '.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('project-selector' + '.png') });
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
  await page.screenshot({ path: testInfo.outputPath('project-dropdown' + '.png') });
  await chooseProject('/projects/another-world');
  await wait(
    "location.pathname === '/projects/another-world/' && document.getElementById('switch-project')?.value === '/projects/another-world'",
  );
  await chooseProject('/projects/hello-world');
  await wait(
    "location.pathname === '/projects/hello-world/' && document.getElementById('switch-project')?.value === '/projects/hello-world'",
  );
  await expect(page.locator('#scene-name')).toHaveText('No scene open');
  await chooseScene(rootSceneId);
  await wait("document.getElementById('status')?.textContent === 'Scene opened.'");
  await expect(page.locator('#layer-name')).toHaveValue('Saved before switching');
  await expect(page.locator('#undo')).toBeDisabled();
  await renameLayer('Keep this edit after a failed save');
  // External edit forces a real save conflict: switching must leave the edit in place.
  rootMap = { ...rootMap, properties: [{ name: 'external', type: 'string', value: 'changed' }] };
  await writeFile(rootScenePath, JSON.stringify(rootMap));
  await chooseProject('/projects/another-world');
  await click('switch-save');
  await wait(
    "document.querySelector('#switch-project-dialog .form-error')?.textContent.length > 0",
  );
  assert.equal(
    await evaluate('location.pathname'),
    `/projects/hello-world/scenes/${string(await evaluate("document.getElementById('scenes').value"))}`,
  );
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await expect(page.locator('#layer-name')).toHaveValue('Keep this edit after a failed save');
  await click('switch-discard');
  await wait(
    "location.pathname === '/projects/another-world/' && document.getElementById('switch-project')?.value === '/projects/another-world'",
  );
  await goProjects();
  await wait("document.querySelectorAll('#project-list a').length === 2");
  await stop();
  await start(projectRoot, false, false);
  await page.goto(url);
  await wait("document.querySelectorAll('#project-list a').length === 2");
  await openProject('another-world');
  assert.equal(await evaluate("document.querySelector('#scenes').options.length"), 1);
  await expect(page.locator('#terrain-overlay')).not.toBeChecked();
});

test('artwork import, painting, sprite placement and scene switching', async ({
  page,
  workspace,
}, testInfo) => {
  test.setTimeout(180000);
  const { folder } = workspace;
  let url = '';
  const start = async (root: string, fixture = true, single = true, demo = false) => {
    url = await workspace.start(root, fixture, single, demo);
  };
  const stop = () => workspace.stop();
  async function catalog() {
    return record(await (await fetch(new URL('/api/project', url))).json());
  }
  async function scene(id: string) {
    const response = await fetch(new URL(`/api/scene/${id}`, url));
    const body = record(await response.json());
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  const evaluate = (expression: string) => page.evaluate(expression);
  const click = (id: string) => clickControl(page, id);
  const submit = async (id: string) => {
    const dialogs: Record<string, [string, string]> = {
      'scene-form': ['create-scene-dialog', 'show-create'],
      'import-form': ['import-atlas-dialog', 'library-import'],
    };
    const target = dialogs[id];
    if (target && !(await evaluate(`document.getElementById('${target[0]}').open`))) {
      await click(target[1]);
    }
    await page
      .locator(id === 'import-form' ? '#atlas-apply' : '#' + id + ' button.primary')
      .first()
      .click();
  };
  const wait = (expression: string) => waitForUI(page, expression);

  const set = (id: string, value: string) => setControl(page, id, value);
  const renameLayer = async (name: string) => {
    await set('layer-name', name);
    await wait("document.getElementById('dirty')?.textContent === 'UNSAVED'");
  };

  const chooseScene = async (id: string) => {
    await wait("document.getElementById('scenes')?.disabled === false");
    await set('scenes', id);
    await wait(
      `document.getElementById('scenes')?.value === ${JSON.stringify(id)} && document.getElementById('scenes')?.disabled === false`,
    );
  };

  // Return to the direct-project fixture to exercise the full editor and legacy opening mode.
  await stop();
  await start(join(folder, 'world'));
  await page.goto(url);
  await wait("document.getElementById('status')?.textContent.includes('Name your project')");
  await expect(page.locator('#folder-name')).toHaveText('world');
  await expect(page.locator('#folder-heading')).toHaveText('Project folder');
  await expect(page.locator('#folder-path')).toHaveText(join(folder, 'world'));
  // A long path remains readable in the popover without widening the page.
  await click('project-folder');
  await wait("document.getElementById('folder-popover').matches(':popover-open')");
  await evaluate(
    "document.getElementById('folder-path').textContent='/very-long-project-folder/'.repeat(20)",
  );
  await page.setViewportSize({ width: 980, height: 760 });
  await wait(`(() => {
    const panel=document.getElementById('folder-popover'),rect=panel.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && panel.scrollWidth <= panel.clientWidth;
  })()`);
  await page.screenshot({ path: testInfo.outputPath('standalone-project-folder' + '.png') });
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
  await page.setViewportSize({ width: 1440, height: 1000 });

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
  await expect(page.locator('#atlas-path')).toHaveValue('/tmp/keep-this-path.atlas.json');
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
  await expect(page.locator('#atlas-manifest')).toHaveValue('');
  assert.deepEqual(await evaluate('window.atlasReads'), []);
  await set('atlas-manifest', 'second.atlas.json');
  assert.deepEqual(record((await catalog()).project).atlases, {});
  await page.screenshot({ path: testInfo.outputPath('standalone-browse-atlas' + '.png') });
  // Exercise the directory-input fallback with actual browser File objects.
  await evaluate(
    'window.folderPickerFixture=window.showDirectoryPicker;window.showDirectoryPicker=undefined',
  );
  const fileChooser = page.waitForEvent('filechooser');
  await click('browse-atlas');
  await (await fileChooser).setFiles(join(folder, 'input'));
  await expect(page.locator('#atlas-manifest')).toHaveValue('terrain.atlas.json');
  await wait("document.getElementById('status')?.textContent.includes('Atlas selected')");
  await evaluate('window.showDirectoryPicker=window.folderPickerFixture');
  // Failed imports stay in their dialog with an inline, actionable error.
  await set('atlas-path', join(folder, 'missing.atlas.json'));
  await submit('import-form');
  await wait("document.querySelector('#import-form .form-error')?.textContent.length > 0");
  await expect(page.locator('#import-atlas-dialog')).toHaveJSProperty('open', true);
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
from gbc_scene_forge.artwork import png
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
  await expect(page.locator('#import-atlas-dialog')).toHaveJSProperty('open', false);
  await set('scene-title', 'Village');
  await set('width', '7');
  await set('height', '5');
  await submit('scene-form');
  await wait("document.getElementById('status')?.textContent.includes('Scene created')");
  await expect(page.locator('#create-scene-dialog')).toHaveJSProperty('open', false);
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
  await expect(page.locator('#inspector-size')).toHaveValue('7 × 5 cells');
  assert.equal(await evaluate("document.querySelectorAll('#show-import').length"), 0);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  assert.equal(
    await evaluate(
      "document.getElementById('save').disabled && !document.getElementById('save').classList.contains('primary')",
    ),
    true,
  );
  await click('fit-scene');
  await expect(page.locator('#zoom')).toHaveValue('fit');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await set('zoom', '3');
  await page
    .locator('[data-asset="actors/idle"]')
    .dragTo(page.locator('#scene'), { targetPosition: { x: 96, y: 72 } });
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  assert.equal(
    await evaluate(
      "!document.getElementById('save').disabled && document.getElementById('save').classList.contains('primary')",
    ),
    true,
  );
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
  const first = string(record(array(record((await catalog()).project).scenes, record)[0]).id);
  const borderBefore = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(8,8,1,1).data)",
  );
  await (async () => {
    const point = await scenePoint(page, 12, 12);
    await page.mouse.move(point.x, point.y);
  })();
  await expect(page.locator('#coordinates')).toHaveText('Cell 1, 1 · Pixel 12, 12');
  assert.notDeepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(8,8,1,1).data)",
    ),
    borderBefore,
  );
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await page.screenshot({ path: testInfo.outputPath('standalone-grid-hover' + '.png') });
  await page.mouse.move(10, 10);
  await expect(page.locator('#coordinates')).toHaveText('Cell —, — · Pixel —, —');
  assert.equal(
    await evaluate(
      "(() => { const p=document.getElementById('scene').getContext('2d').getImageData(8,8,1,1).data; return p[0]<=36 && p[1]<=40 && p[2]<=32; })()",
    ),
    true,
  );
  await (async () => {
    const point = await scenePoint(page, 12, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 12, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await wait("document.getElementById('dirty')?.textContent === 'UNSAVED'");
  // Real canvas rendering of the independent black tile, away from grid lines.
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,12,1,1).data)",
    ),
    [0, 0, 0, 255],
  );
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await click('redo');
  await click('save');
  await wait("document.getElementById('status')?.textContent === 'Scene saved.'");
  const paintedLayers = array(record((await scene(first)).scene).layers, record);
  assert.equal(
    array(paintedLayers[0].cells, (row) => array(row, string))[1][1],
    'terrain/earth/0/0',
  );
  assert.deepEqual(paintedLayers[1], {
    id: 2,
    name: 'Sprites',
    type: 'objectgroup',
    visible: true,
    objects: [],
  });
  // Fill, selection erase and undo exercise the shared editing model through browser events.
  await page.locator('input[value=fill]').first().click();
  await (async () => {
    const point = await scenePoint(page, 4, 4);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 4, 4);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('undo');
  await page.locator('input[value=select]').first().click();
  await (async () => {
    const point = await scenePoint(page, 9, 9);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 14, 14);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 14, 14);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await page.keyboard.press('Delete');
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  // A sprite-only atlas exposes native-size regions independent of the 8px grid.
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').first().click();
  await expect(page.locator('#paint-label')).toHaveText('Place sprite');
  await expect(page.locator('#snap')).toBeChecked();
  await (async () => {
    const point = await scenePoint(page, 29, 22);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 29, 22);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 32, Y 24')",
    ),
    true,
  );
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 33, Y 24')",
    ),
    true,
  );
  await click('undo');
  await click('undo');
  // Alt bypasses snapping for placement and dragging, while selecting alone never moves a sprite.
  await (async () => {
    const point = await scenePoint(page, 29, 22);
    await page.keyboard.down('Alt');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.keyboard.up('Meta');
  })();
  await (async () => {
    const point = await scenePoint(page, 29, 22);
    await page.keyboard.down('Alt');
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.keyboard.up('Meta');
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 29, Y 22')",
    ),
    true,
  );
  await page.locator('input[value=select]').first().click();
  await (async () => {
    const point = await scenePoint(page, 29, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 29, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 29, Y 22')",
    ),
    true,
  );
  await (async () => {
    const point = await scenePoint(page, 29, 12);
    await page.keyboard.down('Alt');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.keyboard.up('Meta');
  })();
  await (async () => {
    const point = await scenePoint(page, 31, 15);
    await page.keyboard.down('Alt');
    await page.mouse.move(point.x, point.y);
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.keyboard.up('Meta');
  })();
  await (async () => {
    const point = await scenePoint(page, 31, 15);
    await page.keyboard.down('Alt');
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.keyboard.up('Meta');
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 31, Y 25')",
    ),
    true,
  );
  await click('undo');
  await (async () => {
    const point = await scenePoint(page, 29, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 31, 15);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 31, 15);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 32, Y 24')",
    ),
    true,
  );
  await click('undo');
  await click('undo');
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').first().click();
  await click('snap');
  await (async () => {
    const point = await scenePoint(page, 29, 22);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 29, 22);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 29, Y 22')",
    ),
    true,
  );
  await click('undo');
  await click('snap');
  await (async () => {
    const point = await scenePoint(page, 55, 39);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 55, 39);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 48, Y 32')",
    ),
    true,
  );
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await (async () => {
    const point = await scenePoint(page, 32, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 32, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#selection-kind')).toHaveText('SPRITE');
  await expect(page.locator('#selection-name')).toHaveText('actors / idle');
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(28,5,1,1).data)",
    ),
    [255, 255, 255, 255],
  );
  await page.locator('input[value=select]').first().click();
  await (async () => {
    const point = await scenePoint(page, 32, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 40, 20);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 40, 20);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await page.keyboard.press('ArrowRight');
  await click('undo');
  await page.keyboard.press('Delete');
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
  await page.locator('[data-delete-atlas="actors"]').first().click();
  await wait("document.getElementById('delete-atlas-dialog').open");
  await expect(page.locator('#delete-atlas-confirm')).toBeDisabled();
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
  await click('artwork-tab');
  await page.locator('[data-asset="spare/earth"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 28, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 28, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 28, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 28, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await set('atlas-filter', 'spare');
  await page.locator('[data-delete-atlas="spare"]').first().click();
  await wait("document.getElementById('delete-atlas-dialog').open");
  await expect(page.locator('#delete-atlas-history')).toHaveJSProperty('hidden', false);
  await click('delete-atlas-cancel');
  await expect(page.locator('#undo')).toBeEnabled();
  assert.equal(Object.keys(record(record((await catalog()).project).atlases)).length, 3);
  await page.locator('[data-delete-atlas="spare"]').first().click();
  await wait("document.getElementById('delete-atlas-dialog').open");
  await page.screenshot({ path: testInfo.outputPath('standalone-delete-atlas' + '.png') });
  await click('delete-atlas-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted atlas “spare”')");
  assert.equal(
    await evaluate("document.getElementById('atlas-filter').selectedOptions[0].textContent"),
    'All atlases',
  );
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await expect(page.locator('#undo')).toBeDisabled();
  // Revert must retain the scene revision rewritten by atlas deletion.
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await page.locator('#discard-dialog button[value=discard]').first().click();
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 28, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 28, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
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
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 20, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 20, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await set('scenes', first);
  await expect(page.locator('#switch-scene-dialog')).toHaveJSProperty('open', false);
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
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
  await expect(page.locator('#scenes')).toHaveValue(second);
  await click('scene-switch-cancel');
  await expect(page.locator('#layer-name')).toHaveValue('River ground');
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await set('scenes', first);
  await wait("document.getElementById('switch-scene-dialog').open");
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await wait("!document.getElementById('switch-scene-dialog').open");
  await expect(page.locator('#scenes')).toHaveValue(second);
  await set('scenes', first);
  await wait("document.getElementById('switch-scene-dialog').open");
  await page.screenshot({ path: testInfo.outputPath('scene-switch-save' + '.png') });
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
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 32, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 32, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('save');
  await wait("document.getElementById('status')?.textContent === 'Scene saved.'");
  assert.deepEqual(record((await scene(second)).scene).objects, [
    { id: 1, asset: 'actors/idle', x: 32, y: 24 },
  ]);
  if (process.env.FORGE_CAPTURE_EDITOR) {
    await cp(folder, '/tmp/forge-editor-preview', { recursive: true });
  }
});

test('sprite playback, directional mapping and transient movement', async ({
  page,
  workspace,
}, testInfo) => {
  test.setTimeout(180000);
  const { folder } = workspace;
  let url = '';
  const start = async (root: string, fixture = true, single = true, demo = false) => {
    url = await workspace.start(root, fixture, single, demo);
  };

  async function catalog() {
    return record(await (await fetch(new URL('/api/project', url))).json());
  }
  async function scene(id: string) {
    const response = await fetch(new URL(`/api/scene/${id}`, url));
    const body = record(await response.json());
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  const evaluate = (expression: string) => page.evaluate(expression);
  const click = (id: string) => clickControl(page, id);

  const wait = (expression: string) => waitForUI(page, expression);

  const set = (id: string, value: string) => setControl(page, id, value);

  const chooseScene = async (id: string) => {
    await wait("document.getElementById('scenes')?.disabled === false");
    await set('scenes', id);
    await wait(
      `document.getElementById('scenes')?.value === ${JSON.stringify(id)} && document.getElementById('scenes')?.disabled === false`,
    );
  };

  await cp('tests/playwright/support/fixtures/editor/project', join(folder, 'world'), {
    recursive: true,
  });
  await cp('tests/playwright/support/fixtures/editor/input', join(folder, 'input'), {
    recursive: true,
  });
  await cp('tests/playwright/support/fixtures/editor/sprites', join(folder, 'sprites'), {
    recursive: true,
  });
  await promisify(execFile)(workspace.python, [
    '-c',
    `
import sys, json
from gbc_scene_forge.project.application import Project
p = Project(sys.argv[1])
if sys.argv[2] == 'layers':
    manifest = p.root / 'forge.project.json'
    data = json.loads(manifest.read_text())
    data['preview']['sprite'] = json.loads(open('tests/playwright/support/fixtures/editor/layer-preview.json').read())
    manifest.write_text(json.dumps(data))
loaded = p.scenes.load(p.catalog()['project']['scenes'][1]['id'])
s = loaded['scene']
s['objects'] = []
s['next_object_id'] = 1
p.scenes.save(loaded['id'], s, loaded['revision'], p.catalog()['revision'])
`,
    join(folder, 'world'),
    'preview',
  ]);
  await start(join(folder, 'world'), false);
  await page.goto(url);
  await wait("document.getElementById('scenes')?.disabled === false");
  const entries = array(record((await catalog()).project).scenes, record);
  const second = string(entries[1].id);

  await chooseScene(second);
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').click();
  const position = await scenePoint(page, 32, 24);
  await page.mouse.click(position.x, position.y);
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
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
  await page.locator('#preview-next').focus();
  await page.keyboard.press('ArrowRight');
  await set('preview-speed', '0.25');
  await click('preview-play');
  await wait("document.getElementById('preview-frame').textContent.includes('Frame 2 / 2')");
  await click('preview-play');
  await expect(page.locator('#preview-play')).toHaveText('Play');
  await click('preview-origin');
  await click('preview-origin');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await expect(page.locator('#selection-detail')).toHaveText(string(selectionBeforePlayback));
  assert.deepEqual(
    await evaluate("['undo','redo'].map(id=>document.getElementById(id).disabled)"),
    historyBeforePlayback,
  );
  assert.deepEqual(await scene(second), savedSprite);
  await evaluate("document.getElementById('animation-preview').scrollIntoView({block:'center'})");
  await page.screenshot({ path: testInfo.outputPath('standalone-animation-preview' + '.png') });
  await set('preview-animation', '');
  await expect(page.locator('#preview-play')).toBeDisabled();
  // Mappings are explicit, per asset, and independent of scene authoring history.
  await set('preview-action', 'idle');
  assert.match(
    string(await evaluate("document.getElementById('preview-mapping-status').textContent")),
    /No sequence mapped for idle \/ down/,
  );
  await expect(page.locator('#preview-animation')).toBeDisabled();
  await evaluate("document.getElementById('preview-mappings').open = true");
  await set('preview-map-idle-down', 'idle');
  await set('preview-map-walk-left', 'stride_west');
  await expect(page.locator('#preview-animation')).toHaveValue('idle');
  await set('preview-action', 'walk');
  await expect(page.locator('#preview-play')).toBeDisabled();
  await set('preview-direction', 'left');
  await expect(page.locator('#preview-animation')).toHaveValue('stride_west');
  assert.match(
    string(await evaluate("document.getElementById('preview-frame').textContent")),
    /Frame 1 \/ 1.*80 ms/,
  );
  await click('preview-play');
  await set('preview-direction', 'up');
  await expect(page.locator('#preview-play')).toBeDisabled();
  await set('preview-direction', 'left');
  await set('preview-map-walk-left', '');
  await expect(page.locator('#preview-play')).toBeDisabled();
  await set('preview-map-walk-left', 'stride_west');
  await evaluate("document.getElementById('preview-mappings').scrollIntoView({block:'center'})");
  await page.screenshot({ path: testInfo.outputPath('standalone-sequence-mappings' + '.png') });
  await set('preview-action', 'manual');
  await expect(page.locator('#preview-animation')).toBeEnabled();
  await expect(page.locator('#preview-animation')).toHaveValue('');
  await set('preview-animation', 'idle');
  await set('preview-action', 'walk');
  await set('preview-action', 'manual');
  await expect(page.locator('#preview-animation')).toHaveValue('idle');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
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
  await expect(page.locator('#preview-map-idle-down')).toHaveValue('idle');
  await expect(page.locator('#preview-map-walk-left')).toHaveValue('stride_west');
  await evaluate("document.getElementById('preview-mappings').open = false");
  await expect(page.locator('#dirty')).toHaveText('SAVED');
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
  await expect(page.locator('#preview-action')).toHaveValue('idle');
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
  await expect(page.locator('#preview-pause-movement')).toHaveText('Resume movement');
  await click('preview-pause-movement');
  await expect(page.locator('#preview-animation')).toHaveValue('stride_west');
  await wait(
    "document.getElementById('preview-position').textContent.includes('X 44.0, Y 40.0') && document.getElementById('preview-action').value === 'idle'",
  );
  await expect(page.locator('#preview-animation')).toHaveValue('idle');
  assert.notDeepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
    ),
    originalSpritePixel,
  );
  // Even with the placement brush active, scene gestures only focus movement controls.
  await (async () => {
    const point = await scenePoint(page, 48, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 48, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(await evaluate("document.getElementById('object-list').options.length"), 1);
  await page.locator('#scene').focus();
  await page.keyboard.down('ArrowLeft');
  await wait(
    "document.getElementById('preview-direction').value === 'left' && document.getElementById('preview-action').value === 'walk'",
  );
  await page.keyboard.up('ArrowLeft');
  await wait("document.getElementById('preview-action').value === 'idle'");
  await page.locator('#scene').focus();
  await page.keyboard.down('d');
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
  await page.screenshot({ path: testInfo.outputPath('standalone-movement-preview' + '.png') });
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
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await evaluate(
    "document.getElementById('save-preview-settings').scrollIntoView({block:'center'})",
  );
  await page.screenshot({ path: testInfo.outputPath('standalone-preview-settings' + '.png') });

  await click('preview-reset-position');
  assert.match(
    string(await evaluate("document.getElementById('preview-position').textContent")),
    /X 32.0, Y 24.0/,
  );
  await page.locator('#scene').focus();
  await page.keyboard.down('Escape');
  await expect(page.locator('#preview-movement')).not.toBeChecked();
  await expect(page.locator('#preview-action')).toHaveValue('manual');
  await expect(page.locator('#preview-animation')).toHaveValue('idle');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
    ),
    originalSpritePixel,
  );
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await expect(page.locator('#selection-detail')).toHaveText(string(selectionBeforePlayback));
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
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  if (process.env.FORGE_CAPTURE_EDITOR) {
    await cp(folder, '/tmp/forge-editor-layers', { recursive: true });
  }
});

test('layer and object history, metadata, export, navigation and moved-project restart', async ({
  page,
  workspace,
}, testInfo) => {
  test.setTimeout(180000);
  const { folder } = workspace;
  let url = '';
  const start = async (root: string, fixture = true, single = true, demo = false) => {
    url = await workspace.start(root, fixture, single, demo);
  };
  const stop = () => workspace.stop();
  async function catalog() {
    return record(await (await fetch(new URL('/api/project', url))).json());
  }
  async function scene(id: string) {
    const response = await fetch(new URL(`/api/scene/${id}`, url));
    const body = record(await response.json());
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  const evaluate = (expression: string) => page.evaluate(expression);
  const click = (id: string) => clickControl(page, id);
  const submit = async (id: string) => {
    const dialogs: Record<string, [string, string]> = {
      'scene-form': ['create-scene-dialog', 'show-create'],
      'import-form': ['import-atlas-dialog', 'library-import'],
    };
    const target = dialogs[id];
    if (target && !(await evaluate(`document.getElementById('${target[0]}').open`))) {
      await click(target[1]);
    }
    await page
      .locator(id === 'import-form' ? '#atlas-apply' : '#' + id + ' button.primary')
      .first()
      .click();
  };
  const wait = (expression: string) => waitForUI(page, expression);
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
  const set = (id: string, value: string) => setControl(page, id, value);

  const chooseLayer = async (id: string) =>
    page.locator(`#layers [data-layer-id="${id}"] .layer-choice`).first().click();
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
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import png
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
    result['reopened'] = {s['id']: project.scenes.load(s['id'])['scene'] for s in report['scenes']}
print(json.dumps(result))
`,
      zipPath,
      output,
    ]);
    return record(JSON.parse(stdout));
  }
  await cp('tests/playwright/support/fixtures/editor/project', join(folder, 'world'), {
    recursive: true,
  });
  await cp('tests/playwright/support/fixtures/editor/input', join(folder, 'input'), {
    recursive: true,
  });
  await cp('tests/playwright/support/fixtures/editor/sprites', join(folder, 'sprites'), {
    recursive: true,
  });
  await promisify(execFile)(workspace.python, [
    '-c',
    `
import sys, json
from gbc_scene_forge.project.application import Project
p = Project(sys.argv[1])
if sys.argv[2] == 'layers':
    manifest = p.root / 'forge.project.json'
    data = json.loads(manifest.read_text())
    data['preview']['sprite'] = json.loads(open('tests/playwright/support/fixtures/editor/layer-preview.json').read())
    manifest.write_text(json.dumps(data))
loaded = p.scenes.load(p.catalog()['project']['scenes'][1]['id'])
s = loaded['scene']
s['objects'] = []
s['next_object_id'] = 1
p.scenes.save(loaded['id'], s, loaded['revision'], p.catalog()['revision'])
`,
    join(folder, 'world'),
    'layers',
  ]);
  await start(join(folder, 'world'), false);
  await page.goto(url);
  await wait("document.getElementById('scenes')?.disabled === false");
  const entries = array(record((await catalog()).project).scenes, record);
  const first = string(entries[0].id),
    second = string(entries[1].id);
  const placed = array(record((await scene(first)).scene).objects, record);
  await chooseScene(second);
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').click();
  const position = await scenePoint(page, 32, 24);
  await page.mouse.click(position.x, position.y);
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  // Named layers render in order, edit independently, and retain history through Save.
  const spritePixel = await evaluate(
    "Array.from(document.getElementById('scene').getContext('2d').getImageData(30,9,1,1).data)",
  );
  await click('layer-tile');
  await set('layer-name', 'Canopy');
  await evaluate("document.getElementById('layer-name').dispatchEvent(new Event('change'))");
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 30, 9);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 30, 9);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
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
  await (async () => {
    const point = await scenePoint(page, 44, 25);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 44, 25);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#status')).toHaveText('Show the active layer before editing it.');
  await expect(page.locator('#layer-context-text')).toHaveText('Canopy is hidden');
  await click('context-show-layer');
  await expect(page.locator('#context-show-layer')).toHaveJSProperty('hidden', true);
  await click('undo');
  await expect(page.locator('#layer-context-text')).toHaveText('Canopy is hidden');
  await click('layer-object');
  await set('layer-name', 'Foreground actors');
  await evaluate("document.getElementById('layer-name').dispatchEvent(new Event('change'))");
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 48, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 48, 24);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('layer-remove');
  assert.equal(await evaluate("document.querySelectorAll('#layers input[type=radio]').length"), 3);
  await click('undo');
  await expect(page.locator('#layer-name')).toHaveValue('Foreground actors');
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
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await click('redo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('#layers .layer-name'), node => node.textContent)",
    ),
    ['Foreground actors', 'Canopy', 'Sprites', 'Ground'],
  );
  await evaluate("document.querySelector('#layers input:checked').focus()");
  for (const [key, , expected] of [
    ['ArrowDown', 40, 'Canopy'],
    ['ArrowUp', 38, 'Foreground actors'],
  ] as const) {
    await page.keyboard.down(key);
    await page.keyboard.up(key);
    await expect(page.locator('#layer-name')).toHaveValue(expected);
    assert.equal(
      await evaluate("document.activeElement === document.querySelector('#layers input:checked')"),
      true,
    );
  }
  await expect(page.locator('#layer-up')).toBeDisabled();
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
  await page.screenshot({ path: testInfo.outputPath('standalone-layers-long-name' + '.png') });
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
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
    await evaluate(`window.__layerCaptureReady=false;
      document.getElementById('layers').addEventListener('gotpointercapture',event=>{
        if(event.isTrusted && event.target===document.getElementById('layers')) {
          window.__layerCaptureReady=true;
        }
      },{once:true})`);
    await (async () => {
      await page.mouse.move(points[0], points[1]);
      await page.mouse.down();
    })();
    // setPointerCapture establishes a pending override. Flush native capture before
    // the large drag movement instead of racing native pointer event delivery.
    await page.mouse.move(points[0], points[1] + 1);
    await wait('window.__layerCaptureReady');
    await page.mouse.move(points[0], points[2]);
    // Input delivery can complete before the application processes its pointer event.
    await wait("document.getElementById('layers').dataset.dragging === 'true'");
    return points;
  };
  const dropLayer = async (points: number[]) => {
    await (async () => {
      await page.mouse.move(points[0], points[2]);
      await page.mouse.up();
    })();
    await wait("document.getElementById('layers').dataset.dragging !== 'true'");
  };
  let dragPoints = await startLayerDrag('1', '3');
  // Chrome can acknowledge a mouse move before delivering its pointer event.
  await wait("document.getElementById('layers').dataset.dragging === 'true'");
  assert.equal(
    await evaluate("document.querySelector('#layers [data-drop=before]').dataset.layerId"),
    '3',
  );
  await page.screenshot({ path: testInfo.outputPath('standalone-layer-drag' + '.png') });
  await dropLayer(dragPoints);
  assert.deepEqual(await layerOrder(), ['4', '1', '3', '2']);
  assert.equal(await evaluate("document.querySelector('#layers input:checked').value"), '4');
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await click('undo');
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await click('redo');
  assert.deepEqual(await layerOrder(), ['4', '1', '3', '2']);
  await click('undo');
  dragPoints = await startLayerDrag('4', '1', true);
  await dropLayer(dragPoints);
  assert.deepEqual(await layerOrder(), ['3', '2', '1', '4']);
  await click('undo');
  dragPoints = await startLayerDrag('1', '3');
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await dropLayer(dragPoints);
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  // Leaving the list cancels, and long stacks scroll under a captured pointer.
  dragPoints = await startLayerDrag('1', '3');
  const outsideX = number(
    await evaluate("document.getElementById('layers').getBoundingClientRect().left - 20"),
  );
  await (async () => {
    await page.mouse.move(outsideX, dragPoints[2]);
    await page.mouse.up();
  })();
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  await evaluate(
    "document.getElementById('layers').style.maxHeight='140px'; document.getElementById('layers').scrollTop=0",
  );
  dragPoints = await startLayerDrag('4', '3');
  const edgeY = number(
    await evaluate("document.getElementById('layers').getBoundingClientRect().bottom - 5"),
  );
  await page.mouse.move(dragPoints[0], edgeY);
  await wait("document.getElementById('layers').scrollTop > 0");
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await dropLayer(dragPoints);
  await evaluate(
    "document.getElementById('layers').style.maxHeight=''; document.getElementById('layers').scrollTop=0",
  );
  assert.deepEqual(await layerOrder(), ['4', '3', '2', '1']);
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await page.screenshot({ path: testInfo.outputPath('standalone-layers' + '.png') });
  // Visibility controls leave the active layer and its selected object unchanged.
  await page.locator('#layers [data-layer-id="4"] .layer-choice').first().click();
  await set('object-list', '2');
  const selectedNameBeforeToggle = await evaluate(
    "document.getElementById('selection-name').textContent",
  );
  await page.locator('#layers [data-layer-id="3"] .layer-eye').first().click();
  assert.equal(await evaluate("document.querySelector('#layers input:checked').value"), '4');
  await expect(page.locator('#selection-name')).toHaveText(string(selectedNameBeforeToggle));
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
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  // Fit stops at 1x for a tall scene, then adjusts when more space becomes available.
  await page.setViewportSize({ width: 980, height: 600 });
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
  await page.screenshot({ path: testInfo.outputPath('standalone-fit-scene' + '.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await wait(sceneFits);
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await set('zoom', '3');
  // Generic markers, areas, properties and per-instance sprite origins share layer history.
  await click('place-point');
  await (async () => {
    const point = await scenePoint(page, 16, 48);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 16, 48);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#selection-kind')).toHaveText('POINT');
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
  await page.screenshot({ path: testInfo.outputPath('standalone-selection-first' + '.png') });
  await click('edit-object');
  await wait("document.getElementById('object-dialog').open");
  await set('object-name', 'Discard me');
  await click('object-cancel');
  await expect(page.locator('#selection-name')).toHaveText('spawn');
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
  await page.locator('#object-properties .object-property:last-child button').first().click();
  await page.screenshot({ path: testInfo.outputPath('standalone-object-properties' + '.png') });
  await click('object-apply');
  await wait("!document.getElementById('object-dialog').open");
  await expect(page.locator('#selection-name')).toHaveText('Entrance');
  await click('undo');
  await expect(page.locator('#selection-name')).toHaveText('spawn');
  await click('redo');
  await expect(page.locator('#selection-name')).toHaveText('Entrance');
  await click('place-rectangle');
  await (async () => {
    const point = await scenePoint(page, 32, 56);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 32, 56);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('edit-object');
  await set('object-name', 'Exit');
  await set('object-class', 'door-trigger');
  await set('object-width', '16');
  await set('object-height', '24');
  await addProperty('destination', 'string', 'room-b');
  await click('object-apply');
  await page.locator('input[value=select]').first().click();
  await (async () => {
    const point = await scenePoint(page, 36, 60);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 44, 68);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 44, 68);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(
    await evaluate(
      "document.getElementById('selection-detail').textContent.includes('X 40, Y 64')",
    ),
    true,
  );
  await page.keyboard.press('ArrowUp');
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
  await (async () => {
    const point = await scenePoint(page, 8, 48);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 8, 48);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#status')).toHaveText('Show the active layer before editing it.');
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');

  // Shared tile metadata saves retain an unsaved scene and its undo history.
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 12, 98);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 12, 98);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
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
  await expect(page.locator('#tile-dialog')).toHaveJSProperty('open', true);
  await set('tile-points', '0,8 8,8 8,0');
  await evaluate("document.getElementById('tile-points').dispatchEvent(new Event('change'))");
  await click('tile-undo');
  assert.equal(await evaluate("document.getElementById('tile-shapes').options.length"), 2);
  await click('tile-redo');
  assert.equal(await evaluate("document.getElementById('tile-shapes').options.length"), 3);
  await page.screenshot({ path: testInfo.outputPath('standalone-tile-metadata' + '.png') });
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
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  // The collision overlay follows actual geometry and visible layers, independently of art.
  await (async () => {
    const point = await scenePoint(page, 12, 98);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 12, 98);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
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
  await page.screenshot({ path: testInfo.outputPath('standalone-collision-overlay' + '.png') });
  await click('layer-visible');
  assert.deepEqual(
    await evaluate(
      "Array.from(document.getElementById('scene').getContext('2d').getImageData(12,102,1,1).data)",
    ),
    [36, 40, 32, 255],
  );
  await click('undo');
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await click('terrain-overlay');
  await evaluate("document.getElementById('terrain-overlay').dispatchEvent(new Event('change'))");
  await click('collision-overlay');
  await evaluate("document.getElementById('collision-overlay').dispatchEvent(new Event('change'))");
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').first().click();
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
  await expect(page.locator('#export-canvas')).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('standalone-export' + '.png') });
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
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
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
  await expect(page.locator('#dirty')).toHaveText('SAVED');
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
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await click('undo');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await page.locator('[data-delete-atlas="terrain"]').first().click();
  await wait("document.getElementById('delete-atlas-dialog').open");
  await expect(page.locator('#delete-atlas-confirm')).toBeDisabled();
  assert.equal(
    await evaluate(
      "document.querySelector('#delete-atlas-form .form-error').textContent.includes('open scene uses')",
    ),
    true,
  );
  assert.equal(Object.keys(record(record((await catalog()).project).atlases)).length, 2);
  await click('delete-atlas-cancel');
  // Resume canvas shortcuts after the modal returns focus to its library trigger.
  await page.locator('#scene').focus();
  await page.keyboard.press('h');
  assert.equal(await evaluate("document.querySelector('input[value=pan]').checked"), true);
  await (async () => {
    const point = await scenePoint(page, 32, 120);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 32, 80);
    await page.mouse.move(point.x, point.y);
  })();
  await (async () => {
    const point = await scenePoint(page, 32, 80);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  assert.equal(await evaluate("document.getElementById('viewport').scrollTop > 0"), true);
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  // Mouse-operated controls release focus so canvas shortcuts work immediately.
  const pointerClick = async (expression: string) => {
    const point = array(
      await evaluate(`(() => {
      const control=${expression}; control.scrollIntoView({block:'nearest'});
      const rect=control.getBoundingClientRect(); return [rect.left+rect.width/2,rect.top+rect.height/2];
    })()`),
      number,
    );
    await (async () => {
      await page.mouse.move(point[0], point[1]);
      await page.mouse.down();
    })();
    await (async () => {
      await page.mouse.move(point[0], point[1]);
      await page.mouse.up();
    })();
  };
  await page.locator('#search').focus();
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
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await expect(page.locator('#layer-name')).toHaveValue(originalLayerName);
  assert.equal(await evaluate('document.activeElement.id'), 'scene');
  await page.locator('#search').focus();
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  assert.equal(await evaluate('document.activeElement.id'), 'scene');
  // Space pans the workspace temporarily without switching tools or authoring.
  await evaluate("document.getElementById('viewport').scrollTop=0");
  const spaceKey = async (type: string) =>
    type === 'keyDown' ? page.keyboard.down('Space') : page.keyboard.up('Space');
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
  await evaluate(`(() => {
    window.__panEvents=[];
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel',
      'gotpointercapture','lostpointercapture','blur','keyup','visibilitychange']) {
      window.addEventListener(type,event=>{
        const viewport=document.getElementById('viewport');
        window.__panEvents.push({type,target:event.target?.id, y:event.clientY,
          buttons:event.buttons,trusted:event.isTrusted,
          capture:event.pointerId===undefined?null:viewport.hasPointerCapture(event.pointerId),
          panning:viewport.dataset.panning,top:viewport.scrollTop,
          height:viewport.clientHeight,scrollHeight:viewport.scrollHeight});
        if(window.__panEvents.length>40)window.__panEvents.shift();
      },true);
    }
  })()`);
  await evaluate(`document.getElementById('viewport').addEventListener('pointerdown',
    event => {window.__activePanPointer = event.pointerId}, {capture:true, once:true})`);
  await evaluate(`window.__panCaptureReady=false;
    document.getElementById('viewport').addEventListener('gotpointercapture',event=>{
      if(event.isTrusted && event.target===document.getElementById('viewport')) {
        window.__panCaptureReady=true;
      }
    },{once:true})`);
  await (async () => {
    await page.mouse.move(panPoint[0], panPoint[1]);
    await page.mouse.down();
  })();
  assert.equal(
    await evaluate("getComputedStyle(document.getElementById('viewport')).cursor"),
    'grabbing',
  );
  // Wait for the native transfer before injecting a delayed child-capture loss.
  // A pending setPointerCapture override is not a delivered gotpointercapture event.
  await page.mouse.move(panPoint[0], panPoint[1] + 1);
  await wait('window.__panCaptureReady');
  // A delayed loss from the canvas's prior capture must not cancel viewport ownership.
  // Preserve the active mouse's button state in the simulated capture transfer.
  await evaluate(`document.getElementById('scene').dispatchEvent(new PointerEvent(
    'lostpointercapture', {pointerId:window.__activePanPointer,bubbles:true,
      pointerType:'mouse',isPrimary:true,buttons:1}))`);
  assert.equal(
    await evaluate("getComputedStyle(document.getElementById('viewport')).cursor"),
    'grabbing',
    'Losing a child canvas capture must preserve the active viewport pan',
  );
  await page.mouse.move(panPoint[0], panPoint[1] - 60);
  // Chrome may acknowledge the mouse move before delivering its pointer event.
  // Keep the drag active until the viewport has processed it.
  try {
    await wait("document.getElementById('viewport').scrollTop > 0");
  } catch (error) {
    throw Error(
      `${String(error)}; pan events: ${JSON.stringify(await evaluate('window.__panEvents'))}`,
      { cause: error },
    );
  }
  // Releasing Space mid-drag must not turn the remaining gesture into painting.
  await spaceKey('keyUp');
  assert.equal(
    await evaluate("getComputedStyle(document.getElementById('scene')).cursor"),
    'crosshair',
  );
  await page.mouse.move(panPoint[0] + 50, panPoint[1] - 80);
  await (async () => {
    await page.mouse.move(panPoint[0] + 50, panPoint[1] - 80);
    await page.mouse.up();
  })();
  assert.deepEqual(
    await evaluate(
      "[document.getElementById('dirty').textContent, document.getElementById('undo').disabled, document.getElementById('redo').disabled]",
    ),
    navigationState,
  );
  await page.locator('#scene').focus();
  await spaceKey('keyDown');
  await evaluate("window.dispatchEvent(new Event('blur'))");
  assert.equal(await evaluate("document.getElementById('viewport').dataset.pan"), 'false');
  await spaceKey('keyUp');
  await page.locator('#search').focus();
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
    (async () => {
      await page.mouse.move(wheelPoint[0], wheelPoint[1]);
      await page.mouse.wheel(0, deltaY);
    })();
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
  await expect(page.locator('#zoom')).toHaveValue('1');
  assert.equal(
    await evaluate(
      "Array.from(document.getElementById('zoom').options).every(option => !option.textContent.includes('%') && (option.value === 'fit' || Number(option.value) >= 1))",
    ),
    true,
  );
  await set('zoom', '8');
  await wheel(-100);
  await expect(page.locator('#zoom')).toHaveValue('8');
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
  await click('library-import');
  await set('atlas-path', join(folder, 'input/terrain.atlas.json'));
  await evaluate("document.getElementById('reimport').checked=true");
  await submit('import-form');
  await wait("document.getElementById('status')?.textContent.includes('Atlas imported')");
  assert.equal(
    array(record((await scene(first)).scene).cells, (row) => array(row, string))[1][1],
    'terrain/earth/0/0',
  );
  await page.screenshot({ path: testInfo.outputPath('standalone-project' + '.png') });
  await page.setViewportSize({ width: 980, height: 760 });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  assert.equal(await evaluate("document.getElementById('viewport').clientHeight > 200"), true);
  await checkBuildLabel();
  await page.screenshot({ path: testInfo.outputPath('standalone-compact' + '.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Restart and move the entire project; import inputs are no longer available.
  await stop();
  await rename(join(folder, 'world'), join(folder, 'moved'));
  await rm(join(folder, 'input'), { recursive: true, force: true });
  await rm(join(folder, 'sprites'), { recursive: true, force: true });
  // Launch the production CLI, rather than recreating input assets through the fixture.
  const movedRoot = join(folder, 'moved');
  await start(movedRoot, false);
  await page.goto(url);
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
  await expect(page.locator('#object-name')).toHaveValue('Entrance');
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
  await expect(page.locator('#preview-map-walk-left')).toHaveValue('stride_west');
  await expect(page.locator('#preview-speed')).toHaveValue('2');
  await expect(page.locator('#preview-move-speed')).toHaveValue('64');
  await expect(page.locator('#preview-footprint-width')).toHaveValue('6');
  await expect(page.locator('#preview-check-collision')).toBeChecked();
  await expect(page.locator('#preview-origin')).toBeChecked();
  await expect(page.locator('#preview-movement')).not.toBeChecked();
  await expect(page.locator('#preview-play')).toHaveText('Play');
  await expect(page.locator('#preview-action')).toHaveValue('manual');
  await expect(page.locator('#preview-animation')).toHaveValue('idle');
  assert.match(
    string(await evaluate("document.getElementById('preview-frame').textContent")),
    /Frame 1 \/ 2/,
  );
  // These cases deliberately exercise stale revisions. Clean automatic adoption
  // is covered by refresh.spec.ts and must not race the injected disk edits.
  await click('auto-refresh');
  await expect(page.locator('#auto-refresh')).not.toBeChecked();
  await page.keyboard.press('Escape');
  const previewManifest = join(movedRoot, 'forge.project.json');
  const beforePreviewConflict = await readFile(previewManifest, 'utf8');
  await writeFile(previewManifest, beforePreviewConflict + '\n');
  await set('preview-speed', '0.5');
  await click('save-preview-settings');
  await wait("document.getElementById('status').textContent.includes('Project changed on disk')");
  await expect(page.locator('#preview-speed')).toHaveValue('0.5');
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  assert.equal(await readFile(previewManifest, 'utf8'), beforePreviewConflict + '\n');
  await writeFile(previewManifest, beforePreviewConflict);
  await set('preview-speed', '2');
  await chooseLayer('1');
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
  const mapPath = join(movedRoot, 'scenes', `${first}.tmj`);
  const before = await readFile(mapPath, 'utf8');
  // Establish the unsaved canvas before invalidating its saved-file revision.
  await (async () => {
    const point = await scenePoint(page, 20, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 20, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await writeFile(mapPath, before + '\n');
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
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await page.screenshot({ path: testInfo.outputPath('standalone-conflict' + '.png') });
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  await expect(page.locator('#delete-scene-unsaved')).toHaveJSProperty('hidden', false);
  await click('delete-scene-cancel');
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
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
  await expect(page.locator('#scenes')).toHaveValue(first);
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  assert.equal(await readFile(mapPath, 'utf8'), before + '\n');
  await click('scene-switch-cancel');
  // Restore the external test edit, then explicitly delete the dirty scene.
  await writeFile(mapPath, before);
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  await page.screenshot({ path: testInfo.outputPath('standalone-delete-scene' + '.png') });
  await click('delete-scene-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted “Village”')");
  await expect(page.locator('#dirty')).toHaveText('NO SCENE');
  await expect(page.locator('#scene')).toHaveJSProperty('hidden', true);
  await expect(page.locator('#undo')).toBeDisabled();
  assert.equal(array(record((await catalog()).project).scenes, record).length, 1);
  await chooseScene(second);
  await click('show-delete');
  await wait("document.getElementById('delete-scene-dialog').open");
  await click('delete-scene-confirm');
  await wait("document.getElementById('status').textContent.includes('Deleted “River”')");
  await expect(page.locator('#dirty')).toHaveText('NO SCENE');
  await expect(page.locator('#scene')).toHaveJSProperty('hidden', true);
  assert.equal(array(record((await catalog()).project).scenes, record).length, 0);
  assert.equal(Object.keys(record(record((await catalog()).project).atlases)).length, 2);
  await assert.rejects(readFile(mapPath), { code: 'ENOENT' });
  for (const id of ['actors', 'terrain']) {
    await page.locator(`[data-delete-atlas="${id}"]`).first().click();
    await wait("document.getElementById('delete-atlas-dialog').open");
    await click('delete-atlas-confirm');
    await wait(`document.getElementById('status').textContent.includes('Deleted atlas “${id}”')`);
  }
  assert.deepEqual(record(record((await catalog()).project).atlases), {});
  await expect(page.locator('#asset-count')).toHaveText('0 / 0');
});

test('demo artwork matches Aseprite exports', async ({ page, workspace }, testInfo) => {
  test.setTimeout(180000);
  const { folder } = workspace;
  let url = '';
  const start = async (root: string, fixture = true, single = true, demo = false) => {
    url = await workspace.start(root, fixture, single, demo);
  };
  const stop = () => workspace.stop();
  async function catalog() {
    return record(await (await fetch(new URL('/api/project', url))).json());
  }

  const evaluate = (expression: string) => page.evaluate(expression);
  const click = (id: string) => clickControl(page, id);

  const wait = (expression: string) => waitForUI(page, expression);

  const set = (id: string, value: string) => setControl(page, id, value);

  const chooseScene = async (id: string) => {
    await wait("document.getElementById('scenes')?.disabled === false");
    await set('scenes', id);
    await wait(
      `document.getElementById('scenes')?.value === ${JSON.stringify(id)} && document.getElementById('scenes')?.disabled === false`,
    );
  };

  // Exercise the actual demo entry point and compare its artwork with Aseprite exports.
  await stop();
  await start(join(folder, 'demo'), false, true, true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
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
from gbc_scene_forge.artwork import png
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
    await page.screenshot({ path: testInfo.outputPath(`demo-${name}` + '.png') });
  }
});

test('palette and hardware budgets, stale reports and profile saves', async ({
  page,
  workspace,
}, testInfo) => {
  test.setTimeout(180000);
  const { folder } = workspace;
  let url = '';
  const start = async (root: string, fixture = true, single = true, demo = false) => {
    url = await workspace.start(root, fixture, single, demo);
  };
  const stop = () => workspace.stop();
  async function catalog() {
    return record(await (await fetch(new URL('/api/project', url))).json());
  }

  const evaluate = (expression: string) => page.evaluate(expression);
  const click = (id: string) => clickControl(page, id);
  const submit = async (id: string) => {
    const dialogs: Record<string, [string, string]> = {
      'scene-form': ['create-scene-dialog', 'show-create'],
      'import-form': ['import-atlas-dialog', 'library-import'],
    };
    const target = dialogs[id];
    if (target && !(await evaluate(`document.getElementById('${target[0]}').open`))) {
      await click(target[1]);
    }
    await page
      .locator(id === 'import-form' ? '#atlas-apply' : '#' + id + ' button.primary')
      .first()
      .click();
  };
  const wait = (expression: string) => waitForUI(page, expression);

  const set = (id: string, value: string) => setControl(page, id, value);

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

  // Use the published atlas conformance bundles in the real standalone editor.
  await stop();
  const paletteRoot = join(folder, 'palette-examples');
  await promisify(execFile)('.venv/bin/python', [
    'tests/support/prepare_palette_fixture.py',
    '--root',
    paletteRoot,
  ]);
  await start(paletteRoot, false);
  await page.goto(url);
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
  await page.screenshot({ path: testInfo.outputPath('palette-preflight-passing' + '.png') });
  await page.setViewportSize({ width: 980, height: 760 });
  assert.equal(
    await evaluate(`(() => {
    const rect = document.getElementById('palette-dialog').getBoundingClientRect();
    const actions = document.getElementById('palette-preflight').getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && actions.bottom <= innerHeight;
  })()`),
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('palette-preflight-compact' + '.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await set('palette-bg-reserved', '1');
  await expect(page.locator('#palette-preflight')).toBeDisabled();
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
  await page.locator('#palette-findings details summary').first().click();
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
  await page.locator('#palette-findings .palette-contributor').first().click();
  await wait("!document.getElementById('palette-dialog').open");
  assert.equal(
    await evaluate(
      "document.getElementById('status').textContent.startsWith('Palette contributor:')",
    ),
    true,
  );
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  const paletteIndicatorWidth = await evaluate(
    "document.getElementById('show-palettes').getBoundingClientRect().width",
  );
  await click('artwork-tab');
  await page.locator('[data-asset="reordered/swapped"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 4, 20);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 4, 20);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await wait("document.getElementById('show-palettes').dataset.state === 'fail'");
  assert.equal(
    await evaluate("document.getElementById('show-palettes').getBoundingClientRect().width"),
    paletteIndicatorWidth,
  );
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
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
  await page.screenshot({ path: testInfo.outputPath('palette-preflight-over-budget' + '.png') });
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
  await page.reload();
  await wait(
    "window.__paletteReloadMarker !== true && document.getElementById('project-name')?.textContent === 'GBC palette examples' && document.getElementById('status')?.textContent === 'Scene opened.' && document.getElementById('scenes')?.disabled === false",
  );
  await chooseScene(passingPaletteScene);
  await wait("document.getElementById('show-palettes').dataset.state === 'pass'");
  // Exercise stale-report guards with automatic snapshot adoption disabled.
  // With refresh enabled, this harmless manifest rewrite is adopted and the
  // palette report legitimately returns to passing instead of staying stale.
  await click('project-commands');
  await click('auto-refresh');
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
  // Versioned hardware estimates reuse guarded profile save and contributor navigation.
  await page.locator('#hardware-settings summary').first().click();
  await click('hardware-enabled');
  await set('hardware-bg_tiles-reserved', '0');
  await set('hardware-obj_tiles-reserved', '0');
  await set('hardware-oam-reserved', '39');
  await expect(page.locator('#palette-preflight')).toBeDisabled();
  await click('palette-save-profile');
  await wait(
    "document.getElementById('palette-findings').textContent.includes('OAM entries: 2 estimated / 1 available · over-estimate')",
  );
  assert.equal(
    await evaluate("document.getElementById('palette-summary').dataset.state"),
    'unverified',
  );
  assert.equal(record(record((await catalog()).project).gbc_palette_profile).version, 2);
  await click('palette-preflight');
  await wait(
    "document.getElementById('palette-summary').textContent === 'GBC budget preflight unverified.'",
  );
  await page.screenshot({ path: testInfo.outputPath('gbc-target-budgets' + '.png') });
  await page.setViewportSize({ width: 1024, height: 768 });
  assert.equal(
    await evaluate(`(() => {
    const dialog = document.getElementById('palette-dialog').getBoundingClientRect();
    const close = document.getElementById('palette-close').getBoundingClientRect();
    return close.bottom <= dialog.bottom && dialog.bottom <= innerHeight;
  })()`),
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('gbc-target-budgets-compact' + '.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#palette-findings details summary').first().click();
  await wait("document.querySelector('#palette-findings .palette-contributor') !== null");
  await page.locator('#palette-findings .palette-contributor').first().click();
  await wait("!document.getElementById('palette-dialog').open");
  await click('show-palettes');
  await click('hardware-enabled');
  await click('palette-save-profile');
  await wait("document.getElementById('palette-summary').dataset.state === 'pass'");
  assert.equal(record(record((await catalog()).project).gbc_palette_profile).version, 1);
  await click('palette-enabled');
  await click('palette-save-profile');
  await wait(
    "document.getElementById('palette-summary').textContent === 'GBC palette checks are off.'",
  );
  await expect(page.locator('#palette-preflight')).toBeDisabled();
  await click('palette-close');
});
