/** Pixel equivalence, bounded reuse and geometry, independent of timing thresholds. */
import { execFileSync } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, editorReady } from '../support/browser-fixtures.ts';

import type * as CacheChecks from '../support/tile-cache-checks.ts';
import { referenceRenderer } from '../support/reference-renderer.ts';
const reference = await referenceRenderer();

test('culled cached scene matches full rendering across viewport and edit transitions', async ({
  page,
  workspace,
}, info) => {
  test.setTimeout(180000);
  const root = join(workspace.folder, 'world');
  await cp('tests/playwright/support/fixtures/editor/project', root, { recursive: true });
  const scene = execFileSync(
    workspace.python,
    [
      '-I',
      '-c',
      `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project(Path(sys.argv[1]))
s = p.scenes.create('Mixed layers', 128, 96, 8, p.catalog()['revision'])
layers = [dict(id=i+1, name=f'Tiles {i}', type='tilelayer', visible=i!=3,
 cells=[['terrain/earth/0/0' + (f'#{(x+y)%7+1}' if (x+y)%3==0 else '') if i==0 or (x+y+i)%4==0 else '' for x in range(128)] for y in range(96)]) for i in range(4)]
layers.insert(1, dict(id=5, name='Actors', type='objectgroup', visible=True, objects=[dict(id=1, asset='actors/idle', x=256, y=256, name='', **{'class': ''}, properties=[])]))
p.scenes.save(s['id'], dict(width=128, height=96, grid=8, layers=layers, next_layer_id=6, next_object_id=2), s['revision'], p.catalog()['revision'])
print(s['id'])
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  const url = await workspace.start(root);
  const captures: string[][] = [];
  for (const baseline of [false, true]) {
    if (baseline) {
      await page.route('**/project.js', (route) =>
        route.fulfill({ body: reference, contentType: 'text/javascript' }),
      );
    }
    await page.goto(url);
    await editorReady(page);
    await page.locator('#scenes').selectOption(scene);
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    const images: string[] = [];
    for (const [zoom, left, top, width, height] of [
      ['1', 0, 0, 1440, 1000],
      ['2', 311, 277, 1440, 1000],
      ['4', 1733, 1381, 1440, 1000],
      ['1', 10000, 10000, 980, 760],
      ['fit', 0, 0, 1440, 1000],
    ] as const) {
      await page.setViewportSize({ width, height });
      if (zoom === 'fit') {
        await page.locator('#review-mode').click();
      }
      await page.locator('#zoom').selectOption(zoom);
      await page
        .locator('#viewport')
        .evaluate((viewport, position) => viewport.scrollTo(...position), [left, top] as const);
      // Wait for owned scroll/ResizeObserver work, then remove transient hover.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.locator('#scene').dispatchEvent('pointerleave');
      await page.locator('#grid').uncheck();
      images.push(
        await page.locator('#scene').evaluate((canvas) => {
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw Error('canvas');
          }
          const viewport = document.getElementById('viewport');
          if (!viewport) {
            throw Error('viewport');
          }
          const c = canvas.getBoundingClientRect(),
            v = viewport.getBoundingClientRect();
          const left = Math.max(
            0,
            Math.ceil(((v.left + viewport.clientLeft - c.left) * canvas.width) / c.width),
          );
          const top = Math.max(
            0,
            Math.ceil(((v.top + viewport.clientTop - c.top) * canvas.height) / c.height),
          );
          const right = Math.min(
            canvas.width,
            Math.floor(
              ((v.left + viewport.clientLeft + viewport.clientWidth - c.left) * canvas.width) /
                c.width,
            ),
          );
          const bottom = Math.min(
            canvas.height,
            Math.floor(
              ((v.top + viewport.clientTop + viewport.clientHeight - c.top) * canvas.height) /
                c.height,
            ),
          );
          const output = document.createElement('canvas');
          output.width = right - left;
          output.height = bottom - top;
          const outputContext = output.getContext('2d');
          const context = canvas.getContext('2d');
          if (!outputContext || !context) {
            throw Error('context');
          }
          outputContext.putImageData(
            context.getImageData(left, top, right - left, bottom - top),
            0,
            0,
          );
          return output.toDataURL();
        }),
      );
    }
    captures.push(images);
    if (!baseline) {
      await page.screenshot({ path: info.outputPath('scalability.png') });
      await info.attach('scalability.png', {
        path: info.outputPath('scalability.png'),
        contentType: 'image/png',
      });
    }
  }
  expect(captures[0]).toEqual(captures[1]);
});

test('tile chunks preserve pixels through mutation, eviction and disposal', async ({
  page,
  forge,
}, info) => {
  const { build } = await import('esbuild');
  const bundle = await build({
    entryPoints: ['tests/playwright/support/tile-cache-checks.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'cacheChecks',
    platform: 'browser',
    target: 'es2022',
  });
  await page.route('**/cache-checks.js', (route) =>
    route.fulfill({ body: bundle.outputFiles[0].text, contentType: 'text/javascript' }),
  );
  await page.goto(forge.url);
  await page.addScriptTag({ url: new URL('cache-checks.js', forge.url).href });
  const result = await page.evaluate(() => window.cacheChecks.checkTileCache());
  expect(result.checks.every(Boolean)).toBe(true);
  expect(result.cold).toBeGreaterThan(0);
  expect(result.warm).toBe(0);
  expect(result.retainedBytes).toBeGreaterThan(0);
  expect(result.retainedBytes).toBeLessThanOrEqual(result.limit);
  expect(result.releasedBytes).toBe(0);
  await info.attach('tile-cache-resources.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
});

declare global {
  interface Window {
    cacheChecks: typeof CacheChecks;
  }
}
