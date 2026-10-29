import type { TileMetadata } from '../frontend/artwork/tile-metadata.mts';
import type { TileScene } from '../frontend/shared/types.ts';
import assert from 'node:assert/strict';
import {
  decodeMetadata,
  emptyMetadata,
  terrainColor,
  validateMetadata,
} from '../frontend/artwork/tile-metadata.mts';
import {
  decodeObject,
  encodeObject,
  objectBounds,
  propertyValue,
} from '../frontend/objects/objects.mts';
import { LayerEditor } from '../frontend/scene/layers.mts';
import { Editor, canvasPoint } from '../frontend/scene/model.mts';

const scene: TileScene = {
  width: 6,
  height: 4,
  cells: Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => 'terrain:earth')),
};
const editor = new Editor(scene, [[0, 0]], { erase_cell: 'terrain:earth' });
assert.deepEqual(
  canvasPoint(
    { clientX: 114, clientY: 78 },
    { left: 50, top: 30, width: 192, height: 128 },
    48,
    32,
  ),
  { x: 16, y: 12 },
);
editor.begin();
editor.stamp(1, 1, [['terrain:scrub']]);
editor.stamp(2, 1, [['terrain:scrub']]);
editor.end();
assert.equal(editor.undoStack.length, 1);
editor.undo();
assert.equal(editor.scene.cells[1][1], 'terrain:earth');
editor.redo();
assert.equal(editor.scene.cells[1][2], 'terrain:scrub');
assert.equal(scene.cells[1][1], 'terrain:earth');
const before = JSON.stringify(editor.scene);
assert.throws(() => editor.stamp(0, 0, [['terrain:water', 'terrain:water']]));
assert.equal(JSON.stringify(editor.scene), before);
assert.throws(() => editor.stamp(5, 1, [['terrain:water', 'terrain:water']]));
assert.equal(JSON.stringify(editor.scene), before);
editor.move({ x: 1, y: 1, w: 2, h: 1 }, 1, 0);
assert.equal(editor.scene.cells[1][1], 'terrain:earth');
assert.equal(editor.scene.cells[1][2], 'terrain:scrub');
assert.equal(editor.scene.cells[1][3], 'terrain:scrub');
editor.undo();
assert.equal(editor.scene.cells[1][1], 'terrain:scrub');
editor.fill(0, 1, 'terrain:water');
assert.equal(editor.scene.cells[0][0], 'terrain:earth');
assert.equal(editor.scene.cells[0][1], 'terrain:water');
assert.equal(editor.scene.cells[1][1], 'terrain:scrub');
editor.begin();
editor.stamp(4, 2, [['terrain:masonry']]);
editor.cancel();
assert.equal(editor.scene.cells[2][4], 'terrain:water');
editor.undo();
editor.stamp(5, 3, [['terrain:water']]);
assert.equal(editor.redoStack.length, 0);
console.log(
  'Scene editing: coordinates, atomic stamps, stroke history, overlapping moves, flood fill and cancellation pass.',
);
const layered = new LayerEditor(
  {
    ...scene,
    layers: [{ id: 1, name: 'Ground', type: 'tilelayer', visible: true, cells: scene.cells }],
    grid: 8,
    next_layer_id: 2,
    next_object_id: 1,
  },
  [],
  { erase_cell: 'empty' },
);
layered.add('tilelayer');
layered.rename('Canopy');
layered.stamp(1, 1, [['leaf']]);
assert.equal(
  layered.layers[0].type === 'tilelayer' && layered.layers[0].cells[1][1],
  'terrain:earth',
);
layered.fill(0, 0, 'sky');
layered.move({ x: 1, y: 1, w: 1, h: 1 }, 1, 0);
assert.equal(layered.cells[1][2], 'leaf');
layered.undo();
assert.equal(layered.cells[1][1], 'leaf');
const activeLayerBeforeVisibility = layered.active.id;
layered.visibility(layered.layers[0].id);
assert.equal(layered.active.id, activeLayerBeforeVisibility);
assert.equal(layered.layers[0].visible, false);
layered.undo();
assert.equal(layered.layers[0].visible, true);
assert.equal(layered.active.id, activeLayerBeforeVisibility);
layered.redo();
assert.equal(layered.layers[0].visible, false);
layered.undo();
const beforeUnknownVisibility = JSON.stringify(layered.scene);
assert.throws(() => layered.visibility(999), /Unknown layer/);
assert.equal(JSON.stringify(layered.scene), beforeUnknownVisibility);
layered.visibility();
const hidden = JSON.stringify(layered.scene);
assert.throws(() => layered.stamp(0, 0, [['bad']]), /Show/);
assert.equal(JSON.stringify(layered.scene), hidden);
layered.cancel();
layered.undo();
assert.equal(layered.active.visible, true);
layered.reorder(-1);
assert.equal(layered.layers[0].name, 'Canopy');
layered.remove();
assert.equal(layered.layers.length, 1);
layered.undo();
assert.equal(layered.active.name, 'Canopy');
assert.equal(layered.cells[1][1], 'leaf');
layered.redo();
layered.add('objectgroup');
assert.equal(layered.active.id, 3);
assert.throws(() => layered.fill(0, 0, 'bad'), /tile layer/);
layered.spriteRegion = () => ({ width: 8, height: 8, origin: [0, 0] });
layered.createObject({
  kind: 'sprite',
  asset: 'actor',
  x: 3,
  y: 4,
  name: '',
  class: '',
  properties: [],
});
layered.undo();
assert.equal(layered.objects.length, 0);
layered.redo();
assert.equal(layered.objects.length, 1);
layered.activate(1);
assert.equal(layered.objects.length, 0);
assert.throws(() => layered.rename('  '), /name/);
console.log('Ordered layer edits, isolation, hidden-layer guards, stable IDs and history pass.');

