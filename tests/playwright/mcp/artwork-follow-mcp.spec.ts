/** Follow committed artwork through the real stdio MCP writer, never over local work. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../support/browser-fixtures.ts';
import { record, array, string } from '../../../frontend/shared/decode.mts';
import { decodeCandidate } from '../../../frontend/artwork/artwork-contracts.mts';
import { PixelModel } from '../../../frontend/artwork/pixel-model.mts';
import {
  revealArtworkControl,
  activeArtworkLayer,
  selectArtworkLayer,
} from '../support/artwork-controls.ts';

const execute = promisify(execFile);
async function setup(
  page: Page,
  workspace: { folder: string; python: string; start: (root: string) => Promise<string> },
  sheet = false,
) {
  const root = join(workspace.folder, 'project');
  await execute(workspace.python, [
    '-I',
    '-c',
    `
import sys,uuid
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.create(Path(sys.argv[1]),'Live artwork review')
a=p.artwork.documents
for name in ['picture','other']:
 if name=='picture' and sys.argv[2]=='sheet':
  frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*32,y=0,width=32,height=64,origin=[0,0]) for i in range(2)]
  c=a.create_sheet(name,name.title(),'sprite',64,64,p.catalog()['revision'],frames=frames,sequences=[])
  c=layers.edit(c,[dict(id=str(uuid.uuid4()),name=n,visible=True,locked=False,opacity=255) for n in ['Base','Detail']])
 else:
  c=a.create(name,name.title(),'sprite',64,64,p.catalog()['revision'])
 a.save(c)
`,
    root,
    sheet ? 'sheet' : 'flat',
  ]);
  const url = await workspace.start(root);
  await page.goto(url);
  await page.locator(`[data-asset="picture/${sheet ? 'f0' : 'artwork'}"]`).click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  const call = async (tool: string, args: Record<string, unknown>) => {
    // Arguments travel through stdin, including arbitrary candidate pixels/metadata.
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        process.env.FORGE_MCP_PYTHON || workspace.python,
        ['tests/support/mcp_call.py', root, tool],
        { maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => (error ? reject(new Error(error.message)) : resolve(stdout)),
      );
      child.stdin?.end(JSON.stringify({ project: 'project', ...args }));
    });
    return record(JSON.parse(result));
  };
  const commit = async (rgba: number[], atlas = 'picture') => {
    const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
    const listing = await call('list_artwork', { project_revision: catalog.revision });
    const item = array(listing.documents, record).find((d) => record(d.target).atlas_id === atlas);
    if (!item) {
      throw Error('Expected saved artwork');
    }
    let candidate = await call('open_artwork', {
      target: item.target,
      project_revision: catalog.revision,
      artwork_revision: item.artwork_revision,
    });
    const layer = array(
      record(candidate.descriptor).layers ? record(record(candidate.descriptor).layers).items : [],
      record,
    )[0];
    candidate = await call('edit_artwork_pixels', {
      candidate,
      writes: [{ x: 2, y: 2, rgba }],
      ...(layer ? { layer_id: layer.id } : {}),
    });
    if (sheet) {
      const descriptor = record(candidate.descriptor);
      candidate = await call('edit_artwork_layout', {
        candidate,
        frames: array(descriptor.frames, record).map((f) =>
          f.id === 'f1' ? { ...f, name: 'Updated pose' } : f,
        ),
        sequences: descriptor.sequences,
      });
    }
    const review = await call('review_artwork_candidate', { candidate });
    await call('commit_artwork', { candidate, receipt: review.receipt });
  };
  return { commit, call, url };
}
const pixel = (page: Page) =>
  page.locator('#art-canvas').evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) {
      throw Error('Expected artwork canvas');
    }
    const canvas = node;
    const center = Math.floor((2.5 * canvas.width) / 64);
    const context = canvas.getContext('2d');
    if (!context) {
      throw Error('Expected artwork context');
    }
    return Array.from(context.getImageData(center, center, 1, 1).data);
  });

test('clean artwork follows repeated MCP commits, preserves view and retires old history', async ({
  page,
  workspace,
}, info) => {
  const { commit } = await setup(page, workspace);
  await page.locator('#art-zoom').selectOption('8');
  await page.locator('#art-canvas').focus();
  // Own saves retain Undo; a truly clean document can adopt external content.
  await page.locator('#art-canvas').click({ position: { x: 30, y: 30 } });
  await page.locator('#save').click();
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await page.locator('#save').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#art-canvas').focus();
  const view = await page.locator('.art-canvas-scroll').evaluate((n) => {
    n.scrollLeft = 100;
    n.scrollTop = 90;
    return [n.scrollLeft, n.scrollTop];
  });
  await commit([255, 0, 0, 255]);
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#redo')).toBeDisabled();
  await expect(page.locator('#art-zoom')).toHaveValue('8');
  const updatedView = await page
    .locator('.art-canvas-scroll')
    .evaluate((n) => [n.scrollLeft, n.scrollTop]);
  for (const [index, offset] of updatedView.entries()) {
    expect(Math.abs(offset - view[index])).toBeLessThanOrEqual(1);
  }
  await expect(page.locator('#art-canvas')).toBeFocused();
  await commit([0, 255, 0, 255]);
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0, 255]);
  await expect(page.locator('#art-sync')).toBeHidden();
  await expect(page.locator('#document-base-state')).toBeHidden();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  // Capture an overview after checking the retained panned view above.
  await page.locator('#art-fit').click();
  await page.screenshot({ path: info.outputPath('live-artwork-review.png') });
  await page.setViewportSize({ width: 800, height: 640 });
  await (await revealArtworkControl(page, 'art-fit')).click();
  await page.screenshot({ path: info.outputPath('live-artwork-review-compact.png') });
});

test('dirty artwork stays local and offers download, cancel and explicit load latest', async ({
  page,
  workspace,
}, info) => {
  const { commit } = await setup(page, workspace);
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 10, y: 10 } });
  await commit([255, 0, 0, 255]);
  await expect(page.locator('#art-sync-status')).toContainText('Live updates paused');
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#undo')).toBeEnabled();
  const before = await pixel(page);
  expect(before).not.toEqual([255, 0, 0, 255]);
  await page.setViewportSize({ width: 800, height: 640 });
  await page.screenshot({ path: info.outputPath('paused-artwork-review-compact.png') });
  await page.locator('#art-sync-load').click();
  await expect(page.locator('#art-reload-dialog')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.locator('#art-reload-download').click();
  expect((await downloaded).suggestedFilename()).toBe('artwork-work.json');
  await page.locator('#art-reload-cancel').click();
  expect(await pixel(page)).toEqual(before);
  await page.locator('#art-sync-load').click();
  await page.locator('#art-reload-confirm').click();
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#art-sync')).toBeHidden();
});

test('Undo after a rejected competing save preserves Redo and edited recovery through reload', async ({
  page,
  workspace,
}, info) => {
  const { commit, url } = await setup(page, workspace);
  const post = async (route: string, data = {}) => {
    const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
    const response = await page.request.post(new URL(`api/${route}`, url).href, {
      data,
      headers: { 'X-Scene-Token': string(catalog.token) },
    });
    expect(response.ok()).toBe(true);
    return record(await response.json());
  };
  const saved = async () => {
    const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
    const listing = await post('artwork-list', { project_revision: catalog.revision });
    const item = array(listing.documents, record).find(
      (d) => record(d.target).atlas_id === 'picture',
    );
    expect(item).toBeDefined();
    return post('artwork-open', {
      target: item?.target,
      project_revision: catalog.revision,
      artwork_revision: item?.artwork_revision,
    });
  };
  await page.locator('#art-color').fill('#ffff00');
  const canvas = await page.locator('#art-canvas').boundingBox();
  if (!canvas) {
    throw Error('Expected canvas bounds');
  }
  await page.locator('#art-canvas').click({
    position: { x: (2.5 * canvas.width) / 64, y: (2.5 * canvas.height) / 64 },
  });
  await expect.poll(() => pixel(page)).toEqual([255, 255, 0, 255]);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await page.locator('#save').click();
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await commit([255, 0, 255, 255]);
  const winning = await saved();
  await page.locator('#save').click();
  await expect(page.locator('#art-message')).toContainText('Local pixels are retained');
  await page.locator('#art-review-close').click();
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#art-sync-status')).toContainText('Redo edits retained');
  // Wait beyond discovery and checkpoint debounce; neither may retire this branch.
  await page.waitForTimeout(2500);
  await expect(page.locator('#redo')).toBeEnabled();
  expect(await pixel(page)).not.toEqual([255, 0, 255, 255]);
  const drafts = array((await post('artwork-draft-list')).drafts, record);
  expect(drafts).toHaveLength(1);
  const draft = drafts[0];
  const download = () => post('artwork-draft-download', { id: draft.id, revision: draft.revision });
  const recovery = await download();
  const model = new PixelModel(decodeCandidate(recovery.candidate));
  expect(model.color({ x: 2, y: 2 })).toEqual([255, 255, 0, 255]);
  await page.screenshot({ path: info.outputPath('paused-redo-after-conflict.png') });
  await page.setViewportSize({ width: 800, height: 640 });
  await expect(page.locator('#art-sync-load')).toBeVisible();
  await page.screenshot({ path: info.outputPath('paused-redo-after-conflict-compact.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Switching documents must not silently retire the clean-looking checkpoint.
  await page.locator('[data-asset="other/artwork"]').click();
  await page.locator('[data-asset="picture/artwork"]').click();
  await expect(page.locator('#redo')).toBeEnabled();
  expect(await download()).toEqual(recovery);
  await page.locator('#art-sync-load').click();
  await expect(page.locator('#art-reload-dialog')).toBeVisible();
  await page.locator('#art-reload-cancel').click();
  await page.locator('#redo').click();
  await expect.poll(() => pixel(page)).toEqual([255, 255, 0, 255]);
  await page.screenshot({ path: info.outputPath('redo-retained-after-conflict.png') });
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  expect(await saved()).toEqual(winning);
  await page.reload();
  expect(await download()).toEqual(recovery);
  expect(await saved()).toEqual(winning);
});

test('an edit during a delayed read defeats adoption; preference and manual checks remain effective', async ({
  page,
  workspace,
}) => {
  const { commit } = await setup(page, workspace);
  let release!: () => void;
  let fetched!: () => void;
  const waiting = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/artwork-open', async (route) => {
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await commit([255, 0, 0, 255]);
  await waiting;
  await page.locator('#art-canvas').click({ position: { x: 12, y: 12 } });
  const local = await pixel(page);
  release();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#art-sync-status')).toContainText('Live updates paused');
  expect(await pixel(page)).toEqual(local);
  await page.unroute('**/api/artwork-open');
  await page.locator('#project-commands').click();
  await page.locator('#auto-refresh').uncheck();
  await page.locator('#project-command-panel').evaluate((n) => {
    if (n instanceof HTMLElement) {
      n.hidePopover();
    }
  });
  await page.locator('#undo').click();
  await page.waitForTimeout(2300);
  expect(await pixel(page)).not.toEqual([255, 0, 0, 255]);
  await page.locator('#project-commands').click();
  await page.locator('#check-external').click();
  await expect(page.locator('#art-sync-status')).toContainText('Redo edits retained');
  await expect(page.locator('#redo')).toBeEnabled();
  await page.locator('#art-sync-load').click();
  await page.locator('#art-reload-confirm').click();
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
});

