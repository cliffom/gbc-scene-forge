/** Model identity and mounted-resource boundaries at the extracted artwork ports. */
import { build } from 'esbuild';
import { test, expect } from '../support/browser-fixtures.ts';

test('captured artwork gestures cancel their original model across replacement and disposal', async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import { createArtworkGestures } from './frontend/artwork/artwork-gestures.mts';
import { EditorLifetime } from './frontend/editor/editor-lifetime.mts';
import { PixelModel } from './frontend/artwork/pixel-model.mts';
const dialog = document.createElement('dialog');
dialog.innerHTML='<input name="art-tool" value="pencil" type="radio" checked><canvas></canvas>';
document.body.append(dialog);
dialog.show();
const canvas = dialog.querySelector('canvas');
const candidate = {
  descriptor: { version:1, width:8, height:8 },
  rgba:btoa('\\0'.repeat(8*8*4))
};
const first = new PixelModel(candidate), second = new PixelModel(candidate);
let current = first, changes = 0;
const lifetime = new EditorLifetime();
const gestures = createArtworkGestures(lifetime, dialog, canvas, {
  current:()=>current, available:()=>true,
  point:({x,y})=>({x,y}), color:()=>[9,8,7,128], chooseColor:()=>{},
  authoringTool:()=>{}, hideTarget:()=>{}, paint:()=>{},
  mutate:work=>current.apply(work), changed:()=>changes++, error:error=>{throw error}
});
// Synthetic pointers have no browser capture; retain the lifetime's release path.
let captured = new Set();
canvas.setPointerCapture = id=>captured.add(id);
canvas.hasPointerCapture = id=>captured.has(id);
canvas.releasePointerCapture = id=>captured.delete(id);
const pointer = (type,id=7,x=1,y=1)=>canvas.dispatchEvent(new PointerEvent(type,{
  pointerId:id, clientX:x, clientY:y, button:0
}));
const pixel = model=>model.color({x:1,y:1});
pointer('pointerdown');
const preview = pixel(first);
// Another pointer cannot finish or cancel the captured stroke.
pointer('pointerup',8);
const stillCaptured = gestures.active;
current = second;
pointer('pointermove');
const replaced = {first:pixel(first), second:pixel(second), active:gestures.active,
  captures:captured.size, changes, history:first.undoStack.length};
pointer('pointerdown'); pointer('pointerup');
const completed = {pixel:pixel(second), changes, history:second.undoStack.length};
second.undo();
pointer('pointerdown');
lifetime.dispose();
const disposed = {pixel:pixel(second), active:gestures.active, captures:captured.size,
  changes, history:second.undoStack.length, handler:canvas.onpointerdown};
pointer('pointerdown'); pointer('pointerup');
document.body.textContent=JSON.stringify({preview,stillCaptured,replaced,completed,disposed,
  afterDisposal:pixel(second)});
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
  await expect(page.locator('body')).toContainText('afterDisposal');
  const result: unknown = JSON.parse(await page.locator('body').innerText());
  expect(result).toEqual({
    preview: [9, 8, 7, 128],
    stillCaptured: true,
    replaced: {
      first: [0, 0, 0, 0],
      second: [0, 0, 0, 0],
      active: false,
      captures: 0,
      changes: 0,
      history: 0,
    },
    completed: { pixel: [9, 8, 7, 128], changes: 1, history: 1 },
    disposed: {
      pixel: [0, 0, 0, 0],
      active: false,
      captures: 0,
      changes: 1,
      history: 0,
      handler: null,
    },
    afterDisposal: [0, 0, 0, 0],
  });
});
