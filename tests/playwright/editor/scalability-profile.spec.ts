/** Optional observational matrix, including a disposable copy of a consumer project. */
import { build } from 'esbuild';
import { readFile, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { test, expect, editorReady } from '../support/browser-fixtures.ts';

// Profiling instrumentation is bundled here; it never enters shipped browser assets.
async function instrumented(reference: boolean, cache: boolean) {
  const result = await build({
    entryPoints: ['frontend/project.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    define: { __FORGE_BUILD_LABEL__: '"profile"' },
    plugins: [
      {
        name: 'measure-visits',
        setup(builder) {
          builder.onLoad(
            { filter: /(?:editor-(?:rendering|viewport)|tile-cache)\.mts$/ },
            async (args) => {
              let contents =
                reference && !args.path.endsWith('tile-cache.mts')
                  ? await readFile(
                      `tests/fixtures/rendering-baseline/${basename(args.path, '.mts')}.txt`,
                      'utf8',
                    )
                  : await readFile(args.path, 'utf8');
              if (reference) {
                contents = contents.replace(
                  '    draw,',
                  '    drawOverview: (context, ...rect) => context.drawImage(canvas, ...rect),\n    draw,',
                );
                contents = contents.replace(
                  'row.forEach((cell, x) => {',
                  'row.forEach((cell, x) => { globalThis.forgeProfile.visited++;',
                );
              } else {
                contents = contents
                  .replace(
                    'const signature = JSON.stringify(rows);',
                    'globalThis.forgeProfile.visited += rows.reduce((n, row) => n + row.length, 0); const signature = JSON.stringify(rows);',
                  )
                  .replace(
                    'const [asset, flags] = tileParts(row[x]);',
                    'globalThis.forgeProfile.visited++; const [asset, flags] = tileParts(row[x]);',
                  );
              }
              if (!reference && !cache) {
                contents = contents.replace('ports.regions, retain)', 'ports.regions, false)');
              }
              return { contents, loader: 'ts' };
            },
          );
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

type Profile = { visited: number; images: number; raster: number; times: number[] };
declare global {
  interface Window {
    forgeProfile: Profile;
  }
}

for (const consumer of [false, true]) {
  test(`observational scalability matrix: ${consumer ? 'Forest' : 'synthetic'}`, async ({
    page,
    workspace,
  }, info) => {
    test.skip(!process.env.FORGE_SCALABILITY_PROFILE, 'Explicit profiling run only');
    test.skip(consumer && !process.env.FORGE_FOREST_PROJECT, 'Consumer project path not supplied');
    test.setTimeout(180000);
    const root = join(workspace.folder, 'world');
    await cp(
      consumer
        ? (process.env.FORGE_FOREST_PROJECT ?? '')
        : 'tests/playwright/support/fixtures/editor/project',
      root,
      { recursive: true },
    );
    const ids: unknown = consumer
      ? []
      : JSON.parse(
          execFileSync(
            workspace.python,
            [
              '-I',
              '-c',
              `
import json, sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1])); ids=[]
for w,h in [(16,12),(128,96)]:
 for sparse in [False, True]:
  s=p.scenes.create(f'{w}x{h} {"sparse" if sparse else "dense"}',w,h,8,p.catalog()['revision'])
  layers=[dict(id=i+1,name=f'Tiles {i}',type='tilelayer',visible=True,cells=[['terrain/earth/0/0' if ((i==0 and not sparse) or (x+y+i)%(16 if sparse else 4)==0) else '' for x in range(w)] for y in range(h)]) for i in range(3)]
  layers.insert(1,dict(id=4,name='Actors',type='objectgroup',visible=True,objects=[dict(id=1,asset='actors/idle',x=32,y=24,name='',**{'class':''},properties=[])]))
  p.scenes.save(s['id'],dict(width=w,height=h,grid=8,layers=layers,next_layer_id=5,next_object_id=2),s['revision'],p.catalog()['revision'])
  ids.append(s['id'])
print(json.dumps(ids))
`,
              root,
            ],
            { encoding: 'utf8' },
          ),
        );
    if (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string')) {
      throw Error('scene ids');
    }
    const url = await workspace.start(root);
    const measurements: unknown[] = [];
    for (const mode of ['before', 'culled', 'cached']) {
      const reference = mode === 'before';
      const bundle = await instrumented(reference, mode === 'cached');
      await page.route('**/project.js', (route) =>
        route.fulfill({ body: bundle, contentType: 'text/javascript' }),
      );
      await page.addInitScript(() => {
        window.forgeProfile = { visited: 0, images: 0, raster: 0, times: [] };
      });
      await page.goto(url);
      await editorReady(page);
      const scenes = consumer
        ? await page
            .locator('#scenes option')
            .evaluateAll((options) =>
              options
                .filter((o) =>
                  o.textContent?.includes('CURRENT - Mosslight Trail v4 - Full Artwork'),
                )
                .map((o) => o.getAttribute('value') ?? ''),
            )
        : ids.filter((id: unknown): id is string => typeof id === 'string');
      expect(scenes.length).toBeGreaterThan(0);
      for (const scene of scenes) {
        await page.locator('#scenes').selectOption(scene);
        await expect(page.locator('#scene-save-state')).toHaveText('Saved');
        // Fit below 1x is a review feature for artwork scenes.
        await page.locator('#review-mode').click();
        await page.evaluate(() => {
          const canvas = document.getElementById('scene');
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw Error('canvas');
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw Error('context');
          }
          const image = Object.getOwnPropertyDescriptor(
            CanvasRenderingContext2D.prototype,
            'drawImage',
          );
          const native: unknown = image?.value;
          function isDrawImage(value: unknown): value is CanvasRenderingContext2D['drawImage'] {
            return typeof value === 'function';
          }
          if (!isDrawImage(native)) {
            throw Error('drawImage');
          }
          CanvasRenderingContext2D.prototype.drawImage = new Proxy(native, {
            apply(target, receiver: CanvasRenderingContext2D, args: unknown[]) {
              if (receiver.canvas === canvas) {
                window.forgeProfile.images++;
              } else {
                window.forgeProfile.raster++;
              }
              Reflect.apply(target, receiver, args);
            },
          });
          let depth = 0,
            start = 0;
          const save = ctx.save.bind(ctx),
            restore = ctx.restore.bind(ctx);
          ctx.save = () => {
            if (depth++ === 0) {
              start = performance.now();
            }
            save();
          };
          ctx.restore = () => {
            restore();
            if (--depth === 0) {
              window.forgeProfile.times.push(performance.now() - start);
            }
          };
        });
        for (const zoom of ['fit', '1', '4']) {
          await page.locator('#zoom').selectOption(zoom);
          for (const position of [0, 0.5, 1]) {
            const geometry = await page
              .locator('#viewport')
              .evaluate(async (viewport, fraction) => {
                viewport.scrollTo(
                  (viewport.scrollWidth - viewport.clientWidth) * fraction,
                  (viewport.scrollHeight - viewport.clientHeight) * fraction,
                );
                await new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                );
                const canvas = document.getElementById('scene');
                if (!(canvas instanceof HTMLCanvasElement)) {
                  throw Error('canvas');
                }
                const c = canvas.getBoundingClientRect(),
                  v = viewport.getBoundingClientRect();
                return {
                  width: canvas.width,
                  height: canvas.height,
                  visibleWidth: Math.min(c.right, v.right) - Math.max(c.left, v.left),
                  visibleHeight: Math.min(c.bottom, v.bottom) - Math.max(c.top, v.top),
                  scale: c.width / canvas.width,
                };
              }, position);
            await page.evaluate(() => {
              window.forgeProfile = { visited: 0, images: 0, raster: 0, times: [] };
              const grid = document.getElementById('grid');
              if (!(grid instanceof HTMLInputElement)) {
                throw Error('grid');
              }
              for (let i = 0; i < 30; i++) {
                grid.dispatchEvent(new Event('change'));
              }
            });
            const metrics = await page.evaluate(() => window.forgeProfile);
            measurements.push({ mode, reference, scene, zoom, position, geometry, ...metrics });
          }
        }
        await page.locator('#review-mode').click();
        if (consumer && mode === 'cached') {
          await page.locator('#zoom').selectOption('1');
          await page.locator('#viewport').evaluate((viewport) => viewport.scrollTo(0, 0));
          await page.locator('#layers [data-layer-id="39"] .layer-choice').click();
          await page.locator('input[name=tool][value=erase]').check();
          const canvas = await page.locator('#scene').boundingBox();
          if (!canvas) {
            throw Error('canvas');
          }
          await page.mouse.click(canvas.x + 24, canvas.y + 24);
          await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
          await page.locator('#undo').click();
          await expect(page.locator('#scene-save-state')).toHaveText('Saved');
          await page.locator('input[name=tool][value=select]').check();
          await page.mouse.move(canvas.x + 8, canvas.y + 8);
          await page.mouse.down();
          await page.mouse.move(canvas.x + 80, canvas.y + 40, { steps: 8 });
          await page.mouse.up();
          await expect(page.locator('#copy-selection')).toBeEnabled();
          await page.locator('#terrain-overlay').check();
          await page.locator('#collision-overlay').check();
          await page.screenshot({ path: info.outputPath('forest-editing.png') });
          await info.attach('forest-editing.png', {
            path: info.outputPath('forest-editing.png'),
            contentType: 'image/png',
          });
          await expect(page.locator('#scene-save-state')).toHaveText('Saved');
        }
        // Remove instrumentation wrappers between scenes via a fresh page.
        await page.goto(url);
        await editorReady(page);
      }
      await page.unroute('**/project.js');
    }
    await info.attach('scalability-profile.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
  });
}