test('background contention retries quietly, persistent errors recover inline, switched documents stay independent', async ({
  page,
  workspace,
}) => {
  const { commit } = await setup(page, workspace);
  let failures = 1;
  await page.route('**/api/project', async (route) => {
    if (failures > 0) {
      failures--;
      await route.fulfill({
        status: 400,
        json: { error: 'Another scene editor is applying changes. Try again when it finishes.' },
      });
    } else {
      await route.continue();
    }
  });
  await page.waitForTimeout(2300);
  await expect(page.locator('#art-sync')).toBeHidden();
  await expect(page.locator('.notification[data-severity="error"]')).toHaveCount(0);
  failures = 4;
  await expect(page.locator('#art-sync-status')).toContainText('Couldn’t check for updates');
  failures = 0;
  await page.locator('#art-sync-retry').click();
  await expect(page.locator('#art-sync')).toBeHidden();
  await page.unroute('**/api/project');
  await page.locator('[data-asset="other/artwork"]').click();
  await page.locator('#art-canvas').click({ position: { x: 12, y: 12 } });
  await commit([255, 0, 0, 255]);
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('[data-asset="picture/artwork"]').click();
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
  await page.locator('[data-asset="other/artwork"]').click();
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#undo')).toBeEnabled();
  await (await revealArtworkControl(page, 'art-discard')).click();
  await page.locator('#close-document-discard').click();
});

