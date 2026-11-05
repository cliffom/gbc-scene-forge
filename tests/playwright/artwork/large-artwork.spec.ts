/** Full native card workflows, bounded zoom allocation and a useful exact-color palette. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { record, array, string } from '../../../frontend/shared/decode.mts';
import { test, expect, activateScene } from '../support/browser-fixtures.ts';
import { reviewArtwork, saveArtwork, revealArtworkControl } from '../support/artwork-controls.ts';

for (const [width, height] of [
  [384, 544],
  [375, 525],
  [411, 561],
  [750, 1050],
  [822, 1122],
  [1500, 2100],
]) {
  test(`single ${width}×${height} artwork edits, checkpoints, reviews, saves and reopens`, async ({
    page,
    workspace,
  }, info) => {
    test.setTimeout(180000);
    const root = join(workspace.folder, 'project');
    execFileSync(workspace.python, [
      '-I',
      '-c',
      `
from pathlib import Path
import sys
from gbc_scene_forge.project.application import Project
Project.create(Path(sys.argv[1]),'Card artwork')
`,
      root,
    ]);
    const url = await workspace.start(root);
    await page.goto(url);
    await page.locator('#show-artwork').click();
    await page.locator('#art-kind').selectOption('sprite');
    await expect(page.locator('#art-width')).toHaveAttribute('step', '1');
    await page.locator('#art-name').fill('Single card');
    await page.locator('#art-width').fill(String(width));
    await page.locator('#art-height').fill(String(height));
    const started = Date.now();
    await page.locator('#art-create').click();
    await expect(page.locator('#art-editor')).toBeVisible();
    expect(Number(await page.locator('#art-zoom').inputValue())).toBeLessThanOrEqual(1);
    await page.locator('#art-color').fill('#112233');
    await page.locator('#art-alpha').fill('0');
    const box = await page.locator('#art-canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      throw Error('Expected canvas');
    }
    const x = Math.floor(width / 2),
      y = Math.floor(height / 2);
    await page.mouse.click(
      box.x + ((x + 0.5) / width) * box.width,
      box.y + ((y + 0.5) / height) * box.height,
    );
    await expect(page.locator('#undo')).toBeEnabled();
    await page.locator('#undo').click();
    await page.locator('#redo').click();
    await expect(page.locator('#art-draft-status')).toContainText('checkpointed in this project.', {
      timeout: 60000,
    });
    const edited = Date.now();
    // Returning to the scene and recovering verifies the durable record, including
    // original plus edited envelopes larger than the previous HTTP request limit.
    await activateScene(page);
    await page.locator('#show-artwork').click();
    await revealArtworkControl(page, 'art-drafts');
    await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
    await expect(page.locator('#art-editor')).toBeVisible();
    await reviewArtwork(page);
    const reviewed = Date.now();
    const image = page.locator('#art-after');
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((img) =>
        img instanceof HTMLImageElement ? Math.max(img.naturalWidth, img.naturalHeight) : Infinity,
      ),
    ).toBeLessThanOrEqual(1024);
    await saveArtwork(page);
    const saved = Date.now();
    await activateScene(page);
    await page.reload();
    await page.locator('[data-asset="single_card/artwork"]').click();
    await expect(page.locator('#art-document-state')).toHaveText('Saved');
    const response = await page.request.get(new URL('api/project', url).href);
    const catalog = record(await response.json());
    const listing = await page.request.post(new URL('api/artwork-list', url).href, {
      headers: { 'X-Scene-Token': string(catalog.token) },
      data: { project_revision: catalog.revision },
    });
    const documents = array(record(await listing.json()).documents, record);
    expect(documents).toHaveLength(1);
    const document = documents[0];
    const opened = await page.request.post(new URL('api/artwork-open', url).href, {
      headers: { 'X-Scene-Token': string(catalog.token) },
      data: { ...document, project_revision: catalog.revision },
    });
    expect(opened.status()).toBe(200);
    const candidate = record(await opened.json());
    expect(candidate.descriptor).toMatchObject({ width, height });
    expect([
      ...Buffer.from(string(candidate.rgba), 'base64').subarray(
        (y * width + x) * 4,
        (y * width + x) * 4 + 4,
      ),
    ]).toEqual([17, 34, 51, 0]);
    await page.locator('#art-zoom').selectOption('32');
    expect(
      await page
        .locator('#art-canvas')
        .evaluate((node) =>
          node instanceof HTMLCanvasElement ? node.width * node.height : Infinity,
        ),
    ).toBeLessThanOrEqual(4_194_304);
    await page.locator('#art-fit').click();
    await info.attach('timings.json', {
      body: JSON.stringify({
        width,
        height,
        editCheckpointMs: edited - started,
        recoverReviewMs: reviewed - edited,
        saveMs: saved - reviewed,
        reopenMs: Date.now() - saved,
      }),
      contentType: 'application/json',
    });
    await page.screenshot({ path: info.outputPath('large-artwork.png') });
  });
}

for (const [width, height] of [
  [1024, 4096],
  [4096, 1024],
]) {
  test(`Fit keeps maximum-axis ${width}×${height} artwork inside short viewports`, async ({
    page,
    workspace,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    const root = join(workspace.folder, 'project');
    execFileSync(workspace.python, [
      '-I',
      '-c',
      'from pathlib import Path; import sys; from gbc_scene_forge.project.application import Project; Project.create(Path(sys.argv[1]), "Maximum-axis artwork")',
      root,
    ]);
    await page.goto(await workspace.start(root));
    await page.locator('#show-artwork').click();
    await page.locator('#art-kind').selectOption('sprite');
    await page.locator('#art-name').fill('Maximum axis');
    await page.locator('#art-width').fill(String(width));
    await page.locator('#art-height').fill(String(height));
    await page.locator('#art-create').click();
    await expect(page.locator('#art-fit')).toBeEnabled();
    const expectFitted = async () => {
      await expect
        .poll(() =>
          page.locator('#art-canvas').evaluate((canvas) => {
            const viewport = canvas.closest('.art-canvas-scroll');
            const bounds = canvas.getBoundingClientRect();
            return (
              viewport !== null &&
              bounds.width <= viewport.clientWidth &&
              bounds.height <= viewport.clientHeight
            );
          }),
        )
        .toBe(true);
    };
    // Opening artwork fits automatically, before the user presses Fit.
    await expectFitted();
    for (const viewport of [
      { width: 1440, height: 800 },
      { width: 760, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator('#art-zoom').selectOption('32');
      await page.locator('#art-fit').click();
      await expectFitted();
    }
    await page.screenshot({ path: info.outputPath('maximum-axis-fit.png') });
  });
}

test('palette dropdown exposes hue-sorted exact colors, keyboard selection and light dismissal', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
from pathlib import Path
import base64, colorsys, sys
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import editable
p=Project.create(Path(sys.argv[1]),'Palette workshop')
a=p.artwork.documents
c=a.create('spectrum','Spectrum card','sprite',375,525,p.catalog()['revision'])
palette=[bytes([round(v*255) for v in colorsys.hsv_to_rgb(i/96,0.65,0.9)]+[255]) for i in range(96)]
palette.extend([bytes([17,34,51,0]),bytes([17,34,51,128])])
raw=b''.join(palette[((y//16)*24+x//16)%len(palette)] for y in range(525) for x in range(375))
c=editable.seal({**{k:v for k,v in c.items() if k!='revision'},'rgba':base64.b64encode(raw).decode()})
a.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="spectrum/artwork"]').click();
  const trigger = page.locator('#art-palette-toggle');
  await trigger.click();
  await expect(page.locator('#art-palette')).toBeVisible();
  const swatches = page.locator('#art-swatches button');
  await expect(swatches).toHaveCount(97);
  await expect(page.locator('#art-palette-count')).toContainText('sorted by hue');
  const first = await swatches.nth(0).boundingBox(),
    second = await swatches.nth(1).boundingBox(),
    nextRow = await swatches.nth(12).boundingBox();
  expect(first?.y).toBe(second?.y);
  expect(nextRow?.y).toBeGreaterThan(first?.y ?? 0);
  await swatches.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(swatches.nth(12)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#art-palette')).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('#artwork-surface')).toBeVisible();
  await trigger.click();
  await page.getByRole('tab', { name: 'Selected layer', exact: true }).click();
  await expect(swatches).toHaveCount(98);
  await page.getByRole('button', { name: 'RGBA 17, 34, 51, 0', exact: true }).click();
  await expect(page.locator('#art-color')).toHaveValue('#112233');
  await expect(page.locator('#art-alpha')).toHaveValue('0');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#art-alpha').fill('999');
  await trigger.click();
  await expect(page.locator('#art-palette-color')).toHaveText('Choose an opacity within 0–255');
  await page.getByRole('button', { name: 'RGBA 17, 34, 51, 128', exact: true }).click();
  await expect(page.locator('#art-alpha')).toHaveValue('128');
  for (const width of [1440, 760]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    await expect(page.locator('#art-palette')).toBeVisible();
    const bounds = await page.locator('#art-palette').boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`palette-${width}.png`) });
    await page.locator('#project-name').click();
    await expect(page.locator('#art-palette')).toBeHidden();
  }
  await trigger.click();
  await page.setViewportSize({ width: 800, height: 640 });
  await expect(page.locator('#art-palette')).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await page.locator('#art-palette').boundingBox();
      return (
        !!bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 800 &&
        bounds.y + bounds.height <= 640
      );
    })
    .toBe(true);
  await page.locator('#project-name').click();
  await expect(page.locator('#art-palette')).toBeHidden();
});

test('detail review initializes new document bounds and restores retained document settings', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    'from pathlib import Path; import sys; from gbc_scene_forge.project.application import Project; Project.create(Path(sys.argv[1]), "Detail review")',
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('#show-artwork').click();
  await page.locator('#art-kind').selectOption('sprite');
  await page.locator('#art-name').fill('Large detail');
  await page.locator('#art-width').fill('375');
  await page.locator('#art-height').fill('525');
  await page.locator('#art-create').click();
  await reviewArtwork(page);
  await page.getByText('Artwork detail view', { exact: true }).click();
  await page.locator('#art-review-detail').check();
  await page.locator('#art-review-x').fill('10');
  await page.locator('#art-review-y').fill('20');
  await reviewArtwork(page);
  await activateScene(page);
  await page.locator('#show-artwork').click();
  await page.locator('#art-kind').selectOption('tile');
  await page.locator('#art-name').fill('Small detail');
  await page.locator('#art-width').fill('16');
  await page.locator('#art-height').fill('16');
  await page.locator('#art-create').click();
  await expect(page.locator('#art-review-detail')).not.toBeChecked();
  await expect(page.locator('#art-review-x')).toHaveValue('0');
  await expect(page.locator('#art-review-y')).toHaveValue('0');
  await expect(page.locator('#art-review-width')).toHaveValue('16');
  await expect(page.locator('#art-review-height')).toHaveValue('16');
  await reviewArtwork(page);
  await expect(page.locator('#art-review-detail')).toBeVisible();
  await page.locator('#art-review-detail').check();
  await reviewArtwork(page);
  await page.screenshot({ path: info.outputPath('small-artwork-detail-review.png') });
  await saveArtwork(page);
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Large detail' }).click();
  await expect(page.locator('#art-review-detail')).toBeChecked();
  await expect(page.locator('#art-review-x')).toHaveValue('10');
  await expect(page.locator('#art-review-y')).toHaveValue('20');
  await expect(page.locator('#art-review-width')).toHaveValue('256');
  await expect(page.locator('#art-review-height')).toHaveValue('256');
});
