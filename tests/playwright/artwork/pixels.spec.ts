import { revealArtworkControl, reviewArtwork, saveArtwork } from '../support/artwork-controls.ts';
/** Native hand editing, scene-history isolation, revision conflicts and durable drafts. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { record, array, string } from '../../../frontend/shared/decode.mts';
import { PixelModel } from '../../../frontend/artwork/pixel-model.mts';
import { decodeCandidate } from '../../../frontend/artwork/artwork-contracts.mts';
import {
  test,
  clickControl,
  paint,
  setControl,
  chooseSavedScene,
  activateScene,
} from '../support/browser-fixtures.ts';

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
  dense = false,
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
    c=a.edit(c,[{'x':x,'y':y,'rgba':([x*32,y*32,(x+y)*16,255] if ${dense ? 'True' : 'False'} and kind=='tile' else ([76,112,53,255] if (x+y)%3 else [116,151,73,255]))} for y in range(h) for x in range(w)])
    a.save(c)
path,_=bundle(Path(sys.argv[1]).parent/'imported')
p.artwork.import_atlas(path,r())
s=p.scenes.create('Workshop',12,10,8,r())
s['scene']['cells'][0][0]='grass/artwork/0/0'
if ${dense ? 'True' : 'False'}:
    s['scene']['cells'][1]=['grass/artwork/0/0']*12
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
  await chooseSavedScene(page, scene);
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  return { url, scene, root };
}
async function openGrass(page: Page) {
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await expect(page.locator('#art-source')).toBeEnabled();
  await page.locator('#art-existing-mode').click();
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
  await (await revealArtworkControl(page, 'art-id')).fill('autumn_grass');
  await page.locator('#art-name').fill('Autumn grass');
  await (await revealArtworkControl(page, 'art-variation')).click();
  await expect(page.locator('#art-shared')).toContainText('1 selected placements');
  await page.locator('#art-color').fill('#cc8833');
  await draw(page, 1, 2);
  await page.locator('#undo').click();
  await page.locator('#redo').click();
  await activateScene(page);
  await page.locator('#show-artwork').click();
  await revealArtworkControl(page, 'art-drafts');
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-shared')).toContainText('1 selected placements');
  await reviewArtwork(page);
  await expect(page.locator('#art-references')).toHaveText(
    '1 selected replacements out of 2 saved source references. Only these selections change; other scenes, stamps and definitions retain the original.',
  );
  await expect(page.locator('#art-before')).toBeVisible();
  await expect(page.locator('#art-scene-after')).toBeVisible();
  await page.screenshot({ path: info.outputPath('variation-desktop.png') });
  await page.setViewportSize({ width: 800, height: 900 });
  await page.screenshot({ path: info.outputPath('variation-compact.png') });
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  await page.locator('#expand-scene-tools').click();
  await page.locator('input[name=tool][value=paint]').check();
  await page.locator('[data-asset="grass/artwork"]').first().click();
  await paint(page, 20, 20);
  await clickControl(page, 'save');
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
  await (await revealArtworkControl(page, 'art-variation')).click();
  await expect(page.locator('#art-message')).toContainText('Save the scene before');
  await activateScene(page);
  await clickControl(page, 'save');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#edit-placement-artwork').click();
  await (await revealArtworkControl(page, 'art-id')).fill('stale_variation');
  await (await revealArtworkControl(page, 'art-variation')).click();
  await draw(page, 0, 0);
  await reviewArtwork(page);
  await expect(page.locator('#save')).toBeEnabled();
  execFileSync(workspace.python, [
    '-c',
    "import sys;from pathlib import Path;p=Path(sys.argv[1])/'scenes'/sys.argv[2];p.write_bytes(p.read_bytes()+b'\\n')",
    root,
    `${scene}.tmj`,
  ]);
  await page.locator('#save').click();
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
  await (await revealArtworkControl(page, 'art-id')).fill('actor_warm');
  await (await revealArtworkControl(page, 'art-variation')).click();
  await page.locator('#art-color').fill('#f0b050');
  await draw(page, 4, 4);
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  await page.locator('input[name=art-tool][value=rectangle]').check();
  await draw(page, 1, 1, 6, 6);
  await page.locator('input[name=art-tool][value=fill]').check();
  await draw(page, 2, 2);
  await page.locator('input[name=art-tool][value=line]').check();
  await draw(page, 0, 7, 7, 0);
  await page.locator('input[name=art-tool][value=pick]').check();
  await draw(page, 0, 0);
  await expect(page.locator('#art-color')).toHaveValue('#cc6633');
  await page.locator('input[name=art-tool][value=select]').check();
  await draw(page, 0, 0, 1, 1);
  await page.locator('#copy-selection').click();
  await page.locator('#deselect').click();
  await page.locator('input[name=art-tool][value=select]').check();
  await draw(page, 4, 4, 5, 5);
  await page.locator('#paste-selection').click();
  await clickControl(page, 'flip-horizontal');
  await clickControl(page, 'flip-vertical');
  await clickControl(page, 'rotate-selection');
  await page.locator('#art-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('input[name=art-tool][value=erase]').check();
  await draw(page, 7, 7);
  await page.locator('input[name=art-tool][value=pencil]').check();
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
  await expect(page.locator('#artwork-surface')).toBeVisible();
  await page.locator('#undo').click();
  await page.locator('#redo').click();
  await reviewArtwork(page);
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#art-references')).toContainText('2 saved references');
  await expect(page.locator('#art-scene-after')).toBeVisible();
  const screenshot = info.outputPath('pixel-editor-desktop.png');
  await page.screenshot({ path: screenshot });
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  await (await revealArtworkControl(page, 'art-id')).fill('hand_tile');
  await page.locator('#art-name').fill('Hand tile');
  await page.locator('#art-width').fill('8');
  await page.locator('#art-height').fill('8');
  await page.locator('#art-create').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await page.locator('input[name=art-tool][value=fill]').check();
  await draw(page, 0, 0);
  await reviewArtwork(page);
  await expect(page.locator('#save')).toBeEnabled();
  const screenshot = info.outputPath('pixel-editor-compact.png');
  await page.screenshot({ path: screenshot });
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  assert.equal((await opened(page, url, 'hand_tile')).descriptor.name, 'Hand tile');
  // Imported artwork offers only copying, and creation does not replace placements.
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await page.locator('#art-source').selectOption({ label: 'terrain / earth (copy to edit)' });
  await expect(page.locator('#art-open')).toBeDisabled();
  await (await revealArtworkControl(page, 'art-source-grid')).selectOption('8');
  await (await revealArtworkControl(page, 'art-id')).fill('copied_tile');
  await page.locator('#art-name').fill('Copied tile');
  await (await revealArtworkControl(page, 'art-duplicate')).click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await (await revealArtworkControl(page, 'art-color')).fill('#eeaa44');
  await page.locator('input[name=art-tool][value=pencil]').check();
  await draw(page, 1, 1);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  // Interrupt the dialog after its checkpoint, without an explicit close/save.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await revealArtworkControl(page, 'art-drafts');
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('Recovered a new copy');
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  await reviewArtwork(page);
  await expect(page.locator('#save')).toBeEnabled();
  let other = await opened(page, url);
  other = decodeCandidate(
    await post(page, url, 'edit', {
      candidate: other,
      writes: [{ x: 0, y: 0, rgba: [0, 0, 255, 255] }],
    }),
  );
  const review = await post(page, url, 'review', { candidate: other });
  await post(page, url, 'save', { candidate: other, receipt: review.receipt });
  await page.locator('#save').click();
  await expect(page.locator('#art-message')).toContainText('retained');
  await expect(page.locator('#artwork-surface')).toBeVisible();
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  assert.deepEqual(new PixelModel(await opened(page, url)).color({ x: 0, y: 0 }), [0, 0, 255, 255]);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await revealArtworkControl(page, 'art-drafts');
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
  await page.locator('input[name=art-tool][value=erase]').check();
  await draw(page, 0, 0, 15, 0);
  // Pointer cancellation rolls back the next stroke in full.
  const a = await pixel(page, 0, 1),
    b = await pixel(page, 15, 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.locator('#art-canvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await reviewArtwork(page);
  await expect(page.locator('#art-references')).toContainText('1 saved references');
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  await (await revealArtworkControl(page, 'art-id')).fill('new_sprite');
  await page.locator('#art-name').fill('New sprite');
  await page.locator('#art-kind').selectOption('sprite');
  await page.locator('#art-create').click();
  await page.locator('input[name=art-tool][value=rectangle]').check();
  await draw(page, 1, 1, 6, 6);
  await reviewArtwork(page);
  await expect(page.locator('#art-scene-after')).toBeVisible();
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  await page.locator('#undo').click();
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  // This transition must fail, so invoke it without the successful-navigation helper.
  await page.locator('#document-switcher').click();
  await page.locator('#scene-document').click();
  await expect(page.locator('#artwork-surface')).toBeVisible();
  await expect(page.locator('#art-message')).toContainText('simulated disk full');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await revealArtworkControl(page, 'art-download')).click(),
  ]);
  assert.equal(download.suggestedFilename(), 'artwork-work.json');
  await page.unroute('**/api/artwork-draft-write');
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
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
  await page.locator('#undo').click();

  // Override the shared fixture's automatic acceptance so this test can stay.
  page.removeAllListeners('dialog');
  const prompt = page.waitForEvent('dialog');
  const reloading = page.reload().catch(() => null);
  const dialog = await prompt;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.dismiss();
  await reloading;
  await expect(page.locator('#artwork-surface')).toBeVisible();
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
  // Resume frames before checking live notification announcements after reload.
  await page.clock.resume();
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await revealArtworkControl(page, 'art-drafts');
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('Recovered a new copy');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await revealArtworkControl(page, 'art-download')).click(),
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
  await expect(page.locator('#art-message[role="alert"]')).toBeAttached();
  await page.clock.runFor(20);
  await expect(page.locator('#art-message')).toContainText('Checkpoint failed');
  await page.unroute('**/api/artwork-draft-write');
  await page.locator('#undo').click();
  page.removeAllListeners('dialog');
  const prompt = page.waitForEvent('dialog');
  const reloading = page.reload({ timeout: 2000 }).catch(() => null);
  const dialog = await prompt;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.dismiss();
  await reloading;
  await expect(page.locator('#artwork-surface')).toBeVisible();
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
  await page.clock.resume();
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
    await (await revealArtworkControl(page, 'art-id')).fill('scene_guard_tile');
    await page.locator('#art-create').click();
    await expect(page.locator('#art-canvas')).toBeVisible();
    await (await revealArtworkControl(page, 'art-use-scene')).uncheck();
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
    await reviewArtwork(page);
    await expect(page.locator('#save')).toBeEnabled();
    await page.locator('#save').click();
    if (external) {
      await expect(page.locator('#art-message')).toContainText('reconcile the scene');
    } else {
      await expect(page.locator('#art-message')).toContainText('Artwork saved.');
    }
    await activateScene(page);
    await expect(page.locator('#artwork-surface')).not.toBeVisible();
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await expect(page.locator('#undo')).toBeEnabled();
    const sceneUrl = new URL(`api/scene/${scene}`, url).href;
    const before = record(await (await page.request.get(sceneUrl)).json());
    const response = page.waitForResponse((r) => r.url().endsWith('/api/save-scene'));
    await clickControl(page, 'save');
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
  await revealArtworkControl(page, 'art-drafts');
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('Recovered a new copy');
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  const saved = new PixelModel(await opened(page, url));
  assert.deepEqual(saved.color({ x: 0, y: 0 }), [255, 0, 0, 255]);
  assert.deepEqual(saved.color({ x: 1, y: 0 }), new PixelModel(original).color({ x: 1, y: 0 }));
});

