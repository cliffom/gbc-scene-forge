/** Native hand editing, scene-history isolation, revision conflicts and durable drafts. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { record, array, string } from '../../../frontend/shared/decode.mts';
import { PixelModel } from '../../../frontend/artwork/pixel-model.mts';
import { decodeCandidate } from '../../../frontend/artwork/artwork-contracts.mts';
import { test, paint } from '../support/browser-fixtures.ts';

async function pixel(page: Page, x: number, y: number) {
  const canvas = page.locator('#art-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box);
  const zoom = Number(await page.locator('#art-zoom').inputValue());
  return { x: box.x + (x + 0.5) * zoom, y: box.y + (y + 0.5) * zoom };
}
async function draw(page: Page, x: number, y: number, toX = x, toY = y) {
  const a = await pixel(page, x, y),
    b = await pixel(page, toX, toY);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}
async function post(page: Page, url: string, action: string, data: unknown) {
  const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
  const response = await page.request.post(new URL('api/artwork-' + action, url).href, {
    data,
    headers: { 'X-Scene-Token': string(catalog.token) },
  });
  assert.equal(response.status(), 200, await response.text());
  return record(await response.json());
}
async function opened(page: Page, url: string, id = 'grass') {
  const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
  const inventory = await post(page, url, 'list', { project_revision: catalog.revision });
  const item = array(inventory.documents, record).find((d) => record(d.target).atlas_id === id);
  assert.ok(item);
  return decodeCandidate(
    await post(page, url, 'open', {
      target: item.target,
      artwork_revision: item.artwork_revision,
      project_revision: catalog.revision,
    }),
  );
}
async function setup(
  page: Page,
  workspace: {
    folder: string;
    python: string;
    start: (root: string, fixture?: boolean) => Promise<string>;
  },
) {
  const root = join(workspace.folder, 'project');
  const scene = execFileSync(
    workspace.python,
    [
      '-c',
      `
import sys
sys.path.insert(0,'tests')
from pathlib import Path
from support.atlas_fixture import bundle
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Pixel workshop')
r=lambda:p.catalog()['revision']
a=p.artwork.documents
for atlas,kind,w,h in [('grass','tile',8,8),('actor','sprite',16,16)]:
    c=a.create(atlas,atlas.title(),kind,w,h,r(),origin=[4,8] if kind=='sprite' else None)
    c=a.edit(c,[{'x':x,'y':y,'rgba':[76,112,53,255] if (x+y)%3 else [116,151,73,255]} for y in range(h) for x in range(w)])
    a.save(c)
path,_=bundle(Path(sys.argv[1]).parent/'imported')
p.artwork.import_atlas(path,r())
s=p.scenes.create('Workshop',12,10,8,r())
s['scene']['cells'][0][0]='grass/artwork/0/0'
s['scene']['cells'][1][1]='grass/artwork/0/0#1'
s['scene']['objects']=[{'id':1,'asset':'actor/artwork','x':32,'y':32,'origin':[4,8]}]
s['scene']['next_object_id']=2
p.scenes.save(s['id'],s['scene'],s['revision'],r())
print(s['id'])
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  const url = await workspace.start(root, true);
  await page.goto(url);
  await expect(page.locator('#scenes')).toBeEnabled();
  await page.locator('#scenes').selectOption(scene);
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  return { url, scene, root };
}
async function openGrass(page: Page) {
  await page.locator('#show-artwork').click();
  await expect(page.locator('#art-source')).toBeEnabled();
  await page.locator('#art-source').selectOption({ label: 'grass / artwork (editable)' });
  await page.locator('#art-open').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await expect(page.locator('#art-review')).toBeEnabled();
}
function savedLayers(data: Record<string, unknown>) {
  const scene = record(data.scene);
  return scene.layers
    ? array(scene.layers, record)
    : [{ cells: scene.cells }, { objects: scene.objects ?? [] }];
}

test('selected tile variation recovers, reviews exact replacements and preserves other placements', async ({
  page,
  workspace,
}, info) => {
  const { url, scene } = await setup(page, workspace);
  const original = await opened(page, url);
  await page.locator('input[name=tool][value=select]').check();
  await paint(page, 12, 12);
  await page.locator('#edit-placement-artwork').click();
  await page.locator('#art-id').fill('autumn_grass');
  await page.locator('#art-name').fill('Autumn grass');
  await page.locator('#art-variation').click();
  await expect(page.locator('#art-shared')).toContainText('1 selected placements');
  await page.locator('#art-color').fill('#cc8833');
  await draw(page, 1, 2);
  await page.locator('#art-undo').click();
  await page.locator('#art-redo').click();
  await page.locator('#art-close').click();
  await page.locator('#show-artwork').click();
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-shared')).toContainText('1 selected placements');
  await page.locator('#art-review').click();
  await expect(page.locator('#art-references')).toHaveText(
    '1 selected replacements out of 2 saved source references. Only these selections change; other scenes, stamps and definitions retain the original.',
  );
  await expect(page.locator('#art-before')).toBeVisible();
  await expect(page.locator('#art-scene-after')).toBeVisible();
  await page.screenshot({ path: info.outputPath('variation-desktop.png') });
  await page.setViewportSize({ width: 800, height: 900 });
  await page.screenshot({ path: info.outputPath('variation-compact.png') });
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  const data = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  const cells = array(savedLayers(data)[0].cells, (row) => array(row, string));
  assert.equal(cells[0][0], 'grass/artwork/0/0');
  assert.equal(cells[1][1], 'autumn_grass/artwork/0/0#1');
  assert.equal((await opened(page, url)).rgba, original.rgba);
  assert.deepEqual(
    new PixelModel(await opened(page, url, 'autumn_grass')).color({ x: 1, y: 2 }),
    [204, 136, 51, 255],
  );
  // A later normal scene save must retain the adopted replacement.
  await page.locator('input[name=tool][value=paint]').check();
  await page.locator('[data-asset="grass/artwork"]').first().click();
  await paint(page, 20, 20);
  await page.locator('#save').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  const final = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  assert.equal(
    array(savedLayers(final)[0].cells, (row) => array(row, string))[1][1],
    'autumn_grass/artwork/0/0#1',
  );
});

test('variation refuses dirty scene work and stale selected scene without losing pixels', async ({
  page,
  workspace,
}) => {
  const { url, root, scene } = await setup(page, workspace);
  await page.locator('[data-asset="grass/artwork"]').first().click();
  await paint(page, 20, 20);
  await page.locator('input[name=tool][value=select]').check();
  await paint(page, 4, 4);
  await page.locator('#edit-placement-artwork').click();
  await page.locator('#art-variation').click();
  await expect(page.locator('#art-message')).toContainText('Save the scene before');
  await page.locator('#art-close').click();
  await page.locator('#save').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#edit-placement-artwork').click();
  await page.locator('#art-id').fill('stale_variation');
  await page.locator('#art-variation').click();
  await draw(page, 0, 0);
  await page.locator('#art-review').click();
  await expect(page.locator('#art-save')).toBeEnabled();
  execFileSync(workspace.python, [
    '-c',
    "import sys;from pathlib import Path;p=Path(sys.argv[1])/'scenes'/sys.argv[2];p.write_bytes(p.read_bytes()+b'\\n')",
    root,
    `${scene}.tmj`,
  ]);
  await page.locator('#art-save').click();
  await expect(page.locator('#art-message')).toContainText('Local pixels are retained');
  await expect(page.locator('#art-canvas')).toBeVisible();
  const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
  assert.equal(record(record(catalog.project).atlases).stale_variation, undefined);
});

test('selected sprite variation preserves its origin and keeps original artwork intact', async ({
  page,
  workspace,
}) => {
  const { url, scene } = await setup(page, workspace);
  const original = await opened(page, url, 'actor');
  const before = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  await page.locator('input[name=tool][value=select]').check();
  await page.locator('.layer-choice').filter({ hasText: 'Sprites' }).click();
  await paint(page, 34, 30);
  await page.locator('#edit-placement-artwork').click();
  await page.locator('#art-id').fill('actor_warm');
  await page.locator('#art-variation').click();
  await page.locator('#art-color').fill('#f0b050');
  await draw(page, 4, 4);
  await page.locator('#art-review').click();
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  const after = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  const objects = (data: Record<string, unknown>) =>
    savedLayers(data).flatMap((l) => array(l.objects ?? [], record));
  assert.deepEqual(
    objects(after),
    objects(before).map((o) => ({ ...o, asset: 'actor_warm/artwork' })),
  );
  assert.deepEqual((await opened(page, url, 'actor_warm')).descriptor.origin, [4, 8]);
  assert.equal((await opened(page, url, 'actor')).rgba, original.rgba);
});

test('pixel drawing tools, exact transparency, reviewed save and scene history isolation', async ({
  page,
  workspace,
}, info) => {
  const { url, scene } = await setup(page, workspace);
  // Dirty scene content/history must survive every artwork operation.
  await page.locator('[data-asset="grass/artwork"]').first().click();
  await paint(page, 20, 20);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await openGrass(page);
  await expect(page.locator('#art-shared')).toContainText('every placement');
  await page.locator('#art-color').fill('#cc6633');
  await draw(page, 0, 0, 7, 0);
  await page.locator('#art-tool').selectOption('rectangle');
  await draw(page, 1, 1, 6, 6);
  await page.locator('#art-tool').selectOption('fill');
  await draw(page, 2, 2);
  await page.locator('#art-tool').selectOption('line');
  await draw(page, 0, 7, 7, 0);
  await page.locator('#art-tool').selectOption('pick');
  await draw(page, 0, 0);
  await expect(page.locator('#art-color')).toHaveValue('#cc6633');
  await page.locator('#art-tool').selectOption('select');
  await draw(page, 0, 0, 1, 1);
  await page.locator('#art-copy').click();
  await page.locator('#art-deselect').click();
  await page.locator('#art-tool').selectOption('select');
  await draw(page, 4, 4, 5, 5);
  await page.locator('#art-paste').click();
  await page.locator('#art-horizontal').click();
  await page.locator('#art-vertical').click();
  await page.locator('#art-rotate').click();
  await page.locator('#art-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('#art-tool').selectOption('erase');
  await draw(page, 7, 7);
  await page.locator('#art-tool').selectOption('pencil');
  await page.locator('#art-color').fill('#010203');
  await page.locator('#art-alpha').fill('0');
  await draw(page, 0, 0);
  // Escape cancels a complete in-progress stroke without touching history.
  const a = await pixel(page, 1, 0),
    b = await pixel(page, 3, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#artwork-dialog')).toBeVisible();
  await page.locator('#art-undo').click();
  await page.locator('#art-redo').click();
  await page.locator('#art-review').click();
  await expect(page.locator('#art-save')).toBeEnabled();
  await expect(page.locator('#art-references')).toContainText('2 saved references');
  await expect(page.locator('#art-scene-after')).toBeVisible();
  const screenshot = info.outputPath('pixel-editor-desktop.png');
  await page.screenshot({ path: screenshot });
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await expect(page.locator('#undo')).toBeEnabled();
  const saved = new PixelModel(await opened(page, url));
  assert.deepEqual(saved.color({ x: 0, y: 0 }), [1, 2, 3, 0]);
  assert.deepEqual(saved.color({ x: 1, y: 0 }), [204, 102, 51, 255]);
  assert.deepEqual(saved.color({ x: 7, y: 7 }), [0, 0, 0, 0]);
  await page.locator('#undo').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  assert.equal(await page.locator('#scenes').inputValue(), scene);
  assert.deepEqual(new PixelModel(await opened(page, url)).color({ x: 0, y: 0 }), [1, 2, 3, 0]);
});

test('new artwork, duplicate imported pixels, compact UI and recoverable draft copy', async ({
  page,
  workspace,
}, info) => {
  const { url } = await setup(page, workspace);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.locator('#show-artwork').click();
  await page.locator('#art-id').fill('hand_tile');
  await page.locator('#art-name').fill('Hand tile');
  await page.locator('#art-width').fill('8');
  await page.locator('#art-height').fill('8');
  await page.locator('#art-create').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await page.locator('#art-tool').selectOption('fill');
  await draw(page, 0, 0);
  await page.locator('#art-review').click();
  await expect(page.locator('#art-save')).toBeEnabled();
  const screenshot = info.outputPath('pixel-editor-compact.png');
  await page.screenshot({ path: screenshot });
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  assert.equal((await opened(page, url, 'hand_tile')).descriptor.name, 'Hand tile');
  // Imported artwork offers only copying, and creation does not replace placements.
  await page.locator('#show-artwork').click();
  await page.locator('#art-source').selectOption({ label: 'terrain / earth (copy to edit)' });
  await expect(page.locator('#art-open')).toBeDisabled();
  await page.locator('#art-source-grid').selectOption('8');
  await page.locator('#art-id').fill('copied_tile');
  await page.locator('#art-name').fill('Copied tile');
  await page.locator('#art-duplicate').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await page.locator('#art-color').fill('#eeaa44');
  await page.locator('#art-tool').selectOption('pencil');
  await draw(page, 1, 1);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  // Interrupt the dialog after its checkpoint, without an explicit close/save.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('Recovered a new copy');
  await page.locator('#art-review').click();
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  assert.deepEqual(
    new PixelModel(await opened(page, url, 'copied_tile')).color({ x: 1, y: 1 }),
    [238, 170, 68, 255],
  );
  const drafts = await post(page, url, 'draft-list', {});
  assert.equal(array(drafts.drafts, record).length, 1); // Original retained after recovery.
});

test('external artwork save rejects reviewed pixels and preserves stale checkpoint for download', async ({
  page,
  workspace,
}) => {
  const { url } = await setup(page, workspace);
  await openGrass(page);
  await page.locator('#art-color').fill('#ff0000');
  await draw(page, 0, 0);
  await page.locator('#art-review').click();
  await expect(page.locator('#art-save')).toBeEnabled();
  let other = await opened(page, url);
  other = decodeCandidate(
    await post(page, url, 'edit', {
      candidate: other,
      writes: [{ x: 0, y: 0, rgba: [0, 0, 255, 255] }],
    }),
  );
  const review = await post(page, url, 'review', { candidate: other });
  await post(page, url, 'save', { candidate: other, receipt: review.receipt });
  await page.locator('#art-save').click();
  await expect(page.locator('#art-message')).toContainText('retained');
  await expect(page.locator('#artwork-dialog')).toBeVisible();
  await page.locator('#art-close').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  assert.deepEqual(new PixelModel(await opened(page, url)).color({ x: 0, y: 0 }), [0, 0, 255, 255]);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('retained');
  await expect(page.locator('#art-start')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), 'artwork-draft.json');
});

test('placed sprite editing preserves origin and references; blank sprites preview without placing', async ({
  page,
  workspace,
}) => {
  const { url, scene } = await setup(page, workspace);
  const before = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  await page.locator('input[name=tool][value=select]').check();
  await page.locator('.layer-choice').filter({ hasText: 'Sprites' }).click();
  await paint(page, 34, 30);
  await page.locator('#edit-placement-artwork').click();
  await expect(page.locator('#art-source option:checked')).toContainText('actor / artwork');
  await page.locator('#art-open').click();
  await page.locator('#art-tool').selectOption('erase');
  await draw(page, 0, 0, 15, 0);
  // Pointer cancellation rolls back the next stroke in full.
  const a = await pixel(page, 0, 1),
    b = await pixel(page, 15, 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.locator('#art-canvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await page.locator('#art-review').click();
  await expect(page.locator('#art-references')).toContainText('1 saved references');
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  const saved = await opened(page, url, 'actor');
  assert.deepEqual(saved.descriptor.origin, [4, 8]);
  const pixels = new PixelModel(saved);
  assert.deepEqual(pixels.color({ x: 0, y: 0 }), [0, 0, 0, 0]);
  assert.deepEqual(pixels.color({ x: 0, y: 1 }), [76, 112, 53, 255]);
  const after = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.scene, before.scene);
  await page.locator('#show-artwork').click();
  await page.locator('#art-id').fill('new_sprite');
  await page.locator('#art-name').fill('New sprite');
  await page.locator('#art-kind').selectOption('sprite');
  await page.locator('#art-create').click();
  await page.locator('#art-tool').selectOption('rectangle');
  await draw(page, 1, 1, 6, 6);
  await page.locator('#art-review').click();
  await expect(page.locator('#art-scene-after')).toBeVisible();
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  assert.equal((await opened(page, url, 'new_sprite')).descriptor.kind, 'sprite');
  const finalScene = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  assert.deepEqual(finalScene.scene, before.scene);
});

test('clean close removes an older checkpoint; failed checkpoint retains local work and blocks closing', async ({
  page,
  workspace,
}) => {
  const { url } = await setup(page, workspace);
  await openGrass(page);
  await page.locator('#art-color').fill('#ff0000');
  await draw(page, 0, 0);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await page.locator('#art-undo').click();
  await page.locator('#art-close').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  assert.equal(array((await post(page, url, 'draft-list', {})).drafts, record).length, 0);
  await openGrass(page);
  await page.route('**/api/artwork-draft-write', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'simulated disk full' }),
    }),
  );
  await draw(page, 0, 0);
  await page.locator('#art-close').click();
  await expect(page.locator('#artwork-dialog')).toBeVisible();
  await expect(page.locator('#art-message')).toContainText('simulated disk full');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#art-download').click(),
  ]);
  assert.equal(download.suggestedFilename(), 'artwork-work.json');
  await page.unroute('**/api/artwork-draft-write');
  await page.locator('#art-close').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  assert.equal(array((await post(page, url, 'draft-list', {})).drafts, record).length, 1);
});

