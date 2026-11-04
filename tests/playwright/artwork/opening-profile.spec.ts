/** Opt-in real editor measurements. Run alone with FORGE_PROFILE_OUTPUT pointing to a JSON file. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../support/browser-fixtures.ts';
import { revealArtworkControl } from '../support/artwork-controls.ts';
import { createOpeningFixture } from '../support/artwork-opening-fixture.ts';

test('measure Library opening and three-layer visibility', async ({
  page,
  workspace,
  browser,
}, info) => {
  const outputPath = process.env.FORGE_PROFILE_OUTPUT;
  test.skip(!outputPath, 'Optional artwork opening profile');
  if (!outputPath) {
    return;
  }
  test.setTimeout(240000);
  const root = join(workspace.folder, 'project');
  createOpeningFixture(workspace.python, root);
  const url = await workspace.start(root);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const requests: { path: string; milliseconds: number }[] = [];
  page.on('requestfinished', (request) => {
    if (request.url().includes('/api/')) {
      const timing = request.timing();
      requests.push({ path: new URL(request.url()).pathname, milliseconds: timing.responseEnd });
    }
  });
  const bundle = await readFile(
    process.env.FORGE_PROFILE_BUNDLE ?? 'src/gbc_scene_forge/static/project.js',
  );
  if (process.env.FORGE_PROFILE_BUNDLE) {
    await page.route('**/project.js', (route) =>
      route.fulfill({ body: bundle, contentType: 'text/javascript' }),
    );
  }
  const openings = [];
  for (const asset of ['small', 'large', 'layered']) {
    await page.goto(url);
    await expect(page.locator(`[data-asset="${asset}/artwork"]`)).toBeVisible();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 0 && process.env.FORGE_OPENING_CPU === '1') {
        await cdp.send('Profiler.start');
      }
      const timing = await page.evaluate(async (asset) => {
        const source = document.querySelector(`[data-asset="${asset}/artwork"]`);
        if (!(source instanceof HTMLElement)) {
          throw Error('Expected Library artwork');
        }
        const start = performance.now();
        let feedback: number | null = null;
        let chooser = false;
        source.click();
        while (performance.now() - start < 30000) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const loading = document.getElementById('art-loading');
          if (loading && !loading.hidden && feedback === null) {
            feedback = performance.now() - start;
          }
          chooser ||= !!document.getElementById('art-setup')?.checkVisibility();
          const editor = document.getElementById('art-editor');
          const color = document.getElementById('art-color');
          if (editor?.checkVisibility() && color instanceof HTMLInputElement && !color.disabled) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            return { feedbackMs: feedback, editableMs: performance.now() - start, chooser };
          }
        }
        throw Error('Artwork did not become editable');
      }, asset);
      openings.push({ asset, attempt, ...timing });
      if (attempt === 0 && process.env.FORGE_OPENING_CPU === '1') {
        const openingProfile = await cdp.send('Profiler.stop');
        await info.attach(`open-${asset}.cpuprofile`, {
          body: JSON.stringify(openingProfile.profile),
          contentType: 'application/json',
        });
      }
      // Remove the retained document to measure a fresh server/decode open, not tab restoration.
      await revealArtworkControl(page, 'art-discard');
      await page.locator('#art-discard').click();
      await expect(page.locator('#artwork-surface')).toBeHidden();
    }
  }
  await page.locator('[data-asset="layered/artwork"]').click();
  await revealArtworkControl(page, 'art-layer-visible');
  const toggles = [];
  for (let i = 0; i < 6; i++) {
    toggles.push(
      await page.locator('#art-layer-visible').evaluate(async (node) => {
        if (!(node instanceof HTMLInputElement)) {
          throw Error('Expected visibility checkbox');
        }
        const start = performance.now();
        node.click();
        const handlerMs = performance.now() - start;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return { handlerMs, frameProxyMs: performance.now() - start };
      }),
    );
    await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  }
  await cdp.send('Profiler.start');
  await page.locator('#art-layer-visible').evaluate((node) => {
    if (node instanceof HTMLElement) {
      node.click();
    }
  });
  const profile = await cdp.send('Profiler.stop');
  await info.attach('cpu-profile.json', {
    body: JSON.stringify(profile),
    contentType: 'application/json',
  });
  const buildInfo: unknown = JSON.parse(
    await readFile('src/gbc_scene_forge/static/build-info.json', 'utf8'),
  );
  const output = {
    environment: {
      browser: browser.version(),
      platform: platform(),
      release: release(),
      cpu: cpus()[0].model,
    },
    bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    buildInfo,
    requests,
    openings,
    toggles,
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
});
