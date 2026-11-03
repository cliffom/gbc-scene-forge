/** Exact raster invalidation, including transparent pixels, history and disposal. */
import { build } from 'esbuild';
import { test, expect } from '../support/browser-fixtures.ts';

// Exercise the real raster module with browser canvas semantics, independently of UI timing.
test('owned artwork raster catches all mutations and retains unaffected frame stamps', async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import { ArtworkRaster } from './frontend/artwork/artwork-raster.mts';
import { PixelModel } from './frontend/artwork/pixel-model.mts';
const descriptor = { version: 2, width: 16, height: 8, frames: [
 {id:'left',x:0,y:0,width:8,height:8}, {id:'right',x:8,y:0,width:8,height:8}
], sequences: [] };
const model = new PixelModel({descriptor, rgba:btoa('\\0'.repeat(16*8*4))});
const raster = new ArtworkRaster();
raster.refresh(model);
const stamp = () => model.descriptor.frames.map(f=>raster.stamp(f,1));
const initial = stamp();
model.begin(); model.put({x:1,y:1},[90,80,70,0]); raster.refresh(model);
const hidden = stamp();
model.cancel(); raster.refresh(model);
const cancelled = stamp();
model.apply(()=>model.put({x:1,y:1},[90,80,70,128])); raster.refresh(model);
const painted = stamp();
const pixel = () => Array.from(raster.canvas.getContext('2d').getImageData(1,1,1,1).data);
const alpha = pixel()[3];
model.undo(); raster.refresh(model); const undoAlpha = pixel()[3];
model.redo(); raster.refresh(model); const redoAlpha = pixel()[3];
const noChange = stamp(); raster.refresh(model); const stable = stamp();
model.descriptor.frames[0].x=8; raster.refresh(model); const moved = stamp();
const other = new PixelModel({descriptor:structuredClone(descriptor), rgba:btoa('\\0'.repeat(16*8*4))});
raster.refresh(other); const switched = stamp();
raster.dispose();
document.body.textContent=JSON.stringify({initial,hidden,cancelled,painted,alpha,undoAlpha,redoAlpha,noChange,stable,moved,switched,disposed:[raster.canvas.width,raster.canvas.height]});
`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  await page.goto('about:blank');
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
  await expect(page.locator('body')).toContainText('disposed');
  const result: unknown = JSON.parse(await page.locator('body').innerText());
  expect(result).toEqual({
    initial: expect.any(Array),
    hidden: expect.any(Array),
    cancelled: expect.any(Array),
    painted: expect.any(Array),
    alpha: 128,
    undoAlpha: 0,
    redoAlpha: 128,
    noChange: expect.any(Array),
    stable: expect.any(Array),
    moved: expect.any(Array),
    switched: expect.any(Array),
    disposed: [0, 0],
  });
  // Decode through runtime guards rather than assuming browser output types.
  if (!result || typeof result !== 'object') {
    throw Error('Expected raster results');
  }
  const stamps = new Map(Object.entries(result));
  const get = (name: string) => {
    const values: unknown = stamps.get(name);
    if (!Array.isArray(values) || !values.every((value: unknown) => typeof value === 'string')) {
      throw Error('Expected stamps');
    }
    return values;
  };
  for (const phase of ['hidden', 'cancelled', 'painted']) {
    expect(get(phase)[0]).not.toBe(get('initial')[0]);
    expect(get(phase)[1]).toBe(get('initial')[1]);
  }
  expect(get('stable')).toEqual(get('noChange'));
  expect(get('moved')[0]).not.toBe(get('stable')[0]);
  expect(get('switched')[0]).not.toBe(get('moved')[0]);
});
