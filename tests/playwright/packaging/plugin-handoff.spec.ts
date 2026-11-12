/** Installed native-client calls alternate with real browser gestures and fresh threads. */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { array, record, string } from '../../../frontend/shared/decode.mts';
import { decodeCandidate } from '../../../frontend/artwork/artwork-contracts.mts';
import { scenePoint } from '../support/browser-fixtures.ts';
import {
  adoptAgentDraft,
  revealArtworkControl,
  reviewArtwork,
  saveArtwork,
} from '../support/artwork-controls.ts';

type Data = Record<string, unknown>;

test('installed plugin preserves browser artwork and scenes across fresh native threads', async ({
  page,
}, info) => {
  test.skip(
    !process.env.FORGE_TEST_PLUGIN_ARCHIVE || !process.env.FORGE_TEST_CODEX,
    'Requires a macOS arm64 repository plugin archive and a native Codex client',
  );
  test.setTimeout(300000);
  const child = spawn(
    process.env.FORGE_TEST_PYTHON || '.venv/bin/python',
    [
      'tests/packaging/plugin_handoff_driver.py',
      '--archive',
      resolve(string(process.env.FORGE_TEST_PLUGIN_ARCHIVE)),
      '--codex',
      resolve(string(process.env.FORGE_TEST_CODEX)),
      '--output',
      info.outputPath('installed'),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let diagnostics = '';
  child.stderr.on('data', (data: Buffer) => (diagnostics += data.toString()));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const exited = new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  const read = async () => {
    const line = await lines.next();
    if (line.done) {
      throw Error(`Installed driver exited: ${diagnostics}`);
    }
    return record(JSON.parse(line.value));
  };
  const command = async (data: Data) => {
    child.stdin.write(JSON.stringify(data) + '\n');
    return read();
  };
  const raw = (tool: string, args: Data = {}, client = 'first') =>
    command({ action: 'call', client, tool, arguments: args });
  const call = async (tool: string, args: Data = {}, client = 'first') => {
    const result = await raw(tool, args, client);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return record(result.structuredContent);
  };
  const project = 'handoff';
  const catalog = (client = 'first') => call('get_project', { project }, client);
  const open = async (client = 'first') => {
    const revision = (await catalog(client)).revision;
    const inventory = await call('list_artwork', { project, project_revision: revision }, client);
    const item = array(inventory.documents, record).find(
      (entry) => record(entry.target).atlas_id === 'tile',
    );
    if (!item) {
      throw Error('Saved tile absent from fresh inventory');
    }
    return call(
      'open_artwork',
      {
        project,
        target: item.target,
        artwork_revision: item.artwork_revision,
        project_revision: revision,
        compact: true,
      },
      client,
    );
  };
  const pixels = async (candidate: Data, client = 'first') =>
    Buffer.from(
      decodeCandidate(await call('export_artwork_candidate', { project, candidate }, client)).rgba,
      'base64',
    );
  const edit = (candidate: Data, x: number, rgba: number[], client = 'first') =>
    call('edit_artwork_pixels', { project, candidate, writes: [{ x, y: 0, rgba }] }, client);
  const review = (candidate: Data, client = 'first') =>
    call('review_artwork_candidate', { project, candidate }, client);
  const commit = async (candidate: Data, client = 'first') =>
    call(
      'commit_artwork',
      { project, candidate, receipt: (await review(candidate, client)).receipt },
      client,
    );
  let completed = false;
  try {
    const provenance = await read();
    await info.attach('provenance.json', {
      body: JSON.stringify(
        { ...provenance, chromium: page.context().browser()?.version() },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    const created = await call('create_project', { name: 'Handoff' });
    let candidate = await call('create_artwork', {
      project,
      project_revision: created.revision,
      atlas_id: 'tile',
      name: 'Handoff tile',
      kind: 'tile',
      width: 8,
      height: 8,
      compact: true,
    });
    const expected = Buffer.from(Array(64).fill([40, 60, 80, 255]).flat());
    candidate = await call('edit_artwork_pixels', {
      project,
      candidate,
      patch: { rectangle: { x: 0, y: 0, width: 8, height: 8 }, rgba: expected.toString('base64') },
    });
    await commit(candidate);
    const oldInventory = await call('list_artwork', {
      project,
      project_revision: (await catalog()).revision,
    });
    const oldItem = array(oldInventory.documents, record)[0];
    const opened = await call('plugin_browser', { project, action: 'open' });
    const origin = string(opened.url);
    await page.goto(origin);
    await expect(page.locator('#show-artwork')).toBeEnabled();
    await page.locator('[data-asset="tile/artwork"]').click();
    await (await revealArtworkControl(page, 'art-grid')).uncheck();
    const dab = async (x: number, color: string) => {
      await page.locator('#art-color').fill(color);
      const canvas = page.locator('#art-canvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      if (!box) {
        throw Error('Artwork canvas has no bounds');
      }
      const zoom = Number(await page.locator('#art-zoom').inputValue());
      await page.mouse.click(box.x + (x + 0.5) * zoom, box.y + 0.5 * zoom);
    };
    await dab(0, '#00ff00');
    await saveArtwork(page);
    await (await revealArtworkControl(page, 'art-zoom')).selectOption('1');
    expected.set([0, 255, 0, 255], 0);
    expect(await pixels(await open())).toEqual(expected);
    const staleArtwork = await raw('open_artwork', {
      project,
      target: oldItem.target,
      project_revision: (await catalog()).revision,
      artwork_revision: oldItem.artwork_revision,
    });
    expect(staleArtwork.isError).toBe(true);
    expect(record(record(staleArtwork.structuredContent).error).message).toContain(
      'Artwork changed',
    );
    const freshInventory = await call('list_artwork', {
      project,
      project_revision: (await catalog()).revision,
    });
    const staleProject = await raw('open_artwork', {
      project,
      target: oldItem.target,
      project_revision: oldInventory.project_revision,
      artwork_revision: array(freshInventory.documents, record)[0].artwork_revision,
    });
    expect(staleProject.isError).toBe(true);
    expect(record(record(staleProject.structuredContent).error).message).toContain(
      'Project changed',
    );
    const oldThread = await command({ action: 'fresh', client: 'second' });
    await command({ action: 'close', client: 'first' });
    const resumedThread = await command({ action: 'fresh', client: 'first' });
    expect(resumedThread.thread).not.toEqual(provenance.initial_thread);
    expect((await call('plugin_status')).selection).toEqual(provenance.selection_record);
    // Discovery uses saved identity in the new thread, never remembered candidate JSON.
    expect(await pixels(await open())).toEqual(expected);
    candidate = await edit(await open(), 1, [0, 0, 255, 255]);
    const report = await review(candidate);
    const preview = record(record(report.after).native_resource);
    await commit(candidate);
    expected.set([0, 0, 255, 255], 4);
    await page.bringToFront();
    await expect(page.locator('#art-document-state')).toHaveText('Saved');
    await expect
      .poll(() =>
        page.locator('#art-canvas').evaluate((node) => {
          if (!(node instanceof HTMLCanvasElement)) {
            throw Error('Expected artwork canvas');
          }
          const context = node.getContext('2d');
          if (!context) {
            throw Error('Expected canvas context');
          }
          return [...context.getImageData(1, 0, 1, 1).data];
        }),
      )
      .toEqual([0, 0, 255, 255]);
    await page.reload();
    await expect(page.locator('#show-artwork')).toBeEnabled();
    await page.locator('[data-asset="tile/artwork"]').click();
    expect(await pixels(await open())).toEqual(expected);
    await (await revealArtworkControl(page, 'art-zoom')).selectOption('16');
    await page.screenshot({ path: info.outputPath('saved-artwork-handoff.png') });
    await (await revealArtworkControl(page, 'art-zoom')).selectOption('1');

    // A competing native session wins after review; no stale receipt/base may overwrite it.
    const loser = await edit(await open(), 2, [255, 0, 0, 255]);
    const loserReview = await review(loser);
    const winner = await edit(await open('second'), 3, [255, 255, 0, 255], 'second');
    await commit(winner, 'second');
    expected.set([255, 255, 0, 255], 12);
    expect(
      (await raw('commit_artwork', { project, candidate: loser, receipt: loserReview.receipt }))
        .isError,
    ).toBe(true);
    expect(await pixels(await open())).toEqual(expected);
    expect((await pixels(loser)).subarray(8, 12)).toEqual(Buffer.from([255, 0, 0, 255]));

    // Dirty browser review becomes stale during MCP save; preserve checkpoint and history.
    await page.reload();
    await expect(page.locator('#show-artwork')).toBeEnabled();
    await page.locator('[data-asset="tile/artwork"]').click();
    await dab(2, '#ff0000');
    await reviewArtwork(page);
    candidate = await edit(await open(), 4, [255, 0, 255, 255]);
    await commit(candidate);
    expected.set([255, 0, 255, 255], 16);
    await page.locator('#save').click();
    await expect(page.locator('#art-message')).toContainText('Local pixels are retained');
    await expect(page.locator('#undo')).toBeEnabled();
    await page.locator('#undo').click();
    await page.locator('#redo').click();
    expect(await pixels(await open())).toEqual(expected);
    await page.screenshot({ path: info.outputPath('dirty-artwork-conflict.png') });

    // Retained unpublished candidates survive process restart; preview resources do not.
    const draft = await edit(await open(), 5, [0, 255, 255, 255]);
    const draftBytes = await pixels(draft);
    const draftReview = await review(draft);
    await command({ action: 'close', client: 'first' });
    const freshThread = await command({ action: 'fresh', client: 'first' });
    expect(freshThread.thread).not.toEqual(oldThread.thread);
    const retained = await call('list_artwork_candidates', { project });
    expect(array(retained.candidates, record).map((entry) => entry.handle)).toContain(draft.handle);
    expect(await pixels(draft)).toEqual(draftBytes);
    const expired = await command({ action: 'resource', client: 'first', uri: preview.uri });
    expect(JSON.stringify(expired)).toMatch(/expired|unknown/i);
    // Review receipts bind exact content; an edit after review requires a new review.
    const changedDraft = await edit(draft, 7, [255, 255, 255, 255]);
    expect(
      (
        await raw('commit_artwork', {
          project,
          candidate: changedDraft,
          receipt: draftReview.receipt,
        })
      ).isError,
    ).toBe(true);
    await page.reload();
    await page.locator('#show-artwork').click();
    await revealArtworkControl(page, 'art-drafts');
    await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
    await expect(page.locator('#art-message')).toContainText('Local pixels are retained');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const checkpointPath = info.outputPath('conflicting-artwork.json');
    await (await download).saveAs(checkpointPath);
    const checkpoint = record(JSON.parse(await readFile(checkpointPath, 'utf8')));
    const local = Buffer.from(expected);
    local.set([255, 0, 0, 255], 8);
    local.set([40, 60, 80, 255], 16); // Local checkpoint predates the winning magenta edit.
    expect(Buffer.from(decodeCandidate(checkpoint.candidate).rgba, 'base64')).toEqual(local);
    // Explicit adoption gives the browser a separate copy; the retained source is immutable.
    await page.reload();
    await page.locator('#show-artwork').click();
    await (await revealArtworkControl(page, 'art-handoff-list')).click();
    await adoptAgentDraft(page, string(draft.revision));
    await dab(6, '#ffffff');
    await (await revealArtworkControl(page, 'art-handoff-return')).click();
    await expect(page.locator('#art-handoff-result')).not.toHaveText('');
    const returned = record(JSON.parse(await page.locator('#art-handoff-result').innerText()));
    expect(await pixels(draft)).toEqual(draftBytes);
    const returnedBytes = Buffer.from(draftBytes);
    returnedBytes.set([255, 255, 255, 255], 24);
    expect(await pixels(returned)).toEqual(returnedBytes);
    expect(await pixels(await open())).toEqual(expected);
    await call('release_artwork_candidate', { project, candidate: changedDraft });
    expect(
      (await raw('export_artwork_candidate', { project, candidate: changedDraft })).isError,
    ).toBe(true);
    expect(await pixels(returned)).toEqual(returnedBytes);
    await page.screenshot({ path: info.outputPath('unpublished-handoff.png') });

    // Scene save/read/refine uses the same installed runtime and explicit saved scene URL.
    const scene = await call('create_scene', {
      project,
      project_revision: (await catalog()).revision,
      name: 'Room',
      width: 8,
      height: 8,
      grid: 8,
    });
    const sceneId = string(scene.id);
    const load = (client = 'first') => call('get_scene', { project, scene_id: sceneId }, client);
    const guards = (saved: Data) => ({
      project,
      scene_id: sceneId,
      project_revision: saved.project_revision,
      scene_revision: saved.revision,
    });
    const savedScene = record((await load()).scene);
    const tileLayer = (value: Data) => (value.layers ? array(value.layers, record)[0] : value);
    const layerId = tileLayer(savedScene).id ?? 1;
    const paint = async (x: number, client = 'first', dry = false) => {
      const saved = await load(client);
      const proposed = await call(
        'edit_scene',
        {
          ...guards(saved),
          dry_run: true,
          operations: [
            {
              op: 'paint_tiles',
              layer_id: layerId,
              cells: [{ x, y: 0, tile: 'tile/artwork/0/0' }],
            },
          ],
        },
        client,
      );
      if (dry) {
        return proposed;
      }
      await call('review_artwork', { ...guards(saved), scene: proposed.scene }, client);
      return call('save_scene', { ...guards(saved), scene: proposed.scene }, client);
    };
    const sceneLink = await call('plugin_browser', { project, action: 'open', scene_id: sceneId });
    await page.goto(string(sceneLink.url));
    await expect(page.locator('#status')).toHaveText('Scene opened.');
    await expect(page.locator('#show-artwork')).toBeEnabled();
    await expect(page.locator('#scene')).toBeVisible();
    await page.locator('#artwork-tab').click();
    await page.locator('#palette button.asset').first().click();
    const point = await scenePoint(page, 4, 4);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('#dirty')).toHaveText('UNSAVED');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toHaveText('Scene saved.');
    const manual = structuredClone(record((await load()).scene));
    await command({ action: 'fresh', client: 'first' });
    expect((await load()).scene).toEqual(manual);
    const refined = await paint(1);
    const expectedScene = structuredClone(manual);
    const expectedLayer = tileLayer(expectedScene);
    const cells = array(expectedLayer.cells, (row) => array(row, (value) => value));
    cells[0][1] = 'tile/artwork/0/0';
    expectedLayer.cells = cells;
    expect(refined.scene).toEqual(expectedScene);
    await page.bringToFront();
    await expect(page.locator('#status')).toContainText('External changes loaded');
    const paintedPoint = await scenePoint(page, 12, 4);
    await expect
      .poll(() =>
        page.locator('#scene').evaluate((node, point) => {
          if (!(node instanceof HTMLCanvasElement)) {
            throw Error('Expected scene canvas');
          }
          const box = node.getBoundingClientRect();
          const context = node.getContext('2d');
          if (!context) {
            throw Error('Expected scene context');
          }
          return [
            ...context.getImageData(
              Math.floor(((point.x - box.x) * node.width) / box.width),
              Math.floor(((point.y - box.y) * node.height) / box.height),
              1,
              1,
            ).data,
          ];
        }, paintedPoint),
      )
      .toEqual([40, 60, 80, 255]);
    await page.reload();
    expect((await load()).scene).toEqual(expectedScene);
    await expect(page.locator('#status')).toHaveText('Scene opened.');
    await expect(page.locator('#scene')).toBeVisible();
    await page.screenshot({ path: info.outputPath('saved-scene-handoff.png') });
    const stale = await load();
    const proposed = await paint(2, 'first', true);
    await call('review_artwork', { ...guards(stale), scene: proposed.scene });
    await paint(3, 'second');
    expect((await raw('save_scene', { ...guards(stale), scene: proposed.scene })).isError).toBe(
      true,
    );
    const staleScene = await raw('save_scene', {
      ...guards(stale),
      project_revision: (await catalog()).revision,
      scene: proposed.scene,
    });
    expect(staleScene.isError).toBe(true);
    expect(record(record(staleScene.structuredContent).error).code).toBe('conflict');
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Scene opened.');
    await expect(page.locator('#show-artwork')).toBeEnabled();
    await expect(page.locator('#scene')).toBeVisible();
    await page.locator('#artwork-tab').click();
    await page.locator('#palette button.asset').first().click();
    const dirtyPoint = await scenePoint(page, 20, 4);
    await page.mouse.click(dirtyPoint.x, dirtyPoint.y);
    await expect(page.locator('#draft-status')).toHaveText('Draft checkpoint saved');
    const beforeExternal = await load();
    const external = await paint(4, 'second');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('changed');
    await expect(page.locator('#dirty')).toHaveText('UNSAVED');
    await expect(page.locator('#undo')).toBeEnabled();
    expect((await load()).scene).toEqual(external.scene);
    expect((await load()).revision).not.toEqual(beforeExternal.revision);
    await page.screenshot({ path: info.outputPath('dirty-scene-conflict.png') });
    await call('plugin_browser', { project, action: 'stop', instance: sceneLink.instance });
    const restarted = await call('plugin_browser', { project, action: 'open', scene_id: sceneId });
    expect(restarted.url).toEqual(sceneLink.url);
    expect(restarted.instance).not.toEqual(sceneLink.instance);
    await page.reload();
    await expect(page.locator('#recovery-dialog')).toBeVisible();
    await page.locator('#recovery-restore').click();
    await expect(page.locator('#recovery-dialog .form-error')).toContainText('changed');
    const sceneDownload = page.waitForEvent('download');
    await page.locator('#recovery-download').click();
    const sceneCheckpointPath = info.outputPath('conflicting-scene.json');
    await (await sceneDownload).saveAs(sceneCheckpointPath);
    const sceneCheckpoint = record(JSON.parse(await readFile(sceneCheckpointPath, 'utf8')));
    const localScene = structuredClone(record(beforeExternal.scene));
    const localLayer = tileLayer(localScene);
    const localCells = array(localLayer.cells, (row) => array(row, (value) => value));
    localCells[0][2] = 'tile/artwork/0/0';
    localLayer.cells = localCells;
    expect(sceneCheckpoint.scene).toEqual(localScene);
    expect((await load()).scene).toEqual(external.scene);
    await page.screenshot({ path: info.outputPath('scene-checkpoint-restart.png') });

    // A changed global selection revokes existing sessions; the same alias must not retarget.
    await command({ action: 'selection', alternate: true });
    const revoked = await call('plugin_status');
    expect(revoked.selection).toBeNull();
    expect(string(revoked.error)).toContain('Selection changed');
    expect((await raw('get_project', { project })).isError).toBe(true);
    await command({ action: 'fresh', client: 'third' });
    expect((await call('list_projects', {}, 'third')).projects).toEqual([]);
    await command({ action: 'selection', alternate: false });
    await command({ action: 'fresh', client: 'first' });
    expect((await load()).scene).toEqual(external.scene);
    expect(await pixels(await open())).toEqual(expected);
    const exported = decodeCandidate(
      await call('export_artwork_candidate', { project, candidate: returned }),
    );
    expect(Buffer.from(exported.rgba, 'base64')).toEqual(returnedBytes);
    const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
    const result = {
      ...provenance,
      selection_record: undefined,
      chromium: page.context().browser()?.version(),
      source_sha256: Object.fromEntries(
        await Promise.all(
          [
            'tests/playwright/packaging/plugin-handoff.spec.ts',
            'tests/packaging/plugin_handoff_driver.py',
            'tests/packaging/plugin_distribution_smoke.py',
          ].map(async (path): Promise<[string, string]> => [path, hash(await readFile(path))]),
        ),
      ),
      saved_rgba_sha256: hash(expected),
      returned_rgba_sha256: hash(returnedBytes),
      saved_scene: external.scene,
      assertions: [
        'saved artwork and scene discovery in fresh native threads',
        'exact browser-gesture preservation and targeted refinement',
        'visible clean-document adoption and reload',
        'simultaneous-session and dirty-browser save conflicts',
        'stale project/artwork/scene guards and changed review candidate',
        'retained unpublished adoption/return and explicit handle release',
        'expired preview resource after process restart',
        'exact conflicting checkpoints and managed server restart',
        'selection revocation and rediscovery',
      ],
      limits:
        'Synthetic directory grant and gestures; no model turns, human manual edit, ' +
        'independent OS users, native folder dialog or additional platform/client coverage.',
    };
    await writeFile(info.outputPath('handoff-result.json'), JSON.stringify(result, null, 2) + '\n');
    completed = true;
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 25000);
    try {
      const code = await exited;
      if (completed) {
        expect(code, diagnostics).toBe(0);
      }
    } finally {
      clearTimeout(timer);
      await info.attach('handoff-driver.log', { body: diagnostics, contentType: 'text/plain' });
    }
  }
});
