/** Optional, production-bundle profiles. Timings are observations, never CI thresholds. */
/* eslint-disable @typescript-eslint/unbound-method -- Preserve and restore instrumented browser methods. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { cpus, platform, arch, release } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../support/browser-fixtures.ts';

const enabled = process.env.FORGE_RESPONSIVENESS_PROFILE === '1';
for (const [size, frames, steps] of [
  [16, 1, 0],
  [128, 32, 8],
  [256, 128, 0],
  [256, 128, 256],
]) {
  for (const throttle of [1, 4]) {
    test(`artwork response ${size}-${frames}-${steps} cpu${throttle}`, async ({
      page,
      workspace,
      browser,
    }, info) => {
      test.skip(!enabled && !(size === 128 && throttle === 1), 'Optional responsiveness profile');
      test.setTimeout(600000);
      const root = join(workspace.folder, 'project');
      execFileSync(workspace.python, [
        '-I',
        '-c',
        `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Responsiveness profile')
n,count,steps=map(int,sys.argv[2:])
w,h=(16,16) if count==1 else (16,32)
frames=[dict(id=f'f{i}',name=f'Frame {i}',kind='sprite',x=(i%(n//w))*w,y=(i//(n//w))*h,width=w,height=h,origin=[0,0]) for i in range(count)]
sequences=[dict(id='walk',name='Walk',loop=True,frames=[dict(frame_id=f'f{i%count}',duration_ms=120) for i in range(steps)])] if steps else []
c=p.artwork.documents.create_sheet('probe','Probe','sprite',n,n,p.catalog()['revision'],frames=frames,sequences=sequences)
p.artwork.documents.save(c)
`,
        root,
        String(size),
        String(frames),
        String(steps),
      ]);
      const url = await workspace.start(root);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const requests: { path: string; bytes: number; elapsed: number }[] = [];
      const starts = new Map<string, number>();
      page.on('request', (request) => {
        if (request.url().includes('/api/')) {
          starts.set(request.url(), performance.now());
          requests.push({
            path: new URL(request.url()).pathname,
            bytes: request.postDataBuffer()?.length ?? 0,
            elapsed: 0,
          });
        }
      });
      page.on('response', (response) => {
        const last = requests.findLast(
          (request) => request.path === new URL(response.url()).pathname,
        );
        if (last) {
          last.elapsed = performance.now() - (starts.get(response.url()) ?? performance.now());
        }
      });
      if (process.env.FORGE_PROFILE_BUNDLE) {
        const body = await readFile(process.env.FORGE_PROFILE_BUNDLE, 'utf8');
        await page.route('**/project.js', (route) =>
          route.fulfill({ body, contentType: 'text/javascript' }),
        );
      }
      const bundleSha256 = createHash('sha256')
        .update(
          await readFile(
            process.env.FORGE_PROFILE_BUNDLE ?? 'src/gbc_scene_forge/static/project.js',
          ),
        )
        .digest('hex');
      const buildInfo = await (await page.request.get(new URL('build-info.json', url).href)).text();
      await page.addInitScript(() => {
        window.profileLongTasks = [];
        new PerformanceObserver((list) => {
          window.profileLongTasks.push(
            ...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })),
          );
        }).observe({ type: 'longtask', buffered: true });
      });
      const coldStart = performance.now();
      await page.goto(url);
      await expect(page.locator('#show-artwork')).toBeEnabled();
      const open = async () => {
        await page.locator('#show-artwork').click();
        await page.locator('#art-existing-mode').click();
        await expect(page.locator('#art-open')).toBeEnabled();
        await page.locator('#art-open').click();
        await expect(page.locator('#art-canvas')).toBeVisible();
      };
      await open();
      const coldOpenMs = performance.now() - coldStart;
      const phases = [];
      for (const view of ['frame', 'sheet']) {
        await page.locator(`#art-${view}-view`).click();
        for (const expanded of steps ? [false, true] : [false]) {
          await page.locator('#art-sequence-frames').evaluate((element, open) => {
            const details = element.closest('details');
            if (details) {
              details.open = open;
            }
          }, expanded);
          const result = await page.evaluate(
            async (moves) => {
              const canvas = document.getElementById('art-canvas');
              if (!(canvas instanceof HTMLCanvasElement)) {
                throw Error('Expected artwork canvas');
              }
              const counts = {
                resets: 0,
                uploads: 0,
                draws: 0,
                encodes: 0,
                serializations: 0,
                serializationMs: 0,
              };
              const proto = HTMLCanvasElement.prototype;
              const dimensions = ['width', 'height'].map((key) => ({
                key,
                descriptor: Object.getOwnPropertyDescriptor(proto, key),
              }));
              for (const { key, descriptor } of dimensions) {
                if (descriptor?.set) {
                  const setter = descriptor.set;
                  Object.defineProperty(proto, key, {
                    ...descriptor,
                    set(value: number) {
                      counts.resets++;
                      Reflect.apply(setter, this, [value]);
                    },
                  });
                }
              }
              const context = CanvasRenderingContext2D.prototype;
              const upload = context.putImageData,
                draw = context.drawImage,
                encode = window.btoa,
                stringify = JSON.stringify;
              context.putImageData = new Proxy(upload, {
                apply(target, receiver, args) {
                  counts.uploads++;
                  Reflect.apply(target, receiver, args);
                },
              });
              context.drawImage = new Proxy(draw, {
                apply(target, receiver, args) {
                  counts.draws++;
                  Reflect.apply(target, receiver, args);
                },
              });
              window.btoa = (value) => {
                counts.encodes++;
                return encode(value);
              };
              JSON.stringify = new Proxy(stringify, {
                apply(target, receiver, args) {
                  const start = performance.now();
                  counts.serializations++;
                  const value: unknown = Reflect.apply(target, receiver, args);
                  counts.serializationMs += performance.now() - start;
                  return value;
                },
              });
              const capture = canvas.setPointerCapture;
              canvas.setPointerCapture = () => undefined;
              const samples = [];
              const frame = () =>
                new Promise<number>((resolve) =>
                  requestAnimationFrame(() => resolve(performance.now())),
                );
              const event = (type: string, i: number) => {
                const rect = canvas.getBoundingClientRect();
                // Stay within the first frame; preserve every segment using synthetic pointer events.
                const select = document.querySelector<HTMLSelectElement>('#art-zoom');
                const scale = Number(select?.value ?? 1);
                const start = performance.now();
                canvas.dispatchEvent(
                  new PointerEvent(type, {
                    pointerId: 7,
                    clientX: rect.left + ((i % 12) + 0.5) * scale,
                    clientY: rect.top + ((Math.floor(i / 12) % 12) + 0.5) * scale,
                    buttons: type === 'pointerup' ? 0 : 1,
                  }),
                );
                return performance.now() - start;
              };
              try {
                for (let trial = 0; trial < 4; trial++) {
                  const color = document.querySelector<HTMLInputElement>('#art-color');
                  if (color) {
                    color.value = ['#112233', '#445566', '#778899', '#aabbcc'][trial];
                  }
                  event('pointerdown', 0);
                  Object.assign(counts, {
                    resets: 0,
                    uploads: 0,
                    draws: 0,
                    encodes: 0,
                    serializations: 0,
                    serializationMs: 0,
                  });
                  const handlerMs = [],
                    toFrameMs = [];
                  const handlerCounts = { resets: 0, uploads: 0, draws: 0, encodes: 0 };
                  for (let i = 0; i < moves; i++) {
                    const start = performance.now();
                    const before = { ...counts };
                    handlerMs.push(event('pointermove', i));
                    for (const key of ['resets', 'uploads', 'draws', 'encodes'] as const) {
                      handlerCounts[key] += counts[key] - before[key];
                    }
                    if (i % 10 === 0) {
                      toFrameMs.push((await frame()) - start);
                    }
                  }
                  const moveCounts = { ...counts };
                  const releaseMs = event('pointerup', moves - 1);
                  const releaseCounts = { ...counts };
                  const undo = document.getElementById('undo'),
                    redo = document.getElementById('redo');
                  const historyMs = [];
                  for (const control of [undo, redo]) {
                    const start = performance.now();
                    if (control instanceof HTMLButtonElement) {
                      control.click();
                    }
                    historyMs.push(performance.now() - start);
                  }
                  if (trial > 0) {
                    samples.push({
                      handlerMs,
                      handlerCounts,
                      toFrameMs,
                      moveCounts,
                      releaseMs,
                      releaseCounts,
                      historyMs,
                    });
                  }
                }
                return samples;
              } finally {
                for (const { key, descriptor } of dimensions) {
                  if (descriptor) {
                    Object.defineProperty(proto, key, descriptor);
                  }
                }
                context.putImageData = upload;
                context.drawImage = draw;
                window.btoa = encode;
                JSON.stringify = stringify;
                canvas.setPointerCapture = capture;
              }
            },
            steps === 256 ? 24 : 120,
          );
          if (!enabled) {
            for (const trial of result) {
              expect(trial.handlerCounts.resets).toBe(0);
              expect(trial.handlerCounts.encodes).toBe(0);
              expect(trial.handlerCounts.uploads).toBeLessThanOrEqual(trial.handlerMs.length);
              expect(trial.handlerCounts.draws).toBeLessThanOrEqual(5 * trial.handlerMs.length);
            }
          }
          phases.push({ view, expanded, trials: result });
        }
      }
      if (size === 128 && throttle === 1) {
        const thumbnailPixel = async (selector: string) =>
          await page
            .locator(selector)
            .first()
            .evaluate((canvas) => {
              if (!(canvas instanceof HTMLCanvasElement)) {
                throw Error('Expected thumbnail');
              }
              return Array.from(canvas.getContext('2d')?.getImageData(60, 60, 1, 1).data ?? []);
            });
        const timeline = '#art-sequence-frames canvas';
        const strip = '#art-frame-strip button[data-frame="f0"] canvas';
        const previous = await thumbnailPixel(timeline);
        await page.locator('#art-timeline summary').first().click();
        await page.locator('#art-canvas').evaluate((canvas) => {
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw Error('Expected pixel canvas');
          }
          const capture = canvas.setPointerCapture.bind(canvas);
          canvas.setPointerCapture = () => undefined;
          const color = document.querySelector<HTMLInputElement>('#art-color');
          if (color) {
            color.value = '#00ff00';
          }
          const rect = canvas.getBoundingClientRect();
          const zoom = Number(document.querySelector<HTMLSelectElement>('#art-zoom')?.value ?? 1);
          try {
            for (const type of ['pointerdown', 'pointerup']) {
              canvas.dispatchEvent(
                new PointerEvent(type, {
                  pointerId: 7,
                  clientX: rect.left + 7.5 * zoom,
                  clientY: rect.top + 7.5 * zoom,
                }),
              );
            }
          } finally {
            canvas.setPointerCapture = capture;
          }
        });
        expect(await thumbnailPixel(strip)).toEqual([0, 255, 0, 255]);
        expect(await thumbnailPixel(timeline)).toEqual(previous);
        await page.locator('#art-timeline summary').first().click();
        await expect.poll(() => thumbnailPixel(timeline)).toEqual([0, 255, 0, 255]);
        await page.locator('#undo').click();
        expect(await thumbnailPixel(strip)).toEqual(previous);
        expect(await thumbnailPixel(timeline)).toEqual(previous);
        // New rows must paint immediately when switching sequences while visible.
        await page.locator('#art-sequence-id').evaluate((input) => {
          const details = input.closest('details');
          if (details) {
            details.open = true;
          }
        });
        await page.locator('#art-sequence-id').fill('Alternate');
        await page.locator('#art-add-sequence').click();
        await page.locator('#art-sequence').selectOption('walk');
        await page.locator('#art-sequence').selectOption('alternate');
        expect(await thumbnailPixel(timeline)).toEqual(previous);
      }
      await expect
        .poll(
          () => requests.filter((request) => request.path.endsWith('artwork-draft-write')).length,
        )
        .toBeGreaterThan(0);
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const surfaces = await page.locator('canvas').evaluateAll((canvases) => ({
        count: canvases.length,
        bytes: canvases.reduce(
          (sum, canvas) =>
            sum + (canvas instanceof HTMLCanvasElement ? canvas.width * canvas.height * 4 : 0),
          0,
        ),
      }));
      const output = {
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        label: process.env.FORGE_PROFILE_LABEL ?? 'working-tree',
        date: new Date().toISOString(),
        browser: browser.version(),
        node: process.version,
        python: execFileSync(workspace.python, ['--version'], { encoding: 'utf8' }).trim(),
        host: {
          platform: platform(),
          arch: arch(),
          release: release(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
        },
        bundleSha256,
        build: buildInfo,
        longTasks: await page.evaluate(() => window.profileLongTasks),
        workload: { size, frames, steps, throttle },
        coldOpenMs,
        phases,
        heap,
        surfaces,
        requests,
      };
      await info.attach('artwork-response.json', {
        body: JSON.stringify(output, null, 2),
        contentType: 'application/json',
      });
      if (process.env.FORGE_PROFILE_OUTPUT) {
        await mkdir(process.env.FORGE_PROFILE_OUTPUT, { recursive: true });
        await writeFile(
          join(process.env.FORGE_PROFILE_OUTPUT, `${size}-${frames}-${steps}-cpu${throttle}.json`),
          JSON.stringify(output, null, 2) + '\n',
        );
      }
    });
  }
}
