import { record, array } from '../../../frontend/shared/decode.mts';
/** Browser creation, far-edge authoring, recovery and resize at grid 16. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { test, expect, clickControl, scenePoint } from '../support/browser-fixtures.ts';

test('wide scene creation, far-edge edits, recovery, resize and saved coordinates', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'wide');
  const python = async (script: string) =>
    (await promisify(execFile)(workspace.python, ['-c', script, root])).stdout;
  await python(`
import sys, json
from pathlib import Path
sys.path.insert(0, 'tests')
from support.atlas_fixture import bundle, image, sprite_bundle
from gbc_scene_forge.project.application import Project
root = Path(sys.argv[1])
p = Project.create(root, 'Wide scenes', starter='blockout')
path, manifest = bundle(root.parent/'tiles')
manifest.update(regions=[dict(name='floor',kind='tile',x=0,y=0,width=16,height=16)], animations=[], cell_palettes=[0]*4)
path.write_text(json.dumps(manifest))
(path.parent/'atlas.png').write_bytes(image(16,16,rgb=(82,82,82)))
for source in (path, sprite_bundle(root.parent/'sprites')[0]):
    p.artwork.import_atlas(source, p.catalog()['revision'])
`);
  await page.goto(await workspace.start(root));
  await expect(page.locator('#show-create')).toBeEnabled();
  await clickControl(page, 'show-create');
  await page.locator('#scene-title').fill('Long trail');
  await page.locator('#cell-size').selectOption('16');
  await expect(page.locator('#width')).toHaveAttribute('max', '512');
  await page.locator('#width').fill('480');
  await page.locator('#height').fill('9');
  await page.locator('#scene-form button.primary').click();
  await expect(page.locator('#scene')).toHaveAttribute('width', '7680');
  await expect(page.locator('#scene')).toHaveAttribute('height', '144');
  const id = await page.locator('#scenes').inputValue();
  // Use the same saved candidate path as MCP to add native actors and a far-edge camera.
  await python(`
from pathlib import Path
import sys
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.adapters.mcp.tools import Adapter
from gbc_scene_forge.planning import blockout
p=Project(Path(sys.argv[1]))
a=Adapter(p.root,single_project=True)
loaded=p.scenes.load('${id}')
s=blockout.new_scene(p.catalog()['project'],dict(width=480,height=9,grid=16,units='cells'))
s['layers'][0]['cells']=[['terrain/floor/0/0']*480 for _ in range(9)]
s['layers'][2]['objects']=[dict(id=2,kind='point',x=7679,y=143,name='Exit',properties=[])]
s['layers'][-1]['objects'][0]['x']=7504
s['layers'].append(dict(id=6,name='Actors',type='objectgroup',visible=True,objects=[dict(id=3,asset='actors/idle',x=7664,y=32,origin=[8,23])]))
s.update(next_layer_id=7,next_object_id=4)
a.call('save_scene',dict(project='project',project_revision=p.catalog()['revision'],scene_revision=loaded['revision'],scene_id=loaded['id'],scene=s))
`);
  await page.reload();
  await expect(page.locator('#scene')).toHaveAttribute('width', '7680');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#zoom').selectOption('1');
  await page.evaluate(() => document.getElementById('viewport')?.scrollTo(7680, 0));
  const timings = await page.locator('#scene').evaluate(async (canvas) => {
    const samples: number[][] = [];
    for (let trial = 0; trial < 4; trial++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rect = canvas.getBoundingClientRect();
      const times: number[] = [];
      for (let i = 0; i < 120; i++) {
        const start = performance.now();
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: rect.left + (460 + (i % 20)) * 16 + 2,
            clientY: rect.top + 2,
            pointerId: 1,
          }),
        );
        times.push(performance.now() - start);
      }
      if (trial > 0) {
        samples.push(times);
      }
    }
    return samples.map((times) => {
      times.sort((a, b) => a - b);
      return { median: times[60], p95: times[114] };
    });
  });
  console.log('Grid-16 480x9 hover milliseconds', timings);
  await info.attach('grid-16-wide-timings.json', {
    body: JSON.stringify(timings),
    contentType: 'application/json',
  });
  await clickControl(page, 'artwork-tab');
  await page.locator('input[name=tool][value=erase]').check();
  const point = await scenePoint(page, 478 * 16 + 8, 8);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  await page.locator('#undo').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#redo').click();
  await expect(page.locator('#draft-status')).toHaveText('Draft checkpoint saved');
  await page.reload();
  await expect(page.locator('#recovery-dialog')).toBeVisible();
  await clickControl(page, 'recovery-restore');
  await expect(page.locator('#status')).toContainText('Draft restored');
  await clickControl(page, 'show-resize');
  await page.locator('#resize-width').fill('512');
  await page.locator('#resize-confirm').click();
  await expect(page.locator('#scene')).toHaveAttribute('width', '8192');
  await page.locator('#undo').click();
  await expect(page.locator('#scene')).toHaveAttribute('width', '7680');
  await page.locator('#redo').click();
  await page.locator('#save').click();
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#scene')).toHaveAttribute('width', '8192');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#zoom').selectOption('1');
  await page.evaluate(() => document.getElementById('viewport')?.scrollTo(7400, 0));
  await page.screenshot({ path: info.outputPath('wide-scene.png') });
  await info.attach('Far edge of wide scene', {
    path: info.outputPath('wide-scene.png'),
    contentType: 'image/png',
  });
  const saved = record(
    JSON.parse(
      await python(`
import sys,json
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
s=p.scenes.load('${id}')['scene']
print(json.dumps(dict(width=s['width'],tile=s['layers'][0]['cells'][0][478],last=s['layers'][0]['cells'][0][479],objects=[o for l in s['layers'] for o in l.get('objects',[])])))
`),
    ),
  );
  expect(saved.width).toBe(512);
  expect(saved.tile).toBe('');
  expect(saved.last).toBe('terrain/floor/0/0');
  expect(array(saved.objects, record).map((o) => [o.id, o.x, o.y])).toEqual([
    [2, 7679, 143],
    [1, 7504, 0],
    [3, 7664, 32],
  ]);
});
