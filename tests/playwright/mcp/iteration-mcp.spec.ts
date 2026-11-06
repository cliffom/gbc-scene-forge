/** Real stdio candidate exchange and saved-library discovery with dirty artwork. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, activateScene } from '../support/browser-fixtures.ts';
import {
  revealArtworkControl,
  saveArtwork,
  adoptAgentDraft,
  selectArtworkLayer,
} from '../support/artwork-controls.ts';
import { record, string, array } from '../../../frontend/shared/decode.mts';
import { decodeCandidate } from '../../../frontend/artwork/artwork-contracts.mts';
import { PixelModel } from '../../../frontend/artwork/pixel-model.mts';

test('mcp: unpublished layered handoff, saved continuation, discovery and deletion preserve dirty local history', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  const python = process.env.FORGE_MCP_PYTHON || workspace.python;
  const encoded = execFileSync(
    python,
    [
      '-I',
      '-c',
      `
import sys,base64
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork.png import encode
p=Project.create(Path(sys.argv[1]),'Exchange')
c=p.artwork.documents.create('local','Local','sprite',16,16,p.catalog()['revision'])
p.artwork.documents.save(c)
print(base64.b64encode(encode(16,16,bytes([71,72,73,0])*256)).decode())
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  const call = (tool: string, args: Record<string, unknown>) =>
    record(
      JSON.parse(
        execFileSync(python, ['tests/support/mcp_call.py', root, tool], {
          input: JSON.stringify({ project: 'project', ...args }),
          encoding: 'utf8',
        }),
      ),
    );
  const url = await workspace.start(root);
  const catalog = async () =>
    record(await (await page.request.get(new URL('api/project', url).href)).json());
  await page.goto(url);
  await page.locator('[data-asset="local/artwork"]').click();
  await page.locator('#art-color').fill('#ff0000');
  await page.locator('#art-canvas').click({ position: { x: 12, y: 12 } });
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  const base = (await catalog()).revision;
  let candidate = call('import_artwork_png', {
    project_revision: base,
    atlas_id: 'agent',
    name: 'Agent',
    png: encoded,
    compact: true,
  });
  const layer = {
    id: crypto.randomUUID(),
    name: 'Source',
    visible: true,
    opacity: 255,
    locked: false,
  };
  const effect = { ...layer, id: crypto.randomUUID(), name: 'Glow', opacity: 160 };
  candidate = call('edit_artwork_layers', { candidate, layers: [layer, effect] });
  candidate = call('edit_artwork_raster', {
    candidate,
    layer_id: effect.id,
    operations: [
      {
        op: 'ellipse',
        rectangle: { x: 3, y: 3, width: 8, height: 8 },
        rgba: [255, 200, 40, 128],
        filled: true,
      },
    ],
  });
  const original = call('export_artwork_candidate', { candidate });
  await page.locator('#show-artwork').click();
  await (await revealArtworkControl(page, 'art-handoff-list')).click();
  await adoptAgentDraft(page, string(candidate.revision));
  await expect(page.locator('#art-message')).toContainText('Opened a separate editable copy');
  await expect(page.locator('#undo')).toBeDisabled();
  await selectArtworkLayer(page, 'Glow');
  await page.locator('#art-layer-opacity').fill('38');
  await page.locator('#art-layer-opacity').press('Enter');
  await page.locator('#art-color').fill('#00ff00');
  await page.locator('#art-canvas').click({ position: { x: 12, y: 12 } });
  await (await revealArtworkControl(page, 'art-handoff-return')).click();
  await expect(page.locator('#art-handoff-result')).toBeVisible();
  await page.screenshot({ path: info.outputPath('unpublished-handoff.png') });
  const returned = record(JSON.parse(await page.locator('#art-handoff-result').innerText()));
  expect(returned.owner).toBeTruthy();
  expect(returned.revision).not.toBe(candidate.revision);
  expect(call('export_artwork_candidate', { candidate })).toEqual(original);
  expect((await catalog()).revision).toEqual(base);
  const transferred = decodeCandidate(call('export_artwork_candidate', { candidate: returned }));
  expect(transferred.layer_rgba).toBeTruthy();
  expect(transferred.descriptor.layers?.items[1].opacity).toBe(97); // 38% in native bytes.
  expect(transferred.layer_rgba?.[layer.id]).toEqual(
    decodeCandidate(original).layer_rgba?.[layer.id],
  );
  candidate = call('edit_artwork_raster', {
    candidate: returned,
    layer_id: layer.id,
    operations: [{ op: 'replace', from: [71, 72, 73, 0], rgba: [81, 82, 83, 0] }],
  });
  const report = call('review_artwork_candidate', { candidate });
  await page.locator('#document-switcher').click();
  const ack = call('commit_artwork', { candidate, receipt: report.receipt });
  // Hold a real modal across a complete discovery interval.
  await page.waitForTimeout(2300);
  await expect(page.locator('[data-asset="agent/artwork"]')).toHaveCount(0);
  await page.locator('#document-chooser-close').click();
  await page.locator('#art-canvas').focus();
  await expect(page.locator('[data-asset="agent/artwork"]')).toBeVisible();
  await expect(page.locator('#art-document-state')).toHaveText('New');
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Local' }).click();
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#undo').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#redo').click();
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  // Open the saved revision explicitly; discovery never rebases the old candidate.
  await page.locator('[data-asset="agent/artwork"]').click();
  await (await revealArtworkControl(page, 'art-discard')).click();
  await page.locator('#close-document-discard').click();
  await page.locator('[data-asset="agent/artwork"]').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#art-color').fill('#0000ff');
  await page.locator('#art-canvas').click({ position: { x: 30, y: 30 } });
  await saveArtwork(page);
  const current = await catalog();
  const inventory = call('list_artwork', { project_revision: current.revision });
  const item = array(inventory.documents, record).find(
    (d) => record(d.target).atlas_id === 'agent',
  );
  if (!item) {
    throw Error('Expected saved agent artwork');
  }
  const resumed = decodeCandidate(
    call('open_artwork', {
      target: item.target,
      project_revision: current.revision,
      artwork_revision: item.artwork_revision,
    }),
  );
  expect(resumed.layer_rgba).toBeTruthy();
  const model = new PixelModel(resumed);
  expect([...model.composite()].some((v) => v !== 0)).toBe(true);
  expect(current.revision).not.toEqual(ack.project_revision);
  // Delete while another local document remains dirty; saved inventory changes only.
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Local' }).click();
  await page.locator('#project-commands').click();
  await page.locator('#auto-refresh').uncheck();
  const plan = call('delete_artwork', {
    atlas_id: 'agent',
    project_revision: current.revision,
    dry_run: true,
  });
  call('delete_artwork', { atlas_id: 'agent', project_revision: current.revision, plan });
  await page.waitForTimeout(2300);
  await expect(page.locator('[data-asset="agent/artwork"]')).toHaveCount(1);
  await page.locator('#project-commands').click();
  await page.locator('#check-external').click();
  await expect(page.locator('[data-asset="agent/artwork"]')).toHaveCount(0);
  await page.locator('#art-canvas').focus();
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('unpublished-and-saved-handoff.png') });
});

test('mcp: adopting saved edits retains the saved baseline through navigation, recovery and save', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  const python = process.env.FORGE_MCP_PYTHON || workspace.python;
  execFileSync(python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Adopt edits')
c=p.artwork.documents.create('picture','Picture','sprite',8,8,p.catalog()['revision'])
p.artwork.documents.save(c)
`,
    root,
  ]);
  const call = (tool: string, args: Record<string, unknown>) =>
    record(
      JSON.parse(
        execFileSync(python, ['tests/support/mcp_call.py', root, tool], {
          input: JSON.stringify({ project: 'project', ...args }),
          encoding: 'utf8',
        }),
      ),
    );
  const url = await workspace.start(root);
  const catalog = record(await (await page.request.get(new URL('api/project', url).href)).json());
  const inventory = call('list_artwork', { project_revision: catalog.revision });
  const item = array(inventory.documents, record)[0];
  let candidate = call('open_artwork', {
    target: item.target,
    artwork_revision: item.artwork_revision,
    project_revision: catalog.revision,
  });
  const layers = ['Red', 'Blue'].map((name) => ({
    id: crypto.randomUUID(),
    name,
    visible: true,
    opacity: 255,
    locked: false,
  }));
  candidate = call('edit_artwork_layers', { candidate, layers });
  for (const [index, rgba] of [
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ].entries()) {
    candidate = call('edit_artwork_pixels', {
      candidate,
      layer_id: layers[index].id,
      writes: [{ x: index, y: 0, rgba }],
    });
  }
  const report = call('review_artwork_candidate', { candidate });
  const ack = call('commit_artwork', { candidate, receipt: report.receipt });
  candidate = call('open_artwork', {
    target: item.target,
    artwork_revision: ack.artwork_revision,
    project_revision: ack.project_revision,
  });
  const original = decodeCandidate(call('export_artwork_candidate', { candidate }));
  candidate = call('edit_artwork_pixels', {
    candidate,
    layer_id: layers[1].id,
    writes: [{ x: 2, y: 0, rgba: [0, 255, 0, 255] }],
    compact: true,
  });
  const edited = decodeCandidate(call('export_artwork_candidate', { candidate }));
  await page.goto(url);
  await page.locator('#show-artwork').click();
  await (await revealArtworkControl(page, 'art-handoff-list')).click();
  await adoptAgentDraft(page, string(candidate.revision));
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await expect(page.locator('#undo')).toBeDisabled();
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/artwork-draft-write')) {
      writes++;
    }
  });
  const palette = page.locator('#art-swatches button');
  const colors = () =>
    palette.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rgba')));
  await revealArtworkControl(page, 'art-layer-list');
  await revealArtworkControl(page, 'art-palette');
  await page.getByRole('tab', { name: 'Selected layer', exact: true }).click();
  await expect.poll(colors).toContain('255,0,0,255');
  await expect.poll(colors).not.toContain('0,0,255,255');
  await page.keyboard.press('Escape');
  await selectArtworkLayer(page, 'Blue');
  await revealArtworkControl(page, 'art-palette');
  await expect.poll(colors).toContain('0,0,255,255');
  await expect.poll(colors).toContain('0,255,0,255');
  await expect.poll(colors).not.toContain('255,0,0,255');
  await page.keyboard.press('Escape');
  await selectArtworkLayer(page, 'Red');
  await revealArtworkControl(page, 'art-palette');
  await expect.poll(colors).toContain('255,0,0,255');
  await expect.poll(colors).not.toContain('0,0,255,255');
  await page.keyboard.press('Escape');
  await expect(page.locator('#undo')).toBeDisabled();
  expect(writes).toBe(0);
  await revealArtworkControl(page, 'art-palette');
  await page.screenshot({ path: info.outputPath('adopted-edit-palette.png') });
  await revealArtworkControl(page, 'art-palette');
  await activateScene(page);
  const post = async (action: string, data = {}) => {
    const response = await page.request.post(new URL('api/artwork-' + action, url).href, {
      data,
      headers: { 'X-Scene-Token': string(catalog.token) },
    });
    expect(response.status(), await response.text()).toBe(200);
    return record(await response.json());
  };
  const drafts = array((await post('draft-list')).drafts, record);
  expect(drafts).toHaveLength(1);
  const checkpoint = await post('draft-download', drafts[0]);
  expect(decodeCandidate(checkpoint.original).layer_rgba).toEqual(original.layer_rgba);
  expect(decodeCandidate(checkpoint.candidate).layer_rgba).toEqual(edited.layer_rgba);
  await page.reload();
  await page.locator('#show-artwork').click();
  await revealArtworkControl(page, 'art-drafts');
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await saveArtwork(page);
  const savedCatalog = record(
    await (await page.request.get(new URL('api/project', url).href)).json(),
  );
  const savedItem = array(
    call('list_artwork', { project_revision: savedCatalog.revision }).documents,
    record,
  )[0];
  const saved = decodeCandidate(
    call('open_artwork', {
      target: savedItem.target,
      artwork_revision: savedItem.artwork_revision,
      project_revision: savedCatalog.revision,
    }),
  );
  expect(saved.layer_rgba).toEqual(edited.layer_rgba);
});