test('Undo to the saved base warns on reload until the recovery checkpoint catches up', async ({
  page,
  workspace,
}) => {
  const { url } = await setup(page, workspace);
  const original = await opened(page, url);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await openGrass(page);
  await page.locator('#art-color').fill('#ff0000');
  await draw(page, 0, 0);
  await page.clock.runFor(400);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await page.locator('#art-undo').click();

  // Override the shared fixture's automatic acceptance so this test can stay.
  page.removeAllListeners('dialog');
  const prompt = page.waitForEvent('dialog');
  const reloading = page.reload().catch(() => null);
  const dialog = await prompt;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.dismiss();
  await reloading;
  await expect(page.locator('#artwork-dialog')).toBeVisible();
  const drafts = array((await post(page, url, 'draft-list', {})).drafts, record);
  assert.equal(drafts.length, 1);
  const stale = decodeCandidate((await post(page, url, 'draft-download', drafts[0])).candidate);
  assert.deepEqual(new PixelModel(stale).color({ x: 0, y: 0 }), [255, 0, 0, 255]);

  await page.clock.runFor(400);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  const updated = array((await post(page, url, 'draft-list', {})).drafts, record);
  const checkpoint = await post(page, url, 'draft-download', updated[0]);
  assert.equal(decodeCandidate(checkpoint.candidate).rgba, original.rgba);
  // With the Undo durably stored, reload must proceed without an unload dialog.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('Recovered a new copy');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#art-download').click(),
  ]);
  const path = await download.path();
  assert.ok(path);
  const recovered = record(JSON.parse(await readFile(path, 'utf8')));
  assert.equal(decodeCandidate(recovered.candidate).rgba, original.rgba);
  assert.equal(recovered.current_rgba, original.rgba);
});

