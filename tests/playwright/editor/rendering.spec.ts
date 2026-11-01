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

import { referenceRenderer } from '../support/reference-renderer.ts';

type Metrics = {
  draws: number;
  images: number;
  resets: number;
  styles: number;
  times: number[];
  requests: number;
  inputTimes: number[];
  latencies: number[];
  frames: number[];
  serializations: number;
  dirtyMs: number;
  uiUpdates: number;
};
declare global {
  interface Window {
    renderingMetrics: Metrics;
    renderingMonitor: number | undefined;
  }
}

for (const [name, width, height] of [
  ['small', 16, 12],
  ['large', 128, 96],
  ['wide', 480, 9],
  ['tall', 9, 480],
  ['budget', 1023, 64],
] as const) {
  test(`rendering dimensions, history and profiling: ${name}`, async ({
    page,
    workspace,
  }, info) => {
    test.setTimeout(180000);
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
    cells=[['terrain/earth/0/0' if (i==0 and not sys.argv[4]) or (x+y+i)% (16 if sys.argv[4] else 4)==0 else ''
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
      process.env.FORGE_PROFILE_SPARSE ?? '',
    ]);
    const url = await workspace.start(root);
    if (process.env.FORGE_PROFILE_REFERENCE) {
      const reference = await referenceRenderer();
      await page.route('**/project.js', (route) =>
        route.fulfill({ body: reference, contentType: 'text/javascript' }),
      );
    }
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
      window.renderingMetrics = {
        draws: 0,
        images: 0,
        resets: 0,
        styles: 0,
        times: [],
        requests: 0,
        inputTimes: [],
        latencies: [],
        frames: [],
        serializations: 0,
        dirtyMs: 0,
        uiUpdates: 0,
      };
      const dirtyIndicator = document.getElementById('dirty');
      if (!dirtyIndicator) {
        throw Error('Expected dirty indicator');
      }
      new MutationObserver((records) => {
        window.renderingMetrics.uiUpdates += records.length;
      }).observe(dirtyIndicator, { childList: true });
      let latestInput: number | undefined;
      canvas.addEventListener(
        'pointermove',
        () => {
          latestInput = performance.now();
          window.renderingMetrics.requests++;
          window.renderingMetrics.inputTimes.push(latestInput);
        },
        { capture: true },
      );
      const stringify = JSON.stringify;
      JSON.stringify = new Proxy(stringify, {
        apply(target, receiver, args) {
          const value: unknown = args[0];
          const authored =
            typeof value === 'object' &&
            value !== null &&
            'layers' in value &&
            Array.isArray(value.layers) &&
            'nextLayer' in value;
          const start = performance.now();
          const result: unknown = Reflect.apply(target, receiver, args);
          if (authored) {
            window.renderingMetrics.serializations++;
            window.renderingMetrics.dirtyMs += performance.now() - start;
          }
          return result;
        },
      });
      let depth = 0;
      const save = ctx.save.bind(ctx),
        restore = ctx.restore.bind(ctx);
      ctx.save = () => {
        depth++;
        save();
      };
      ctx.restore = () => {
        restore();
        if (--depth === 0 && latestInput !== undefined) {
          window.renderingMetrics.latencies.push(performance.now() - latestInput);
          latestInput = undefined;
        }
      };
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
        performance.clearMeasures();
        window.renderingMetrics = {
          draws: 0,
          images: 0,
          resets: 0,
          styles: 0,
          times: [],
          requests: 0,
          inputTimes: [],
          latencies: [],
          frames: [],
          serializations: 0,
          dirtyMs: 0,
          uiUpdates: 0,
        };
      });
    if (name === 'small' && !process.env.FORGE_RENDER_BASELINE) {
      const transitions = await page.locator('#scene').evaluate(async (canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw Error('Expected scene canvas');
        }
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        canvas.dispatchEvent(new PointerEvent('pointerleave'));
        await frame();
        const clear = canvas.toDataURL();
        const rect = canvas.getBoundingClientRect();
        const move = (x = 26) =>
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: rect.left + x,
              clientY: rect.top + 26,
              pointerId: 1,
            }),
          );
        let before = window.renderingMetrics.draws;
        move();
        canvas.dispatchEvent(new PointerEvent('pointerleave'));
        await frame();
        const leave = {
          paints: window.renderingMetrics.draws - before,
          clear: canvas.toDataURL() === clear,
        };
        before = window.renderingMetrics.draws;
        move();
        canvas.dispatchEvent(new PointerEvent('pointercancel'));
        const immediate = window.renderingMetrics.draws - before;
        await frame();
        const cancel = { immediate, paints: window.renderingMetrics.draws - before };
        before = window.renderingMetrics.draws;
        // Cancel left hover at cell 3,3; change cells to queue a fresh frame.
        move(34);
        const zoom = document.getElementById('zoom');
        if (!(zoom instanceof HTMLSelectElement)) {
          throw Error('Expected zoom');
        }
        zoom.value = '2';
        zoom.dispatchEvent(new Event('change'));
        const zoomImmediate = window.renderingMetrics.draws - before;
        await frame();
        const zoomPaints = window.renderingMetrics.draws - before;
        zoom.value = '1';
        zoom.dispatchEvent(new Event('change'));
        return { leave, cancel, zoomImmediate, zoomPaints };
      });
      expect(transitions).toEqual({
        leave: { paints: 1, clear: true },
        cancel: { immediate: 1, paints: 1 },
        zoomImmediate: 1,
        zoomPaints: 1,
      });
    }
    // Native Playwright mouse input and deliberately synchronous bursts are separate samples.
    const interactions: Record<
      string,
      Metrics & { measures: { name: string; duration: number }[] }
    > = {};
    const profile = async (label: string, work: () => Promise<void>) => {
      await page.evaluate(() => {
        performance.clearMeasures();
        performance.clearMarks();
        window.renderingMetrics = {
          draws: 0,
          images: 0,
          resets: 0,
          styles: 0,
          times: [],
          requests: 0,
          inputTimes: [],
          latencies: [],
          frames: [],
          serializations: 0,
          dirtyMs: 0,
          uiUpdates: 0,
        };
      });
      await page.evaluate(() => {
        const tick = (time: number) => {
          window.renderingMetrics.frames.push(time);
          window.renderingMonitor = requestAnimationFrame(tick);
        };
        window.renderingMonitor = requestAnimationFrame(tick);
      });
      await work();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      interactions[label] = await page.evaluate(() => {
        if (window.renderingMonitor !== undefined) {
          cancelAnimationFrame(window.renderingMonitor);
        }
        return {
          ...window.renderingMetrics,
          measures: performance
            .getEntriesByType('measure')
            .map(({ name, duration }) => ({ name, duration })),
        };
      });
    };
    if (name === 'small' || name === 'large') {
      const first = await scenePoint(page, 0, 0);
      await profile('native-hover', async () => {
        for (let i = 0; i < 24; i++) {
          await page.mouse.move(first.x + (i % 12) * 8, first.y + Math.floor(i / 12) * 8);
        }
      });
      await profile('burst-hover', async () => {
        const immediate = await page.locator('#scene').evaluate((canvas) => {
          // Independent refresh/checkpoint timers may run between profile setup tasks.
          // Only synchronous hover-handler work belongs to this assertion.
          const beforeDraws = window.renderingMetrics.draws;
          const beforeSerializations = window.renderingMetrics.serializations;
          const rect = canvas.getBoundingClientRect();
          for (let i = 0; i < 20; i++) {
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: rect.left + (i % 12) * 8 + 2,
                clientY: rect.top + 26,
                pointerId: 1,
              }),
            );
          }
          return {
            draws: window.renderingMetrics.draws - beforeDraws,
            serializations: window.renderingMetrics.serializations - beforeSerializations,
            coordinates: document.getElementById('coordinates')?.textContent,
          };
        });
        if (!process.env.FORGE_RENDER_BASELINE) {
          expect(immediate.draws).toBe(0);
          expect(immediate.serializations).toBe(0);
          expect(immediate.coordinates).toContain('Cell 7, 3');
        }
      });
      if (!process.env.FORGE_RENDER_BASELINE) {
        expect(interactions['burst-hover'].draws).toBe(1);
        expect(interactions['burst-hover'].uiUpdates).toBe(0);
      }
    }
    if (name === 'small' && !process.env.FORGE_RENDER_BASELINE) {
      const capture = info.outputPath('hover-feedback.png');
      await page.screenshot({ path: capture });
      await info.attach('hover-feedback.png', { path: capture, contentType: 'image/png' });
    }
    const movesPerBurst = name === 'budget' ? 5 : 20;
    const moveCount = 6 * movesPerBurst;
    const results: Record<string, Metrics> = {};
    const snapshot = async (workload: string) => {
      results[workload] = await page.evaluate(() => window.renderingMetrics);
      if (workload !== 'animation') {
        const paints =
          !process.env.FORGE_RENDER_BASELINE && workload.startsWith('hover') ? 6 : moveCount;
        expect(results[workload].draws).toBe(paints);
        if (process.env.FORGE_PROFILE_SPARSE) {
          expect(results[workload].images).toBeGreaterThan(0);
        } else if (process.env.FORGE_PROFILE_REFERENCE) {
          expect(results[workload].images).toBe(paints * (width * height * 1.5 + 1));
        } else {
          // Scene composition copies bounded transparent chunks rather than every tile.
          expect(results[workload].images).toBeGreaterThan(0);
          expect(results[workload].images).toBeLessThan(paints * (width * height * 1.5 + 1));
        }
        if (!process.env.FORGE_RENDER_BASELINE && workload.startsWith('hover')) {
          expect(results[workload].uiUpdates).toBe(0);
        }
      }
      if (!process.env.FORGE_RENDER_BASELINE && workload === 'painting') {
        // One dirty serialization per UI refresh; allow independent refresh/checkpoint polling.
        expect(results[workload].serializations).toBeGreaterThanOrEqual(moveCount);
        expect(results[workload].serializations).toBeLessThan(moveCount * 2);
      }
      interactions[workload] = await page.evaluate(() => ({
        ...window.renderingMetrics,
        measures: performance
          .getEntriesByType('measure')
          .map(({ name, duration }) => ({ name, duration })),
      }));
      if (!process.env.FORGE_RENDER_BASELINE) {
        expect(results[workload].resets).toBe(0);
        expect(results[workload].styles).toBe(0);
      }
    };
    const moves = async () => {
      // Six bursts of different hover cells; use fewer samples at the cell budget.
      await page.evaluate(async (movesPerBurst) => {
        const canvas = document.getElementById('scene');
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw Error('Expected scene canvas');
        }
        for (let burst = 0; burst < 6; burst++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const rect = canvas.getBoundingClientRect();
          for (let i = 0; i < movesPerBurst; i++) {
            const start = performance.now();
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: rect.left + (i % Math.min(12, canvas.width / 8)) * 8 + 2,
                clientY: rect.top + (burst % 6) * 8 + 2,
                pointerId: 1,
              }),
            );
            window.renderingMetrics.times.push(performance.now() - start);
          }
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }, movesPerBurst);
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
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
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
    await info.attach('interaction-profile.json', {
      body: JSON.stringify(interactions, null, 2),
      contentType: 'application/json',
    });
    await info.attach('rendering-profile.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  });
}