test('sheet updates retain the selected frame and source layer', async ({ page, workspace }) => {
  const { commit } = await setup(page, workspace, true);
  await page.locator('#art-frame').selectOption('f1');
  await page.locator('#art-frame-view').click();
  await selectArtworkLayer(page, 'Detail');
  const layer = await activeArtworkLayer(page).getAttribute('data-layer-id');
  await page.locator('#art-canvas').focus();
  const opened = page.waitForResponse('**/api/artwork-open');
  await commit([255, 0, 0, 255]);
  await opened;
  await expect(page.locator('#art-frame option[value="f1"]')).toHaveText('Updated pose');
  await expect(page.locator('#document-base-state')).toBeHidden();
  await expect(page.locator('#art-frame')).toHaveValue('f1');
  await expect(activeArtworkLayer(page)).toHaveAttribute('data-layer-id', layer ?? '');
  await expect(page.locator('#art-layer-panel')).toBeVisible();
  await expect(page.locator('#art-frame-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#document-state')).toHaveText('Saved');
});

test('removed artwork keeps the open canvas and offers download instead of replacement', async ({
  page,
  workspace,
}) => {
  const { call, url } = await setup(page, workspace);
  const before = await pixel(page);
  const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
  const args = { atlas_id: 'picture', project_revision: catalog.revision };
  const plan = await call('delete_artwork', { ...args, dry_run: true });
  await call('delete_artwork', { ...args, plan });
  await expect(page.locator('#art-sync-status')).toContainText('no longer available');
  await expect(page.locator('#art-sync-download')).toBeVisible();
  await expect(page.locator('#art-sync-load')).toBeHidden();
  expect(await pixel(page)).toEqual(before);
});