test('a lost checkpoint update acknowledgment keeps Undo protected until guarded reconciliation', async ({
  page,
  workspace,
}) => {
  const { url } = await setup(page, workspace);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await openGrass(page);
  await page.locator('#art-color').fill('#ff0000');
  await draw(page, 0, 0);
  await page.clock.runFor(400);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  const acknowledged = array((await post(page, url, 'draft-list', {})).drafts, record)[0];
  const first = decodeCandidate((await post(page, url, 'draft-download', acknowledged)).candidate);

  await page.route('**/api/artwork-draft-write', async (route) => {
    // Commit the update, then lose only its response to the browser.
    assert.equal((await route.fetch()).status(), 200);
    await route.abort('failed');
  });
  await draw(page, 1, 0);
  await page.clock.runFor(400);
  await expect(page.locator('#art-message')).toContainText('Checkpoint failed');
  await page.unroute('**/api/artwork-draft-write');
  await page.locator('#art-undo').click();
  page.removeAllListeners('dialog');
  const prompt = page.waitForEvent('dialog');
  const reloading = page.reload({ timeout: 2000 }).catch(() => null);
  const dialog = await prompt;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.dismiss();
  await reloading;
  await expect(page.locator('#artwork-dialog')).toBeVisible();
  const uncertain = array((await post(page, url, 'draft-list', {})).drafts, record)[0];
  assert.notEqual(uncertain.revision, acknowledged.revision);
  const stored = decodeCandidate((await post(page, url, 'draft-download', uncertain)).candidate);
  assert.deepEqual(new PixelModel(stored).color({ x: 1, y: 0 }), [255, 0, 0, 255]);

  await page.clock.runFor(400);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  const reconciled = array((await post(page, url, 'draft-list', {})).drafts, record)[0];
  const current = decodeCandidate((await post(page, url, 'draft-download', reconciled)).candidate);
  assert.equal(current.rgba, first.rgba);
  assert.notEqual(reconciled.revision, uncertain.revision);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
});

