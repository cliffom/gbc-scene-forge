/** Reproducible panel/dock states and actual drawing-space measurements. */
/* eslint-disable @typescript-eslint/unbound-method -- Scoped instrumentation restores native methods. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { test, expect } from '../support/browser-fixtures.ts';
import { reviewArtwork } from '../support/artwork-controls.ts';

test('contextual Inspector and optional animation dock preserve drawing space and authored history', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Contextual panels')
a=p.artwork.documents
frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*16,y=0,width=16,height=16,origin=[4,8]) for i in range(2)]
sequences=[dict(id='walk',name='Walk',loop=True,frames=[dict(frame_id=f'f{i}',duration_ms=120) for i in range(2)])]
c=a.create_sheet('player','Player poses','sprite',32,16,p.catalog()['revision'],frames=frames,sequences=sequences)
c=a.edit(c,[dict(x=i*16+x,y=y,rgba=([245,224,175,255] if y<4 else [32,40,52,255] if i else [72,145,200,255])) for i in range(2) for y in range(1,16) for x in range(5,11)])
a.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="player/f1"]').click();
  await expect(page.locator('#art-frame')).toHaveValue('f1');
  await expect(page.locator('#undo')).toBeDisabled();
  const measurements = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 800, height: 640 },
    { width: 1280, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    for (const state of ['normal', 'animation', 'properties', 'review']) {
      await page.locator('#art-dock').evaluate((n, state) => {
        if (n instanceof HTMLDetailsElement) {
          n.open = state !== 'normal';
        }
      }, state);
      await page.locator('#art-timeline').evaluate((n, state) => {
        if (n instanceof HTMLDetailsElement) {
          n.open = state === 'animation';
        }
      }, state);
      if (state === 'properties') {
        await page.locator('#art-properties-toggle').click();
        await expect(page.locator('#art-frame-geometry')).toHaveText('16 × 16 · origin 4, 8');
      }
      if (state === 'review') {
        await reviewArtwork(page);
      }
      await page.locator('#art-sheet-controls').evaluate((n) => {
        n.scrollTop = 0;
      });
      if (state === 'animation') {
        await page.locator('#art-play').scrollIntoViewIfNeeded();
        await expect(page.locator('#art-play')).toBeInViewport();
        await page.locator('#art-play').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#art-step')).toBeFocused();
        const duration = page.getByRole('spinbutton', { name: 'Frame 1 duration in milliseconds' });
        await duration.focus();
        await expect(duration).toBeInViewport();
      }

      await expect(page.locator('#save')).toBeInViewport();
      await expect(page.locator('.art-document-actions > summary')).toBeInViewport();
      await expect(page.locator('#undo')).toBeDisabled();
      const area = await page.locator('#art-viewport').boundingBox();
      expect(area?.width).toBeGreaterThanOrEqual(200);
      expect(area?.height).toBeGreaterThanOrEqual(150);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      measurements.push({ ...viewport, state, canvasViewport: area });
      await page.screenshot({
        path: info.outputPath(`${viewport.width}x${viewport.height}-${state}.png`),
      });
      if (state === 'review') {
        await page.locator('#art-review-close').click();
      }
      if (state === 'properties') {
        await page.locator('#art-properties-toggle').click();
      }
    }
  }
  await writeFile(info.outputPath('canvas-space.json'), JSON.stringify(measurements, null, 2));
  const work = await page.evaluate(() => {
    const strip = document.getElementById('art-frame-strip');
    const timeline = document.getElementById('art-sequence-frames');
    const frame = document.getElementById('art-frame');
    if (!strip || !timeline || !(frame instanceof HTMLSelectElement)) {
      throw Error('Expected dock');
    }
    const before = document.querySelectorAll('canvas').length;
    let thumbnailPaints = 0;
    let dockHandlersAdded = 0;
    const listen = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = new Proxy(listen, {
      apply(method, receiver: EventTarget, args) {
        if (receiver === document.getElementById('art-dock')) {
          dockHandlersAdded++;
        }
        Reflect.apply(method, receiver, args);
      },
    });
    const original = CanvasRenderingContext2D.prototype.drawImage;
    const observer = new MutationObserver(() => {});
    observer.observe(strip, { childList: true, subtree: true });
    observer.observe(timeline, { childList: true, subtree: true });
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(original, {
      apply(method, receiver: CanvasRenderingContext2D, args) {
        if (receiver.canvas.closest('#art-frame-strip,#art-sequence-frames')) {
          thumbnailPaints++;
        }
        Reflect.apply(method, receiver, args);
      },
    });
    try {
      for (let i = 0; i < 32; i++) {
        frame.value = 'f' + (i % 2);
        frame.dispatchEvent(new Event('change'));
      }
      return {
        navigations: 32,
        thumbnailPaints,
        dockHandlersAdded,
        thumbnailRebuilds: observer.takeRecords().length,
        canvasGrowth: document.querySelectorAll('canvas').length - before,
      };
    } finally {
      CanvasRenderingContext2D.prototype.drawImage = original;
      EventTarget.prototype.addEventListener = listen;
      observer.disconnect();
    }
  });
  expect(work).toEqual({
    navigations: 32,
    thumbnailPaints: 0,
    dockHandlersAdded: 0,
    thumbnailRebuilds: 0,
    canvasGrowth: 0,
  });
  await writeFile(info.outputPath('navigation-work.json'), JSON.stringify(work, null, 2));

  await page.locator('#toggle-inspector').click();
  await expect(page.locator('#toggle-inspector')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inspector-pane')).toBeVisible();
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#art-dock > summary').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
});

test('single tiles keep a contextual repetition preview without a sheet dock', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Tile panels')
a=p.artwork.documents
c=a.create('tile','Tile','tile',8,8,p.catalog()['revision'])
a.save(a.edit(c,[dict(x=0,y=0,rgba=[17,34,51,255])]))
c=a.create('other','Other tile','tile',8,8,p.catalog()['revision'])
a.save(a.edit(c,[dict(x=0,y=0,rgba=[68,85,102,255])]))
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="tile/artwork"]').click();
  await expect(page.locator('#art-sheet-controls')).toBeHidden();
  await page.locator('#art-properties-toggle').click();
  const repeat = page.locator('#art-repeat-canvas');
  await expect(repeat).toBeVisible();
  async function expectRepeated(color: number[]) {
    expect(
      await repeat.evaluate((node) => {
        if (!(node instanceof HTMLCanvasElement)) {
          throw Error('Expected repeat canvas');
        }
        const context = node.getContext('2d');
        return [0, 64, 128].map((x) => [...(context?.getImageData(x, 0, 1, 1).data ?? [])]);
      }),
    ).toEqual([color, color, color]);
  }
  await expectRepeated([17, 34, 51, 255]);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#art-color').fill('#cc7733');
  await page.locator('#art-canvas').click({ position: { x: 8, y: 8 } });
  await expectRepeated([204, 119, 51, 255]);
  await page.locator('#undo').click();
  await expectRepeated([17, 34, 51, 255]);
  await page.locator('#redo').click();
  await expectRepeated([204, 119, 51, 255]);
  await page.locator('[data-asset="other/artwork"]').click();
  await page.locator('#art-properties-toggle').click();
  await expectRepeated([68, 85, 102, 255]);
  await page.locator('#document-switcher').click();
  await page
    .locator('#artwork-documents button')
    .filter({ hasText: /^Tile · Artwork/ })
    .click();
  await page.locator('#art-properties-toggle').click();
  await expectRepeated([204, 119, 51, 255]);
});