layered.activate(3);
const marker = layered.createObject({
  kind: 'point',
  name: 'Entrance',
  class: 'spawn',
  x: 8,
  y: 8,
  properties: [
    { name: 'enabled', type: 'bool', value: false },
    { name: 'target', type: 'string', value: '' },
  ],
});
assert.equal(marker, '2');
const pointObject = structuredClone(layered.objects[1]);
assert.deepEqual(decodeObject(encodeObject(pointObject)), pointObject);
assert.deepEqual(objectBounds(pointObject), { x: 4, y: 4, width: 8, height: 8 });
layered.replaceObject({
  ...pointObject,
  x: 12,
  name: 'North entrance',
  properties: [{ name: 'priority', type: 'int', value: 3 }],
});
assert.equal(layered.objects[1].name, 'North entrance');
layered.undo();
assert.deepEqual(layered.objects[1], pointObject);
layered.redo();
assert.equal(layered.objects[1].x, 12);
const objectBefore = JSON.stringify(layered.scene),
  historyBefore = layered.undoStack.length;
assert.throws(
  () =>
    layered.replaceObject({
      ...pointObject,
      properties: [{ name: 'repeat', type: 'int', value: 1.5 }],
    }),
  /integer/,
);
assert.throws(
  () =>
    layered.replaceObject({
      ...pointObject,
      properties: [
        { name: 'target', type: 'string', value: 'a' },
        { name: 'target', type: 'string', value: 'b' },
      ],
    }),
  /unique/,
);
assert.throws(
  () =>
    layered.createObject({
      kind: 'rectangle',
      x: 40,
      y: 1,
      width: 16,
      height: 8,
      name: '',
      class: 'trigger',
      properties: [],
    }),
  /dimensions/,
);
assert.equal(JSON.stringify(layered.scene), objectBefore);
assert.equal(layered.undoStack.length, historyBefore);
assert.equal(layered.stroke, null);
const area = layered.createObject({
  kind: 'rectangle',
  x: 16,
  y: 8,
  width: 16,
  height: 16,
  name: 'Door',
  class: 'trigger',
  properties: [],
});
assert.equal(area, '3');
assert.deepEqual(decodeObject(encodeObject(layered.objects[2])), layered.objects[2]);
assert.equal(propertyValue('bool', false), false);
assert.equal(propertyValue('float', '1.25'), 1.25);
assert.equal(propertyValue('string', ''), '');
assert.throws(() => propertyValue('int', ''), /value/);
assert.throws(() => propertyValue('float', 'Infinity'), /finite/);
assert.throws(() => propertyValue('int', '9007199254740992'), /safe integer/);
layered.visibility();
assert.throws(
  () => layered.createObject({ kind: 'point', x: 0, y: 0, name: '', class: '', properties: [] }),
  /Show/,
);
layered.undo();
const actor = layered.objects[0];
assert.deepEqual(objectBounds(actor, { width: 8, height: 8, origin: [4, 7] }), {
  x: -1,
  y: -3,
  width: 8,
  height: 8,
});
if (actor.kind !== 'sprite') {
  throw Error('Expected sprite');
}
layered.replaceObject({ ...actor, origin: [8, 8] });
assert.deepEqual(objectBounds(layered.objects[0], { width: 8, height: 8, origin: [4, 7] }), {
  x: -5,
  y: -4,
  width: 8,
  height: 8,
});
assert.throws(() => layered.replaceObject({ ...actor, origin: [9, 0] }), /origin/);
console.log(
  'Generic objects: typed property edits, bounds, origins, stable IDs and atomic undo/redo pass.',
);

