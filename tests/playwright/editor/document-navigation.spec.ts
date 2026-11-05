/** One navigation control, independent document contexts and guarded departures. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { array, string } from '../../../frontend/shared/decode.mts';
import { revealArtworkControl } from '../support/artwork-controls.ts';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  chooseSavedScene,
  activateScene,
  paint,
} from '../support/browser-fixtures.ts';

type Workspace = {
  folder: string;
  python: string;
  start: (root: string, fixture?: boolean, single?: boolean) => Promise<string>;
};
async function setup(page: Page, workspace: Workspace, projects = false) {
  const root = join(workspace.folder, 'projects');
  const project = join(root, 'one');
  const ids = array(
    JSON.parse(
      execFileSync(
        workspace.python,
        [
          '-I',
          '-c',
          `
import sys,json
from pathlib import Path
from gbc_scene_forge.project.application import Project
root=Path(sys.argv[1])
p=Project.create(root/'one','Navigation review')
a=p.artwork.documents
c=a.create('grass','Grass','tile',8,8,p.catalog()['revision'])
c=a.edit(c,[dict(x=x,y=y,rgba=[76,112,53,255]) for y in range(8) for x in range(8)])
a.save(c)
frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*16,y=0,width=16,height=16,origin=[4,8]) for i in range(2)]
c=a.create_sheet('player','Player','sprite',32,16,p.catalog()['revision'],frames=frames,sequences=[dict(id='walk',name='Walk',loop=True,frames=[dict(frame_id=f'f{i}',duration_ms=120) for i in range(2)])])
a.save(c)
ids=[]
for name in ['Workshop','Other room']:
 s=p.scenes.create(name,48,40,8,p.catalog()['revision'])
 s['scene']['cells'][0][0]='grass/artwork/0/0'
 p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
 ids.append(s['id'])
Project.create(root/'two','Other project')
print(json.dumps(ids))
`,
          root,
        ],
        { encoding: 'utf8' },
      ),
    ),
    string,
  );
  const url = await workspace.start(projects ? root : project, false, !projects);
  await page.goto(projects ? new URL('projects/one/', url).href : url);
  await chooseSavedScene(page, ids[0]);
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Workshop · Scene ▾');
  return { project, ids, url };
}
async function openGrass(page: Page) {
  await page.locator('#edit-placement-artwork').click();
  await page.locator('#art-open').click();
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Grass · Artwork ▾');
}
async function pixel(page: Page, x: number, y: number) {
  const bounds = await page.locator('#art-canvas').boundingBox();
  if (!bounds) {
    throw Error('Expected artwork canvas');
  }
  const zoom = Number(await page.locator('#art-zoom').inputValue());
  return { x: bounds.x + (x + 0.5) * zoom, y: bounds.y + (y + 0.5) * zoom };
}
async function chooseArtwork(page: Page, name: string) {
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: name }).click();
  await expect(page.locator('#art-canvas')).toBeFocused();
}

test('one document bar retains dirty scene, layers, selection, tools and sheet context', async ({
  page,
  workspace,
}, info) => {
  await setup(page, workspace);
  await paint(page, 20, 20);
  await page.locator('#zoom').selectOption('6');
  await page.locator('#viewport').evaluate((n) => {
    n.scrollLeft = 80;
    n.scrollTop = 70;
  });
  const sceneView = await page.locator('#viewport').evaluate((n) => [n.scrollLeft, n.scrollTop]);
  await openGrass(page);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('#art-layers-toggle').click();
  await page.locator('#art-layer-add').click();
  const layer = await page.locator('#art-layer').inputValue();
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  await page.locator('#art-zoom').selectOption('32');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('[data-asset="player/f0"]').click();
  await page.locator('#art-zoom').selectOption('16');
  await page.locator('#art-frame').selectOption('f1');
  await page.locator('#art-frame-view').click();
  await (await revealArtworkControl(page, 'art-sequence')).selectOption('walk');
  await page.locator('#art-color').fill('#eeaa55');
  const point = await pixel(page, 1, 1);
  await page.mouse.click(point.x, point.y);
  await page.getByRole('radio', { name: 'Select rectangle', exact: true }).check();
  const end = await pixel(page, 3, 3);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  const selected = await page
    .locator('#art-canvas')
    .evaluate((n) => (n instanceof HTMLCanvasElement ? n.toDataURL() : ''));
  await page.screenshot({ path: info.outputPath('artwork.png') });
  await activateScene(page);
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#zoom')).toHaveValue('6');
  await expect
    .poll(() => page.locator('#viewport').evaluate((n) => [n.scrollLeft, n.scrollTop]))
    .toEqual(sceneView);
  await page.locator('#document-switcher').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-document')).toHaveText('Workshop · Scene · Modified');
  await page.screenshot({ path: info.outputPath('documents.png') });
  await page.locator('#artwork-documents button').filter({ hasText: 'Grass' }).click();
  await expect(page.locator('#art-color')).toHaveValue('#cc7744');
  await expect(page.locator('#art-zoom')).toHaveValue('32');
  await page.locator('#art-layers-toggle').click();
  await expect(page.locator('#art-layer')).toHaveValue(layer);
  await chooseArtwork(page, 'Player');
  await expect(page.locator('#art-frame')).toHaveValue('f1');
  await expect(page.locator('#art-sequence')).toHaveValue('walk');
  await expect(page.locator('#art-color')).toHaveValue('#eeaa55');
  await expect(page.getByRole('radio', { name: 'Select rectangle', exact: true })).toBeChecked();
  expect(
    await page
      .locator('#art-canvas')
      .evaluate((n) => (n instanceof HTMLCanvasElement ? n.toDataURL() : '')),
  ).toBe(selected);
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('#redo').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.setViewportSize({ width: 800, height: 640 });
  await page.locator('#document-switcher').click();
  await page.screenshot({ path: info.outputPath('documents-compact.png') });
});

test('external artwork preserves dirty history, then follows when Undo returns to the saved base', async ({
  page,
  workspace,
}) => {
  const { project } = await setup(page, workspace);
  await openGrass(page);
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]));a=p.artwork.documents
item=next(d for d in a.list(p.catalog()['revision'])['documents'] if d['target']['atlas_id']=='grass')
c=a.open(item['target'],p.catalog()['revision'],item['artwork_revision'])
c=a.edit(c,[dict(x=0,y=0,rgba=[255,0,0,255])]);a.save(c)
`,
    project,
  ]);
  await page.locator('#art-canvas').focus();
  await expect(page.locator('#document-base-state')).toHaveText(
    'Live updates paused · unsaved edits',
  );
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#document-base-state')).toBeHidden();
  await expect(page.locator('#redo')).toBeDisabled();
});

test('failed and delayed checkpoints guard scene and project departures and preserve recovery', async ({
  page,
  workspace,
}) => {
  const { url, ids } = await setup(page, workspace, true);
  await openGrass(page);
  await page.route('**/api/artwork-draft-write', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'disk full' }),
    }),
  );
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  await chooseSavedScene(page, ids[1]);
  await expect(page.locator('#art-message')).toContainText('disk full');
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Grass · Artwork ▾');
  await page.locator('#switch-project').selectOption('/projects/two');
  await expect(page.locator('#status')).toContainText('disk full');
  await expect(page).toHaveURL(new URL(`projects/one/scenes/${ids[0]}`, url).href);
  await page.unroute('**/api/artwork-draft-write');
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/artwork-draft-write', async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('#document-switcher').click();
  await page.locator('#scene-document').click();
  await expect(page.locator('#document-switcher')).toBeDisabled();
  await expect(page.locator('#close-document')).toBeDisabled();
  // Duplicate navigation while a write is pending cannot start another transition.
  await page.locator('#scene-document').dispatchEvent('click');
  release();
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Workshop · Scene ▾');
  await chooseArtwork(page, 'Grass');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#switch-project').selectOption('/projects/two');
  await expect(page).toHaveURL(new URL('projects/two/', url).href);
  await page.goto(new URL('projects/one/', url).href);
  await page.locator('#library-options').evaluate((node) => {
    if (node instanceof HTMLDetailsElement) {
      node.open = true;
    }
  });
  await page.locator('#art-browse').click();
  await expect(page.locator('#art-recovery')).toContainText('Grass');
  await page.locator('#art-recovery button').filter({ hasText: 'Recover copy' }).first().click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
});