test('dense variation controls scroll while reviewed save actions remain clickable', async ({
  page,
  workspace,
}, info) => {
  await setup(page, workspace, true);
  await page.locator('input[name=tool][value=select]').check();
  const points = await page.locator('#scene').evaluate((canvas: HTMLCanvasElement) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: r.x + (4 * r.width) / canvas.width,
      end: r.x + (52 * r.width) / canvas.width,
      y: r.y + (12 * r.height) / canvas.height,
    };
  });
  await page.mouse.move(points.x, points.y);
  await page.mouse.down();
  await page.mouse.move(points.end, points.y, { steps: 7 });
  await page.mouse.up();
  await page.locator('#edit-placement-artwork').click();
  await (await revealArtworkControl(page, 'art-id')).fill('dense_variation');
  await (await revealArtworkControl(page, 'art-variation')).click();
  await expect(page.locator('#art-shared')).toContainText('7 selected placements');
  await page.locator('#art-palette-toggle').click();
  await page.getByRole('tab', { name: 'Selected layer', exact: true }).click();
  await expect(page.locator('#art-swatches button')).toHaveCount(64);
  await page.keyboard.press('Escape');
  await revealArtworkControl(page, 'art-download');
  await page.locator('.art-help summary').click();
  await page.locator('#art-selection-details summary').click();
  await reviewArtwork(page);
  await expect(page.locator('#save')).toBeEnabled();
  for (const [width, height] of [
    [1440, 900],
    [760, 640],
    [1440, 600],
  ]) {
    await page.setViewportSize({ width, height });
    for (const id of ['save']) {
      expect(
        await page.locator('#' + id).evaluate((node) => {
          const r = node.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.bottom <= innerHeight && !!hit && node.contains(hit);
        }),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`dense-${width}-${height}.png`) });
  }
  // Physical click avoids Playwright scrolling a clipped Save into view.
  const save = await page.locator('#save').boundingBox();
  assert.ok(save);
  await page.mouse.click(save.x + save.width / 2, save.y + save.height / 2);
  await expect(page.locator('#art-message')).toContainText('Artwork saved.');
  await expect(page.locator('#artwork-surface')).toBeVisible();
});

test('transparent drawing restores opacity and preserves partial alpha in saved pixels', async ({
  page,
  workspace,
}, info) => {
  const { url } = await setup(page, workspace);
  await openGrass(page);
  await page.locator('#art-color').fill('#cc8833');
  await page.locator('#art-alpha').fill('128');
  await draw(page, 0, 0);
  const transparent = page.locator('#art-transparent');
  await expect(transparent).toHaveAccessibleName('Transparent');
  await transparent.click();
  await expect(transparent).toHaveAttribute('aria-pressed', 'true');
  await expect(transparent).toHaveAccessibleName('Resume color');
  await expect(transparent).toContainText('Resume color');
  await draw(page, 1, 0);
  await page.screenshot({ path: info.outputPath('transparent-active.png') });
  await transparent.click();
  await expect(page.locator('#art-alpha')).toHaveValue('128');
  await expect(transparent).toHaveAccessibleName('Transparent');
  await draw(page, 2, 0);
  await transparent.click();
  await page.locator('#art-color').fill('#112233');
  await expect(transparent).toHaveAttribute('aria-pressed', 'false');
  await expect(transparent).toHaveAccessibleName('Transparent');
  await draw(page, 3, 0);
  await page.locator('#art-alpha').fill('0');
  await expect(transparent).toHaveAttribute('aria-pressed', 'true');
  await expect(transparent).toHaveAccessibleName('Resume color');
  await page.getByRole('radio', { name: 'Eyedropper', exact: true }).check();
  await draw(page, 0, 0);
  await expect(page.locator('#art-alpha')).toHaveValue('128');
  await expect(transparent).toHaveAttribute('aria-pressed', 'false');
  await expect(transparent).toHaveAccessibleName('Transparent');
  await page.locator('#art-palette-toggle').click();
  await page.getByRole('tab', { name: 'Selected layer', exact: true }).click();
  await page.getByRole('button', { name: 'RGBA 204, 136, 51, 0', exact: true }).click();
  await expect(transparent).toHaveAttribute('aria-pressed', 'true');
  await expect(transparent).toHaveAccessibleName('Resume color');
  await page.locator('#art-palette-toggle').click();
  await page.getByRole('button', { name: 'RGBA 204, 136, 51, 128', exact: true }).click();
  await expect(transparent).toHaveAttribute('aria-pressed', 'false');
  await expect(transparent).toHaveAccessibleName('Transparent');
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  const saved = new PixelModel(await opened(page, url));
  assert.deepEqual(saved.color({ x: 0, y: 0 }), [204, 136, 51, 128]);
  assert.deepEqual(saved.color({ x: 1, y: 0 }), [204, 136, 51, 0]);
  assert.deepEqual(saved.color({ x: 2, y: 0 }), [204, 136, 51, 128]);
  assert.deepEqual(saved.color({ x: 3, y: 0 }), [17, 34, 51, 128]);
});

