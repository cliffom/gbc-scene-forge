/** Artwork entry is read-only until explicit guarded adoption or creation. */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { test, expect, activateScene } from '../support/browser-fixtures.ts';
import type { Page } from '@playwright/test';
import { record } from '../../../frontend/shared/decode.mts';

const seed = `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork.candidates import ArtworkCandidates
from gbc_scene_forge.artwork.png import decode
p=Project.from_sample(Path(sys.argv[1]),title='Artwork setup')
a=p.artwork.documents
saved=a.create('saved','Saved picture','sprite',16,16,p.catalog()['revision'])
a.save(saved)
w,h,rgba=decode(Path(sys.argv[2]).read_bytes())
for i in range(int(sys.argv[3])):
 c=a.create(f'draft_{i}',('Courtyard stone and garden tile palette exploration ' * 2)[:100] if i==0 else f'Agent draft {i}','sprite',w,h,p.catalog()['revision'])
 c=a.edit(c,[dict(x=x,y=y,rgba=list(rgba[(y*w+x)*4:(y*w+x+1)*4])) for y in range(h) for x in range(w)])
 ArtworkCandidates(a).retain(c)
`;
function prepare(python: string, root: string, count = 7, extra = '') {
  execFileSync(python, [
    '-I',
    '-c',
    seed + extra,
    root,
    resolve('assets/demo/artwork/atlas.png'),
    String(count),
  ]);
}
async function snapshot(page: Page) {
  return record(await (await page.request.get(new URL('api/project', page.url()).href)).json());
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 800, height: 640 },
]) {
  test(`artwork setup has padded keyboard tabs, visual drafts and no editing commands at ${viewport.width}`, async ({
    page,
    workspace,
  }, info) => {
    const root = join(workspace.folder, 'project');
    prepare(workspace.python, root);
    await page.setViewportSize(viewport);
    await page.goto(await workspace.start(root));
    const before = await snapshot(page);
    let writes = 0;
    let downloads = 0;
    page.on('request', (request) => {
      if (/\/api\/artwork-(candidate-adopt|save|draft-write)$/.test(request.url())) {
        writes++;
      }
    });
    page.on('download', () => downloads++);
    await page.locator('#show-artwork').click();
    await expect(page.locator('#art-agent-count')).toHaveText('7');
    await expect(page.locator('#art-new-mode')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#art-create')).toBeInViewport();
    await expect(page.locator('#art-new-options')).not.toHaveAttribute('open');
    await expect(page.locator('#document-command-toolbar')).toBeHidden();
    await page.screenshot({ path: info.outputPath('new-artwork.png') });
    await page.locator('#art-new-mode').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#art-existing-mode')).toBeFocused();
    await expect(page.locator('#art-source-panel')).toBeVisible();
    await expect(page.locator('#document-command-toolbar')).toBeHidden();
    await page.screenshot({ path: info.outputPath('existing-artwork.png') });
    await page.keyboard.press('End');
    await expect(page.locator('#art-agent-mode')).toBeFocused();
    await expect(page.locator('#art-handoff')).toBeVisible();
    await expect(page.locator('#art-handoff-candidates section')).toHaveCount(7);
    const card = page.locator('#art-handoff-candidates button').first();
    await expect(card.locator('canvas')).toBeVisible();
    expect(
      await page
        .locator('#art-agent-mode')
        .evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft)),
    ).toBeGreaterThanOrEqual(10);
    await page.locator('#art-agent-mode').hover();
    await page.screenshot({ path: info.outputPath('agent-gallery.png') });
    const galleryBox = await page.locator('#art-handoff-candidates').boundingBox();
    expect(galleryBox && galleryBox.x + galleryBox.width).toBeLessThanOrEqual(viewport.width);
    await card.click();
    await expect(page.locator('#art-agent-image canvas')).toBeVisible();
    await expect(page.locator('#art-agent-details')).not.toHaveAttribute('open');
    await expect(page.locator('#art-agent-adopt')).toBeEnabled();
    await page.screenshot({ path: info.outputPath('agent-preview.png') });
    await page.locator('#art-agent-cancel').click();
    await expect(card).toBeFocused();
    expect(downloads).toBe(0);
    expect(writes).toBe(0);
    expect((await snapshot(page)).revision).toBe(before.revision);
    await page.locator('#art-agent-mode').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#art-new-mode')).toBeFocused();
    await expect(page.locator('#art-new-panel')).toBeVisible();
  });
}

