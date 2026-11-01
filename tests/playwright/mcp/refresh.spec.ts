import { expect } from '@playwright/test';
/** Saved-file refresh with a real stdio MCP writer and protected browser edits. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { array, record, string } from '../../../frontend/shared/decode.mts';

import {
  clickControl,
  scenePoint,
  setControl,
  test,
  waitForUI,
} from '../support/browser-fixtures.ts';
test('refresh: Saved-file refresh with a real stdio MCP writer and protected browser edits.', async ({
  page,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  const python = process.env.FORGE_MCP_PYTHON || '.venv/bin/python';
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
  const serverUrl = await workspace.start(join(folder, 'projects'), false, false);
  const url = new URL(`projects/${root.split('/').at(-1)}/`, serverUrl).href;
  const catalog = async () => record(await (await fetch(new URL('api/project', url))).json());
  const saved = async () => record(await (await fetch(new URL(`api/scene/${id}`, url))).json());
  const objects = (scene: unknown) =>
    array(record(scene).layers, record).flatMap((layer) => array(layer.objects ?? [], record));
  const original = await saved();
  assert.equal(objects(original.scene).length, 22);
  assert.deepEqual(record((await catalog()).project).atlases, {});
  await page.setViewportSize({ width: 1440, height: 1100 });
  const evaluate = (expression: string) => page.evaluate(expression),
    wait = (expression: string) => waitForUI(page, expression);
  const click = (name: string) => clickControl(page, name);
  const set = async (name: string, value: string) => setControl(page, name, value);
  await page.goto(url);
  await wait(
    "document.getElementById('status')?.textContent==='Choose a scene, or import an atlas and create one.' && !document.getElementById('scenes').disabled",
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
    const child = spawn(python, ['tests/support/mcp_call.py', root, name], {
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
  await expect(page.locator('#undo')).toBeEnabled();
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
  await expect(page.locator('#zoom')).toHaveValue('4');
  assert.deepEqual(
    await evaluate(
      "[document.getElementById('viewport').scrollLeft,document.getElementById('viewport').scrollTop]",
    ),
    scroll,
  );
  await expect(page.locator('#undo')).toBeDisabled();
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
  await agent('create_scene', {
    project_revision: (await catalog()).revision,
    name: 'Discovered while dirty',
    width: 20,
    height: 18,
    grid: 8,
  });
  await tick();
  await wait("document.getElementById('scenes').textContent.includes('Discovered while dirty')");
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await evaluate('window.__probeCount'), 0);
  await expect(page.locator('#scenes')).toHaveValue(id);
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await expect(page.locator('#undo')).toBeEnabled();
  await click('save');
  await wait("document.getElementById('status').textContent.includes('changed')");
  assert.equal(objects((await saved()).scene).find((item) => item.id === 1)?.x, 24);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await page.locator('#discard-dialog button[value=discard]').first().click();
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
  // The real MCP upload shares the browser importer and refresh inventory.
  const { stdout: atlasUpload } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    "import base64,json,sys;from pathlib import Path;sys.path.insert(0,'tests');from support.atlas_fixture import bundle;p,_=bundle(Path(sys.argv[1]));print(json.dumps(dict(name=p.name,manifest=p.read_text(),png=base64.b64encode((p.parent/'atlas.png').read_bytes()).decode())))",
    join(folder, 'external-art'),
  ]);
  const upload = record(JSON.parse(atlasUpload));
  await agent('import_atlas', {
    project_revision: (await catalog()).revision,
    bundle: upload,
    dry_run: true,
  });
  await agent('import_atlas', {
    project_revision: (await catalog()).revision,
    bundle: upload,
  });
  await tick();
  await wait('document.querySelector(\'#palette [data-asset="terrain/earth"]\')!==null');
  await inspectCamera(72);
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await page.screenshot({ path: testInfo.outputPath('external-refresh' + '.png') });
  await evaluate("document.getElementById('project-command-panel').hidePopover()");
  console.log('Refresh: preserve tools and the chosen artwork brush');
  await click('artwork-tab');
  await page.locator('#palette [data-asset="terrain/stone"]').first().click();
  const mode = () =>
    evaluate(`({
    tool:document.querySelector('input[name="tool"]:checked')?.value,
    asset:document.querySelector('#palette [aria-pressed="true"]')?.dataset.asset ?? null,
    label:document.getElementById('selected-brush').textContent,
    layer:document.querySelector('#layers input:checked')?.value,
    preset:document.querySelector('#blockout-presets [aria-pressed="true"]')?.dataset.definition ?? null,
    point:document.getElementById('place-point').getAttribute('aria-pressed'),
    stamp:document.getElementById('place-stamp').getAttribute('aria-pressed'),
  })`);
  for (const [index, tool] of ['select', 'erase', 'fill', 'pan'].entries()) {
    await page.locator(`input[name="tool"][value="${tool}"]`).first().click();
    const before = await mode();
    await moveCamera(73 + index);
    await tick();
    await wait("document.getElementById('status').textContent.includes('External changes loaded')");
    assert.deepEqual(await mode(), before);
  }
  await set('zoom', '1');
  await evaluate(
    "document.getElementById('viewport').scrollTo(0,0);document.activeElement?.blur()",
  );
  await page.locator('input[name="tool"][value="select"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 8, 8);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 8, 8);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  // The retained brush must still paint stone when the author explicitly selects Paint.
  await page.locator('input[name="tool"][value="paint"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 8, 8);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 8, 8);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await wait("document.getElementById('dirty').textContent==='UNSAVED'");
  await click('save');
  await wait("document.getElementById('status').textContent==='Scene saved.'");
  const painted = array(record((await saved()).scene).layers, record).find(
    (l) => l.type === 'tilelayer',
  );
  assert.equal(array(array(painted?.cells, (row) => row)[1], string)[1], 'terrain/stone/0/0');
  const beforeReimport = await saved();
  await agent('import_atlas', {
    project_revision: (await catalog()).revision,
    bundle: upload,
    reimport: true,
  });
  await tick();
  assert.deepEqual((await saved()).scene, beforeReimport.scene);
  const artwork = await agent('review_artwork', {
    project_revision: (await catalog()).revision,
    scene_id: id,
    scene_revision: (await saved()).revision,
  });
  assert.equal(record(artwork.camera_resource).mimeType, 'image/png');
  // Delete an unused atlas while its brush is active. Never select a substitute.
  await promisify(execFile)('.venv/bin/python', [
    '-c',
    "import sys;from pathlib import Path;sys.path.insert(0,'tests');from support.atlas_fixture import bundle;from gbc_scene_forge.project.application import Project;p,_=bundle(Path(sys.argv[2]),'spare');w=Project(sys.argv[1]);w.artwork.import_atlas(p,w.catalog()['revision'])",
    root,
    join(folder, 'spare-art'),
  ]);
  await tick();
  await wait('document.querySelector(\'#palette [data-asset="spare/earth"]\')!==null');
  await click('artwork-tab');
  await page.locator('#palette [data-asset="spare/earth"]').first().click();
  await evaluate("document.getElementById('status').textContent=''");
  await post('delete-atlas', {
    id: 'spare',
    project_revision: (await catalog()).revision,
    scene: { id, revision: (await saved()).revision },
  });
  await tick();
  await wait("document.getElementById('status').textContent.includes('External changes loaded')");
  assert.equal(
    await evaluate('document.querySelector(\'#palette [aria-pressed="true"]\')===null'),
    true,
  );
  await expect(page.locator('#selected-brush')).toHaveText('Select a brush');
  await (async () => {
    const point = await scenePoint(page, 16, 8);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 16, 8);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  // Generic object placement and shared presets retain their mode without selecting artwork.
  for (const [index, choose] of [
    '#place-point',
    '#blockout-presets button[data-definition]',
  ].entries()) {
    await click(index === 0 ? 'objects-tab' : 'blockout-tab');
    await page.locator(choose).first().click();
    const before = await mode();
    await moveCamera(77 + index);
    await tick();
    await wait("document.getElementById('status').textContent.includes('External changes loaded')");
    assert.deepEqual(await mode(), before);
  }
  const stampScene = record((await saved()).scene);
  await agent('save_stamp', {
    name: 'Refresh stamp',
    scene: stampScene,
    slots: array(stampScene.layers, () => 0),
    project_revision: (await catalog()).revision,
  });
  await tick();
  await wait("document.getElementById('stamps').textContent.includes('Refresh stamp')");
  await click('stamps-tab');
  await page.locator('#stamps').selectOption({ index: 1 });
  await click('place-stamp');
  const stampMode = await mode();
  await moveCamera(79);
  await tick();
  await wait("document.getElementById('status').textContent.includes('External changes loaded')");
  assert.deepEqual(await mode(), stampMode);
  await click('place-stamp');
  await inspectCamera(79);
  console.log('Refresh: automatic and manual adoption during sprite animation');
  const { stdout: spriteOutput } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    "import json,sys;from pathlib import Path;sys.path.insert(0,'tests');from support.atlas_fixture import sprite_bundle;from support.project_busy import retry_busy;from gbc_scene_forge.project.application import Project;p,m=sprite_bundle(Path(sys.argv[2]));m['animations'][0]['frames']=[dict(region='idle',duration_ms=120),dict(region='idle',duration_ms=240)];p.write_text(json.dumps(m));w=Project(sys.argv[1]);revision=retry_busy(w.catalog)['revision'];retry_busy(lambda:w.artwork.import_atlas(p,revision));s=retry_busy(lambda:w.scenes.load(sys.argv[3]));i=s['scene']['next_object_id'];l=next(l for l in s['scene']['layers'] if l['name']=='Camera guides');l['objects'].append(dict(id=i,asset='actors/idle',x=80,y=80));s['scene']['next_object_id']=i+1;revision=retry_busy(w.catalog)['revision'];retry_busy(lambda:w.scenes.save(s['id'],s['scene'],s['revision'],revision));print(i)",
    root,
    join(folder, 'animated-art'),
    id,
  ]);
  const spriteId = spriteOutput.trim();
  await tick();
  await wait(`document.querySelector('#object-list option[value="${spriteId}"]')!==null`);
  await click('artwork-tab');
  await page.locator('#palette [data-asset="actors/idle"]').first().click();
  await inspectCamera(79);
  for (const manual of [false, true]) {
    if (manual) {
      await evaluate("document.getElementById('project-command-panel').showPopover()");
      await click('auto-refresh');
    }
    await set('object-list', spriteId);
    await set('preview-animation', 'idle');
    await set('preview-speed', '1');
    await click('preview-play');
    await wait("document.getElementById('preview-play').textContent==='Pause'");
    // Make every snapshot span real animation frames, so replacing the loaded
    // display object cannot masquerade as a scene switch or an authored edit.
    await evaluate(`window.__animatedSnapshots=0;window.fetch=async(...args)=>{
      const response=await window.__realFetch(...args);
      if(String(args[0]).includes('/api/snapshot')){
        await new Promise((resolve,reject)=>{
          const detail=document.getElementById('preview-frame');
          let previous=detail.textContent, frames=0;
          const timeout=setTimeout(()=>{observer.disconnect();reject(Error('Animation stopped before snapshot completed'))},5000);
          const observer=new MutationObserver(()=>{
            if(detail.textContent!==previous){previous=detail.textContent;frames++;}
            if(frames>=2){clearTimeout(timeout);observer.disconnect();resolve();}
          });
          observer.observe(detail,{childList:true,subtree:true,characterData:true});
        });
        window.__animatedSnapshots++;
      }
      return response;
    }`);
    const x = manual ? 88 : 80;
    await moveCamera(x);
    if (manual) {
      await evaluate("document.getElementById('project-command-panel').showPopover()");
      await click('check-external');
    } else {
      await tick();
    }
    await wait("document.getElementById('status').textContent.includes('External changes loaded')");
    assert.ok(Number(await evaluate('window.__animatedSnapshots')) >= 1);
    assert.equal(record(await mode()).asset, 'actors/idle');
    assert.equal(record(await mode()).tool, 'select');
    await evaluate('window.fetch=window.__realFetch');
    await expect(page.locator('#dirty')).toHaveText('SAVED');
    await inspectCamera(x);
  }
  // Restore automatic refresh for the inventory/deletion checks below.
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await click('auto-refresh');
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
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#canvas-surround')).toHaveJSProperty('hidden', true);
  await evaluate("document.getElementById('project-command-panel').showPopover()");
  await page.screenshot({ path: testInfo.outputPath('external-scene-deleted' + '.png') });

  console.log(
    'Refresh browser passed: real MCP saves, view preservation, forms, paused dirty polling, save conflicts, manual checks, in-flight edits, animated sprites, reconnect, inventories and deletion.',
  );
});