test('native player sheet, animation authoring and document switching retain independent work', async ({
  page,
  workspace,
}, info) => {
  const { url } = await setup(page, workspace);
  await page.locator('[data-asset="grass/artwork"]').first().click();
  await paint(page, 20, 20);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await page.locator('#show-artwork').click();
  await (await revealArtworkControl(page, 'art-id')).fill('player_sheet');
  await page.locator('#art-name').fill('Player sheet');
  await page.locator('#art-kind').selectOption('sprite');
  await page.locator('#art-width').fill('32');
  await page.locator('#art-height').fill('16');
  await page.locator('#art-multiple').check();
  await page.locator('#art-frame-width').fill('8');
  await page.locator('#art-frame-height').fill('16');
  await (await revealArtworkControl(page, 'art-origin-x')).fill('3');
  await (await revealArtworkControl(page, 'art-origin-y')).fill('12');
  await page.locator('#art-create').click();
  await expect(page.locator('#art-frame option')).toHaveCount(4);
  await page.locator('#art-frame-view').click();
  await page.locator('#art-color').fill('#cc6633');
  await draw(page, 1, 2);
  await page.locator('#art-zoom').selectOption('32');
  for (const [id, frame] of [
    ['idle', 'frame_0'],
    ['walk', 'frame_1'],
    ['jump', 'frame_2'],
    ['duck', 'frame_3'],
  ]) {
    await page.locator('#art-frame').selectOption(frame);
    // Author distinct poses with normal pointer tools, so overview/playback
    // screenshots contain actual pixels in every frame.
    await page.locator('#art-color').fill('#cc6633');
    await draw(page, 2, 3, 5, 3);
    await draw(page, 3, 4, 3, id === 'duck' ? 8 : 10);
    await draw(page, 1, id === 'jump' ? 5 : 7, 5, 7);
    await draw(page, 3, id === 'duck' ? 8 : 10, id === 'walk' ? 6 : 4, 13);
    await (await revealArtworkControl(page, 'art-sequence-id')).fill(id);
    await page.locator('#art-add-sequence').click();
  }
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-sequence').selectOption('walk');
  await page.locator('#art-frame').selectOption('frame_2');
  await page.locator('#art-add-animation-frame').click();
  await revealArtworkControl(page, 'art-play');
  await page.getByLabel('Frame 1 duration in milliseconds', { exact: true }).fill('180');
  await revealArtworkControl(page, 'art-play');
  await page.getByLabel('Frame 1 duration in milliseconds', { exact: true }).press('Tab');
  await page.locator('#art-loop').uncheck();
  await page.locator('#art-onion').check();
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-play').click();
  await expect(page.locator('#art-play')).toHaveText('Play');
  await page.locator('#art-step').click();
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Player sheet' }).click();
  await expect(page.locator('#art-zoom')).toHaveValue('32');
  await expect(page.locator('#art-frame')).toHaveValue('frame_2');
  await expect(page.locator('#art-onion')).toBeChecked();
  await page.locator('#undo').click();
  await expect(page.locator('#art-loop')).toBeChecked();
  await page.locator('#redo').click();
  await expect(page.locator('#art-loop')).not.toBeChecked();
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-animation-review').click();
  await expect(page.locator('#art-animation-image')).toBeVisible();
  const animation = await page.locator('#art-animation-image').getAttribute('src');
  assert.ok(animation);
  assert.ok(animation.startsWith('data:image/apng;base64,'));
  await writeFile(
    info.outputPath('player-walk.apng'),
    Buffer.from(animation.split(',')[1], 'base64'),
  );
  await page.screenshot({ path: info.outputPath('unified-player-sheet-desktop.png') });
  await page.locator('#art-zoom').selectOption('16');
  await page.locator('#art-sheet-view').click();
  await page.locator('.art-review').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('unified-player-sheet-overview.png') });
  await page.setViewportSize({ width: 800, height: 640 });
  await page.screenshot({ path: info.outputPath('unified-player-sheet-compact.png') });
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  const saved = await opened(page, url, 'player_sheet');
  assert.equal(saved.descriptor.version, 2);
  if (saved.descriptor.version !== 2) {
    throw Error('Expected sheet');
  }
  assert.equal(saved.descriptor.sequences.length, 4);
  assert.equal(saved.descriptor.sequences[1].frames[0].duration_ms, 180);
  assert.equal(saved.descriptor.sequences[1].loop, false);
  assert.deepEqual(new PixelModel(saved).color({ x: 1, y: 2 }), [204, 102, 51, 255]);
});

