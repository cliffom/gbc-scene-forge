import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockoutAppearance,
  blockoutDefinitions,
  blockoutLayer,
  climbEndpoint,
  dragRectangle,
  resizeRectangle,
} from '../frontend/blockout.mts';
import { definitionInstance } from '../frontend/object-definitions.mts';
import type { ObjectDefinition } from '../frontend/object-definitions.mts';
import { LayerEditor } from '../frontend/layers.mts';

const definition: ObjectDefinition = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Landing',
  kind: 'rectangle',
  width: 32,
  height: 8,
  fields: [
    { name: 'blockout_role', type: 'string', required: false, default: 'one_way' },
    { name: 'blockout_color', type: 'string', required: false, default: '#aabbcc' },
    { name: 'blockout_symbol', type: 'string', required: false, default: '1W' },
    { name: 'blockout_pattern', type: 'string', required: false, default: 'one-way' },
  ],
};
await test('drag and resize geometry stays snapped and inside the scene, including reverse and edge drags', () => {
  assert.deepEqual(dragRectangle({ x: 24, y: 24 }, { x: 8, y: 9 }, 960, 272, 8), {
    x: 8,
    y: 8,
    width: 16,
    height: 16,
  });
  assert.deepEqual(dragRectangle({ x: 952, y: 264 }, { x: 1200, y: 900 }, 960, 272, 8), {
    x: 952,
    y: 264,
    width: 8,
    height: 8,
  });
  assert.deepEqual(dragRectangle({ x: 16, y: 16 }, { x: 16, y: 16 }, 960, 272, 8), {
    x: 16,
    y: 16,
    width: 8,
    height: 8,
  });
  assert.deepEqual(resizeRectangle({ x: 16, y: 24 }, { x: 5000, y: 900 }, 960, 272, 8), {
    width: 944,
    height: 248,
  });
  assert.deepEqual(resizeRectangle({ x: 16, y: 24 }, { x: 0, y: 0 }, 960, 272, 1), {
    width: 1,
    height: 1,
  });
});
await test('blockout instances use ordinary object identities, typed defaults and one undo stroke for drawing/resizing', () => {
  const editor = new LayerEditor(
    {
      width: 120,
      height: 34,
      grid: 8,
      layers: [{ id: 1, name: 'Plan', type: 'objectgroup', visible: true, objects: [] }],
      next_layer_id: 2,
      next_object_id: 1,
    },
    [],
    { erase_cell: 'empty' },
  );
  editor.begin();
  const id = editor.createObject(definitionInstance(definition, 16, 16));
  const original = editor.objects[0];
  assert.equal(original.kind, 'rectangle');
  if (original.kind !== 'rectangle') {
    throw Error('Expected a rectangle');
  }
  editor.replaceObject({ ...original, ...dragRectangle(original, { x: 80, y: 32 }, 960, 272, 8) });
  editor.end();
  assert.equal(editor.undoStack.length, 1);
  assert.equal(editor.objects[0].id, id);
  assert.equal(blockoutAppearance(editor.objects[0], [definition])?.role, 'one_way');
  editor.undo();
  assert.equal(editor.objects.length, 0);
  editor.redo();
  assert.equal(editor.objects[0].id, id);
  editor.begin();
  editor.replaceObject({ ...original, width: 96, height: 24 });
  editor.cancel();
  assert.equal(editor.objects[0].kind === 'rectangle' && editor.objects[0].width, 64);
});
await test('portable appearance metadata supports custom presets, safe color fallbacks and relative climb intent', () => {
  const item = { ...definitionInstance(definition, 16, 32), id: '1' };
  assert.equal(blockoutDefinitions([definition]).length, 1);
  assert.equal(
    blockoutAppearance(
      { ...item, properties: [{ name: 'blockout_color', type: 'string', value: 'url(evil)' }] },
      [definition],
    )?.color,
    '#83cfc1',
  );
  assert.equal(blockoutLayer('camera', 'rectangle'), 'Camera guides');
  assert.equal(blockoutLayer('enemy', 'point'), 'Gameplay markers');
  assert.deepEqual(climbEndpoint({ x: 16, y: 32, width: 24, height: 64 }, {}, 'entry'), {
    x: 28,
    y: 96,
  });
  assert.deepEqual(
    climbEndpoint(
      { x: 16, y: 32, width: 24, height: 128 },
      { exit_edge: 'right', exit_offset: 0.25 },
      'exit',
    ),
    { x: 40, y: 64 },
  );
});

await test('labels prioritize selection, avoid collisions and stay within the visible scene', async () => {
  const { layoutLabels, intersects } = await import('../frontend/blockout-labels.mts');
  const candidates = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i),
    text: 'Long overlapping camera or marker caption ' + i,
    color: '#ffffff',
    priority: i === 999 ? 0 : 4,
    x: 10,
    y: 10,
    width: 100,
    height: 80,
  }));
  const view = { x: 0, y: 0, width: 200, height: 100 };
  const labels = layoutLabels(candidates, view, (text) => [...text].length * 7);
  assert.equal(labels[0].candidate.id, '999');
  assert.ok(labels.length < candidates.length);
  assert.ok(labels[0].text.endsWith('…'));
  for (const [index, label] of labels.entries()) {
    assert.ok(label.x >= 0 && label.y >= 0);
    assert.ok(label.x + label.width <= view.width);
    assert.ok(label.y + label.height <= view.height);
    for (const other of labels.slice(index + 1)) {
      assert.equal(intersects(label, other, 4), false);
    }
  }
  assert.deepEqual(
    layoutLabels(candidates, { ...view, x: 500 }, () => 10),
    [],
  );
  assert.deepEqual(
    layoutLabels(candidates, { ...view, width: 10 }, () => 10),
    [],
  );
  assert.equal(candidates[999].text, 'Long overlapping camera or marker caption 999');
});
await test('labels use effective metadata, preserve full saved captions and give markers priority over geometry', async () => {
  const { labelCandidates } = await import('../frontend/blockout-labels.mts');
  const item = { ...definitionInstance(definition, 16, 32), id: '1', name: 'A long name' };
  const [plain] = labelCandidates([item], [definition], new Set(), 4);
  assert.equal(plain.text, '1W A long name');
  assert.equal(plain.x, 64);
  assert.equal(plain.y, 128);
  assert.equal(plain.width, 128);
  const [selected] = labelCandidates([item], [definition], new Set(['1']), 0.5);
  assert.equal(selected.priority, 0);
  assert.equal(selected.x, 8);
  const [marker] = labelCandidates(
    [
      {
        id: '2',
        kind: 'point',
        x: 0,
        y: 0,
        name: 'Marker',
        class: '',
        properties: [{ name: 'blockout_role', type: 'string', value: 'spawn' }],
      },
    ],
    [],
    new Set(),
    1,
  );
  assert.ok(marker.priority < plain.priority);
});
