/** Inheritance is live project metadata; instance changes remain scene-history operations. */
import assert from 'node:assert/strict';
import {
  decodeDefinitions,
  definitionInstance,
  resolveDefinition,
} from '../frontend/objects/object-definitions.mts';
import type { ObjectDefinition } from '../frontend/objects/object-definitions.mts';
import { decodeObject, encodeObject } from '../frontend/objects/objects.mts';
import { LayerEditor } from '../frontend/scene/layers.mts';
import { capture, paste } from '../frontend/compositions/compositions.mts';
const definition: ObjectDefinition = {
  id: 'f3825e00-c5e9-4aa3-aa07-61a9d9fb12a6',
  name: 'Entrance',
  kind: 'point',
  fields: [
    {
      name: 'facing',
      type: 'string',
      required: true,
      default: 'south',
      choices: ['south', 'north'],
    },
    { name: 'priority', type: 'int', required: true, min: 0, max: 10 },
    { name: 'enabled', type: 'bool', required: true, default: false },
    { name: 'speed', type: 'float', required: false, default: 1.5, min: 0 },
  ],
};
assert.deepEqual(decodeDefinitions({ version: 1, definitions: [definition] }), [definition]);
assert.throws(() => decodeDefinitions({ version: 2, definitions: [] }));
const editor = new LayerEditor(
  {
    width: 8,
    height: 8,
    grid: 8,
    next_layer_id: 2,
    next_object_id: 1,
    layers: [{ id: 1, name: 'Markers', type: 'objectgroup', visible: true, objects: [] }],
  },
  [],
  { erase_cell: 'empty' },
);
const id = editor.createObject(definitionInstance(definition, 8, 8));
const instance = structuredClone(editor.objects[0]);
assert.equal(id, '1');
assert.deepEqual(instance.properties, []);
assert.deepEqual(resolveDefinition(instance, [definition]).findings, [
  { field: 'priority', code: 'required' },
]);
editor.undo();
assert.equal(editor.objects.length, 0);
editor.redo();
assert.equal(editor.objects[0].definition, definition.id);
instance.properties = [{ name: 'priority', type: 'int', value: 2 }];
editor.replaceObject(instance);
assert.deepEqual(resolveDefinition(instance, [definition]).findings, []);
const before = JSON.stringify(editor.scene);
const changed = structuredClone(definition);
changed.fields[0].default = 'north';
changed.fields[1].default = 9;
let resolved = resolveDefinition(instance, [changed]);
assert.equal(resolved.properties.find((p) => p.name === 'facing')?.value, 'north');
assert.equal(resolved.properties.find((p) => p.name === 'priority')?.value, 2);
assert.equal(resolved.properties.find((p) => p.name === 'enabled')?.value, false);
assert.equal(JSON.stringify(editor.scene), before);
editor.undo();
assert.deepEqual(editor.objects[0].properties, []);
assert.equal(
  resolveDefinition(editor.objects[0], [changed]).properties.find((p) => p.name === 'priority')
    ?.value,
  9,
);
editor.redo();
assert.deepEqual(editor.objects[0].properties, instance.properties);
assert.deepEqual(decodeObject(encodeObject(instance)), instance);
changed.fields[1] = { name: 'priority', type: 'string', required: true };
changed.fields.push({ name: 'destination', type: 'string', required: true });
changed.kind = 'rectangle';
changed.width = changed.height = 8;
resolved = resolveDefinition(instance, [changed]);
assert.deepEqual(resolved.findings, [
  { field: '', code: 'kind' },
  { field: 'priority', code: 'type' },
  { field: 'destination', code: 'required' },
]);
assert.deepEqual(resolveDefinition(instance, []).findings, [
  { field: '', code: 'missing-definition' },
]);
assert.deepEqual(instance.properties, [{ name: 'priority', type: 'int', value: 2 }]);
const invalid = structuredClone(instance);
invalid.properties = [
  { name: 'priority', type: 'int', value: 11 },
  { name: 'facing', type: 'string', value: '' },
  { name: 'retired', type: 'string', value: 'keep' },
];
assert.deepEqual(
  resolveDefinition(invalid, [definition]).findings.map((f) => f.code),
  ['required', 'choices', 'max', 'unknown-field'],
);
const captured = capture(
  editor,
  { rectangle: null, objects: new Set([id]), allLayers: false },
  'project',
).composition;
paste(editor, captured, 'project', 3, 3, () => true);
assert.equal(editor.objects.length, 2);
assert.notEqual(editor.objects[1].id, id);
assert.equal(editor.objects[1].definition, definition.id);
assert.deepEqual(editor.objects[1].properties, instance.properties);
for (const d of [
  { ...definition, kind: 'rectangle' as const, width: 7, height: 8 },
  { ...definition, kind: 'sprite' as const, asset: 'actors/idle' },
]) {
  assert.equal(definitionInstance(d, 1, 2).kind, d.kind);
}
// Detachment can materialize all defaults and overrides without losing values.
const many: ObjectDefinition = {
  ...definition,
  fields: Array.from({ length: 128 }, (_, i) => ({
    name: `default-${i}`,
    type: 'int',
    required: false,
    default: i,
  })),
};
const linked = structuredClone(instance);
linked.properties = Array.from({ length: 128 }, (_, i) => ({
  name: `extra-${i}`,
  type: 'string',
  value: `keep-${i}`,
}));
editor.replaceObject(linked);
const detached = structuredClone(linked);
detached.properties = resolveDefinition(linked, [many]).properties;
delete detached.definition;
assert.equal(detached.properties.length, 256);
editor.replaceObject(detached);
assert.deepEqual(editor.objects[0], detached);
editor.undo();
assert.deepEqual(editor.objects[0], linked);
editor.redo();
assert.deepEqual(editor.objects[0], detached);
assert.deepEqual(decodeObject(encodeObject(detached)), detached);
assert.throws(
  () =>
    editor.replaceObject({
      ...detached,
      properties: [...detached.properties, { name: 'overflow', type: 'int', value: 0 }],
    }),
  /256 properties/,
);
assert.throws(() => editor.replaceObject({ ...detached, definition: many.id }), /128 properties/);
console.log('Object definition model checks passed');
