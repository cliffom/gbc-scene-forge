/** Clipboard, mixed layers, transforms and atomic rejection independent of the DOM. */
import assert from 'node:assert/strict';
import type { TileMetadata } from '../frontend/artwork/tile-metadata.mts';
import { LayerEditor } from '../frontend/scene/layers.mts';
import { capture, paste, eraseCaptured, transform } from '../frontend/compositions/compositions.mts';
import type { CompositionSelection } from '../frontend/compositions/compositions.mts';
import {
  tileParts,
  tilePoint,
  transformCell,
  transformMetadata,
} from '../frontend/artwork/tile-transform.mts';
const make = () => {
  const editor = new LayerEditor(
    {
      width: 8,
      height: 6,
      grid: 8,
      next_layer_id: 4,
      next_object_id: 3,
      layers: [
        {
          id: 1,
          name: 'Ground',
          type: 'tilelayer',
          visible: true,
          cells: Array.from({ length: 6 }, () => Array<string>(8).fill('empty')),
        },
        {
          id: 2,
          name: 'Markers',
          type: 'objectgroup',
          visible: true,
          objects: [
            {
              id: '1',
              kind: 'point',
              name: 'spawn',
              class: 'start',
              properties: [{ name: 'key', type: 'string', value: 'north' }],
              x: 8,
              y: 8,
            },
            {
              id: '2',
              kind: 'rectangle',
              name: 'door',
              class: 'trigger',
              properties: [],
              x: 16,
              y: 8,
              width: 5,
              height: 3,
            },
          ],
        },
        { id: 3, name: 'Hidden', type: 'objectgroup', visible: false, objects: [] },
      ],
    },
    [],
    { erase_cell: 'empty' },
  );
  editor.cells[1][1] = 'terrain/a/0/0';
  editor.cells[1][2] = 'terrain/b/0/0';
  return editor;
};
const selection: CompositionSelection = {
  rectangle: { x: 1, y: 1, w: 2, h: 1 },
  objects: new Set(),
  allLayers: true,
};
const source = make();
const copied = capture(source, selection, 'project');
assert.deepEqual(copied.composition.slots, [0, 0]);
assert.equal(copied.composition.scene.layers.length, 2);
const dest = make();
dest.scene.layers.forEach((l) => {
  l.id += 10;
});
const before = structuredClone(dest.scene);
const ids = paste(dest, copied.composition, 'project', 3, 3, () => true);
assert.deepEqual([...ids], ['3', '4']);
const markers = dest.scene.layers[1];
assert(markers.type === 'objectgroup');
assert.deepEqual(markers.objects[2], {
  ...source.scene.layers.flatMap((l) => (l.type === 'objectgroup' ? l.objects : []))[0],
  id: '3',
  x: 24,
  y: 24,
});
assert.equal(dest.undoStack.length, 1);
const after = structuredClone(dest.scene);
dest.undo();
assert.deepEqual(dest.scene, before);
dest.redo();
assert.deepEqual(dest.scene, after);
source.cells[1][1] = 'changed';
assert.equal(
  copied.composition.scene.layers[0].type === 'tilelayer' &&
    copied.composition.scene.layers[0].cells[0][0],
  'terrain/a/0/0',
);
for (const bad of ['project', 'grid', 'layer', 'hidden', 'bounds', 'asset', 'id']) {
  const target = make();
  if (bad === 'grid') {
    target.scene.grid = 16;
  }
  if (bad === 'layer') {
    target.scene.layers.pop();
  }
  if (bad === 'layer') {
    target.scene.layers.pop();
  }
  if (bad === 'hidden') {
    target.scene.layers[1].visible = false;
  }
  if (bad === 'id') {
    target.scene.next_object_id = 2147483646;
  }
  const initial = structuredClone(target.scene);
  assert.throws(() =>
    paste(
      target,
      copied.composition,
      bad === 'project' ? 'other' : 'project',
      bad === 'bounds' ? 7 : 2,
      2,
      () => bad !== 'asset',
    ),
  );
  assert.deepEqual(target.scene, initial, bad);
  assert.equal(target.undoStack.length, 0);
}
const cut = make();
const original = structuredClone(cut.scene);
eraseCaptured(cut, selection);
assert.equal(cut.cells[1][1], 'empty');
assert(cut.scene.layers[1].type === 'objectgroup');
assert.equal(cut.scene.layers[1].objects.length, 0);
cut.undo();
assert.deepEqual(cut.scene, original);
const objectEditor = make();
objectEditor.activate(2);
const group = capture(
  objectEditor,
  { rectangle: null, objects: new Set(['1', '2']), allLayers: false },
  'project',
);
assert.equal(group.composition.scene.layers.length, 1);
const sprite = structuredClone(group.composition);
const objects = sprite.scene.layers[0];
assert(objects.type === 'objectgroup');
objects.objects.push({
  id: '9',
  kind: 'sprite',
  asset: 'actors/idle',
  origin: [4, 8],
  name: 'actor',
  class: '',
  properties: [],
  x: 0,
  y: 0,
});
assert.throws(() => transform(sprite, 'rotate'), /Sprite transforms/);
objectEditor.spriteRegion = () => ({ width: 8, height: 8, origin: [4, 8] });
assert.equal(paste(objectEditor, sprite, 'project', 3, 3, () => true).size, 3); // attach region below

