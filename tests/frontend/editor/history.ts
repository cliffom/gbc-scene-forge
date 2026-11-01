import assert from 'node:assert/strict';
import { LayerEditor, type LayerScene } from '../../../frontend/scene/layers.mts';

const initial: LayerScene = {
  width: 4,
  height: 3,
  grid: 8,
  next_layer_id: 2,
  next_object_id: 1,
  layers: [
    {
      id: 1,
      name: 'Ground',
      type: 'tilelayer',
      visible: true,
      cells: Array.from({ length: 3 }, () => Array<string>(4).fill('')),
    },
  ],
};
const editor = new LayerEditor(initial, [], { erase_cell: 'empty' });
const states = [structuredClone(editor.scene)];
function edit(action: () => void) {
  action();
  states.push(structuredClone(editor.scene));
}
edit(() => {
  editor.begin();
  editor.stamp(0, 0, [['a', 'b']]);
  editor.stamp(3, 2, [['c']]);
  editor.end();
});
edit(() => editor.fill(0, 1, 'water'));
edit(() => editor.add('objectgroup'));
edit(() => {
  editor.createObject({ kind: 'point', x: 5, y: 6, name: '', class: '', properties: [] });
});
edit(() =>
  editor.replaceObject({
    ...editor.objects[0],
    properties: [{ name: 'value', type: 'string', value: 'one' }],
  }),
);
const retained = editor.objects[0];
edit(() => editor.replaceObject({ ...retained, name: 'Two' }));
retained.properties[0].value = 'mutated old input';
edit(() => editor.reorder(-1));
edit(() => editor.visibility());
edit(() =>
  editor.change((scene) => {
    scene.width = 5;
    scene.layers.forEach((layer) => {
      if (layer.type === 'tilelayer') {
        layer.cells.forEach((row) => row.push('new'));
      }
    });
  }),
);
edit(() => editor.remove());
for (let i = states.length - 2; i >= 0; i--) {
  editor.undo();
  assert.deepEqual(editor.scene, states[i]);
  assert.equal(JSON.stringify(editor.scene), JSON.stringify(states[i]));
}
for (let i = 1; i < states.length; i++) {
  editor.redo();
  assert.deepEqual(editor.scene, states[i]);
  assert.equal(JSON.stringify(editor.scene), JSON.stringify(states[i]));
}
assert.ok(
  editor.historySome((scene) =>
    scene.layers.some((layer) => layer.type === 'tilelayer' && layer.cells[0][0] === 'a'),
  ),
);
editor.undo();
const redo = editor.redoStack.length;
editor.change(() => {});
assert.equal(editor.redoStack.length, redo);
editor.begin();
editor.add('tilelayer');
editor.cancel();
assert.deepEqual(editor.scene, states.at(-2));
editor.rename('New edit');
assert.equal(editor.redoStack.length, 0);
for (let i = 0; i < 110; i++) {
  editor.rename(`Name ${i}`);
}
assert.equal(editor.undoStack.length, 100);
for (let i = 0; i < 100; i++) {
  editor.undo();
}
assert.equal(editor.active.name, 'Name 9');
console.log('Mixed delta history, isolation, no-ops, cancel, IDs and bound passed');

// Active layer is transient, but undo/redo must restore the same context as snapshots did.
const context = new LayerEditor(initial, [], { erase_cell: 'empty' });
context.add('objectgroup');
const objectLayer = context.active.id;
context.activate(1);
context.rename('Painted ground');
context.activate(objectLayer);
context.undo();
assert.equal(context.active.id, 1);
context.activate(1);
context.redo();
assert.equal(context.active.id, objectLayer);
context.undo();
assert.equal(context.active.id, 1);

const shapes = new LayerEditor(initial, [], { erase_cell: 'empty' });
shapes.add('objectgroup');
shapes.createObject({
  kind: 'point',
  x: 1,
  y: 1,
  name: '',
  class: '',
  definition: '12345678-1234-4234-8234-123456789012',
  properties: [],
});
const linked = JSON.stringify(shapes.scene);
shapes.change(() => {
  delete shapes.objects[0].definition;
});
shapes.undo();
assert.equal(JSON.stringify(shapes.scene), linked);
shapes.redo();
assert.equal(shapes.objects[0].definition, undefined);

// Absent and undefined optional fields have identical persistent/dirty JSON semantics.
const optional = new LayerEditor(initial, [], { erase_cell: 'empty' });
optional.change((scene) => {
  scene.active_layer_id = undefined;
});
assert.equal(optional.undoStack.length, 0);
optional.add('objectgroup');
optional.createObject({ kind: 'point', x: 1, y: 1, name: '', class: '', properties: [] });
const optionalDepth = optional.undoStack.length;
optional.change(() => {
  optional.objects[0].definition = undefined;
});
assert.equal(optional.undoStack.length, optionalDepth);