const collision: TileMetadata = {
  terrain: 'water',
  solid: true,
  next_shape_id: 8,
  shapes: [
    { id: 2, kind: 'rectangle', x: 0, y: 4, width: 8, height: 4 },
    { id: 4, kind: 'ellipse', x: 1, y: 0, width: 6, height: 8 },
    {
      id: 7,
      kind: 'polygon',
      points: [
        [0, 8],
        [8, 8],
        [8, 0],
      ],
    },
  ],
};
validateMetadata(collision, 8, 8);
assert.deepEqual(decodeMetadata(collision), collision);
validateMetadata(emptyMetadata(), 8, 8);
assert.equal(terrainColor('water'), terrainColor('water'));
assert.notEqual(terrainColor('water'), terrainColor('grass'));
assert.throws(() => validateMetadata({ ...collision, next_shape_id: 7 }, 8, 8), /ID/);
assert.throws(
  () =>
    validateMetadata({ ...collision, shapes: [collision.shapes[0], collision.shapes[0]] }, 8, 8),
  /duplicate/,
);
for (const points of [
  [
    [0, 0],
    [8, 8],
    [0, 8],
    [7, 0],
  ],
  [
    [0, 0],
    [8, 8],
    [0, 0],
  ],
  [
    [0, 0],
    [4, 0],
    [8, 0],
  ],
  [
    [0, 0],
    [9, 8],
    [0, 8],
  ],
]) {
  assert.throws(() =>
    validateMetadata(
      {
        terrain: '',
        solid: false,
        next_shape_id: 2,
        shapes: [
          { id: 1, kind: 'polygon', points: points.map((p): [number, number] => [p[0], p[1]]) },
        ],
      },
      8,
      8,
    ),
  );
}
console.log(
  'Tile metadata: terrain identity, shapes, stable IDs and invalid polygon/bounds checks pass.',
);

// A drag moves an arbitrary layer in one history entry without changing the active layer.
const dragLayers = new LayerEditor(
  {
    width: 1,
    height: 1,
    grid: 8,
    layers: [1, 2, 3].map((id) => ({
      id,
      name: `Layer ${id}`,
      visible: id !== 3,
      type: 'tilelayer' as const,
      cells: [['empty']],
    })),
    next_layer_id: 4,
    next_object_id: 1,
    active_layer_id: 2,
  },
  [],
  { erase_cell: 'empty' },
);
dragLayers.moveLayer(1, 3);
assert.deepEqual(
  dragLayers.layers.map((layer) => layer.id),
  [2, 3, 1],
);
assert.equal(dragLayers.active.id, 2);
assert.equal(dragLayers.undoStack.length, 1);
assert.equal(dragLayers.layers[1].visible, false);
dragLayers.undo();
assert.deepEqual(
  dragLayers.layers.map((layer) => layer.id),
  [1, 2, 3],
);
dragLayers.redo();
assert.deepEqual(
  dragLayers.layers.map((layer) => layer.id),
  [2, 3, 1],
);
dragLayers.moveLayer(1, null);
assert.deepEqual(
  dragLayers.layers.map((layer) => layer.id),
  [1, 2, 3],
);
const dragHistory = dragLayers.undoStack.length;
dragLayers.moveLayer(1, null);
dragLayers.moveLayer(2, 2);
assert.equal(dragLayers.undoStack.length, dragHistory);
assert.throws(() => dragLayers.moveLayer(99, null), /Unknown layer/);
assert.throws(() => dragLayers.moveLayer(1, 99), /Unknown layer/);
assert.equal(dragLayers.undoStack.length, dragHistory);
