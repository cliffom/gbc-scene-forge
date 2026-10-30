/** Repeatable rendering workloads; timings are observations, never CI thresholds. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import {
  test,
  expect,
  editorReady,
  scenePoint,
  clickControl,
  setControl,
} from '../support/browser-fixtures.ts';

type Metrics = { draws: number; images: number; resets: number; styles: number; times: number[] };
declare global {
  interface Window {
    renderingMetrics: Metrics;
  }
}

for (const [name, width, height] of [
  ['small', 16, 12],
  ['large', 128, 96],
] as const) {
  test(`rendering dimensions, history and profiling: ${name}`, async ({
    page,
    workspace,
  }, info) => {
    const root = join(workspace.folder, 'world');
    await cp('tests/playwright/support/fixtures/editor/project', root, { recursive: true });
    const { stdout } = await promisify(execFile)(workspace.python, [
      '-I',
      '-c',
      `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project(Path(sys.argv[1]))
w, h = int(sys.argv[2]), int(sys.argv[3])
loaded = p.scenes.create('Rendering profile', w, h, 8, p.catalog()['revision'])
layers = [dict(id=i+1, name=f'Tiles {i}', type='tilelayer', visible=i!=3,
    cells=[['terrain/earth/0/0' if i==0 or (x+y+i)%4==0 else ''
        for x in range(w)] for y in range(h)]) for i in range(4)]
layers.append(dict(id=5, name='Actors', type='objectgroup', visible=True, objects=[
    dict(id=1, asset='actors/idle', x=32, y=24, name='', **{'class': ''}, properties=[])]))
s = dict(width=w, height=h, grid=8, layers=layers, next_layer_id=6, next_object_id=2)
p.scenes.save(loaded['id'], s, loaded['revision'], p.catalog()['revision'])
print(loaded['id'])
`,
      root,
      String(width),
      String(height),
    ]);
    const url = await workspace.start(root);
    await page.goto(url);
    await editorReady(page);
    await page.locator('#scenes').selectOption(stdout.trim());
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await page.locator('#zoom').selectOption('1');

    // Count actual backing-store writes and canvas paints, including animation callbacks.
    await page.evaluate(() => {
      const canvas = document.getElementById('scene');
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw Error('Expected scene canvas');
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw Error('Expected drawing context');
      }
      window.renderingMetrics = { draws: 0, images: 0, resets: 0, styles: 0, times: [] };
      for (const key of ['width', 'height'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
        if (!descriptor?.get || !descriptor.set) {
          throw Error('Expected canvas dimension accessors');
        }
        const get = descriptor.get.bind(canvas);
        const set = descriptor.set.bind(canvas);
        Object.defineProperty(canvas, key, {
          get() {
            return Number(get());
          },
          set(value: number) {
            window.renderingMetrics.resets++;
            set(value);
          },
        });
      }
      new MutationObserver((records) => {
        window.renderingMetrics.styles += records.filter((r) => r.attributeName === 'style').length;
      }).observe(canvas, { attributes: true });
      const fill = ctx.fillRect.bind(ctx);
      ctx.fillRect = (...args) => {
        if (
          args[0] === 0 &&
          args[1] === 0 &&
          args[2] === canvas.width &&
          args[3] === canvas.height
        ) {
          window.renderingMetrics.draws++;
        }
        fill(...args);
      };
      const image = ctx.drawImage.bind(ctx);
      ctx.drawImage = new Proxy(image, {
        apply(target, receiver, args) {
          window.renderingMetrics.images++;
          Reflect.apply(target, receiver, args);
        },
      });
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        raf((time) => {
          const before = window.renderingMetrics.draws;
          const start = performance.now();
          callback(time);
          if (window.renderingMetrics.draws > before) {
            window.renderingMetrics.times.push(performance.now() - start);
          }
        });
    });
    const reset = () =>
      page.evaluate(() => {
        window.renderingMetrics = { draws: 0, images: 0, resets: 0, styles: 0, times: [] };
      });
    const results: Record<string, Metrics> = {};
    const snapshot = async (workload: string) => {
      results[workload] = await page.evaluate(() => window.renderingMetrics);
      if (workload !== 'animation') {
        expect(results[workload].draws).toBe(120);
        expect(results[workload].images).toBe(120 * (width * height * 1.5 + 1));
      }
      if (!process.env.FORGE_RENDER_BASELINE) {
        expect(results[workload].resets).toBe(0);
        expect(results[workload].styles).toBe(0);
      }
    };
    const moves = async () => {
      // Six bursts of 20 different hover cells: exposes redundant requests in one frame.
      await page.evaluate(async () => {
        const canvas = document.getElementById('scene');
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw Error('Expected scene canvas');
        }
        for (let burst = 0; burst < 6; burst++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const rect = canvas.getBoundingClientRect();
          for (let i = 0; i < 20; i++) {
            const start = performance.now();
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: rect.left + (i % 12) * 8 + 2,
                clientY: rect.top + (burst % 6) * 8 + 2,
                pointerId: 1,
              }),
            );
            window.renderingMetrics.times.push(performance.now() - start);
          }
        }
      });
    };
    await moves(); // Warm up renderer and browser JIT before collecting timings.
    for (let trial = 1; trial <= 3; trial++) {
      await reset();
      await moves();
      await snapshot(`hover-${trial}`);
    }
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');

    await clickControl(page, 'artwork-tab');
    await page.locator('[data-asset="terrain/stone"]').first().click();
    await page.locator('#scene').dispatchEvent('pointerleave');
    const original = await page.locator('#scene').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw Error('Expected scene canvas');
      }
      return canvas.toDataURL();
    });
    const point = await scenePoint(page, 2, 2);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await reset();
    await moves();
    await page.mouse.up();
    await snapshot('painting');
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await page.locator('#undo').click();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await expect(page.locator('#undo')).toBeDisabled();
    // Remove hover before comparing full pixels (the authored stroke is completely undone).
    await page.locator('#scene').dispatchEvent('pointerleave');
    await page.locator('#redo').click();
    await page.locator('#undo').click();
    expect(
      await page.locator('#scene').evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw Error('Expected scene canvas');
        }
        return canvas.toDataURL();
      }),
    ).toBe(original);

    // Select the saved actor and exercise real playback (draw(false) in an animation frame).
    await page
      .getByRole('radio', { name: 'Actors Objects · Visible', exact: true })
      .locator('..')
      .click();
    await page.locator('input[name=tool][value=select]').check();
    await setControl(page, 'object-list', '1');
    await setControl(page, 'preview-animation', 'turn');
    await reset();
    await page.locator('#preview-play').click();
    await expect
      .poll(() => page.evaluate(() => window.renderingMetrics.draws))
      .toBeGreaterThanOrEqual(12);
    await page.locator('#preview-play').click();
    await snapshot('animation');
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await expect(page.locator('#undo')).toBeDisabled();

    await reset();
    await page.locator('#zoom').selectOption('2');
    expect(
      await page.locator('#scene').evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw Error('Expected scene canvas');
        }
        const context = canvas.getContext('2d');
        if (!context) {
          throw Error('Expected drawing context');
        }
        return [
          canvas.width,
          canvas.height,
          canvas.style.width,
          canvas.style.height,
          context.imageSmoothingEnabled,
        ];
      }),
    ).toEqual([width * 8, height * 8, `${width * 16}px`, `${height * 16}px`, false]);
    if (!process.env.FORGE_RENDER_BASELINE) {
      expect(await page.evaluate(() => window.renderingMetrics.resets)).toBe(0);
    }
    // A real width-only resize resets only that dimension, including undo/redo.
    await clickControl(page, 'show-resize');
    await page.locator('#resize-width').fill(String(width + 1));
    await reset();
    await page.locator('#resize-confirm').click();
    if (!process.env.FORGE_RENDER_BASELINE) {
      expect(await page.evaluate(() => window.renderingMetrics.resets)).toBe(1);
    }
    await expect(page.locator('#scene')).toHaveAttribute('width', String((width + 1) * 8));
    await page.locator('#undo').click();
    await expect(page.locator('#scene')).toHaveAttribute('width', String(width * 8));
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await page.locator('#redo').click();
    await page.locator('#save').click();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await page.locator('#scenes').selectOption({ label: 'River' });
    await expect(page.locator('#scene')).toHaveAttribute('width', '56');
    await page.locator('#scenes').selectOption(stdout.trim());
    await expect(page.locator('#scene')).toHaveAttribute('width', String((width + 1) * 8));
    await info.attach('rendering-profile.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  });
}