test('Library opens agent-authored sheets without any scene, manual corrections are exact agent bases', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Agent sheet')
a=p.artwork.documents
frames=[dict(id=k,name=k,kind='sprite',x=i*8,y=0,width=8,height=8,origin=[3,5]) for i,k in enumerate(['idle','step'])]
s=[dict(id='walk',name='Walk',loop=True,frames=[dict(frame_id=k,duration_ms=d) for k,d in [('idle',120),('step',240)]])]
c=a.create_sheet('player','Agent player','sprite',16,8,p.catalog()['revision'],frames=frames,sequences=s)
c=a.edit(c,[dict(x=0,y=0,rgba=[41,52,63,0])])
a.save(c,receipt=p.artwork.reviews.animation(c,'walk',scale=1)['receipt'])
`,
    root,
  ]);
  const url = await workspace.start(root, true);
  await page.goto(url);
  await expect(page.locator('[data-asset="player/idle"]')).toBeVisible();
  await page.locator('[data-asset="player/idle"]').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await expect(page.locator('#art-frame option')).toHaveCount(2);
  await page.locator('#art-sheet-view').click();
  await page.locator('#art-color').fill('#ddaa77');
  await draw(page, 9, 2);
  await activateScene(page);
  await page.locator('[data-asset="player/idle"]').click();
  await expect(page.locator('#artwork-documents button')).toHaveCount(1);
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#undo').click();
  await page.locator('#redo').click();
  await revealArtworkControl(page, 'art-play');
  await page.getByLabel('Frame 1 duration in milliseconds', { exact: true }).fill('333');
  await revealArtworkControl(page, 'art-play');
  await page.getByLabel('Frame 1 duration in milliseconds', { exact: true }).press('Tab');
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-animation-review').click();
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  const saved = await opened(page, url, 'player');
  assert.equal(saved.descriptor.version, 2);
  if (saved.descriptor.version !== 2) {
    throw Error('Expected sheet');
  }
  assert.equal(saved.descriptor.sequences[0].frames[0].duration_ms, 333);
  assert.deepEqual(new PixelModel(saved).color({ x: 0, y: 0 }), [41, 52, 63, 0]);
  assert.deepEqual(new PixelModel(saved).color({ x: 9, y: 2 }), [221, 170, 119, 255]);
  const output = execFileSync(
    workspace.python,
    [
      '-c',
      `
import sys,json
from gbc_scene_forge.adapters.mcp.tools import Adapter
a=Adapter(sys.argv[1],single_project=True)
p=a.call('get_project',dict(project='project'))
l=a.call('list_artwork',dict(project='project',project_revision=p['revision']))
d=l['documents'][0]
c=a.call('open_artwork',dict(project='project',target=d['target'],project_revision=p['revision'],artwork_revision=d['artwork_revision'],compact=True))
c=a.call('edit_artwork_pixels',dict(project='project',candidate=c,writes=[dict(x=10,y=3,rgba=[70,80,90,255])]))
review=a.call('review_artwork_animation',dict(project='project',candidate=c,sequence_id='walk',scale=1))
saved=a.call('commit_artwork',dict(project='project',candidate=c,receipt=review['receipt']))
c=a.call('open_artwork',dict(project='project',target=d['target'],project_revision=saved['project_revision'],artwork_revision=saved['artwork_revision'],compact=True))
c=a.call('export_artwork_candidate',dict(project='project',candidate=c))
print(json.dumps(c))
`,
      root,
    ],
    { encoding: 'utf8' },
  );
  const continued = decodeCandidate(JSON.parse(output));
  const expected = Buffer.from(saved.rgba, 'base64');
  expected.set([70, 80, 90, 255], (3 * saved.descriptor.width + 10) * 4);
  assert.equal(continued.rgba, expected.toString('base64'));
  assert.deepEqual(continued.descriptor, saved.descriptor);
  await page.reload();
  await page.locator('[data-asset="player/idle"]').click();
  await expect(page.getByLabel('Frame 1 duration in milliseconds', { exact: true })).toHaveValue(
    '333',
  );
  assert.equal((await opened(page, url, 'player')).rgba, continued.rgba);
});

test('manual tile sheet repetition, scene placement and explicit sprite conversion', async ({
  page,
  workspace,
}, info) => {
  const { url, root, scene } = await setup(page, workspace);
  execFileSync(workspace.python, [
    '-c',
    `
import sys
from gbc_scene_forge.project.application import Project
p=Project(sys.argv[1]);s=p.scenes.load(sys.argv[2]);s['scene']['objects'][0]['x']=36
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
`,
    root,
    scene,
  ]);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await (await revealArtworkControl(page, 'art-id')).fill('tile_sheet');
  await page.locator('#art-name').fill('Tile sheet');
  await page.locator('#art-width').fill('16');
  await page.locator('#art-height').fill('8');
  await page.locator('#art-multiple').check();
  await page.locator('#art-create').click();
  await page.locator('#art-frame-view').click();
  await page.locator('input[name=art-tool][value=fill]').check();
  await draw(page, 0, 0);
  await revealArtworkControl(page, 'art-repeat-canvas');
  await expect(page.locator('#art-repeat-canvas')).toBeVisible();
  await (await revealArtworkControl(page, 'art-use-scene')).uncheck();
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await page.locator('[data-asset="tile_sheet/frame_0"]').first().click();
  await paint(page, 20, 20);
  await clickControl(page, 'save');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await page.locator('#art-source').selectOption({ label: 'actor / artwork (editable)' });
  await (await revealArtworkControl(page, 'art-id')).fill('scenery_actor');
  await page.locator('#art-name').fill('Scenery actor');
  await page.locator('#art-duplicate-sheet').click();
  await (await revealArtworkControl(page, 'art-tile-representation')).click();
  await (await revealArtworkControl(page, 'art-use-scene')).uncheck();
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await page.locator('input[name=tool][value=select]').check();
  await page.locator('.layer-choice').filter({ hasText: 'Sprites' }).click();
  await paint(page, 38, 30);
  await page.locator('#selection-secondary > summary').click();
  await page.locator('#convert-sprites').click();
  await expect(page.locator('#conversion-dialog')).toBeVisible();
  await page.locator('#conversion-target').selectOption('scenery_actor/artwork_tiles');
  await page.locator('#conversion-static').check();
  await page.locator('#conversion-review').click();
  await expect(page.locator('#conversion-save')).toBeEnabled();
  await expect(page.locator('#conversion-mapping')).toContainText('2 × 2 tiles at column 4, row 3');
  await expect(page.locator('#conversion-before')).toHaveAttribute(
    'src',
    (await page.locator('#conversion-after').getAttribute('src')) ?? '',
  );
  await page.screenshot({ path: info.outputPath('sprite-tile-conversion-review.png') });
  await page.locator('#conversion-save').click();
  await expect(page.locator('#conversion-dialog')).not.toBeVisible();
  const data = record(
    await (await page.request.get(new URL(`api/scene/${scene}`, url).href)).json(),
  );
  const layers = savedLayers(data);
  assert.equal(layers.flatMap((layer) => array(layer.objects ?? [], record)).length, 0);
  assert.ok(
    layers.some((layer) =>
      JSON.stringify(layer.cells ?? []).includes('scenery_actor/artwork_tiles'),
    ),
  );
});

test('conversion review covers distant origin-adjusted sprites and requires every view', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Conversion views')
a=p.artwork.documents
frames=[dict(id='pose',name='Pose',kind='sprite',x=0,y=0,width=16,height=16,origin=[4,8]),dict(id='tiles',name='Tiles',kind='tile',x=0,y=0,width=16,height=16,origin=[0,0])]
c=a.create_sheet('scenery','Scenery','sprite',16,16,p.catalog()['revision'],frames=frames,sequences=[])
c=a.edit(c,[dict(x=x,y=y,rgba=[40,80,200,255] if x==y==15 else [200,80,40,255]) for y in range(16) for x in range(16)])
a.save(c,receipt=p.artwork.reviews.review(c)['receipt'])
s=p.scenes.create('Stage',100,100,8,p.catalog()['revision'])
s['scene']['objects']=[dict(id=1,asset='scenery/pose',x=324,y=328),dict(id=2,asset='scenery/pose',x=796,y=784,origin=[12,0])]
s['scene']['next_object_id']=3
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
`,
    root,
  ]);
  const url = await workspace.start(root, true);
  await page.goto(url);
  await chooseSavedScene(page, { label: 'Stage' });
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#fit-scene').click();
  await page.locator('input[name=tool][value=select]').check();
  await page.locator('.layer-choice').filter({ hasText: 'Sprites' }).click();
  await paint(page, 328, 328);
  await page
    .locator('#viewport')
    .evaluate((node) => node.scrollTo(node.scrollWidth, node.scrollHeight));
  await page.keyboard.down('Shift');
  await paint(page, 792, 792);
  await page.keyboard.up('Shift');
  await expect(page.locator('#selection-name')).toHaveText('2 objects selected');
  await page.locator('#selection-secondary > summary').click();
  await page.locator('#convert-sprites').click();
  await page.locator('#conversion-target').selectOption('scenery/tiles');
  await page.locator('#conversion-static').check();
  const viewports: { x: number; y: number; width: number; height: number }[] = [];
  let fail = true;
  await page.route('**/api/artwork-conversion-review', async (route) => {
    const data = record(route.request().postDataJSON());
    const v = record(data.viewport);
    viewports.push({
      x: Number(v.x),
      y: Number(v.y),
      width: Number(v.width),
      height: Number(v.height),
    });
    if (fail && viewports.length === 2) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Review view unavailable' }),
      });
    } else {
      await route.continue();
    }
  });
  await page.locator('#conversion-review').click();
  await expect(page.locator('#conversion-message')).toContainText('Review view unavailable');
  await expect(page.locator('#conversion-save')).toBeDisabled();
  await expect(page.locator('#conversion-images')).not.toBeVisible();
  fail = false;
  viewports.length = 0;
  await page.locator('#conversion-review').click();
  await expect(page.locator('#conversion-save')).toBeEnabled();
  await expect(page.locator('.conversion-view')).toHaveCount(2);
  await expect(page.locator('#conversion-mapping li')).toHaveCount(2);
  for (const [index, bound] of [
    { x: 320, y: 320 },
    { x: 784, y: 784 },
  ].entries()) {
    const v = viewports[index];
    assert.ok(v.x <= bound.x && v.y <= bound.y);
    assert.ok(v.x + v.width >= bound.x + 16 && v.y + v.height >= bound.y + 16);
    assert.ok(v.x + v.width <= 800 && v.y + v.height <= 800);
    const images = page.locator('.conversion-view').nth(index).locator('img');
    assert.equal(await images.nth(0).getAttribute('src'), await images.nth(1).getAttribute('src'));
    const colors = await images.nth(0).evaluate(
      async (node, point) => {
        if (!(node instanceof HTMLImageElement)) {
          throw Error('Expected a conversion review image');
        }
        const image = node;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          throw Error('Expected a canvas context');
        }
        context.drawImage(image, 0, 0);
        return [
          Array.from(context.getImageData(point.x, point.y, 1, 1).data),
          Array.from(context.getImageData(point.x + 15, point.y + 15, 1, 1).data),
        ];
      },
      { x: bound.x - v.x, y: bound.y - v.y },
    );
    assert.deepEqual(colors, [
      [200, 80, 40, 255],
      [40, 80, 200, 255],
    ]);
  }
  await page.setViewportSize({ width: 760, height: 640 });
  await page.locator('#conversion-save').scrollIntoViewIfNeeded();
  await expect(page.locator('#conversion-save')).toBeVisible();
  assert.ok(
    await page
      .locator('#conversion-dialog')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await page.setViewportSize({ width: 1440, height: 1280 });
  await page.locator('#conversion-dialog').evaluate((node) => node.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('conversion-selected-views.png') });
  await page.locator('#conversion-save').click();
  await expect(page.locator('#conversion-dialog')).not.toBeVisible();
});

