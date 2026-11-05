/** Optional mixed inventory / object / lifecycle measurements with scoped instrumentation. */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import {
  test,
  expect,
  editorReady,
  clickControl,
  setControl,
  scenePoint,
  chooseSavedScene,
} from '../support/browser-fixtures.ts';
import { saveArtwork } from '../support/artwork-controls.ts';
import { createHash } from 'node:crypto';
import { sceneCostBundle } from '../support/scene-cost-profile.ts';

for (const large of [false, true]) {
  test(`scene costs and retained resources: ${large ? 'large' : 'ordinary'}`, async ({
    page,
    workspace,
    browser,
  }, info) => {
    test.skip(process.env.FORGE_SCENE_COST_PROFILE !== '1', 'Optional scene/resource profile');
    test.setTimeout(300000);
    const root = join(workspace.folder, 'project');
    await cp('tests/playwright/support/fixtures/editor/project', root, { recursive: true });
    const scene = execFileSync(
      workspace.python,
      [
        '-I',
        '-c',
        `
import json,sys
from pathlib import Path
from uuid import uuid4
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1])); large=sys.argv[2]=='True'
for i in range(32 if large else 4):
 frames=[dict(id=f'f{j}',name=f'Pose {j}',kind='sprite',x=(j%8)*16,y=(j//8)*32,width=16,height=32,origin=[4,8]) for j in range(32)]
 c=p.artwork.documents.create_sheet(f'library_{i}',f'Library {i}','sprite',128,128,p.catalog()['revision'],frames=frames,sequences=[dict(id='walk',name='Walk',loop=True,frames=[dict(frame_id=f'f{j}',duration_ms=120) for j in range(8)])])
 p.artwork.documents.save(c)
path=p.root/'forge.project.json'; document=json.loads(path.read_text())
definitions=[dict(id=str(uuid4()),name=f'Definition {i}',kind='point',fields=[dict(name=f'field{j}',type='int',required=True) for j in range(2)]) for i in range(128 if large else 4)]
document['object_definitions']=dict(version=1,definitions=definitions)
path.write_text(json.dumps(document))
w,h=(128,96) if large else (16,12)
s=p.scenes.create('Cost profile',w,h,8,p.catalog()['revision'])
layers=[dict(id=i+1,name=f'Tiles {i}',type='tilelayer',visible=i!=2,cells=[['terrain/earth/0/0' if (x+y+i)%4==0 else '' for x in range(w)] for y in range(h)]) for i in range(3)]
layers.append(dict(id=4,name='Instances',type='objectgroup',visible=True,objects=[dict(id=i+1,kind='point',x=(i%64)*2,y=(i//64)*2,definition=definitions[i%len(definitions)]['id'],name=f'Instance {i}',**{'class':'Instance'},properties=[]) for i in range(4096 if large else 64)]))
p.scenes.save(s['id'],dict(width=w,height=h,grid=8,layers=layers,next_layer_id=5,next_object_id=4097 if large else 65),s['revision'],p.catalog()['revision'])
print(s['id'])
`,
        root,
        large ? 'True' : 'False',
      ],
      { encoding: 'utf8' },
    ).trim();
    const url = await workspace.start(root);
    const baseline = process.env.FORGE_COST_BASELINE === '1';
    const bundle = await sceneCostBundle(baseline);
    await page.route('**/project.js', (route) =>
      route.fulfill({ body: bundle, contentType: 'text/javascript' }),
    );
    await page.addInitScript(() => {
      window.sceneCosts = {};
      window.profileLongTasks = [];
      new PerformanceObserver((list) => {
        window.profileLongTasks.push(
          ...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })),
        );
      }).observe({ type: 'longtask', buffered: true });
    });
    const requests: { path: string; bytes: number; responseBytes?: number }[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
        requests.push({
          path: new URL(request.url()).pathname,
          bytes: request.postDataBuffer()?.length ?? 0,
        });
      }
    });
    page.on('response', (response) => {
      const request = requests.findLast(
        (request) => request.path === new URL(response.url()).pathname,
      );
      if (request) {
        request.responseBytes = Number(response.headers()['content-length'] ?? 0);
      }
    });
    const phases: { name: string; elapsed: number; costs: Record<string, number[]> }[] = [];
    const phase = async (name: string, work: () => Promise<void>) => {
      await page.evaluate(() => {
        window.sceneCosts = {};
      });
      const start = performance.now();
      await work();
      phases.push({
        name,
        elapsed: performance.now() - start,
        costs: await page.evaluate(() => window.sceneCosts),
      });
    };
    const cold = performance.now();
    await page.goto(url);
    await editorReady(page);
    const coldProjectMs = performance.now() - cold;
    await phase('open', async () => {
      await chooseSavedScene(page, scene);
      await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    });
    await phase('library-search', async () => {
      await page.locator('#search').fill('f31');
      await expect(page.locator('#palette')).toContainText('f31');
      await page.locator('#search').fill('');
    });
    await phase('paint-and-transient-refresh', async () => {
      await clickControl(page, 'artwork-tab');
      await page.locator('[data-asset="terrain/stone"]').first().click();
      const point = await scenePoint(page, 2, 2);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 30, point.y + 30, { steps: 30 });
      await page.mouse.up();
      await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
      // Selection and tool changes exercise full control refresh without authoring.
      for (let trial = 0; trial < 3; trial++) {
        await page.locator('input[name=tool][value=select]').check();
        await page.locator('input[name=tool][value=paint]').check();
      }
      await expect
        .poll(() => requests.filter((request) => request.path.endsWith('checkpoint-draft')).length)
        .toBeGreaterThan(0);
    });
    await phase('object-hit-and-selection', async () => {
      await page
        .getByRole('radio', { name: 'Instances Objects · Visible', exact: true })
        .locator('..')
        .click();
      await page.locator('input[name=tool][value=select]').check();
      for (let trial = 1; trial <= 6; trial++) {
        await setControl(page, 'object-list', String(trial));
      }
      const point = await scenePoint(page, 4, 4);
      await page.mouse.click(point.x, point.y);
    });
    await phase('pan-zoom-history-save', async () => {
      await page.locator('#zoom').selectOption('2');
      const point = await scenePoint(page, 20, 20);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(point.x + 40, point.y + 30, { steps: 10 });
      await page.mouse.up({ button: 'middle' });
      await page.locator('#undo').click();
      await page.locator('#redo').click();
      await clickControl(page, 'save');
      await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    });
    await phase('external-refresh', async () => {
      await page.locator('#scene').focus();
      execFileSync(workspace.python, [
        '-I',
        '-c',
        `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1])); loaded=p.scenes.load(sys.argv[2])
objects=next(layer['objects'] for layer in loaded['scene']['layers'] if layer['type']=='objectgroup')
objects[0]['name']='External instance'
p.scenes.save(sys.argv[2],loaded['scene'],loaded['revision'],p.catalog()['revision'])
`,
        root,
        scene,
      ]);
      await expect(page.locator('#object-list option').first()).toHaveText(
        'External instance · #1',
      );
      await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    });
    const cdp = await page.context().newCDPSession(page);
    const resources: unknown[] = [];
    const sample = async (name: string) => {
      await cdp.send('HeapProfiler.collectGarbage');
      resources.push({
        name,
        heap: await cdp.send('Runtime.getHeapUsage'),
        dom: await cdp.send('Memory.getDOMCounters'),
        canvases: await page.locator('canvas').evaluateAll((nodes) => ({
          count: nodes.length,
          bytes: nodes.reduce(
            (sum, node) =>
              sum + (node instanceof HTMLCanvasElement ? node.width * node.height * 4 : 0),
            0,
          ),
        })),
      });
    };
    await sample('scene-saved');
    await phase('retained-artwork-documents', async () => {
      for (let index = 0; index < 4; index++) {
        // Library activation uses the real document controller and retained session map.
        await page.locator('#palette').evaluate(
          (element, index) =>
            element.dispatchEvent(
              new CustomEvent('open-artwork', {
                detail: { atlas: `library_${index}`, region: 'f0' },
              }),
            ),
          index,
        );
        await expect(page.locator('#artwork-heading')).toHaveText(`Library ${index}`);
        await expect(page.locator('#art-canvas')).toBeVisible();
        await page.locator('#art-frame-view').click();
        await page.locator('#art-show-animation').click();
        await page.locator('#art-play').click();
        await expect(page.locator('#art-animation-status')).toContainText('frame');
        await page.locator('#art-play').click();
        await page.locator('#art-canvas').evaluate((canvas) => {
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw Error('Expected pixel canvas');
          }
          const capture = canvas.setPointerCapture.bind(canvas);
          canvas.setPointerCapture = () => undefined;
          try {
            for (let stroke = 0; stroke < 24; stroke++) {
              const color = document.querySelector<HTMLInputElement>('#art-color');
              if (color) {
                color.value = stroke % 2 ? '#123456' : '#654321';
              }
              const bounds = canvas.getBoundingClientRect();
              const zoom = Number(
                document.querySelector<HTMLSelectElement>('#art-zoom')?.value ?? 1,
              );
              for (const type of ['pointerdown', 'pointerup']) {
                canvas.dispatchEvent(
                  new PointerEvent(type, {
                    pointerId: 7,
                    clientX: bounds.left + ((stroke % 12) + 0.5) * zoom,
                    clientY: bounds.top + (Math.floor(stroke / 12) + 0.5) * zoom,
                  }),
                );
              }
            }
          } finally {
            canvas.setPointerCapture = capture;
          }
        });
        await saveArtwork(page);
      }
      await clickControl(page, 'scene-document');
    });
    await sample('four-retained-documents');
    await phase('repeated-switch', async () => {
      for (let cycle = 0; cycle < 12; cycle++) {
        await page.locator('#palette').evaluate(
          (element, index) =>
            element.dispatchEvent(
              new CustomEvent('open-artwork', {
                detail: { atlas: `library_${index}`, region: 'f0' },
              }),
            ),
          cycle % 4,
        );
        await expect(page.locator('#artwork-heading')).toHaveText(`Library ${cycle % 4}`);
        await clickControl(page, 'scene-document');
      }
    });
    await sample('after-twelve-switches');
    const evaluate = (source: string): Promise<unknown> => page.evaluate(source);
    await evaluate(
      "(async()=>{window.profileModule=await import('/project.js');window.profileModule.editor.dispose()})()",
    );
    await sample('disposed');
    for (let cycle = 0; cycle < 3; cycle++) {
      await evaluate(
        "history.replaceState(null,'','/');window.profileMounted=window.profileModule.mountProjectEditor()",
      );
      await editorReady(page);
      await chooseSavedScene(page, scene);
      await expect(page.locator('#scene-save-state')).toHaveText('Saved');
      await evaluate('window.profileMounted.dispose()');
      await sample(`remount-disposed-${cycle + 1}`);
    }
    const output = {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      date: new Date().toISOString(),
      baseline,
      bundleSha256: createHash('sha256').update(bundle).digest('hex'),
      longTasks: await page.evaluate(() => window.profileLongTasks),
      instrumentation: 'minified test-only boundary wrappers; nested costs overlap',
      browser: browser.version(),
      node: process.version,
      cpu: cpus()[0]?.model,
      large,
      coldProjectMs,
      phases,
      resources,
      requests,
    };
    await info.attach('scene-resource-profile.json', {
      body: JSON.stringify(output, null, 2),
      contentType: 'application/json',
    });
    if (process.env.FORGE_PROFILE_OUTPUT) {
      await mkdir(process.env.FORGE_PROFILE_OUTPUT, { recursive: true });
      await writeFile(
        join(process.env.FORGE_PROFILE_OUTPUT, `scene-${large ? 'large' : 'ordinary'}.json`),
        JSON.stringify(output, null, 2) + '\n',
      );
    }
  });
}
