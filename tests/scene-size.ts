import assert from 'node:assert/strict';
import { LayerEditor } from '../frontend/scene/layers.mts';
import { resizeScene } from '../frontend/scene/scene-size.mts';
const make = () =>
  new LayerEditor(
    {
      width: 4,
      height: 3,
      grid: 8,
      next_layer_id: 3,
      next_object_id: 5,
      layers: [
        {
          id: 1,
          name: 'Hidden ground',
          type: 'tilelayer',
          visible: false,
          cells: [
            ['a', 'b', 'c', 'd'],
            ['empty', 'empty', 'empty', 'empty'],
            ['e', 'f', 'g', 'h'],
          ],
        },
        {
          id: 2,
          name: 'Objects',
          type: 'objectgroup',
          visible: false,
          objects: [
            {
              id: '1',
              name: 'crossing',
              class: '',
              properties: [],
              kind: 'rectangle',
              x: 8,
              y: 8,
              width: 24,
              height: 16,
            },
            { id: '2', name: 'outside', class: '', properties: [], kind: 'point', x: 31, y: 23 },
            {
              id: '3',
              name: 'sprite',
              class: '',
              properties: [],
              kind: 'sprite',
              asset: 'a/b',
              x: 8,
              y: 8,
              origin: [4, 8],
            },
            {
              id: '4',
              name: 'inside',
              class: '',
              properties: [{ name: 'key', type: 'int', value: 5 }],
              kind: 'point',
              x: 0,
              y: 0,
            },
          ],
        },
      ],
    },
    [],
    { erase_cell: 'empty' },
  );
const editor = make(),
  original = structuredClone(editor.scene);
const originalObjects = original.layers[1];
assert(originalObjects.type === 'objectgroup');
const crop = resizeScene(editor, 2, 2, '0,0');
assert.equal(crop.tiles, 6);
assert.equal(crop.removed, 1);
assert.equal(crop.clipped, 1);
assert.deepEqual(editor.scene, original); // preflight is read-only
const objects = crop.scene.layers[1];
assert(objects.type === 'objectgroup');
assert.deepEqual(
  objects.objects.map((o) => o.id),
  ['1', '3', '4'],
);
assert.deepEqual(objects.objects[0], { ...originalObjects.objects[0], width: 8, height: 8 });
assert.deepEqual(objects.objects[1], originalObjects.objects[2]);
editor.change(() => {
  editor.scene = crop.scene;
});
assert.equal(editor.undoStack.length, 1);
editor.undo();
assert.deepEqual(editor.scene, original);
editor.redo();
assert.deepEqual(editor.scene, crop.scene);
for (const ax of [0, 1, 2]) {
  for (const ay of [0, 1, 2]) {
    const source = make();
    const grow = resizeScene(source, 8, 7, `${ax},${ay}`);
    assert.equal(grow.dx, ax * 2);
    assert.equal(grow.dy, ay * 2);
    assert.equal(grow.tiles + grow.removed + grow.clipped, 0);
    source.scene = grow.scene;
    assert.deepEqual(resizeScene(source, 4, 3, `${ax},${ay}`).scene, original);
  }
}
const left = resizeScene(make(), 2, 2, '2,2');
const rects = left.scene.layers[1];
assert(rects.type === 'objectgroup');
assert.deepEqual(rects.objects[0], {
  ...originalObjects.objects[0],
  x: 0,
  y: 0,
  width: 16,
  height: 16,
});
assert.equal(left.removed, 2); // sprite and point anchors shifted outside
const odd = resizeScene(make(), 5, 4, '1,1');
assert.equal(odd.dx, 0);
assert.equal(odd.dy, 0);
for (const n of [0, 257, 1.5, NaN]) {
  assert.throws(() => resizeScene(make(), n, 2, '0,0'));
}
assert.throws(() => resizeScene(make(), 2, 2, 'bogus'));
assert.deepEqual(resizeScene(make(), 4, 3, '1,1').scene, original);
console.log('Scene resize model checks passed');