test('saved artwork stays open across saves and undo compares with the latest saved base', async ({
  page,
  workspace,
}) => {
  const { url } = await setup(page, workspace);
  await expect(page.locator('#document-switcher')).toBeVisible();
  expect(await page.locator('#document-tabs').boundingBox()).toBeNull();
  await page.locator('[data-asset="grass/artwork"]').dblclick();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(page.locator('#art-source-panel')).toBeHidden();
  await expect(page.locator('.art-review')).toBeHidden();
  await page.locator('#art-color').fill('#cc7744');
  await draw(page, 0, 0);
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await reviewArtwork(page);
  await saveArtwork(page);
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#undo').click();
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await page.locator('#redo').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#art-color').fill('#4488bb');
  await draw(page, 1, 0);
  await reviewArtwork(page);
  await saveArtwork(page);
  const model = new PixelModel(await opened(page, url));
  assert.deepEqual(model.color({ x: 0, y: 0 }), [204, 119, 68, 255]);
  assert.deepEqual(model.color({ x: 1, y: 0 }), [68, 136, 187, 255]);
  await activateScene(page);
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeEnabled();
});

for (const failure of ['save acknowledgment', 'saved reopen'] as const) {
  test(`successful artwork write with failed ${failure} preserves the correct recovery boundary`, async ({
    page,
    workspace,
  }) => {
    const { url } = await setup(page, workspace);
    await openGrass(page);
    await page.locator('#art-color').fill('#cc7744');
    await draw(page, 0, 0);
    await reviewArtwork(page);
    const route = failure === 'save acknowledgment' ? 'save' : 'open';
    await page.route(`**/api/artwork-${route}`, async (request) => {
      if (route === 'save') {
        const committed = await request.fetch();
        expect(committed.status()).toBe(200);
      }
      await request.abort('failed');
    });
    await page.locator('#save').click();
    await expect(page.locator('#art-message')).toContainText(
      failure === 'save acknowledgment' ? 'Local pixels are retained' : 'Artwork saved.',
    );
    expect(new PixelModel(await opened(page, url)).color({ x: 0, y: 0 })).toEqual([
      204, 119, 68, 255,
    ]);
    const drafts = array((await post(page, url, 'draft-list', {})).drafts, record);
    if (failure === 'save acknowledgment') {
      expect(drafts).toHaveLength(1);
      const checkpoint = await post(page, url, 'draft-download', {
        id: drafts[0].id,
        revision: drafts[0].revision,
      });
      expect(new PixelModel(decodeCandidate(checkpoint.candidate)).color({ x: 0, y: 0 })).toEqual([
        204, 119, 68, 255,
      ]);
      await revealArtworkControl(page, 'art-download');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#art-download').click(),
      ]);
      const path = await download.path();
      assert.ok(path);
      const work = record(JSON.parse(await readFile(path, 'utf8')));
      expect(work.current_rgba).toBe(decodeCandidate(checkpoint.candidate).rgba);
      // Retrying an ambiguous save cannot reuse its now-stale review/base.
      await page.unroute(`**/api/artwork-${route}`);
      await page.locator('#save').click();
      await expect(page.locator('#art-message')).toContainText('retained');
      expect(array((await post(page, url, 'draft-list', {})).drafts, record)).toHaveLength(1);
    } else {
      expect(drafts).toHaveLength(0);
      // The exact save succeeded; failed adoption must retire its stale session.
      await expect(page.locator('#art-editor')).toBeHidden();
      await expect(page.locator('#document-switcher')).toBeVisible();
    }
  });
}

test('a late artwork open cannot adopt into a replacement mounted editor', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await page.locator('#art-source').selectOption({ label: 'grass / artwork (editable)' });
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let read = () => {};
  const readComplete = new Promise<void>((resolve) => {
    read = resolve;
  });
  await page.route('**/api/artwork-open', async (route) => {
    const response = await route.fetch();
    read();
    await pending;
    await route.fulfill({ response });
  });
  await page.locator('#art-open').click();
  await readComplete;
  try {
    await page.evaluate(`(async()=>{
      const module=await import('/project.js');
      module.editor.dispose();
      window.__replacement=module.mountProjectEditor();
    })()`);
    await expect(page.locator('#show-artwork')).toBeEnabled();
  } finally {
    release();
  }
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await expect(page.locator('#document-switcher')).toBeVisible();
  await openGrass(page);
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.evaluate('window.__replacement.dispose()');
});

test('document restoration binds the selected sequence and clears other artwork reviews', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Independent sheet reviews')
a=p.artwork.documents
for atlas,offset,color in [('player_a',0,[220,40,30,255]),('player_b',333,[30,60,220,255])]:
    frames=[dict(id=k,name=k.title(),kind='sprite',x=i*8,y=0,width=8,height=8,origin=[0,0]) for i,k in enumerate(['idle','walk'])]
    sequences=[dict(id='idle',name='Idle',loop=True,frames=[dict(frame_id='idle',duration_ms=111+offset)]),dict(id='walk',name='Walk',loop=False,frames=[dict(frame_id='walk',duration_ms=222+offset),dict(frame_id='idle',duration_ms=333+offset)])]
    c=a.create_sheet(atlas,atlas.title(),'sprite',16,8,p.catalog()['revision'],frames=frames,sequences=sequences)
    c=a.edit(c,[dict(x=x,y=y,rgba=color) for y in range(8) for x in range(16)])
    a.save(c,receipt=p.artwork.reviews.animation(c,'walk',scale=1)['receipt'])
`,
    root,
  ]);
  const url = await workspace.start(root, true);
  await page.goto(url);
  await page.locator('[data-asset="player_a/walk"]').click();
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-sequence').selectOption('walk');
  await expect(page.getByLabel('Frame 1 duration in milliseconds', { exact: true })).toHaveValue(
    '222',
  );
  await reviewArtwork(page);
  const firstReview = await page.locator('#art-after').getAttribute('src');
  await page.locator('#art-animation-review').click();
  await expect(page.locator('#art-animation-image')).toBeVisible();
  await page.locator('[data-asset="player_b/idle"]').click();
  await expect(page.locator('#artwork-heading')).toHaveText('Player_B');
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-sequence').selectOption('idle');
  await reviewArtwork(page);
  const secondReview = await page.locator('#art-after').getAttribute('src');
  assert.notEqual(firstReview, secondReview);
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-animation-review').click();
  await expect(page.locator('#art-animation-image')).toBeVisible();
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Player_A' }).click();
  await expect(page.locator('#art-sequence')).toHaveValue('walk');
  await expect(page.locator('#art-loop')).not.toBeChecked();
  await expect(page.locator('#art-sequence-frames input')).toHaveCount(2);
  const duration = page.getByLabel('Frame 1 duration in milliseconds', { exact: true });
  await expect(duration).toHaveValue('222');
  await expect(page.locator('#art-comparison')).toBeHidden();
  await expect(page.locator('#art-animation-result')).toBeHidden();
  await expect(page.locator('#art-references')).toBeEmpty();
  for (const id of [
    'art-before',
    'art-after',
    'art-scene-before',
    'art-scene-after',
    'art-animation-image',
  ]) {
    await expect(page.locator('#' + id)).not.toHaveAttribute('src');
  }
  await duration.fill('277');
  await duration.press('Tab');
  await reviewArtwork(page);
  await expect(page.locator('#art-after')).toHaveAttribute('src', firstReview ?? 'missing');
  await saveArtwork(page);
  const saved = await opened(page, url, 'player_a');
  assert.equal(saved.descriptor.version, 2);
  if (saved.descriptor.version !== 2) {
    throw Error('Expected sheet');
  }
  assert.equal(saved.descriptor.sequences[0].frames[0].duration_ms, 111);
  assert.equal(saved.descriptor.sequences[1].frames[0].duration_ms, 277);
  const other = await opened(page, url, 'player_b');
  assert.equal(other.descriptor.version, 2);
  if (other.descriptor.version !== 2) {
    throw Error('Expected sheet');
  }
  assert.equal(other.descriptor.sequences[0].frames[0].duration_ms, 444);
});

async function reviewedSheetFixture(workspace: {
  folder: string;
  python: string;
  start: (root: string, fixture?: boolean) => Promise<string>;
}) {
  const root = join(workspace.folder, 'project');
  const scene = execFileSync(
    workspace.python,
    [
      '-c',
      `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Saved sheet history')
a=p.artwork.documents
frames=[dict(id=k,name=k.title(),kind='sprite',x=i*8,y=0,width=8,height=8,origin=[0,0]) for i,k in enumerate(['idle','step'])]
sequences=[dict(id='walk',name='Walk',loop=False,frames=[dict(frame_id=k,duration_ms=120) for k in ['idle','step']]),dict(id='pose',name='Pose',loop=False,frames=[dict(frame_id='idle',duration_ms=120)])]
c=a.create_sheet('player','Player','sprite',16,8,p.catalog()['revision'],frames=frames,sequences=sequences)
a.save(c,receipt=p.artwork.reviews.review(c)['receipt'])
s=p.scenes.create('Stage',4,4,8,p.catalog()['revision'])
s['scene']['objects']=[dict(id=1,asset='player/idle',x=8,y=8)]
s['scene']['next_object_id']=2
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
print(s['id'])
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  return { url: await workspace.start(root, true), scene };
}

