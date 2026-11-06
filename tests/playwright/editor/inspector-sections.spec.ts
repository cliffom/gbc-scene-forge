/** Artwork disclosure state is presentation, retained independently per document. */
import { record, string, number } from '../../../frontend/shared/decode.mts';
import { cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  test,
  expect,
  activateScene,
  chooseSavedScene,
  revealControl,
  setControl,
  paint,
} from '../support/browser-fixtures.ts';
import { revealArtworkControl, reviewArtwork } from '../support/artwork-controls.ts';

test('artwork Inspector disclosures retain independent state and keep keyboard focus visible', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  const scene = execFileSync(
    workspace.python,
    [
      '-I',
      '-c',
      `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.create(Path(sys.argv[1]),'Inspector sections')
a=p.artwork.documents
for key in ['picture','other']:
    c=a.create(key,key.title()+(' — A long artwork name that stays readable within the Inspector pane' if key=='picture' else ''),'sprite',16,16,p.catalog()['revision'])
    items=[layers.item('Layer '+str(i)) for i in range(7)]
    items.append(layers.item('A long artwork layer name that stays bounded in the Inspector'))
    a.save(layers.edit(c,items))
print(p.scenes.create('Workshop',16,16,8,p.catalog()['revision'])['id'])
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  const layers = page.locator('#art-layer-section');
  const properties = page.locator('#art-properties-section');
  const layerHeading = page.locator('#art-layers-toggle');
  const propertyHeading = page.locator('#art-properties-toggle');
  const list = page.locator('#art-layer-list');
  const palette = page.locator('#art-palette-section');
  const paletteHeading = page.locator('#art-palette-toggle');
  expect(
    await page
      .locator('#art-inspector-content > details')
      .evaluateAll((nodes) => nodes.map((n) => n.id)),
  ).toEqual(['art-properties-section', 'art-palette-section', 'art-layer-section']);
  await expect(page.locator('#art-document-pixels')).toHaveText('256');
  await expect(page.locator('#art-document-width')).toHaveText('16 px');
  await expect(page.locator('#art-document-name')).toHaveAccessibleName(
    /Artwork name: Picture — A long artwork name/,
  );
  await page.locator('#art-palette-layer').click();
  await page.locator('#art-palette-sort').selectOption('usage');
  await expect(layers).toHaveAttribute('open');
  await expect(properties).toHaveAttribute('open');
  await expect(page.locator('#art-layer-count')).toHaveText('8');
  await expect(page.locator('#undo')).toBeDisabled();

  await propertyHeading.click();
  await expect(properties).not.toHaveAttribute('open');
  await expect(list).toBeVisible();
  await layerHeading.focus();
  await page.keyboard.press('Enter');
  await expect(layers).not.toHaveAttribute('open');
  await expect(list).toBeHidden();
  await expect(page.locator('#art-layer-count')).toBeVisible();
  await paletteHeading.click();
  await expect(palette).not.toHaveAttribute('open');
  await propertyHeading.focus();
  await page.keyboard.press('Tab');
  await expect(paletteHeading).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(layerHeading).toBeFocused();
  await propertyHeading.focus();
  await page.keyboard.press('Space');
  await expect(properties).toHaveAttribute('open');
  await expect(page.locator('#art-document-geometry')).toBeVisible();
  await expect(layers).not.toHaveAttribute('open');

  // A collapse from a controller must also retire focus from hidden descendants.
  await layerHeading.click();
  await list.locator('.layer-grip').first().focus();
  await layers.evaluate((node) => {
    if (node instanceof HTMLDetailsElement) {
      node.open = false;
    }
  });
  await expect(layerHeading).toBeFocused();
  await expect(list).toBeHidden();
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#document-state')).toHaveText('Saved');

  await page.locator('#toggle-inspector').click();
  await expect(page.locator('#inspector-pane')).toBeHidden();
  await page.locator('[data-asset="other/artwork"]').click();
  await expect(page.locator('#document-switcher')).toContainText('Other');
  await expect(page.locator('#inspector-pane')).toBeHidden();
  await page.locator('#toggle-inspector').click();
  await expect(layers).toHaveAttribute('open');
  await expect(properties).toHaveAttribute('open');
  await propertyHeading.click();
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Picture' }).click();
  await expect(layers).not.toHaveAttribute('open');
  await expect(properties).toHaveAttribute('open');
  await expect(palette).not.toHaveAttribute('open');
  await expect(page.locator('#art-palette-layer')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#art-palette-sort')).toHaveValue('usage');
  await activateScene(page);
  await chooseSavedScene(page, scene);
  await page.locator('#scene-properties-toggle').click();
  await page.locator('#layers-heading').click();
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Picture' }).click();
  await expect(layers).not.toHaveAttribute('open');
  await expect(properties).toHaveAttribute('open');
  await activateScene(page);
  await expect(page.locator('#scene-panel')).not.toHaveAttribute('open');
  await expect(page.locator('#layers-panel')).not.toHaveAttribute('open');
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Picture' }).click();

  await reviewArtwork(page);
  await expect(layers).not.toHaveAttribute('open');
  await expect(properties).not.toHaveAttribute('open');
  await expect(layerHeading).toBeVisible();
  await expect(propertyHeading).toBeVisible();
  await layerHeading.click();
  await expect(page.locator('#art-review-panel')).toBeHidden();
  await expect(list).toBeVisible();
  await expect(properties).not.toHaveAttribute('open');
  await reviewArtwork(page);
  await propertyHeading.press('Enter');
  await expect(page.locator('#art-review-panel')).toBeHidden();
  await expect(properties).toHaveAttribute('open');
  await reviewArtwork(page);
  await paletteHeading.press('Space');
  await expect(page.locator('#art-review-panel')).toBeHidden();
  await expect(palette).toHaveAttribute('open');
  await expect(properties).not.toHaveAttribute('open');
  await reviewArtwork(page);
  await page.locator('#art-review-close').click();
  await expect(layers).not.toHaveAttribute('open');
  await expect(properties).not.toHaveAttribute('open');

  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [800, 640],
    [1440, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await revealArtworkControl(page, 'art-layer-list');
    await revealArtworkControl(page, 'art-document-geometry');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const stackBounds = await list.boundingBox();
    expect(stackBounds?.height).toBeLessThanOrEqual(Math.min(300, height * 0.4));
    await layerHeading.focus();
    await expect(layerHeading).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`${width}x${height}-expanded.png`) });
    await propertyHeading.focus();
    await expect(propertyHeading).toBeInViewport();
    await page.keyboard.press('Space');
    await layerHeading.press('Enter');
    await expect(list).toBeHidden();
    await expect(layerHeading).toBeInViewport();
    await expect(propertyHeading).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`${width}x${height}-collapsed.png`) });
  }
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#document-state')).toHaveText('Saved');
});

test('scene disclosures retain choices while selection rises and collapsed statuses remain useful', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  await cp('tests/playwright/support/fixtures/editor/project', root, { recursive: true });
  const seeded = record(
    JSON.parse(
      execFileSync(
        workspace.python,
        [
          '-I',
          '-c',
          `
import json, sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.formats import tiled
p=Project(Path(sys.argv[1]))
loaded=p.scenes.load(p.catalog()['project']['scenes'][0]['id'])
s=loaded['scene']
s=dict(width=s['width'],height=s['height'],grid=s['grid'],layers=tiled.scene_layers(s))
s['next_object_id']=max(o['id'] for l in s['layers'] for o in l.get('objects',[]))+1
objects=next(l for l in s['layers'] if l['type']=='objectgroup')['objects']
for kind,x in [('point',24),('rectangle',48)]:
    objects.append(dict(id=s['next_object_id'],kind=kind,x=x,y=24,name=kind.title(),**(dict(width=8,height=8) if kind=='rectangle' else {})))
    s['next_object_id']+=1
p.scenes.save(loaded['id'],s,loaded['revision'],p.catalog()['revision'])
print(json.dumps(dict(id=loaded['id'],width=s['width']*s['grid'],height=s['height']*s['grid'],grid=s['grid'])))
`,
          root,
        ],
        { encoding: 'utf8' },
      ),
    ),
  );
  await page.goto(await workspace.start(root));
  await chooseSavedScene(page, string(seeded.id));
  const properties = page.locator('#scene-panel');
  const layers = page.locator('#layers-panel');
  const selection = page.locator('#selection-panel');
  const validation = page.locator('#object-validation-section');
  const recovery = page.locator('#draft-recovery-section');
  const firstSection = () =>
    page
      .locator('#inspector-pane > details')
      .evaluateAll(
        (nodes) =>
          nodes
            .filter((n) => n.checkVisibility())
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]?.id,
      );
  expect(await firstSection()).toBe('scene-panel');
  await expect(page.locator('#inspector-width')).toHaveText(`${number(seeded.width)} px`);
  await expect(page.locator('#inspector-height')).toHaveText(`${number(seeded.height)} px`);
  await expect(page.locator('#inspector-pixels')).toHaveText(
    (number(seeded.width) * number(seeded.height)).toLocaleString(),
  );
  await expect(page.locator('#inspector-grid')).toHaveValue(`${number(seeded.grid)} px`);
  await expect(validation).not.toHaveAttribute('open');
  await expect(recovery).not.toHaveAttribute('open');
  await expect(page.locator('#object-validation-count')).not.toHaveText('No scene');
  await page.locator('#scene-properties-toggle').press('Enter');
  await expect(properties).not.toHaveAttribute('open');
  await expect(page.locator('#scene-properties-summary')).toHaveText(
    `${number(seeded.width)} × ${number(seeded.height)} px`,
  );
  await (await revealControl(page, 'layer-name')).focus();
  await layers.evaluate((node) => {
    if (node instanceof HTMLDetailsElement) {
      node.open = false;
    }
  });
  await expect(page.locator('#layers-heading')).toBeFocused();
  await page.locator('#layers-heading').press('Space');
  await page
    .getByRole('radio', { name: 'Sprites Objects · Visible', exact: true })
    .locator('..')
    .click();
  const options = await page
    .locator('#object-list option')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('value') || ''));
  for (const [index, kind] of ['SPRITE', 'POINT', 'RECTANGLE'].entries()) {
    await setControl(page, 'object-list', options[index]);
    await expect(selection).toHaveAttribute('open');
    await expect(page.locator('#selection-kind')).toHaveText(kind);
    expect(await firstSection()).toBe('selection-panel');
    if (index === 0) {
      await page.locator('#scene-properties-toggle').click();
      for (const [width, height] of [
        [1440, 900],
        [800, 640],
      ]) {
        await page.setViewportSize({ width, height });
        await page.locator('#inspector-pane').evaluate((node) => {
          node.scrollTop = 0;
        });
        await expect(page.locator('#selection-toggle')).toBeInViewport();
        await page.screenshot({ path: info.outputPath(`scene-selected-${width}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('#scene-properties-toggle').click();
    }
    await page.locator('#selection-toggle').press('Enter');
    await page.locator('input[name=tool][value=select]').check();
    await expect(selection).not.toHaveAttribute('open');
    await expect(properties).not.toHaveAttribute('open');
  }
  await page.locator('input[name=tool][value=select]').check();
  await paint(page, 24, 24);
  await page.keyboard.down('Shift');
  await paint(page, 50, 26);
  await page.keyboard.up('Shift');
  await expect(selection).toHaveAttribute('open');
  await expect(page.locator('#selection-kind')).toHaveText('OBJECTS');
  await page.locator('#layers [data-layer-id="1"] .layer-choice').click();
  await page.locator('#fit-scene').click();
  await page.locator('input[name=tool][value=select]').check();
  const start = await page.locator('#scene').boundingBox();
  if (!start) {
    throw Error('Expected scene');
  }
  await page.mouse.move(start.x + 2, start.y + 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 24, { steps: 3 });
  await page.mouse.up();
  await expect(selection).toHaveAttribute('open');
  await expect(page.locator('#selection-kind')).toContainText('TILE');
  await page.locator('#selection-toggle').click();
  await page.locator('#toggle-inspector').click();
  await page.locator('#review-mode').click();
  await page.locator('#review-mode').click();
  await expect(page.locator('#inspector-pane')).toBeHidden();
  await page.locator('#toggle-inspector').click();
  await expect(selection).not.toHaveAttribute('open');
  await expect(properties).not.toHaveAttribute('open');
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#deselect').click();
  await page.locator('#layers-panel > div > details > summary').click();
  await page.locator('#scene-properties-toggle').click();
  expect(await firstSection()).toBe('scene-panel');
  for (const [width, height] of [
    [1440, 900],
    [800, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#scene-properties-toggle').focus();
    await expect(page.locator('#scene-properties-toggle')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`scene-${width}.png`) });
  }
  await page.route('**/api/checkpoint-draft', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Inspector checkpoint failure' }),
    }),
  );
  await (await revealControl(page, 'layer-name')).fill('Recovery status');
  await page.locator('#layer-name').press('Tab');
  await expect(page.locator('#draft-recovery-summary')).toContainText(
    'Inspector checkpoint failure',
  );
  await expect(recovery).not.toHaveAttribute('open');
  await page.unroute('**/api/checkpoint-draft');
  await paint(page, 4, 4);
});