for (const external of [false, true]) {
  test(`new artwork preserves the scene save guard with external change=${external}`, async ({
    page,
    workspace,
  }) => {
    const { url, scene, root } = await setup(page, workspace);
    await page.locator('[data-asset="grass/artwork"]').first().click();
    await paint(page, 20, 20);
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await page.locator('#show-artwork').click();
    await page.locator('#art-id').fill('scene_guard_tile');
    await page.locator('#art-create').click();
    await expect(page.locator('#art-canvas')).toBeVisible();
    await page.locator('#art-use-scene').uncheck();
    if (external) {
      execFileSync(workspace.python, [
        '-c',
        `
from pathlib import Path
import sys
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
s=p.scenes.load(sys.argv[2])
s['scene']['cells'][8][10]='grass/artwork/0/0'
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
`,
        root,
        scene,
      ]);
    }
    await page.locator('#art-review').click();
    await expect(page.locator('#art-save')).toBeEnabled();
    await page.locator('#art-save').click();
    if (external) {
      await expect(page.locator('#art-message')).toContainText('reconcile the scene');
      await page.locator('#art-close').click();
    }
    await expect(page.locator('#artwork-dialog')).not.toBeVisible();
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await expect(page.locator('#undo')).toBeEnabled();
    const sceneUrl = new URL(`api/scene/${scene}`, url).href;
    const before = record(await (await page.request.get(sceneUrl)).json());
    const response = page.waitForResponse((r) => r.url().endsWith('/api/save-scene'));
    await page.locator('#save').click();
    assert.equal((await response).status(), external ? 409 : 200);
    if (external) {
      await expect(page.locator('#status')).toContainText('Scene changed on disk');
      assert.deepEqual(await (await page.request.get(sceneUrl)).json(), before);
      await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    } else {
      await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    }
    assert.equal((await opened(page, url, 'scene_guard_tile')).descriptor.kind, 'tile');
  });
}