test('agent listing and preview failures are retryable, and a dismissed read cannot reopen its dialog', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  prepare(workspace.python, root, 1);
  await page.goto(await workspace.start(root));
  await page.route(
    '**/api/artwork-candidate-list',
    (route) => route.fulfill({ status: 500, json: { error: 'Listing unavailable.' } }),
    { times: 1 },
  );
  await page.locator('#show-artwork').click();
  await expect(page.locator('#art-create')).toBeEnabled();
  await page.locator('#art-agent-mode').click();
  await expect(page.locator('#art-agent-status')).toContainText('Listing unavailable');
  await page.locator('#art-handoff-list').click();
  const card = page.locator('#art-handoff-candidates button').first();
  await expect(card.locator('canvas')).toBeVisible();
  await page.route(
    '**/api/artwork-candidate-export',
    (route) => route.fulfill({ status: 500, json: { error: 'Preview unavailable.' } }),
    { times: 1 },
  );
  await card.click();
  await expect(page.locator('#art-agent-preview-status')).toContainText('Could not load preview');
  await expect(page.locator('#art-agent-adopt')).toBeDisabled();
  await page.locator('#art-agent-details > summary').click();
  const download = page.waitForEvent('download');
  await page.locator('#art-agent-json').click();
  expect((await download).suggestedFilename()).toBe('draft_0-candidate.json');
  await page.locator('#art-agent-retry').click();
  await expect(page.locator('#art-agent-image canvas')).toBeVisible();
  await page.locator('#art-agent-close').click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const requested = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(
    '**/api/artwork-candidate-export',
    async (route) => {
      const response = await route.fetch();
      received();
      await gate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await card.click();
  await requested;
  await expect(page.locator('#art-agent-preview-status')).toHaveText('Loading preview…');
  await page.keyboard.press('Escape');
  const finished = page.waitForResponse('**/api/artwork-candidate-export');
  release();
  await finished;
  await expect(page.locator('#art-agent-preview')).not.toBeVisible();
  await expect(page.locator('#art-agent-image canvas')).toHaveCount(0);
});

test('stale agent draft previews and downloads remain available while guarded adoption rejects', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  prepare(
    workspace.python,
    root,
    1,
    "\na.save(a.create('later','Later saved artwork','tile',8,8,p.catalog()['revision']))\n",
  );
  await page.goto(await workspace.start(root));
  const before = await snapshot(page);
  await page.locator('#show-artwork').click();
  await page.locator('#art-agent-mode').click();
  await page.locator('#art-handoff-candidates button').first().click();
  await expect(page.locator('#art-agent-preview-status')).toContainText('project has changed');
  await page.locator('#art-agent-adopt').click();
  await expect(page.locator('#art-agent-preview-status')).toContainText(
    'original draft is retained',
  );
  await expect(page.locator('#art-agent-preview')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('#art-agent-png').click();
  expect((await download).suggestedFilename()).toBe('draft_0-draft.png');
  expect((await snapshot(page)).revision).toBe(before.revision);
  await page.screenshot({ path: info.outputPath('stale-agent-draft.png') });
});

test('setup shortcuts cannot edit retained artwork and its undo history returns with the document', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  prepare(workspace.python, root, 0);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="saved/artwork"]').click();
  await page.locator('#art-color').fill('#cc8833');
  await page.locator('#art-canvas').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#show-artwork').click();
  await expect(page.locator('#document-command-toolbar')).toBeHidden();
  for (const id of ['art-new-mode', 'art-existing-mode', 'art-agent-mode']) {
    await page.locator('#' + id).click();
    await page.locator('#' + id).focus();
    for (const key of ['Control+z', 'Control+Shift+z', 'Control+x', 'Control+v', 'Control+s']) {
      await page.keyboard.press(key);
    }
    await expect(page.locator('#document-command-toolbar')).toBeHidden();
  }
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Saved picture' }).click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#document-command-toolbar')).toBeVisible();
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('#redo').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).toBeHidden();
});

test('thumbnail exports start only in the gallery, remain bounded and cannot repopulate refreshed cards', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  prepare(workspace.python, root);
  await page.goto(await workspace.start(root));
  let requests = 0;
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/artwork-candidate-export', async (route) => {
    requests++;
    maximum = Math.max(maximum, ++active);
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
    active--;
  });
  await page.locator('#show-artwork').click();
  await expect(page.locator('#art-agent-count')).toHaveText('7');
  expect(requests).toBe(0);
  await page.locator('#art-agent-mode').click();
  await expect.poll(() => requests).toBe(2);
  await page.route(
    '**/api/artwork-candidate-list',
    (route) => route.fulfill({ json: { candidates: [] } }),
    { times: 1 },
  );
  await page.locator('#art-handoff-list').click();
  await expect(page.locator('#art-agent-status')).toContainText('No agent drafts yet');
  release();
  await expect.poll(() => active).toBe(0);
  expect(maximum).toBe(2);
  expect(requests).toBe(2);
  await expect(page.locator('#art-handoff-candidates canvas')).toHaveCount(0);
  await expect(page.locator('#art-agent-count')).toBeHidden();
});