test('explicit checkpoint retirement guards edits before discarding a Redo branch', async ({
  page,
  workspace,
}) => {
  const { commit } = await setup(page, workspace);
  await page.locator('#art-canvas').click({ position: { x: 30, y: 30 } });
  await page.locator('#undo').click();
  await expect(page.locator('#art-draft-status')).toContainText('recovery checkpoint');
  await expect(page.locator('#redo')).toBeEnabled();
  let release!: () => void;
  let fetched!: () => void;
  const waiting = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/artwork-draft-delete', async (route) => {
    fetched();
    await gate;
    await route.continue();
  });
  await commit([255, 0, 0, 255]);
  await expect(page.locator('#art-sync-status')).toContainText('Redo edits retained');
  await page.locator('#art-sync-load').click();
  await page.locator('#art-reload-confirm').click();
  await waiting;
  await expect(page.locator('#art-color')).toBeDisabled();
  const before = await pixel(page);
  await page.locator('#art-canvas').click({ position: { x: 12, y: 12 } });
  expect(await pixel(page)).toEqual(before);
  release();
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#art-color')).toBeEnabled();
  await expect(page.locator('#redo')).toBeDisabled();
});

test('load latest cancels a pending checkpoint before delayed retirement', async ({
  page,
  workspace,
}) => {
  const { commit, url } = await setup(page, workspace);
  await page.locator('#art-canvas').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await commit([255, 0, 0, 255]);
  await expect(page.locator('#art-sync-status')).toContainText('Live updates paused');
  await page.clock.install();
  await page.clock.pauseAt(new Date());

  let releaseDelete!: () => void;
  let releaseEdit!: () => void;
  let deleting!: () => void;
  const deleteStarted = new Promise<void>((resolve) => {
    deleting = resolve;
  });
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const editGate = new Promise<void>((resolve) => {
    releaseEdit = resolve;
  });
  let edits = 0;
  await page.route('**/api/artwork-draft-delete', async (route) => {
    const response = await route.fetch();
    deleting();
    await deleteGate;
    await route.fulfill({ response });
  });
  await page.route('**/api/artwork-edit', async (route) => {
    edits++;
    await editGate;
    await route.continue();
  });
  try {
    await page.locator('#art-canvas').click({ position: { x: 20, y: 20 } });
    await page.locator('#art-sync-load').click();
    await page.locator('#art-reload-confirm').click();
    await deleteStarted;
    // The debounce must not start old-session work while deletion is in flight.
    await page.clock.runFor(400);
    releaseDelete();
    await expect(page.locator('#document-state')).toHaveText('Saved');
    releaseEdit();
    await page.clock.runFor(1000);
    expect(edits).toBe(0);
    expect(await pixel(page)).toEqual([255, 0, 0, 255]);
    const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
    const response = await page.request.post(new URL('api/artwork-draft-list', url).href, {
      data: {},
      headers: { 'X-Scene-Token': string(catalog.token) },
    });
    expect(response.ok()).toBe(true);
    expect(record(await response.json()).drafts).toEqual([]);
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#art-sync')).toBeHidden();
  } finally {
    releaseDelete();
    releaseEdit();
  }
});

test('a later MCP commit overtakes a delayed snapshot without adopting stale pixels', async ({
  page,
  workspace,
}) => {
  const { commit } = await setup(page, workspace);
  let release!: () => void;
  let fetched!: () => void;
  const waiting = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route('**/api/artwork-open', async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await commit([255, 0, 0, 255]);
  await waiting;
  await commit([0, 255, 0, 255]);
  release();
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0, 255]);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#art-sync')).toBeHidden();
});

test('pan capture prevents a fetched update from replacing the document until navigation finishes', async ({
  page,
  workspace,
}) => {
  const { commit } = await setup(page, workspace);
  const before = await pixel(page);
  let release!: () => void;
  let fetched!: () => void;
  const waiting = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/artwork-open', async (route) => {
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await commit([255, 0, 0, 255]);
  await waiting;
  await page.locator('#art-pan').click();
  const canvas = await page.locator('#art-canvas').boundingBox();
  if (!canvas) {
    throw Error('Expected canvas bounds');
  }
  await page.mouse.move(canvas.x + 20, canvas.y + 20);
  await page.mouse.down();
  release();
  await page.waitForTimeout(2300);
  expect(await pixel(page)).toEqual(before);
  await page.mouse.up();
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
});
