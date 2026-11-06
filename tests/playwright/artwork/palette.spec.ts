/** Composition inspection remains independent of the selected source and history. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { test, expect } from '../support/browser-fixtures.ts';
import {
  revealArtworkControl,
  activeArtworkLayer,
  selectArtworkLayer,
} from '../support/artwork-controls.ts';

test('palette scopes follow layers, blending, history and frame/sheet views', async ({
  page,
  workspace,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
from pathlib import Path
import sys
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.create(Path(sys.argv[1]),'Composition palette')
a=p.artwork.documents
frames=[dict(id=name,name=name,x=x,y=0,width=8,height=8,kind='sprite',origin=[0,0]) for name,x in [('left',0),('right',8)]]
c=a.create_sheet('picture','Forest study','sprite',16,8,p.catalog()['revision'],frames=frames,sequences=[])
items=[layers.item('Base'),layers.item('Overlay'),{**layers.item('Hidden'),'visible':False}]
c=layers.edit(c,items)
base=bytearray(bytes([255,0,0,255])*128)
for y in range(8):
    for x in range(8,16): base[(y*16+x)*4:(y*16+x+1)*4]=bytes([0,0,255,255])
base[12:16]=bytes([66,55,44,0])
overlay=bytearray(512)
overlay[:12]=bytes([0,255,0,255,0,255,0,128,7,8,9,0])
overlay[12:16]=bytes([9,20,30,128])
c=layers.reseal(c,{items[0]['id']:bytes(base),items[1]['id']:bytes(overlay),items[2]['id']:bytes([255,255,0,255])*128})
a.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/left"]').click();
  await revealArtworkControl(page, 'art-layer-list');
  const layer = activeArtworkLayer(page);
  const trigger = page.locator('#art-palette-toggle');
  const panel = page.locator('#art-palette');
  const swatch = (rgba: string) => page.locator(`#art-swatches button[data-rgba="${rgba}"]`);
  const open = async () => {
    if (!(await panel.isVisible())) {
      await revealArtworkControl(page, 'art-palette');
    }
    await panel.locator('[role=tab][aria-selected=true]').focus();
  };
  await page.locator('#art-sheet-view').click();
  await open();
  await expect(page.getByRole('tab', { name: 'Composition', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#art-palette-scope')).toHaveText('Entire sheet · visible composition');
  await expect(page.locator('#art-swatches button')).toHaveCount(5);
  for (const c of ['255,0,0,255', '0,0,255,255', '0,255,0,255', '127,128,0,255', '9,20,30,128']) {
    await expect(swatch(c)).toBeVisible();
  }
  await expect(swatch('255,255,0,255')).toHaveCount(0);
  await expect(swatch('7,8,9,0')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Selected layer', exact: true }).click();
  await expect(page.locator('#art-swatches button')).toHaveCount(3);
  await expect(swatch('66,55,44,0')).toBeVisible();
  await page.screenshot({ path: info.outputPath('source-layer-palette.png') });
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Composition', exact: true })).toBeFocused();
  await expect(page.locator('#art-palette-content')).toHaveAttribute(
    'aria-labelledby',
    'art-palette-composition',
  );
  await page.locator('#art-palette-sort').selectOption('usage');
  await expect(page.locator('#art-swatches button').first()).toHaveAttribute(
    'data-rgba',
    '0,0,255,255',
  );
  await expect(page.locator('#undo')).toBeDisabled();
  const active = await layer.getAttribute('data-layer-id');
  await swatch('9,20,30,128').click();
  await expect(layer).toHaveAttribute('data-layer-id', active ?? '');
  await expect(page.locator('#art-color')).toHaveValue('#09141e');
  await expect(page.locator('#art-alpha')).toHaveValue('128');
  await expect(page.locator('#undo')).toBeDisabled();
  await selectArtworkLayer(page, 'Overlay');
  await activeArtworkLayer(page).locator('.art-layer-visible').click();
  await open();
  await expect(page.locator('#art-swatches button')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.locator('#undo').click();
  await open();
  await expect(swatch('0,255,0,255')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#redo').click();
  await open();
  await expect(swatch('0,255,0,255')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await activeArtworkLayer(page).locator('.art-layer-visible').click();
  await page.locator('#art-layer-opacity').fill('50');
  await page.locator('#art-layer-opacity').press('Enter');
  await open();
  await expect(swatch('191,64,0,255')).toBeVisible();
  await expect(swatch('9,20,30,64')).toBeVisible();
  await expect(swatch('0,255,0,255')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('#art-frame-view').click();
  await open();
  await expect(page.locator('#art-palette-scope')).toHaveText(
    'Current frame · visible composition',
  );
  await expect(swatch('0,0,255,255')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await (await revealArtworkControl(page, 'art-frame')).selectOption('right');
  await open();
  await expect(page.locator('#art-swatches button')).toHaveCount(1);
  await expect(swatch('0,0,255,255')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#art-sheet-view').click();
  await selectArtworkLayer(page, 'Base');
  await page.locator('#art-color').fill('#0c2238');
  await page.locator('#art-alpha').fill('255');
  const canvas = await page.locator('#art-canvas').boundingBox();
  if (!canvas) {
    throw Error('Expected artwork canvas');
  }
  await page.mouse.click(
    canvas.x + (canvas.width * 9.5) / 16,
    canvas.y + (canvas.height * 2.5) / 8,
  );
  await open();
  await expect(swatch('12,34,56,255')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#undo').click();
  await open();
  await expect(swatch('12,34,56,255')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('#redo').click();
  await open();
  await expect(swatch('12,34,56,255')).toBeVisible();
  await page.locator('#art-palette-sort').selectOption('hue');
  for (const [width, height] of [
    [1440, 900],
    [800, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await panel.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox();
        return (
          !!bounds &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= height
        );
      })
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`composition-palette-${width}.png`) });
    const paletteBounds = await panel.boundingBox();
    const inspectorBounds = await page.locator('#inspector-pane').boundingBox();
    expect(paletteBounds?.x).toBeGreaterThanOrEqual(inspectorBounds?.x ?? 0);
    expect((paletteBounds?.x ?? 0) + (paletteBounds?.width ?? 0)).toBeLessThanOrEqual(
      (inspectorBounds?.x ?? 0) + (inspectorBounds?.width ?? 0),
    );
  }
  await page.keyboard.press('Escape');
  await activeArtworkLayer(page).locator('.art-layer-visible').click();
  await selectArtworkLayer(page, 'Overlay');
  await activeArtworkLayer(page).locator('.art-layer-visible').click();
  await open();
  await expect(page.locator('#art-palette-empty')).toBeVisible();
  await expect(page.locator('#art-swatches button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('remounting resets palette tabs and their contents to the same scope', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
from pathlib import Path
import sys
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Palette remount')
a=p.artwork.documents
c=a.create('picture','Transparent source','sprite',8,8,p.catalog()['revision'],origin=[0,0])
c=a.edit(c,[dict(x=0,y=0,rgba=[66,55,44,0])])
a.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  const composition = page.getByRole('tab', { name: 'Composition', exact: true });
  const layer = page.getByRole('tab', { name: 'Selected layer', exact: true });
  const source = page.locator('#art-swatches button[data-rgba="66,55,44,0"]');
  const open = async () => {
    await page.locator('[data-asset="picture/artwork"]').click();
    await expect(page.locator('#art-canvas')).toBeVisible();
    await revealArtworkControl(page, 'art-palette');
  };
  await open();
  await layer.click();
  await expect(source).toBeVisible();
  await page.evaluate(`(async () => {
    const module = await import('/project.js');
    module.editor.dispose();
    module.mountProjectEditor();
  })()`);
  await expect(page.locator('#show-artwork')).toBeEnabled();
  await open();
  await expect(composition).toHaveAttribute('aria-selected', 'true');
  await expect(composition).toHaveAttribute('tabindex', '0');
  await expect(layer).toHaveAttribute('aria-selected', 'false');
  await expect(layer).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#art-palette-content')).toHaveAttribute(
    'aria-labelledby',
    'art-palette-composition',
  );
  await expect(page.locator('#art-palette-scope')).toHaveText('Entire image · visible composition');
  await expect(page.locator('#art-swatches button')).toHaveCount(0);
  await expect(page.locator('#art-palette-empty')).toBeVisible();
  await composition.focus();
  await page.keyboard.press('ArrowRight');
  await expect(layer).toBeFocused();
  await expect(layer).toHaveAttribute('aria-selected', 'true');
  await expect(source).toBeVisible();
});

test('palette collection is lazy, cached, and reads exact shared raster bytes', async ({
  page,
}) => {
  await page.goto('about:blank');
  // Mount the real markup without loading the complete editor or adding a test-only API.
  await page.evaluate(
    (html) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      for (const id of ['art-palette-section']) {
        const element = parsed.getElementById(id);
        if (!element) {
          throw Error('Missing palette markup');
        }
        document.body.append(element);
      }
    },
    readFileSync('src/gbc_scene_forge/static/project.html', 'utf8'),
  );
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import { createArtworkPaletteControls } from './frontend/artwork/artwork-palette-controls.mts';
import { ArtworkRaster } from './frontend/artwork/artwork-raster.mts';
import { PixelModel } from './frontend/artwork/pixel-model.mts';
import { EditorLifetime } from './frontend/editor/editor-lifetime.mts';
const model = new PixelModel({descriptor:{version:1,width:512,height:512},rgba:btoa('\\0'.repeat(512*512*4))});
const raster = new ArtworkRaster();
raster.refresh(model);
const snapshot = raster.pixels;
let reads = 0;
Object.defineProperty(raster,'pixels',{get:()=>{reads++;return snapshot}});
const lifetime = new EditorLifetime();
let drawingColor = [0,0,0,255];
let busy=false;
document.getElementById('art-palette-section').open=false;
const palette = createArtworkPaletteControls(lifetime,raster,{current:()=>model,view:()=>null,busy:()=>busy,color:()=>drawingColor,chooseColor:()=>{}});
palette.sync();
model.apply(()=>model.put({x:1,y:1},[90,80,70,128]));
raster.refresh(model);
palette.invalidate();
for(let i=0;i<20;i++) palette.sync();
const closed = reads;
const panel = document.getElementById('art-palette-section');
panel.open=true;palette.sync();
const opened = reads;
palette.invalidate();busy=true;for(let i=0;i<20;i++) palette.sync();
const busyReads=reads;busy=false;
panel.hidden=true;for(let i=0;i<20;i++) palette.sync();
const hiddenReads=reads;panel.hidden=false;palette.sync();
for(let i=0;i<20;i++) palette.sync();
drawingColor=[11,22,33,128];palette.sync();
const drawingLabel=document.getElementById('art-palette-color').textContent;
const cached = reads;
const exact = document.querySelector('#art-swatches button').dataset.rgba;
model.undo();raster.refresh(model);palette.invalidate();palette.sync();
const undone = document.querySelectorAll('#art-swatches button').length;
model.redo();raster.refresh(model);palette.invalidate();palette.sync();
const redone = document.querySelector('#art-swatches button').dataset.rgba;
panel.open=false;
palette.invalidate();for(let i=0;i<20;i++) palette.sync();
const final = reads;
model.apply(()=>{for(let i=0;i<1025;i++) model.pixels.set([i%256,Math.floor(i/256),1,255],i*4)});
raster.refresh(model);palette.invalidate();panel.open=true;palette.sync();
const capped = document.querySelectorAll('#art-swatches button').length;
const limited = !document.getElementById('art-palette-limits').hidden;
const count = document.getElementById('art-palette-count').textContent;
lifetime.dispose();raster.dispose();
document.body.dataset.result=JSON.stringify({closed,opened,busyReads,hiddenReads,cached,drawingLabel,exact,undone,redone,final,capped,limited,count,disposed:document.querySelectorAll('#art-swatches button').length>0});
`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
  await expect(page.locator('body')).toHaveAttribute('data-result', /closed/);
  const result = await page.locator('body').getAttribute('data-result');
  if (!result) {
    throw Error('Missing palette results');
  }
  expect(JSON.parse(result)).toEqual({
    closed: 0,
    opened: 1,
    busyReads: 1,
    hiddenReads: 1,
    cached: 2,
    drawingLabel: 'RGBA 11, 22, 33, 128',
    exact: '90,80,70,128',
    undone: 0,
    redone: '90,80,70,128',
    final: 4,
    capped: 1024,
    limited: true,
    count: 'First 1,024 colors shown · additional colors available.',
    disposed: false,
  });
});

test('an open palette refreshes when returning to a retained document with unchanged geometry', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
from pathlib import Path
import sys
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Retained palettes')
for key,color in [('red',[255,0,0,255]),('blue',[0,0,255,255])]:
    c=p.artwork.documents.create(key,key.title(),'sprite',8,8,p.catalog()['revision'])
    c=p.artwork.documents.edit(c,[dict(x=0,y=0,rgba=color)])
    p.artwork.documents.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  const colors = page.locator('#art-swatches button');
  await page.locator('[data-asset="red/artwork"]').click();
  await expect(colors).toHaveCount(1);
  await expect(colors.first()).toHaveAttribute('data-rgba', '255,0,0,255');
  await page.locator('[data-asset="blue/artwork"]').click();
  await expect(colors.first()).toHaveAttribute('data-rgba', '0,0,255,255');
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Red' }).click();
  await expect(page.locator('#art-palette-section')).toHaveAttribute('open');
  await expect(colors.first()).toHaveAttribute('data-rgba', '255,0,0,255');
  await expect(page.locator('#undo')).toBeDisabled();
});
