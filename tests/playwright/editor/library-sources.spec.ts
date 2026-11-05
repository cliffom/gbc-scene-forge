/** Source-specific Library actions preserve local work and require explicit copy choice. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeProject } from '../../../frontend/project/project-contracts.mts';
import { record } from '../../../frontend/shared/decode.mts';
import { test, expect, activateScene, chooseSavedScene } from '../support/browser-fixtures.ts';
import { revealArtworkControl } from '../support/artwork-controls.ts';

const create = `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Library sources')
a=p.artwork.documents
for name in ('first','other'):
    a.save(a.create(name,name.title(),'sprite',16,16,p.catalog()['revision']))
frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*16,y=0,width=16,height=16,origin=[4,8]) for i in range(2)]
a.save(a.create_sheet('player','Player','sprite',32,16,p.catalog()['revision'],frames=frames,sequences=[]))
`;

test('source metadata follows filtered artwork without changing the scene brush', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `${create}
a.save(a.create('tiles','Tile cells','tile',16,16,p.catalog()['revision']))
p.scenes.create('Metadata scene',8,6,8,p.catalog()['revision'])
p.scenes.create('Larger grid',8,6,32,p.catalog()['revision'])
`,
    root,
  ]);
  await page.setViewportSize({ width: 800, height: 640 });
  const url = await workspace.start(root);
  await page.goto(url);
  await chooseSavedScene(page, { label: 'Metadata scene' });
  async function catalog() {
    const response = await page.request.get(new URL('api/project', url).href);
    expect(response.ok()).toBe(true);
    return decodeProject(record(await response.json()).project);
  }
  const before = await catalog();
  await page.locator('[data-asset="tiles/artwork"]').click();
  const tileBrush = await page.locator('#selected-brush').textContent();
  await page.locator('#search').fill('player');
  await page.locator('#library-source-actions').click();
  await expect(page.locator('#library-source-name')).toHaveText('player');
  await page.locator('#edit-tile').click();
  await expect(page.locator('#tile-cell option')).toHaveText(['player/f0']);
  await expect(page.locator('#tile-transition-fields')).toBeHidden();
  await page.screenshot({ path: info.outputPath('filtered-source-metadata.png') });
  await page.locator('#tile-terrain').fill('actor');
  await page.locator('#tile-solid').check();
  await page.locator('#tile-save').click();
  await expect(page.locator('#tile-dialog')).toBeHidden();
  let saved = await catalog();
  expect(saved.atlases.player.metadata.sprites['player/f0'].terrain).toBe('actor');
  expect(saved.atlases.player.metadata.sprites['player/f0'].solid).toBe(true);
  expect(saved.atlases.tiles.metadata).toEqual(before.atlases.tiles.metadata);
  await expect(page.locator('#selected-brush')).toHaveText(tileBrush ?? '');

  await page.locator('#search').fill('first');
  await page.locator('[data-asset="first/artwork"]').click();
  const spriteBrush = await page.locator('#selected-brush').textContent();
  await page.locator('#search').fill('tiles');
  await page.locator('#library-source-actions').click();
  await expect(page.locator('#library-source-name')).toHaveText('tiles');
  await page.locator('#edit-tile').click();
  await expect(page.locator('#tile-cell option')).toHaveText([
    'tiles/artwork/0/0',
    'tiles/artwork/1/0',
    'tiles/artwork/0/1',
    'tiles/artwork/1/1',
  ]);
  await expect(page.locator('#tile-transition-fields')).toBeVisible();
  await page.locator('#tile-cell').selectOption('1');
  await page.locator('#tile-terrain').fill('path');
  await page.locator('#tile-save').click();
  await expect(page.locator('#tile-dialog')).toBeHidden();
  saved = await catalog();
  expect(saved.atlases.tiles.metadata['8']['tiles/artwork/1/0'].terrain).toBe('path');
  expect(saved.atlases.first.metadata).toEqual(before.atlases.first.metadata);
  await expect(page.locator('#selected-brush')).toHaveText(spriteBrush ?? '');

  await chooseSavedScene(page, { label: 'Larger grid' });
  await page.locator('#library-source-actions').click();
  await expect(page.locator('#edit-tile')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('#search').fill('no matching source');
  await expect(page.locator('#library-source-actions')).toBeDisabled();
  await expect(page.locator('#edit-tile')).toBeDisabled();
});

test('long artwork names and Library source actions fit supported pane widths', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  const longId = 'twilight_coronation_card_full_artwork_with_a_long_source_name';
  const longRegion = 'princess_twilight_sparkle_coronation_full_artwork';
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `${create}
for source, region in [(sys.argv[2], sys.argv[3]), ('x'*64, 'y'*64)]:
    a.save(a.create(source,'Long artwork','sprite',16,16,p.catalog()['revision'],region=region))
`,
    root,
    longId,
    longRegion,
  ]);
  await page.goto(await workspace.start(root));
  const asset = page.locator(`[data-asset="${longId}/${longRegion}"]`);
  await expect(asset).toBeVisible();
  await expect(asset).toHaveAttribute('title', `${longId}/${longRegion} · sprite · 16 × 16px`);
  await expect(asset.locator('.asset-name')).toHaveText(longId.replaceAll('_', ' '));
  await expect(asset.locator('.asset-region')).toHaveText(longRegion.replaceAll('_', ' '));
  await expect(page.locator('[data-asset="first/artwork"]')).toHaveText('first');
  await expect(page.locator('#palette .asset .type')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Project assets', exact: true })).toHaveCount(0);
  await asset.click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await activateScene(page);
  for (const width of [1440, 1024, 760]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.locator('#palette').evaluate((palette) => {
        const rows = [...palette.querySelectorAll('.asset')];
        return (
          palette.scrollWidth <= palette.clientWidth &&
          rows.every((row) => {
            const label = row.querySelector('.asset-name');
            if (!label) {
              return false;
            }
            const bounds = row.getBoundingClientRect();
            const name = label.getBoundingClientRect();
            return (
              name.width >= 85 &&
              name.right <= bounds.right &&
              name.height <= parseFloat(getComputedStyle(label).lineHeight) * 2 + 1
            );
          })
        );
      }),
    ).toBe(true);
    await asset.scrollIntoViewIfNeeded();
    await page.locator('#library-source-actions').click();
    await expect(page.locator('#library-source-name')).toHaveText(longId);
    expect(
      await page.locator('#source-command-panel').evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight &&
          panel.scrollWidth <= panel.clientWidth
        );
      }),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`long-artwork-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.locator('#library-source-actions').click();
  await page.locator('#library-update-source').click();
  await expect(page.locator('#import-atlas-dialog')).toBeVisible();
  await expect(page.locator('#generic-id')).toHaveValue(longId);
  await expect(page.locator('#reimport')).toBeChecked();
  await expect(page.locator('#sheet-reimport')).toBeChecked();
  await page.keyboard.press('Escape');
  await page.locator('#library-source-actions').click();
  await page.locator('#library-delete-source').click();
  await expect(page.locator('#delete-atlas-description')).toContainText(longId);
  await page.keyboard.press('Escape');
  await asset.click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(asset).toBeVisible();
  await expect(page.locator('#palette h3')).toHaveCount(0);
  await asset.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('artwork-library-names.png') });
});

test('no-scene artwork creation restores the scene Library category and opens the requested pose', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, ['-I', '-c', create, root]);
  await page.goto(await workspace.start(root));
  await page.locator('#objects-tab').click();
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-new-document').click();
  await expect(page.locator('#artwork-panel')).toBeVisible();
  await expect(page.locator('#objects-panel')).toBeHidden();
  await page.locator('#art-name').fill('Independent illustration');
  await page.locator('#art-kind').selectOption('sprite');
  await page.locator('#art-width').fill('375');
  await page.locator('#art-height').fill('525');
  await page.locator('#art-create').click();
  await expect(page.locator('#art-document-state')).toHaveText('New');
  await activateScene(page);
  await expect(page.locator('#objects-tab')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#artwork-tab').click();
  await page.locator('#search').fill('player');
  await page.locator('#library-options').evaluate((node) => {
    if (node instanceof HTMLDetailsElement) {
      node.open = true;
    }
  });
  await page.locator('#kind-filter').selectOption('sprite');
  await page.locator('[data-asset="player/f1"]').click();
  await expect(page.locator('#art-frame')).toHaveValue('f1');
  await expect(page.locator('#search')).toHaveValue('player');
  await expect(page.locator('#kind-filter')).toHaveValue('sprite');
  await page.locator('#library-source-actions').focus();
  await page.keyboard.press('Enter');
  await page.locator('#library-copy-source').click();
  await expect(page.locator('#art-source')).toHaveValue('3');
  await expect(page.locator('#art-open')).toBeEnabled();
  await expect(page.locator('#art-source-help')).toContainText('shared original');
  await page.locator('#art-open').click();
  await expect(page.locator('#art-frame')).toHaveValue('f1');
  await page.locator('#document-switcher').click();
  await expect(page.locator('#artwork-documents button').filter({ hasText: 'Player' })).toHaveCount(
    1,
  );
  await page.locator('#document-chooser-close').click();
  await page.locator('#library-source-actions').click();
  await page.locator('#library-copy-source').click();

  await expect(page.locator('#art-copy-help')).toContainText('animation timing');
  await expect(page.locator('#art-variation-help')).toContainText('Save the scene');
  await page.locator('#art-name').fill('Independent pose');
  await page
    .locator('#art-duplicate')
    .evaluate((n) => n.closest('details')?.setAttribute('open', ''));
  await page.locator('#art-duplicate').click();
  await expect(page.locator('#document-switcher')).toContainText('Independent pose');
  await page.locator('#document-switcher').click();
  await expect(page.locator('#artwork-documents')).toContainText('Independent illustration');
  await expect(page.locator('#artwork-documents')).toContainText('Player');
});

test('deleted copy sources stay unavailable across discovery without clearing entered fields', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, ['-I', '-c', create, root]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="first/artwork"]').click();
  await page.locator('#library-source-actions').click();
  await page.locator('#library-copy-source').click();
  await page.locator('#art-name').fill('Keep this copy name');
  await (await revealArtworkControl(page, 'art-id')).fill('keep_copy_identity');
  await page.locator('#project-name').click();
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
p.artwork.delete_atlas('first',p.catalog()['revision'])
`,
    root,
  ]);
  await expect(page.locator('#art-source')).toHaveValue('-1');
  await expect(page.locator('#art-source-help')).toContainText('no longer available');
  await expect(page.locator('#art-name')).toHaveValue('Keep this copy name');
  await expect(page.locator('#art-id')).toHaveValue('keep_copy_identity');
  for (const id of ['art-open', 'art-duplicate-sheet', 'art-duplicate', 'art-variation']) {
    await expect(page.locator('#' + id)).toBeDisabled();
  }
  await page.locator('#project-commands').click();
  await page.locator('#check-external').click();
  await expect(page.locator('#art-source')).toHaveValue('-1');
  await page.screenshot({ path: info.outputPath('deleted-source-fields.png') });
  await page.locator('#art-source').selectOption('0');
  await expect(page.locator('#art-open')).toBeEnabled();
  await expect(page.locator('#art-name')).toHaveValue('Keep this copy name');
});
