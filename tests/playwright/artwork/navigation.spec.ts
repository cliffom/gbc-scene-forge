/** Actual pointer coordinates, transient work, modal focus and per-document navigation. */
/* eslint-disable @typescript-eslint/unbound-method -- Instrument browser work, preserving methods. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from '../support/browser-fixtures.ts';
import { record, string } from '../../../frontend/shared/decode.mts';
import { revealArtworkControl } from '../support/artwork-controls.ts';

const longName = 'Player poses with a long descriptive document name for compact navigation';
async function setup(
  page: Page,
  workspace: { folder: string; python: string; start: (root: string) => Promise<string> },
) {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Artwork navigation')
a=p.artwork.documents
frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*16,y=0,width=16,height=16,origin=[4,8]) for i in range(2)]
sequences=[dict(id='walk',name='Walk',loop=True,frames=[dict(frame_id=f'f{i}',duration_ms=120) for i in range(2)])]
c=a.create_sheet('player',sys.argv[2],'sprite',32,16,p.catalog()['revision'],frames=frames,sequences=sequences)
c=a.edit(c,[dict(x=i*16+x,y=y,rgba=([245,224,175,255] if y<4 else [32,40,52,255] if i else [72,145,200,255])) for i in range(2) for y in range(1,16) for x in range(5,11) if y<13 or x in (5,6,9,10)])
a.save(c)
c=a.create('large','Other retained artwork with a long descriptive document name','sprite',256,256,p.catalog()['revision'])
a.save(c)
`,
    root,
    longName,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="player/f0"]').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
}
async function pixel(page: Page, x: number, y: number) {
  const bounds = await page.locator('#art-canvas').boundingBox();
  if (!bounds) {
    throw Error('Expected artwork canvas');
  }
  const zoom = Number(await page.locator('#art-zoom').inputValue());
  return { x: bounds.x + (x + 0.5) * zoom, y: bounds.y + (y + 0.5) * zoom };
}
async function hover(page: Page, x: number, y: number, offset = 0) {
  const p = await pixel(page, x, y);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('#art-target')).toBeVisible();
  await expect(page.locator('#art-target')).toHaveAttribute('data-x', String(x + offset));
  await expect(page.locator('#art-target')).toHaveAttribute('data-y', String(y));
  const target = await page.locator('#art-target').boundingBox();
  expect(target).not.toBeNull();
  expect(Math.abs((target?.x ?? 0) + (target?.width ?? 0) / 2 - p.x)).toBeLessThan(1);
}
async function drag(page: Page, dx: number, dy: number, mode: 'middle' | 'space' | 'tool') {
  const v = await page.locator('#art-viewport').boundingBox();
  if (!v) {
    throw Error('Expected viewport');
  }
  await page.locator('#art-canvas').focus();
  if (mode === 'space') {
    await page.keyboard.down('Space');
  }
  if (mode === 'tool') {
    await page.locator('#art-pan').click();
  }
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  await page.mouse.down({ button: mode === 'middle' ? 'middle' : 'left' });
  await page.mouse.move(v.x + v.width / 2 + dx, v.y + v.height / 2 + dy, { steps: 4 });
  await page.mouse.up({ button: mode === 'middle' ? 'middle' : 'left' });
  if (mode === 'space') {
    await page.keyboard.up('Space');
  }
}

test('hover and pan target exact sheet/frame pixels without raster, control or checkpoint work', async ({
  page,
  workspace,
}, info) => {
  await setup(page, workspace);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/artwork-')) {
      requests.push(r.url());
    }
  });
  for (const zoom of ['4', '16', '32']) {
    await page.locator('#art-zoom').selectOption(zoom);
    await hover(page, 4, 3);
  }
  for (const [label, x, y] of [
    ['light', 6, 2],
    ['color', 6, 6],
    ['transparent', 3, 3],
  ] as const) {
    await hover(page, x, y);
    await page.screenshot({ path: info.outputPath(`target-${label}.png`) });
  }
  await page.locator('#art-frame').selectOption('f1');
  await page.locator('#art-frame-view').click();
  await hover(page, 6, 6, 16);
  await page.screenshot({ path: info.outputPath('target-dark.png') });
  await hover(page, 3, 4, 16);
  await drag(page, 65, 30, 'middle');
  await hover(page, 3, 4, 16);
  await drag(page, -30, -15, 'space');
  await hover(page, 3, 4, 16);
  await page.locator('#art-viewport').evaluate((n) => n.scrollBy(40, 20));
  await hover(page, 3, 4, 16);
  await page.getByRole('radio', { name: 'Eyedropper', exact: true }).check();
  await hover(page, 3, 4, 16);
  await expect(page.locator('#art-target')).toHaveAttribute('data-tool', 'pick');
  await page.getByRole('radio', { name: 'Select rectangle', exact: true }).check();
  await hover(page, 3, 4, 16);
  await page.getByRole('radio', { name: 'Move selection', exact: true }).check();
  await page.mouse.move((await pixel(page, 3, 4)).x, (await pixel(page, 3, 4)).y);
  await expect(page.locator('#art-target')).toBeHidden();
  await page.getByRole('radio', { name: 'Pencil', exact: true }).check();

  const counts = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#art-canvas');
    const target = document.querySelector<HTMLElement>('#art-target');
    const controlPanel = document.querySelector('.art-controls');
    const sheetPanel = document.querySelector('#art-sheet-controls');
    if (!canvas || !target || !controlPanel || !sheetPanel) {
      throw Error('Expected editor surfaces');
    }
    const rect = canvas.getBoundingClientRect();
    let raster = 0,
      controls = 0,
      paints = 0;
    const image = CanvasRenderingContext2D.prototype.drawImage;
    const upload = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(image, {
      apply(method, receiver, args) {
        raster++;
        Reflect.apply(method, receiver, args);
      },
    });
    CanvasRenderingContext2D.prototype.putImageData = new Proxy(upload, {
      apply(method, receiver, args) {
        raster++;
        Reflect.apply(method, receiver, args);
      },
    });
    const controlObserver = new MutationObserver((records) => {
      controls += records.length;
    });
    controlObserver.observe(controlPanel, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    controlObserver.observe(sheetPanel, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    const targetObserver = new MutationObserver(() => {
      paints++;
    });
    targetObserver.observe(target, { attributes: true });
    try {
      for (let i = 0; i < 80; i++) {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: rect.x + 100 + (i % 5),
            clientY: rect.y + 100,
          }),
        );
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        }),
      );
      return { raster, controls, paints };
    } finally {
      CanvasRenderingContext2D.prototype.drawImage = image;
      CanvasRenderingContext2D.prototype.putImageData = upload;
      controlObserver.disconnect();
      targetObserver.disconnect();
    }
  });
  expect(counts).toEqual({ raster: 0, controls: 0, paints: 1 });
  // Synthetic moves above do not move the browser's real pointer into the viewport.
  await hover(page, 3, 4, 16);
  await page.mouse.move(1, 1);
  await expect(page.locator('#art-target')).toBeHidden();
  await expect(page.locator('#art-undo')).toBeDisabled();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  expect(requests).toEqual([]);
});

test('pan, Fit, cancellation and document restoration preserve authoring and focus', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await page.locator('#art-frame').selectOption('f1');
  await page.locator('#art-frame-view').click();
  await page.locator('#art-color').fill('#cc7744');
  await drag(page, 50, 25, 'tool');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#art-pan')).toHaveAttribute('aria-pressed', 'true');
  const before = await page.locator('#art-canvas').boundingBox();
  await page.locator('#art-canvas').press('Escape');
  await expect(page.locator('#artwork-dialog')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pencil', exact: true })).toBeChecked();
  const p = await pixel(page, 2, 3);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await expect(page.locator('#art-undo')).toBeEnabled();

  await page.locator('#document-switcher').click();
  await page.locator('#artwork-new-document').click();
  await page.locator('#art-name').fill('Other document with another long descriptive name');
  await page.locator('#art-create').click();
  await expect(page.locator('#art-document-state')).toHaveText('New');
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: longName }).click();
  await expect(page.locator('#art-frame')).toHaveValue('f1');
  await expect(page.locator('#art-edit-frame')).toBeChecked();
  await expect(page.locator('#art-undo')).toBeEnabled();
  const restored = await page.locator('#art-canvas').boundingBox();
  expect(Math.abs((restored?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((restored?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  await page.locator('#art-undo').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  // Fit and scope changes deliberately center the drawing.
  await page.locator('#art-fit').click();
  const centered = await page.locator('#art-canvas').boundingBox();
  if (!centered) {
    throw Error('Expected canvas');
  }
  const v = await page.locator('#art-viewport').boundingBox();
  if (!v) {
    throw Error('Expected viewport');
  }
  expect(Math.abs(centered.x + centered.width / 2 - (v.x + v.width / 2))).toBeLessThan(2);
  await page.locator('#art-sheet-view').click();
  await page.locator('#art-frame-view').click();
  await hover(page, 2, 3, 16);
  // Escape cancels a held pan, and releasing Space or losing focus clears grab mode.
  await page.locator('#art-canvas').focus();
  await page.keyboard.down('Space');
  await page.mouse.move(v.x + 30, v.y + 30);
  await page.mouse.down();
  await page.mouse.move(v.x + 70, v.y + 50);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(page.locator('#artwork-dialog')).toBeVisible();
  await expect(page.locator('#art-undo')).toBeDisabled();
  await page.locator('#art-alpha').focus();
  expect(
    await page.locator('#art-alpha').evaluate((n) => {
      const e = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' ',
        code: 'Space',
      });
      n.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  ).toBe(false);
});

test('Documents is modal, dismisses predictably and fits long names at compact widths', async ({
  page,
  workspace,
}, info) => {
  await setup(page, workspace);
  await page.locator('#art-close').click();
  await page.locator('[data-asset="large/artwork"]').click();
  await page.locator('#art-close').click();
  await page.locator('[data-asset="player/f0"]').click();
  const trigger = page.locator('#document-switcher');
  const chooser = page.locator('#document-tabs');
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/artwork-')) {
      requests.push(r.url());
    }
  });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 640 },
    { width: 640, height: 512 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(
      (zoom) => {
        document.body.style.zoom = String(zoom);
      },
      size.width === 640 ? 1.25 : 1,
    );
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(chooser).toBeVisible();
    await expect(page.locator('#document-chooser-close')).toBeFocused();
    expect(await chooser.evaluate((n) => n.matches(':modal'))).toBe(true);
    await expect(page.locator('#scene-document')).toHaveText('Return to Scene workspace');
    await expect(page.locator('#artwork-documents [aria-pressed=true]')).toContainText('Current');
    expect(
      await chooser.evaluate(
        (n) => n.scrollWidth <= n.clientWidth && n.getBoundingClientRect().right <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`documents-${size.width}.png`) });
    await page.keyboard.press('Escape');
    await expect(chooser).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(2, 2);
    await expect(chooser).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  expect(requests).toEqual([]);
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
});

test('oversized panned artwork writes the targeted pixel and releases navigation on cancel/blur', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await page.locator('#art-close').click();
  await page.locator('[data-asset="large/artwork"]').click();
  await page.locator('#art-zoom').selectOption('32');
  await drag(page, 80, 20, 'middle');
  await drag(page, -20, -10, 'space');
  await hover(page, 128, 128);
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-alpha').fill('73');
  const p = await pixel(page, 128, 128);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  const download = page.waitForEvent('download');
  await (await revealArtworkControl(page, 'art-download')).click();
  const path = await (await download).path();
  if (!path) {
    throw Error('Expected downloaded work');
  }
  const work = record(JSON.parse(await readFile(path, 'utf8')));
  const rgba = Buffer.from(string(work.current_rgba), 'base64');
  const index = (128 * 256 + 128) * 4;
  expect([...rgba.subarray(index, index + 4)]).toEqual([204, 119, 68, 73]);
  expect([...rgba.subarray(index - 4, index)]).toEqual([0, 0, 0, 0]);
  await page.locator('.art-document-actions>summary').click();
  await page.locator('#art-undo').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  for (const ending of ['pointercancel', 'lostpointercapture', 'blur']) {
    await page.locator('#art-canvas').focus();
    await page.keyboard.down('Space');
    const v = await page.locator('#art-viewport').boundingBox();
    if (!v) {
      throw Error('Expected viewport');
    }
    await page.mouse.move(v.x + 100, v.y + 100);
    await page.mouse.down();
    await page.mouse.move(v.x + 120, v.y + 110);
    await page.locator('#art-viewport').evaluate((node, name) => {
      if (name === 'blur') {
        window.dispatchEvent(new Event('blur'));
      } else {
        node.dispatchEvent(new PointerEvent(name, { pointerId: 1 }));
      }
    }, ending);
    const position = await page
      .locator('#art-viewport')
      .evaluate((n) => [n.scrollLeft, n.scrollTop]);
    await page.mouse.move(v.x + 150, v.y + 130);
    expect(
      await page.locator('#art-viewport').evaluate((n) => [n.scrollLeft, n.scrollTop]),
    ).toEqual(position);
    await page.mouse.up();
    await page.keyboard.up('Space');
  }
  await expect(page.locator('#art-undo')).toBeDisabled();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
});

test('artwork layout keeps commands and drawing reachable across window sizes', async ({
  page,
  workspace,
}, info) => {
  await setup(page, workspace);
  const observations: unknown[] = [];
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [800, 640],
    [1440, 600],
  ]) {
    await page.setViewportSize({ width, height });
    for (const state of ['normal', 'animation', 'properties', 'review']) {
      await page.locator('#art-timeline').evaluate((n, open) => {
        if (!(n instanceof HTMLDetailsElement)) {
          throw Error('Expected timeline');
        }
        n.open = open;
      }, state !== 'normal');
      if (await page.locator('.art-review').isVisible()) {
        await page.locator('#art-review-close').click();
      }
      if (await page.locator('#art-properties').isVisible()) {
        await page.locator('#art-properties-toggle').click();
      }
      if (state === 'properties') {
        await page.locator('#art-properties-toggle').click();
      }
      if (state === 'review') {
        await page.locator('#art-save').click();
        await expect(page.locator('#art-comparison')).toBeVisible();
        await expect(page.locator('#art-save')).toBeEnabled();
      }
      const geometry = await page.locator('#artwork-dialog').evaluate((dialog) => {
        const viewport = dialog.querySelector<HTMLElement>('.art-canvas-scroll');
        const controls = dialog.querySelector<HTMLElement>('.art-controls');
        const footerElement = dialog.querySelector<HTMLElement>('#art-editor>.dialog-actions');
        if (!viewport || !controls || !footerElement) {
          throw Error('Expected artwork layout');
        }
        const bounds = viewport.getBoundingClientRect();
        const footer = footerElement.getBoundingClientRect();
        const commands = [
          ...controls.querySelectorAll<HTMLElement>('.tool,button,input,select'),
        ].filter((n) => n.checkVisibility() && !n.closest('.art-swatches'));
        // Palette swatches have their own horizontal scroller; fixed commands must fit.
        return {
          toolbarHeight: controls.getBoundingClientRect().height,
          drawingHeight: bounds.height,
          drawingWidth: bounds.width,
          footerVisible: footer.bottom <= innerHeight && footer.top >= 0,
          overflow:
            dialog.scrollWidth > dialog.clientWidth || dialog.scrollHeight > dialog.clientHeight,
          commandsVisible: commands.every((n) => {
            const r = n.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
          }),
        };
      });
      observations.push({ width, height, state, ...geometry });
      if (!process.env.FORGE_ARTWORK_BASELINE) {
        expect(geometry.footerVisible).toBe(true);
        expect(geometry.overflow, JSON.stringify({ width, height, state, geometry })).toBe(false);
        expect(geometry.commandsVisible).toBe(true);
        expect(geometry.drawingHeight).toBeGreaterThanOrEqual(150);
      }
      await page.screenshot({ path: info.outputPath(`artwork-${width}-${height}-${state}.png`) });
    }
  }
  const output = process.env.FORGE_ARTWORK_LAYOUT_RECORD ?? info.outputPath('layout');
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, 'measurements.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        build: { version: await page.locator('#app-version').textContent() },
        observations,
      },
      null,
      2,
    ) + '\n',
  );
});
