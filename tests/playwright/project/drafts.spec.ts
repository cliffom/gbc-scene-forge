import { expect } from '@playwright/test';
/** Unsaved work survives a lost browser, server restart and project move. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { array, record, string } from '../../../frontend/shared/decode.mts';
import { clickControl, scenePoint, test, waitForUI } from '../support/browser-fixtures.ts';

test('independent tabs, crash, restart, move, restore and revert', async ({
  page,
  context,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  let root = join(folder, 'world');
  let url = '';
  const start = async () => {
    url = await workspace.start(root);
  };
  const stop = () => workspace.stop();
  async function post(route: string, data: unknown = {}) {
    const catalog = record(await (await fetch(new URL('api/project', url))).json());
    const response = await fetch(new URL(`api/${route}`, url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scene-Token': string(catalog.token) },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return record(await response.json());
  }
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
sys.path.insert(0, 'tests')
from support.atlas_fixture import bundle, sprite_bundle
from gbc_scene_forge.project.application import Project
root = Path(sys.argv[1])
p = Project.create(root, 'Draft recovery example')
for source in (bundle(root.parent / 'art')[0], sprite_bundle(root.parent / 'actors')[0]):
    p.artwork.import_atlas(source, p.catalog()['revision'])
a = p.scenes.create('Room', 12, 10, 8, p.catalog()['revision'])
b = p.scenes.create('Other room', 12, 10, 8, p.catalog()['revision'])
print(json.dumps({'first': a['id'], 'second': b['id']}))
`,
    root,
  ]);
  const ids = record(JSON.parse(stdout));
  const first = string(ids.first);
  await start();
  const evaluate = (expression: string) => page.evaluate(expression);
  const wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  async function newTab() {
    page = await context.newPage();
    await page.goto(url);
    await wait(
      "document.getElementById('project-name')?.textContent === 'Draft recovery example' && document.getElementById('scenes')?.disabled === false",
    );
    return page;
  }
  async function chooseScene(id = first) {
    await page.locator('#scenes').selectOption(id);
    await wait(
      `document.getElementById('scenes').value === ${JSON.stringify(id)} && document.getElementById('show-create').disabled === false`,
    );
  }
  async function paint(x = 4, y = 4) {
    await evaluate("document.getElementById('draft-status').textContent = ''");
    await click('artwork-tab');
    await page.locator('[data-asset="terrain/earth"]').first().click();
    await (async () => {
      const point = await scenePoint(page, x, y);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
    })();
    await (async () => {
      const point = await scenePoint(page, x, y);
      await page.mouse.move(point.x, point.y);
      await page.mouse.up();
    })();
    await wait("document.getElementById('draft-status').textContent === 'Draft checkpoint saved'");
  }
  console.log('Draft browser: creating two independent tab checkpoints');
  const firstTarget = await newTab();
  await chooseScene();
  await paint();
  const original = await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8');
  let drafts = array((await post('list-drafts')).drafts, record);
  assert.equal(drafts.length, 1);
  const sourceDraft = drafts[0];
  // Another tab sees the first tab's draft but owns a separate checkpoint.
  const secondTarget = await newTab();
  await wait("document.getElementById('recovery-dialog').open");
  await click('recovery-later');
  await chooseScene();
  await wait("document.getElementById('recovery-dialog').open");
  await click('recovery-later');
  await paint(20, 20);
  drafts = array((await post('list-drafts')).drafts, record);
  assert.equal(drafts.length, 2);
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  drafts = array((await post('list-drafts')).drafts, record);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, sourceDraft.id);
  // Restore the base bytes so the first tab's saved-revision guard matches again.
  await writeFile(join(root, 'scenes', `${first}.tmj`), original);
  // Lose both browser targets without running page unload/cleanup handlers.
  await secondTarget.close();
  await firstTarget.close();
  console.log('Draft browser: restarting after closing tabs');
  await stop();
  const moved = join(folder, 'moved-world');
  await rename(root, moved);
  root = moved;
  await start();
  await newTab();
  await wait("document.getElementById('recovery-dialog').open");
  await page.screenshot({ path: testInfo.outputPath('draft-recovery' + '.png') });
  await click('recovery-restore');
  await wait("document.getElementById('status').textContent.includes('Draft restored')");
  assert.equal(await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8'), original);
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  // Revert must return to committed content rather than reopen the recovered draft.
  console.log('Draft browser: checking recovered Revert and write retries');
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await page.locator('#discard-dialog button[value=discard]').first().click();
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
});

test('checkpoint deletion, lost acknowledgements, retry, reload/save and transient preview', async ({
  page,
  context,
  workspace,
}) => {
  const { folder } = workspace;
  const root = join(folder, 'world');
  let url = '';
  const start = async () => {
    url = await workspace.start(root);
  };

  async function post(route: string, data: unknown = {}) {
    const catalog = record(await (await fetch(new URL('api/project', url))).json());
    const response = await fetch(new URL(`api/${route}`, url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scene-Token': string(catalog.token) },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return record(await response.json());
  }
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
sys.path.insert(0, 'tests')
from support.atlas_fixture import bundle, sprite_bundle
from gbc_scene_forge.project.application import Project
root = Path(sys.argv[1])
p = Project.create(root, 'Draft recovery example')
for source in (bundle(root.parent / 'art')[0], sprite_bundle(root.parent / 'actors')[0]):
    p.artwork.import_atlas(source, p.catalog()['revision'])
a = p.scenes.create('Room', 12, 10, 8, p.catalog()['revision'])
b = p.scenes.create('Other room', 12, 10, 8, p.catalog()['revision'])
print(json.dumps({'first': a['id'], 'second': b['id']}))
`,
    root,
  ]);
  const ids = record(JSON.parse(stdout));
  const first = string(ids.first);
  await start();
  const evaluate = (expression: string) => page.evaluate(expression);
  const wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  async function newTab() {
    page = await context.newPage();
    await page.goto(url);
    await wait(
      "document.getElementById('project-name')?.textContent === 'Draft recovery example' && document.getElementById('scenes')?.disabled === false",
    );
    return page;
  }
  async function chooseScene(id = first) {
    await page.locator('#scenes').selectOption(id);
    await wait(
      `document.getElementById('scenes').value === ${JSON.stringify(id)} && document.getElementById('show-create').disabled === false`,
    );
  }
  async function paint(x = 4, y = 4) {
    await evaluate("document.getElementById('draft-status').textContent = ''");
    await click('artwork-tab');
    await page.locator('[data-asset="terrain/earth"]').first().click();
    await (async () => {
      const point = await scenePoint(page, x, y);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
    })();
    await (async () => {
      const point = await scenePoint(page, x, y);
      await page.mouse.move(point.x, point.y);
      await page.mouse.up();
    })();
    await wait("document.getElementById('draft-status').textContent === 'Draft checkpoint saved'");
  }
  await newTab();
  await chooseScene();
  const original = await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8');
  // A live tab resumes under a new identity after another tab removes its checkpoint.
  await paint(12, 12);
  const removed = array((await post('list-drafts')).drafts, record)[0];
  await post('delete-draft', removed);
  await paint(20, 12);
  const replacement = array((await post('list-drafts')).drafts, record);
  assert.equal(replacement.length, 1);
  assert.notEqual(replacement[0].id, removed.id);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await page.locator('#discard-dialog button[value=discard]').first().click();
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  // Persist a first write but lose its acknowledgement, then explicitly discard it.
  await evaluate(`window.__cleanupFetch = window.fetch; window.__loseCheckpoint = true;
    window.fetch = async (...args) => {
      const response = await window.__cleanupFetch(...args);
      if (String(args[0]).endsWith('/api/checkpoint-draft') && window.__loseCheckpoint) {
        window.__loseCheckpoint = false;
        throw Error('simulated lost acknowledgement');
      }
      return response;
    };`);
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
  await wait(
    "document.getElementById('draft-status').textContent.includes('lost acknowledgement')",
  );
  assert.equal(array((await post('list-drafts')).drafts, record).length, 1);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await page.locator('#discard-dialog button[value=discard]').first().click();
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  await evaluate('window.fetch = window.__cleanupFetch');
  // New draft, failed writes and automatic retries; preview remains transient.
  await evaluate(
    `window.__draftFetch = window.fetch; window.fetch = (...args) => String(args[0]).endsWith('/api/checkpoint-draft') ? Promise.resolve(new Response(JSON.stringify({error:'simulated disk full'}), {status:400, headers:{'Content-Type':'application/json'}})) : window.__draftFetch(...args);`,
  );
  await click('artwork-tab');
  await page.locator('[data-asset="terrain/earth"]').first().click();
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
  await wait("document.getElementById('draft-status').textContent.includes('simulated disk full')");
  await evaluate('window.fetch = window.__draftFetch');
  await wait("document.getElementById('draft-status').textContent === 'Draft checkpoint saved'");

  // Reload retains the draft and offers explicit choices.
  console.log('Draft browser: reloading with a checkpoint');
  await page.reload();
  await wait("document.getElementById('recovery-dialog')?.open");
  await click('recovery-restore');
  await wait("document.getElementById('status').textContent.includes('Draft restored')");
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  assert.notEqual(await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8'), original);
  // Playback moves only a transient pose; checkpoints retain authored sprite coordinates.
  await click('artwork-tab');
  await page.locator('[data-asset="actors/idle"]').first().click();
  await (async () => {
    const point = await scenePoint(page, 40, 32);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 40, 32);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await click('save');
  await wait("document.getElementById('status').textContent === 'Scene saved.'");
  await evaluate(
    "(() => { const e = document.getElementById('object-list'); e.value = '1'; e.dispatchEvent(new Event('change')); })()",
  );
  await evaluate("document.getElementById('preview-movement-settings').open = true");
  await click('preview-movement');
  await evaluate(
    "(() => { const e = document.getElementById('preview-path'); e.value = '64, 32'; e.dispatchEvent(new Event('input')); })()",
  );
  await click('preview-follow-path');
  await wait("document.getElementById('preview-position').textContent.includes('X 64.0, Y 32.0')");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  await expect(page.locator('#dirty')).toHaveText('SAVED');
  await click('preview-movement');
  await paint(72, 64);
  const previewDraft = array((await post('list-drafts')).drafts, record)[0];
  const previewSnapshot = record((await post('download-draft', previewDraft)).scene);
  const sprite = array(
    array(previewSnapshot.layers, record).find((layer) => layer.type === 'objectgroup')?.objects,
    record,
  )[0];
  assert.equal(sprite.x, 40);
  assert.equal(sprite.y, 32);
  await click('revert');
  await wait("document.getElementById('discard-dialog').open");
  await page.locator('#discard-dialog button[value=discard]').first().click();
  await wait("document.getElementById('dirty').textContent === 'SAVED'");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
});

test('stale revision, download and confirmed discard', async ({
  page,
  context,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  const root = join(folder, 'world');
  let url = '';
  const start = async () => {
    url = await workspace.start(root);
  };

  async function post(route: string, data: unknown = {}) {
    const catalog = record(await (await fetch(new URL('api/project', url))).json());
    const response = await fetch(new URL(`api/${route}`, url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scene-Token': string(catalog.token) },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return record(await response.json());
  }
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
sys.path.insert(0, 'tests')
from support.atlas_fixture import bundle, sprite_bundle
from gbc_scene_forge.project.application import Project
root = Path(sys.argv[1])
p = Project.create(root, 'Draft recovery example')
for source in (bundle(root.parent / 'art')[0], sprite_bundle(root.parent / 'actors')[0]):
    p.artwork.import_atlas(source, p.catalog()['revision'])
a = p.scenes.create('Room', 12, 10, 8, p.catalog()['revision'])
b = p.scenes.create('Other room', 12, 10, 8, p.catalog()['revision'])
print(json.dumps({'first': a['id'], 'second': b['id']}))
`,
    root,
  ]);
  const ids = record(JSON.parse(stdout));
  const first = string(ids.first);
  await start();
  const evaluate = (expression: string) => page.evaluate(expression);
  const wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  async function newTab() {
    page = await context.newPage();
    await page.goto(url);
    await wait(
      "document.getElementById('project-name')?.textContent === 'Draft recovery example' && document.getElementById('scenes')?.disabled === false",
    );
    return page;
  }
  async function chooseScene(id = first) {
    await page.locator('#scenes').selectOption(id);
    await wait(
      `document.getElementById('scenes').value === ${JSON.stringify(id)} && document.getElementById('show-create').disabled === false`,
    );
  }

  await newTab();
  await chooseScene();

  const checkpoint = { id: '12345678-1234-4234-8234-123456789abc' };
  // A stale scene blocks restore but still supports download and confirmed discard.
  console.log('Draft browser: checking conflict, download and discard');
  const catalog = record(await (await fetch(new URL('api/project', url))).json());
  const current = record(await (await fetch(new URL(`api/scene/${first}`, url))).json());
  const draft = await post('checkpoint-draft', {
    id: checkpoint.id,
    revision: null,
    project_id: record(catalog.project).id,
    scene_id: first,
    name: 'Room',
    scene_revision: current.revision,
    project_revision: catalog.revision,
    scene: current.scene,
  });
  const currentBytes = await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8');
  await writeFile(join(root, 'scenes', `${first}.tmj`), currentBytes + '\n');
  await click('show-recovery');
  await wait("document.getElementById('recovery-dialog').open");
  await click('recovery-restore');
  await wait(
    "document.querySelector('#recovery-dialog .form-error').textContent.includes('changed')",
  );
  await page.screenshot({ path: testInfo.outputPath('draft-recovery-conflict' + '.png') });
  await evaluate(
    'window.__draftBlob = null; URL.createObjectURL = blob => { window.__draftBlob = blob; return "blob:captured"; }; HTMLAnchorElement.prototype.click = function() {};',
  );
  await click('recovery-download');
  await wait('window.__draftBlob !== null');
  const downloaded = record(JSON.parse(string(await evaluate('window.__draftBlob.text()'))));
  assert.equal(downloaded.scene_id, first);
  assert.deepEqual(downloaded.scene, current.scene);
  assert.equal(draft.revision, array((await post('list-drafts')).drafts, record)[0].revision);
  await evaluate('window.confirm = () => false');
  await click('recovery-discard');
  assert.equal(array((await post('list-drafts')).drafts, record).length, 1);
  await evaluate('window.confirm = () => true');
  await click('recovery-discard');
  await wait("!document.getElementById('recovery-dialog').open");
  assert.equal(array((await post('list-drafts')).drafts, record).length, 0);
  assert.equal(await readFile(join(root, 'scenes', `${first}.tmj`), 'utf8'), currentBytes + '\n');
});