for (const history of ['undo', 'redo'] as const) {
  test(`artwork ${history} across frames clears selections outside the active frame`, async ({
    page,
    workspace,
  }) => {
    const { url } = await reviewedSheetFixture(workspace);
    await page.goto(url);
    await page.locator('[data-asset="player/idle"]').click();
    await page.locator('#art-frame-view').click();
    await page.locator('#art-frame').selectOption('step');
    await page.locator('#art-color').fill('#cc6633');
    await draw(page, 1, 1);
    await page.locator('#art-frame').selectOption('idle');
    await page.locator('input[name="art-tool"][value="select"]').check();
    await draw(page, 1, 1, 2, 1);
    await page.locator('input[name="art-tool"][value="pencil"]').check();
    await draw(page, 1, 1);
    if (history === 'redo') {
      await page.locator('#undo').click();
    }
    await page.locator('#art-frame').selectOption('step');
    await page.locator(`#${history}`).click();
    await expect(page.locator('#art-frame')).toHaveValue('step');
    // Copy must use the active frame, and transforms/paste must remain usable.
    await page.locator('#copy-selection').click();
    await expect(page.locator('#paste-selection')).toBeEnabled();
    await clickControl(page, 'flip-horizontal');
    await page.locator('#paste-selection').click();
    await saveArtwork(page);
    const saved = new PixelModel(await opened(page, url, 'player'));
    assert.deepEqual(saved.color({ x: 9, y: 1 }), [204, 102, 51, 255]);
    assert.deepEqual(saved.color({ x: 14, y: 1 }), [0, 0, 0, 0]);
    assert.deepEqual(
      saved.color({ x: 1, y: 1 }),
      history === 'redo' ? [204, 102, 51, 255] : [0, 0, 0, 0],
    );
  });
}

for (const scope of ['frame', 'sheet'] as const) {
  test(`artwork history retains compatible selections in ${scope} view`, async ({
    page,
    workspace,
  }) => {
    const { url } = await reviewedSheetFixture(workspace);
    await page.goto(url);
    await page.locator('[data-asset="player/idle"]').click();
    await page.locator(`#art-${scope}-view`).click();
    const x = scope === 'frame' ? 1 : 7;
    await page.locator('input[name="art-tool"][value="select"]').check();
    await draw(page, x, 1, x + 1, 1);
    await page.locator('input[name="art-tool"][value="pencil"]').check();
    await page.locator('#art-color').fill('#cc6633');
    await draw(page, x, 1);
    await page.locator('#undo').click();
    await page.locator('#redo').click();
    await page.locator('#copy-selection').click();
    await page.locator('#art-frame-view').click();
    await page.locator('#art-frame').selectOption('step');
    await page.locator('#paste-selection').click();
    await saveArtwork(page);
    const saved = new PixelModel(await opened(page, url, 'player'));
    // The retained two-pixel selection, rather than a whole sheet/frame, was copied.
    assert.deepEqual(saved.color({ x: 8, y: 0 }), [204, 102, 51, 255]);
    assert.deepEqual(saved.color({ x: 9, y: 0 }), [0, 0, 0, 0]);
  });
}

test('artwork Undo and Redo stop playback before restoring sequence frames', async ({
  page,
  workspace,
}) => {
  const { url } = await reviewedSheetFixture(workspace);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('[data-asset="player/idle"]').click();
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-sequence').selectOption('pose');
  await page.locator('#art-loop').check();
  await page.locator('#art-add-animation-frame').click();
  await expect(page.locator('#art-sequence-frames input')).toHaveCount(2);
  await page.clock.install();

  await page.locator('#art-play').click();
  await expect(page.locator('#art-play')).toHaveText('Pause');
  await page.locator('#undo').click();
  await expect(page.locator('#art-sequence-frames input')).toHaveCount(1);
  await expect(page.locator('#art-play')).toHaveText('Play');
  await page.clock.runFor(250);
  await expect(page.locator('#art-animation-status')).toContainText('frame 1/1');

  await page.locator('#art-play').click();
  await expect(page.locator('#art-play')).toHaveText('Pause');
  await page.locator('#redo').click();
  await expect(page.locator('#art-sequence-frames input')).toHaveCount(2);
  await expect(page.locator('#art-play')).toHaveText('Play');
  await page.clock.runFor(250);
  await expect(page.locator('#art-animation-status')).toContainText('frame 1/2');

  await page.locator('#art-play').click();
  await page.clock.runFor(120);
  await expect(page.locator('#art-animation-status')).toContainText('frame 2/2');
  await expect(page.locator('#art-play')).toHaveText('Pause');
  await page.locator('#art-play').click();
  assert.deepEqual(errors, []);
});

for (const [label, name, expectedPrefix] of [
  ['94-character', 'A'.repeat(94), 'A'.repeat(94)],
  ['95-character', 'B'.repeat(95), 'B'.repeat(94)],
  ['100-character', 'C'.repeat(100), 'C'.repeat(94)],
  ['Unicode boundary', 'D'.repeat(93) + '😀 pose', 'D'.repeat(93)],
] as const) {
  test(`tile representation from a ${label} frame name stays recoverable`, async ({
    page,
    workspace,
  }) => {
    const { url } = await reviewedSheetFixture(workspace);
    await page.goto(url);
    await page.locator('[data-asset="player/idle"]').click();
    await (await revealArtworkControl(page, 'art-frame-name')).fill(name);
    await page.locator('#art-rename-frame').click();
    await page.locator('#art-properties summary').click();
    await page.locator('#art-tile-representation').click();
    await expect(page.locator('#art-frame option')).toHaveCount(3);
    await expect(page.locator('#art-draft-status')).toHaveText(
      'Unsaved artwork checkpointed in this project.',
    );
    await page.locator('#undo').click();
    await expect(page.locator('#art-frame option')).toHaveCount(2);
    await page.locator('#redo').click();
    await expect(page.locator('#art-frame option')).toHaveCount(3);
    await activateScene(page);
    await expect(page.locator('#artwork-surface')).not.toBeVisible();
    await page.locator('#document-switcher').click();
    await page.locator('#artwork-documents button').click();
    await saveArtwork(page);
    const saved = await opened(page, url, 'player');
    if (saved.descriptor.version !== 2) {
      throw Error('Expected sheet');
    }
    assert.equal(saved.descriptor.frames[0].name, name);
    const tiles = saved.descriptor.frames.find((frame) => frame.id === 'idle_tiles');
    assert.ok(tiles);
    assert.equal(tiles.name, `${expectedPrefix} tiles`);
    assert.ok(tiles.name.length <= 100);
    assert.equal(saved.descriptor.frames.length, 3);
  });
}