test('manual checks report a changed scene base without adopting over dirty work', async ({
  page,
  workspace,
}) => {
  const { project, ids } = await setup(page, workspace);
  await paint(page, 20, 20);
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
s=p.scenes.load(sys.argv[2])
s['scene']['cells'][0][1]='grass/artwork/0/0'
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
`,
    project,
    ids[0],
  ]);
  await page.locator('#project-commands').click();
  await page.locator('#check-external').click();
  await expect(page.locator('#document-base-state')).toHaveText('Saved base changed externally');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  if (await page.locator('#expand-scene-tools').isVisible()) {
    await page.locator('#expand-scene-tools').click();
  }
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
});

test('Documents releases a captured scene pan and stops outgoing artwork playback', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await page.locator('#zoom').selectOption('6');
  const viewport = page.locator('#viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) {
    throw Error('Expected scene viewport');
  }
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'middle' });
  await expect(viewport).toHaveAttribute('data-panning', 'true');
  await page.locator('#document-switcher').focus();
  await page.keyboard.press('Enter');
  await expect(viewport).toHaveAttribute('data-panning', 'false');
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#document-switcher')).toBeFocused();
  await openGrass(page);
  await page.locator('[data-asset="player/f0"]').click();
  await (await revealArtworkControl(page, 'art-sequence')).selectOption('walk');
  await page.locator('#art-play').click();
  await expect(page.locator('#art-play')).toHaveText('Pause');
  await page.locator('#document-switcher').click();
  await expect(page.locator('#art-play')).toHaveText('Play');
  await page.locator('#artwork-documents button').filter({ hasText: 'Grass' }).click();
  await chooseArtwork(page, 'Player');
  await (await revealArtworkControl(page, 'art-play')).waitFor({ state: 'visible' });
  await expect(page.locator('#art-play')).toHaveText('Play');
});

test('Close document releases clean scenes and artwork, preserves assets and restores retained context', async ({
  page,
  workspace,
}, info) => {
  const { ids, url } = await setup(page, workspace);
  await openGrass(page);
  await page.locator('[data-asset="player/f0"]').click();
  await page.locator('#art-frame').selectOption('f1');
  await page.locator('#close-document').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Grass · Artwork ▾');
  await expect(page.locator('#art-canvas')).toBeFocused();
  await expect(page.locator('#artwork-documents button')).toHaveCount(1);
  await activateScene(page);
  await page.locator('#close-document').click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Grass · Artwork ▾');
  await page.locator('#close-document').click();
  await expect(page.locator('#empty-scene')).toBeVisible();
  await expect(page.locator('#close-document')).toBeDisabled();
  await expect(page.locator('#artwork-documents button')).toHaveCount(0);
  await expect(page.locator('#viewport')).toBeFocused();
  await page.screenshot({ path: info.outputPath('close-empty-desktop.png') });
  await page.setViewportSize({ width: 800, height: 640 });
  await page.screenshot({ path: info.outputPath('close-empty-compact.png') });
  await chooseSavedScene(page, ids[0]);
  await openGrass(page);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('#close-document').click();
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Workshop · Scene ▾');
  await page.goBack();
  await expect(page.locator('#empty-scene')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Workshop · Scene ▾');
});

test('dirty scene close protects cancel, failed save/checkpoint and recoverable drafts', async ({
  page,
  workspace,
}, info) => {
  const { ids } = await setup(page, workspace);
  await paint(page, 20, 20);
  await page.locator('#close-document').click();
  await expect(page.locator('#close-document-cancel')).toBeFocused();
  await page.screenshot({ path: info.outputPath('close-confirm-desktop.png') });
  await page.setViewportSize({ width: 800, height: 640 });
  await page.screenshot({ path: info.outputPath('close-confirm-compact.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#close-document')).toBeFocused();
  await page.route('**/api/save-scene', (route) =>
    route.fulfill({ status: 400, json: { error: 'save unavailable' } }),
  );
  await page.locator('#close-document').click();
  await page.locator('#close-document-save').click();
  await expect(page.locator('#status')).toContainText('save unavailable');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.unroute('**/api/save-scene');
  await page.route('**/api/checkpoint-draft', (route) =>
    route.fulfill({ status: 400, json: { error: 'disk full' } }),
  );
  await page.locator('#close-document').click();
  await page.locator('#close-document-keep').click();
  await expect(
    page.locator('.notification-message').filter({ hasText: 'Could not confirm' }),
  ).toBeVisible();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.unroute('**/api/checkpoint-draft');
  await page.locator('#close-document').click();
  await page.locator('#close-document-keep').click();
  await expect(page.locator('#empty-scene')).toBeVisible();
  await chooseSavedScene(page, ids[0]);
  await expect(page.locator('#recovery-dialog')).toBeVisible();
  await page.locator('#recovery-restore').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#close-document').click();
  await page.locator('#close-document-save').click();
  await expect(page.locator('#empty-scene')).toBeVisible();
  await chooseSavedScene(page, ids[0]);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#recovery-dialog')).not.toBeVisible();
});

test('artwork close keeps recoverable work and unrelated dirty scene and artwork histories', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await paint(page, 20, 20);
  await openGrass(page);
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  await page.locator('[data-asset="player/f0"]').click();
  await page.locator('#art-color').fill('#00aa55');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  await page.locator('#close-document').click();
  await page.locator('#close-document-cancel').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.route('**/api/artwork-draft-write', (route) =>
    route.fulfill({ status: 400, json: { error: 'checkpoint unavailable' } }),
  );
  await page.locator('#close-document').click();
  await page.locator('#close-document-keep').click();
  await expect(page.locator('#art-message')).toContainText('checkpoint unavailable');
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Player · Artwork ▾');
  await page.unroute('**/api/artwork-draft-write');
  await page.locator('#close-document').click();
  await page.locator('#close-document-keep').click();
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Grass · Artwork ▾');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#undo')).toBeEnabled();
  await activateScene(page);
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#library-options').evaluate((node) => {
    if (node instanceof HTMLDetailsElement) {
      node.open = true;
    }
  });
  await page.locator('#art-browse').click();
  await expect(page.locator('#art-recovery')).toContainText('Player');
  await page.locator('#art-recovery button').filter({ hasText: 'Recover copy' }).first().click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#close-document').click();
  await page.locator('#close-document-discard').click();
  await expect(page.locator('#artwork-documents button')).toHaveCount(1);
});

test('artwork Save and close requires exact review and successful save; cancelling closing retains work', async ({
  page,
  workspace,
}, info) => {
  await setup(page, workspace);
  await openGrass(page);
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  await page.locator('#close-document').click();
  await page.locator('#close-document-save').click();
  await expect(page.locator('#save')).toHaveText('Confirm save and close');
  await expect(page.locator('#art-cancel-close')).toBeVisible();
  await page.screenshot({ path: info.outputPath('close-artwork-review-desktop.png') });
  await page.setViewportSize({ width: 800, height: 640 });
  await page.screenshot({ path: info.outputPath('close-artwork-review-compact.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/artwork-save', (route) =>
    route.fulfill({ status: 409, json: { error: 'revision conflict' } }),
  );
  await page.locator('#save').click();
  await expect(page.locator('#art-message')).toContainText('revision conflict');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.unroute('**/api/artwork-save');
  await page.locator('#art-cancel-close').click();
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await page.locator('#save').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Grass · Artwork ▾');
  await page.locator('#art-canvas').click({ position: { x: 36, y: 36 } });
  await page.locator('#close-document').click();
  await page.locator('#close-document-save').click();
  await expect(page.locator('#save')).toHaveText('Confirm save and close');
  await page.locator('#save').click();
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Workshop · Scene ▾');
  await expect(page.locator('#artwork-documents button')).toHaveCount(0);
  await openGrass(page);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('#art-color').fill('#112233');
  await page.locator('#art-canvas').click({ position: { x: 48, y: 48 } });
  await page.locator('#save').click();
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await page.locator('#close-document').click();
  await page.locator('#close-document-save').click();
  await expect(page.locator('#save')).toHaveText('Confirm save and close');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#art-review-close').click();
  await page.locator('#save').click();
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await page.locator('#save').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#document-switcher')).toHaveText('Documents · Grass · Artwork ▾');
});

test('scene save and close retains the confirmed revision if checkpoint cleanup fails', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await paint(page, 20, 20);
  await expect(page.locator('#draft-status')).toContainText('checkpoint saved');
  await page.route('**/api/delete-draft', (route) =>
    route.fulfill({ status: 400, json: { error: 'cannot remove scene checkpoint' } }),
  );
  await page.locator('#close-document').click();
  await page.locator('#close-document-save').click();
  await expect(
    page
      .locator('.notification-message')
      .filter({ hasText: 'cannot remove scene checkpoint' })
      .first(),
  ).toBeVisible();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.unroute('**/api/delete-draft');
  await page.locator('#layer-name').fill('Continue after successful save');
  await page.locator('#layer-name').press('Tab');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#close-document').click();
  await page.locator('#close-document-save').click();
  await expect(page.locator('#empty-scene')).toBeVisible();
});

test('failed checkpoint cleanup keeps Scene and Artwork open until explicit retry succeeds', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await paint(page, 20, 20);
  await expect(page.locator('#draft-status')).toContainText('checkpoint saved');
  await page.route('**/api/delete-draft', (route) =>
    route.fulfill({ status: 400, json: { error: 'cannot remove scene checkpoint' } }),
  );
  await page.locator('#close-document').click();
  await page.locator('#close-document-discard').click();
  await expect(
    page
      .locator('.notification-message')
      .filter({ hasText: 'cannot remove scene checkpoint' })
      .first(),
  ).toBeVisible();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.unroute('**/api/delete-draft');
  await page.locator('#close-document').click();
  await page.locator('#close-document-discard').click();
  await expect(page.locator('#empty-scene')).toBeVisible();
  await page.locator('[data-asset="grass/artwork"]').click();
  await page.locator('#art-color').fill('#cc7744');
  const checkpoint = page.waitForResponse('**/api/artwork-draft-write');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  await checkpoint;
  await page.route('**/api/artwork-draft-delete', (route) =>
    route.fulfill({ status: 400, json: { error: 'cannot remove artwork checkpoint' } }),
  );
  await page.locator('#close-document').click();
  await page.locator('#close-document-discard').click();
  await expect(page.locator('#art-message')).toContainText('cannot remove artwork checkpoint');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.unroute('**/api/artwork-draft-delete');
  await page.locator('#close-document').click();
  await page.locator('#close-document-discard').click();
  await expect(page.locator('#empty-scene')).toBeVisible();
  await expect(page.locator('#close-document')).toBeDisabled();
});