test('a pending checkpoint excludes a later canceled gesture through recovery', async ({
  page,
  workspace,
}) => {
  const { url } = await setup(page, workspace);
  const original = await opened(page, url);
  await page.clock.install();
  await openGrass(page);
  await page.locator('#art-color').fill('#ff0000');
  await draw(page, 0, 0);
  const next = await pixel(page, 1, 0);
  await page.mouse.move(next.x, next.y);
  await page.mouse.down();
  await page.clock.runFor(400);
  await expect
    .poll(async () => array((await post(page, url, 'draft-list', {})).drafts, record).length)
    .toBe(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.clock.runFor(1000);
  const drafts = array((await post(page, url, 'draft-list', {})).drafts, record);
  const checkpoint = await post(page, url, 'draft-download', drafts[0]);
  const pixels = new PixelModel(decodeCandidate(checkpoint.candidate));
  assert.deepEqual(pixels.color({ x: 0, y: 0 }), [255, 0, 0, 255]);
  assert.deepEqual(pixels.color({ x: 1, y: 0 }), new PixelModel(original).color({ x: 1, y: 0 }));
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('Recovered a new copy');
  await page.locator('#art-review').click();
  await page.locator('#art-save').click();
  await expect(page.locator('#artwork-dialog')).not.toBeVisible();
  const saved = new PixelModel(await opened(page, url));
  assert.deepEqual(saved.color({ x: 0, y: 0 }), [255, 0, 0, 255]);
  assert.deepEqual(saved.color({ x: 1, y: 0 }), new PixelModel(original).color({ x: 1, y: 0 }));
});