async function boundedSheetFixture(workspace: {
  folder: string;
  python: string;
  start: (root: string, fixture?: boolean) => Promise<string>;
}) {
  const root = join(workspace.folder, 'bounded-sheet');
  execFileSync(
    workspace.python,
    [
      '-c',
      `
import copy
import sys
from pathlib import Path
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Animation workshop')
a=p.artwork.documents
f=dict(id='p',name='Pose',kind='sprite',x=0,y=0,width=8,height=8,origin=[0,0])
c=a.create_sheet('player','Player 🌲','sprite',8,8,p.catalog()['revision'],frames=[f],sequences=[])
d=copy.deepcopy(c['descriptor'])
last=[]
for total in range(1,1025):
    sequences=[dict(id='seq_'+str(i),name='Sequence '+str(i),loop=True,
        frames=[dict(frame_id='p',duration_ms=120) for j in range(min(256,total-i*256))])
        for i in range((total+255)//256)]
    d['sequences']=sequences
    if len(record_bytes(d))>65536:
        break
    last=sequences
c=a.create_sheet('player','Player 🌲','sprite',8,8,p.catalog()['revision'],frames=[f],sequences=last)
assert 65450 < len(record_bytes(c['descriptor'])) <= 65536
a.save(c,receipt=p.artwork.reviews.review(c)['receipt'])
`,
      root,
    ],
    { encoding: 'utf8' },
  );
  return workspace.start(root, true);
}

test('oversized layout edits preserve valid history, checkpoints and document navigation', async ({
  page,
  workspace,
}) => {
  const url = await boundedSheetFixture(workspace);
  const layoutFailures: number[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('/api/artwork-layout') && !response.ok()) {
      layoutFailures.push(response.status());
    }
  });
  await page.goto(url);
  await page.locator('[data-asset="player/p"]').click();
  await revealArtworkControl(page, 'art-play');
  // Retain a valid edit in Redo while trying several rejected mutations.
  const duration = page.getByLabel('Frame 1 duration in milliseconds', { exact: true });
  await duration.fill('121');
  await duration.press('Tab');
  await expect(page.locator('#art-draft-status')).toHaveText(
    'Unsaved artwork checkpointed in this project.',
  );
  await page.locator('#undo').click();
  await expect(duration).toHaveValue('120');
  await page.locator('#art-sequence').selectOption('seq_3');
  await (await revealArtworkControl(page, 'art-sequence-id')).fill('Extra');
  await page.locator('#art-add-sequence').click();
  await expect(page.locator('#art-message')).toContainText('Editable descriptor exceeds 64 KiB');
  await expect(page.locator('#art-sequence option')).toHaveCount(4);
  await expect(page.locator('#art-sequence')).toHaveValue('seq_3');

  await (await revealArtworkControl(page, 'art-frame-name')).fill('Tree 🌲'.repeat(12));
  await page.locator('#art-rename-frame').click();
  await expect(page.locator('#art-frame-name')).toHaveValue('Pose');
  await page.locator('#art-properties summary').click();
  await page.locator('#art-tile-representation').click();
  await expect(page.locator('#art-frame option')).toHaveCount(1);
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-sequence').selectOption('seq_3');
  const entries = await page.locator('#art-sequence-frames input').count();
  await page.locator('#art-add-animation-frame').click();
  await expect(page.locator('#art-sequence-frames input')).toHaveCount(entries);

  await page.locator('#art-sequence').selectOption('seq_0');
  await page.locator('#redo').click();
  await expect(duration).toHaveValue('121');
  await page.locator('#undo').click();
  await expect(duration).toHaveValue('120');
  await page.locator('#redo').click();
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').click();
  await saveArtwork(page);
  const saved = await opened(page, url, 'player');
  if (saved.descriptor.version !== 2) {
    throw Error('Expected sheet');
  }
  assert.equal(saved.descriptor.frames.length, 1);
  assert.equal(saved.descriptor.frames[0].name, 'Pose');
  assert.equal(saved.descriptor.sequences.length, 4);
  assert.equal(saved.descriptor.sequences[0].frames[0].duration_ms, 121);
  assert.deepEqual(layoutFailures, []);
});

test('saving a representation retains only valid near-limit history states', async ({
  page,
  workspace,
}) => {
  const url = await boundedSheetFixture(workspace);
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/artwork-') && !response.ok()) {
      failures.push(response.url());
    }
  });
  await page.goto(url);
  await page.locator('[data-asset="player/p"]').click();
  await revealArtworkControl(page, 'art-play');
  await page.locator('#art-sequence').selectOption('seq_3');
  const entries = await page.locator('#art-sequence-frames input').count();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Remove animation frame 1', exact: true }).click();
  }
  // This pixel history remains valid after making the representation permanent.
  await page.locator('#art-color').fill('#cc6633');
  await draw(page, 1, 1);
  await (await revealArtworkControl(page, 'art-tile-representation')).click();
  await saveArtwork(page);
  await revealArtworkControl(page, 'art-play');
  await page.locator('#undo').click();
  // Two earlier timing states still fit; older ones exceed the budget after rebasing.
  await page.locator('#undo').click();
  await page.locator('#undo').click();
  await expect(page.locator('#art-sequence-frames input')).toHaveCount(entries - 3);
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#art-frame option')).toHaveCount(2);
  await expect(page.locator('#art-draft-status')).toHaveText(
    'Unsaved artwork checkpointed in this project.',
  );
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').click();
  await saveArtwork(page);
  const earlier = await opened(page, url, 'player');
  assert.deepEqual(new PixelModel(earlier).color({ x: 1, y: 1 }), [0, 0, 0, 0]);
  for (let i = 0; i < 3; i++) {
    await page.locator('#redo').click();
  }
  await expect(page.locator('#redo')).toBeDisabled();
  await saveArtwork(page);
  const restored = await opened(page, url, 'player');
  assert.deepEqual(new PixelModel(restored).color({ x: 1, y: 1 }), [204, 102, 51, 255]);
  assert.equal(restored.descriptor.version, 2);
  if (restored.descriptor.version !== 2) {
    throw Error('Expected sheet');
  }
  assert.equal(restored.descriptor.frames.length, 2);
  assert.equal(restored.descriptor.sequences[3].frames.length, entries - 5);
  assert.deepEqual(failures, []);
});

test('saved representation keeps earlier Undo checkpointable and reviewable', async ({
  page,
  workspace,
}) => {
  const { url } = await reviewedSheetFixture(workspace);
  await page.goto(url);
  await page.locator('[data-asset="player/idle"]').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await page.locator('#art-color').fill('#cc6633');
  await draw(page, 1, 1);
  await revealArtworkControl(page, 'art-play');
  const duration = page.getByLabel('Frame 1 duration in milliseconds', { exact: true });
  await duration.fill('277');
  await duration.press('Tab');
  await (await revealArtworkControl(page, 'art-tile-representation')).click();
  await saveArtwork(page);
  await page.locator('#undo').click();
  await revealArtworkControl(page, 'art-play');
  await expect(duration).toHaveValue('120');
  await expect(page.locator('#art-frame option')).toHaveCount(3);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').click();
  await saveArtwork(page);
  const saved = await opened(page, url, 'player');
  assert.equal(saved.descriptor.version, 2);
  if (saved.descriptor.version !== 2) {
    throw Error('Expected sheet');
  }
  assert.equal(saved.descriptor.frames.length, 3);
  assert.equal(saved.descriptor.sequences[0].frames[0].duration_ms, 120);
  assert.deepEqual(new PixelModel(saved).color({ x: 1, y: 1 }), [204, 102, 51, 255]);
  await page.locator('#redo').click();
  await revealArtworkControl(page, 'art-play');
  await expect(duration).toHaveValue('277');
  await saveArtwork(page);
});

