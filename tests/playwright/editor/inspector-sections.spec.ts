/** Artwork disclosure state is presentation, retained independently per document. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, activateScene, chooseSavedScene } from '../support/browser-fixtures.ts';
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
    c=a.create(key,key.title(),'sprite',16,16,p.catalog()['revision'])
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
  await page.keyboard.press('Tab');
  await expect(propertyHeading).toBeFocused();
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
  await activateScene(page);
  await chooseSavedScene(page, scene);
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Picture' }).click();
  await expect(layers).not.toHaveAttribute('open');
  await expect(properties).toHaveAttribute('open');

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