for (let flags = 0; flags < 8; flags++) {
  const cell = 'terrain/a/0/0' + (flags ? `#${flags}` : '');
  assert.deepEqual(tileParts(cell), ['terrain/a/0/0', flags]);
  let rotated = cell;
  for (let i = 0; i < 4; i++) {
    rotated = transformCell(rotated, 'rotate');
  }
  assert.equal(rotated, cell);
  assert.equal(transformCell(transformCell(cell, 'horizontal'), 'horizontal'), cell);
  assert.equal(transformCell(transformCell(cell, 'vertical'), 'vertical'), cell);
}
assert.deepEqual(tilePoint(5, 0, 0, 8), [8, 0]);
assert.equal(transformCell('empty', 'rotate'), 'empty');
let rotated = copied.composition;
for (let i = 0; i < 4; i++) {
  rotated = transform(rotated, 'rotate');
}
assert.deepEqual(rotated, copied.composition);
const once = transform(copied.composition, 'rotate');
assert.equal(once.scene.width, 1);
assert.equal(once.scene.height, 2);
assert(once.scene.layers[1].type === 'objectgroup');
assert.deepEqual(
  once.scene.layers[1].objects.map((o) => [o.x, o.y]),
  [
    [7, 0],
    [5, 8],
  ],
);
// Duplicate layer names preserve the source's occurrence even when only one was selected.
const duplicates = make();
duplicates.add('tilelayer');
duplicates.rename('Ground');
duplicates.cells[0][0] = 'terrain/a/0/0';
const second = capture(
  duplicates,
  { rectangle: { x: 0, y: 0, w: 1, h: 1 }, objects: new Set(), allLayers: false },
  'project',
);
assert.deepEqual(second.composition.slots, [1]);
paste(duplicates, second.composition, 'project', 2, 2, () => true);
assert.equal(duplicates.cells[2][2], 'terrain/a/0/0');
assert(duplicates.scene.layers[0].type === 'tilelayer');
assert.equal(duplicates.scene.layers[0].cells[2][2], 'empty');

const metadata: TileMetadata = {
  terrain: 'wall',
  solid: false,
  next_shape_id: 4,
  shapes: [
    { id: 1, kind: 'rectangle', x: 1, y: 2, width: 3, height: 4 },
    { id: 2, kind: 'ellipse', x: 0, y: 0, width: 2, height: 6 },
    {
      id: 3,
      kind: 'polygon',
      points: [
        [0, 0],
        [8, 0],
        [0, 8],
      ],
    },
  ],
};
const transformedMetadata = transformMetadata(metadata, 5, 8);
assert.deepEqual(transformedMetadata.shapes[0], {
  id: 1,
  kind: 'rectangle',
  x: 2,
  y: 1,
  width: 4,
  height: 3,
});
assert.deepEqual(transformedMetadata.shapes[1], {
  id: 2,
  kind: 'ellipse',
  x: 2,
  y: 0,
  width: 6,
  height: 2,
});
assert.deepEqual(transformedMetadata.shapes[2], {
  id: 3,
  kind: 'polygon',
  points: [
    [8, 0],
    [8, 8],
    [0, 0],
  ],
});

// An area object crossing the drawn selection expands the entire rectangular footprint.
const expanded = make();
const areaLayer = expanded.scene.layers[1];
assert(areaLayer.type === 'objectgroup');
areaLayer.objects[1] = {
  id: '2',
  kind: 'rectangle',
  x: 8,
  y: 8,
  width: 16,
  height: 8,
  name: '',
  class: '',
  properties: [],
};
expanded.cells[1][2] = 'terrain/b/0/0';
const small: CompositionSelection = {
  rectangle: { x: 1, y: 1, w: 1, h: 1 },
  objects: new Set(),
  allLayers: true,
};
const enlarged = capture(expanded, small, 'project');
assert.equal(enlarged.composition.scene.width, 2);
assert(enlarged.composition.scene.layers[0].type === 'tilelayer');
assert.equal(enlarged.composition.scene.layers[0].cells[0][1], 'terrain/b/0/0');
eraseCaptured(expanded, small);
assert.equal(expanded.cells[1][2], 'empty');
expanded.undo();
assert.equal(expanded.cells[1][2], 'terrain/b/0/0');
console.log('Composition clipboard and transform checks passed');