test('offline Download work includes live layout after failed synchronization', async ({
  page,
  workspace,
}) => {
  const { url } = await reviewedSheetFixture(workspace);
  await page.goto(url);
  await page.locator('[data-asset="player/idle"]').click();
  await expect(page.locator('#art-canvas')).toBeVisible();
  await page.route('**/api/artwork-layout', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Layout offline' }),
    }),
  );
  await revealArtworkControl(page, 'art-play');
  const duration = page.getByLabel('Frame 1 duration in milliseconds', { exact: true });
  await duration.fill('277');
  await duration.press('Tab');
  await (await revealArtworkControl(page, 'art-frame-name')).fill('Offline pose');
  await page.locator('#art-rename-frame').click();
  await page.locator('#art-properties summary').click();
  await page.locator('#art-tile-representation').click();
  await expect(page.locator('#art-message')).toContainText('Checkpoint failed');
  const pending = page.waitForEvent('download');
  await (await revealArtworkControl(page, 'art-download')).click();
  const path = await (await pending).path();
  assert.ok(path);
  const data = record(JSON.parse(await readFile(path, 'utf8')));
  const descriptor = record(data.current_descriptor);
  assert.equal(array(descriptor.frames, record).length, 3);
  assert.equal(array(descriptor.frames, record)[0].name, 'Offline pose');
  const sequence = array(descriptor.sequences, record)[0];
  assert.equal(array(sequence.frames, record)[0].duration_ms, 277);
  assert.notDeepEqual(descriptor, record(data.candidate).descriptor);
});

test('non-looping artwork playback replays completed sequences and resumes paused poses', async ({
  page,
  workspace,
}) => {
  const { url } = await reviewedSheetFixture(workspace);
  await page.goto(url);
  await page.locator('[data-asset="player/idle"]').click();
  await revealArtworkControl(page, 'art-play');
  await page.clock.install();
  // Only runFor should advance these short poses, including between UI actions.
  await page.clock.pauseAt(new Date());
  for (const name of ['walk', 'pose']) {
    await page.locator('#art-sequence').selectOption(name);
    await page.locator('#art-play').click();
    await page.clock.runFor(250);
    await expect(page.locator('#art-play')).toHaveText('Play');
    await page.locator('#art-play').click();
    await expect(page.locator('#art-animation-status')).toContainText('frame 1/');
    await page.clock.runFor(name === 'walk' ? 130 : 40);
    await expect(page.locator('#art-animation-status')).toContainText(
      name === 'walk' ? 'frame 2/2' : 'frame 1/1',
    );
    await page.locator('#art-play').click();
    const paused = await page.locator('#art-animation-status').textContent();
    await expect(page.locator('#art-play')).toHaveText('Play');
    await page.locator('#art-play').click();
    await expect(page.locator('#art-animation-status')).toHaveText(paused ?? '');
    await expect(page.locator('#art-play')).toHaveText('Pause');
    await page.clock.runFor(250);
    await expect(page.locator('#art-play')).toHaveText('Play');
  }
});

test('non-looping scene playback replays completed sequences and resumes paused poses', async ({
  page,
  workspace,
}, info) => {
  const { url, scene } = await reviewedSheetFixture(workspace);
  await page.goto(url);
  await expect(page.locator('#scenes')).toBeEnabled();
  await chooseSavedScene(page, scene);
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page
    .getByRole('radio', { name: /Sprites Objects/ })
    .locator('..')
    .click();
  await page.locator('input[name=tool][value=select]').check();
  await setControl(page, 'object-list', '1');
  await page.clock.install();
  // CI action/assertion latency must not consume the remaining frame duration.
  await page.clock.pauseAt(new Date());
  for (const name of ['walk', 'pose']) {
    await setControl(page, 'preview-animation', name);
    await clickControl(page, 'preview-play');
    await page.clock.runFor(300);
    await expect(page.locator('#preview-play')).toHaveText('Play');
    await clickControl(page, 'preview-play');
    await expect(page.locator('#preview-frame')).toContainText('Frame 1 /');
    await page.clock.runFor(name === 'walk' ? 150 : 40);
    await expect(page.locator('#preview-frame')).toContainText(
      name === 'walk' ? 'Frame 2 / 2' : 'Frame 1 / 1',
    );
    await clickControl(page, 'preview-play');
    const paused = await page.locator('#preview-frame').textContent();
    await expect(page.locator('#preview-play')).toHaveText('Play');
    await clickControl(page, 'preview-play');
    await expect(page.locator('#preview-frame')).toHaveText(paused ?? '');
    await expect(page.locator('#preview-play')).toHaveText('Pause');
    await page.clock.runFor(300);
    await expect(page.locator('#preview-play')).toHaveText('Play');
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  }
  await page.screenshot({ path: info.outputPath('completed-non-looping-playback.png') });
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 800, height: 640 },
]) {
  test(`review identifies shared references and independent new artwork at ${viewport.width}`, async ({
    page,
    workspace,
  }, info) => {
    await page.setViewportSize(viewport);
    await setup(page, workspace);
    await openGrass(page);
    await reviewArtwork(page);
    await expect(page.locator('#art-document-state')).toHaveText('Saved');
    await expect(page.locator('#art-draft-status')).toHaveText(
      'Saved artwork checkpointed in this project.',
    );
    await expect(page.locator('#art-references')).toContainText('2 saved references');
    const details = page.locator('#art-reference-details');
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(page.locator('#art-reference-scenes')).toHaveText('Workshop (2 placements)');
    await expect(page.locator('#art-reference-locations li')).toHaveCount(2);
    await expect(page.locator('#art-reference-locations')).toContainText('cell 0, 0');
    await expect(page.locator('#art-reference-locations')).toContainText('cell 1, 1');
    await expect(page.locator('#art-reference-limit')).toContainText('All saved source locations');
    await expect(page.locator('#save')).toHaveText('Confirm save');
    const footer = await page.locator('#save').boundingBox();
    assert.ok(footer);
    expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height);
    await page.locator('#art-reference-locations li').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`references-${viewport.width}.png`) });
    await page.locator('#art-review-close').click();
    await expect(page.locator('#save')).toBeFocused();
    await activateScene(page);
    await page.locator('#show-artwork').click();
    await page.locator('#art-existing-mode').click();
    const imported = page
      .locator('#art-source option')
      .filter({ hasText: '(copy to edit)' })
      .first();
    await page.locator('#art-source').selectOption(string(await imported.getAttribute('value')));
    await expect(page.locator('#art-open')).toBeDisabled();
    await expect(page.locator('#art-open')).toHaveAttribute('aria-describedby', 'art-source-help');
    await expect(page.locator('#art-source-help')).toContainText('Name an editable copy');
    await expect(page.locator('#art-open')).toHaveAttribute('title', /requires an editable copy/);
    await page.locator('#art-new-mode').click();
    await page.locator('#art-name').fill('Independent tile');
    await page.locator('#art-create').click();
    await reviewArtwork(page);
    await expect(page.locator('#art-references')).toContainText('New independent artwork');
    await expect(page.locator('#art-references')).toContainText('place it separately');
    await expect(details).toBeHidden();
    await page.screenshot({ path: info.outputPath(`new-review-${viewport.width}.png`) });
    await saveArtwork(page);
    await expect(page.locator('#art-document-state')).toHaveText('Saved');
  });
}

test('shared review discloses a bounded location page and every affected scene', async ({
  page,
  workspace,
}) => {
  const { root, scene } = await setup(page, workspace, true);
  // Use the canonical saved scene API to construct more than one reference page.
  execFileSync(workspace.python, [
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]));s=p.scenes.load(sys.argv[2])
s['scene']['cells']=[['grass/artwork/0/0']*12 for _ in range(10)]
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
p.scenes.duplicate(s['id'],'Second affected scene',p.scenes.load(s['id'])['revision'],p.catalog()['revision'])
p.scenes.duplicate(s['id'],'Third affected scene',p.scenes.load(s['id'])['revision'],p.catalog()['revision'])
`,
    root,
    scene,
  ]);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await openGrass(page);
  await reviewArtwork(page);
  await page.locator('#art-reference-summary').click();
  await expect(page.locator('#art-reference-scenes')).toContainText('Workshop (120 placements)');
  await expect(page.locator('#art-reference-scenes')).toContainText(
    'Second affected scene (120 placements)',
  );
  await expect(page.locator('#art-reference-scenes')).toContainText(
    'Third affected scene (120 placements)',
  );
  await expect(page.locator('#art-reference-locations li')).toHaveCount(256);
  await expect(page.locator('#art-reference-limit')).toContainText('Showing 256 of 360');
});
