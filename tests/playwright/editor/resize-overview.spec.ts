import { execFileSync } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, editorReady, clickControl } from '../support/browser-fixtures.ts';

test('resize overview includes offscreen artwork independently of pan, zoom and crop', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'world');
  await cp('tests/playwright/support/fixtures/editor/project', root, { recursive: true });
  const id = execFileSync(
    workspace.python,
    [
      '-I',
      '-c',
      `
import sys, json, shutil
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import png
root=Path(sys.argv[1])
pixels=b''.join(bytes((255,0,0,255) if x<8 else (0,0,255,255)) for y in range(8) for x in range(16))
source=root.parent/'art'
shutil.copytree(root/'assets/terrain',source)
(source/'atlas.png').write_bytes(png.encode(16,8,pixels))
manifest=json.loads((source/'terrain.atlas.json').read_text())
manifest['palettes']=[[[0,0,0],[31,0,0],[0,0,31],[31,31,31]]]
(source/'terrain.atlas.json').write_text(json.dumps(manifest))
p=Project(root)
p.artwork.import_atlas(str(source/'terrain.atlas.json'),p.catalog()['revision'],reimport=True)
s=p.scenes.create('Resize overview',128,96,8,p.catalog()['revision'])
cells=[['terrain/earth/0/0' if x<64 else 'terrain/stone/0/0' for x in range(128)] for y in range(96)]
p.scenes.save(s['id'],dict(width=128,height=96,grid=8,next_layer_id=2,next_object_id=1,layers=[dict(id=1,name='Ground',visible=True,type='tilelayer',cells=cells)]),s['revision'],p.catalog()['revision'])
print(s['id'])
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  await page.goto(await workspace.start(root));
  await editorReady(page);
  await page.locator('#scenes').selectOption(id);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  const overview = () =>
    page.locator('#resize-preview').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw Error('preview');
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw Error('context');
      }
      return {
        image: canvas.toDataURL(),
        left: [...ctx.getImageData(50, 50, 1, 1).data],
        right: [...ctx.getImageData(210, 150, 1, 1).data],
      };
    });
  const display = () =>
    page.locator('#scene').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw Error('scene');
      }
      return canvas.toDataURL();
    });
  const cancel = () => page.locator('[data-close="resize-scene-dialog"]').click();
  const originals: string[] = [],
    crops: string[] = [];
  for (const [zoom, fraction] of [
    ['2', 0],
    ['8', 1],
    ['1', 0.5],
  ] as const) {
    await page.locator('#zoom').selectOption(zoom);
    await page
      .locator('#viewport')
      .evaluate(
        (viewport, fraction) =>
          viewport.scrollTo(
            (viewport.scrollWidth - viewport.clientWidth) * fraction,
            (viewport.scrollHeight - viewport.clientHeight) * fraction,
          ),
        fraction,
      );
    await page.mouse.move(1, 1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const before = await display();
    await clickControl(page, 'show-resize');
    const original = await overview();
    expect(original.left).toEqual([255, 0, 0, 255]);
    expect(original.right).toEqual([0, 0, 255, 255]);
    originals.push(original.image);
    expect(await display()).toBe(before);
    await page.locator('#resize-width').fill('64');
    const crop = await overview();
    expect(crop.left).toEqual([255, 0, 0, 255]);
    expect(crop.right[0]).toBeGreaterThan(100);
    expect(crop.right[2]).toBeGreaterThan(100);
    crops.push(crop.image);
    if (zoom === '2') {
      await page.screenshot({ path: info.outputPath('resize-overview.png') });
      await info.attach('resize-overview.png', {
        path: info.outputPath('resize-overview.png'),
        contentType: 'image/png',
      });
    }
    await cancel();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await expect(page.locator('#undo')).toBeDisabled();
  }
  expect(new Set(originals).size).toBe(1);
  expect(new Set(crops).size).toBe(1);
  // Unsaved authored changes are included; undo restores the complete original overview.
  await page.locator('#zoom').selectOption('1');
  await page.locator('#viewport').evaluate((viewport) => viewport.scrollTo(0, 0));
  await page.locator('#palette [data-asset="terrain/stone"]').first().click();
  await page.locator('input[name=tool][value=fill]').check();
  const canvas = await page.locator('#scene').boundingBox();
  if (!canvas) {
    throw Error('scene');
  }
  await page.mouse.click(canvas.x + 12, canvas.y + 12);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await clickControl(page, 'show-resize');
  expect((await overview()).left).toEqual([0, 0, 255, 255]);
  await cancel();
  await page.locator('#undo').click();
  await clickControl(page, 'show-resize');
  expect((await overview()).image).toBe(originals[0]);
  await cancel();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
});
