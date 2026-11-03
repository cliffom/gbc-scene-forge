import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectViewCategory } from '../../../frontend/scene/view-filters.mts';
import type { SceneObject } from '../../../frontend/objects/objects.mts';
import type { ObjectDefinition } from '../../../frontend/objects/object-definitions.mts';

await test('portable definitions and object overrides classify mixed planning independently of names', () => {
  const common = { id: '1', name: 'Arbitrary', class: '', x: 0, y: 0, properties: [] };
  const rectangle: SceneObject = { ...common, kind: 'rectangle', width: 8, height: 8 };
  const point: SceneObject = { ...common, kind: 'point' };
  assert.equal(objectViewCategory(rectangle, []), 'geometry');
  assert.equal(objectViewCategory(point, []), 'gameplay');
  const definition: ObjectDefinition = {
    id: 'typed',
    name: 'Any name',
    kind: 'rectangle',
    width: 8,
    height: 8,
    fields: [{ name: 'forge_view', type: 'string', required: false, default: 'guides' }],
  };
  assert.equal(objectViewCategory({ ...rectangle, definition: 'typed' }, [definition]), 'guides');
  assert.equal(
    objectViewCategory(
      {
        ...rectangle,
        definition: 'typed',
        properties: [{ name: 'forge_view', type: 'string', value: 'gameplay' }],
      },
      [definition],
    ),
    'gameplay',
  );
  for (const role of [
    'patrol',
    'approach',
    'arena',
    'detour',
    'camera',
    'section',
    'note',
    'solid',
    'climb',
  ]) {
    const item: SceneObject = {
      ...rectangle,
      properties: [{ name: 'blockout_role', type: 'string' as const, value: role }],
    };
    assert.equal(
      objectViewCategory(item, []),
      ['camera', 'section', 'note'].includes(role)
        ? 'guides'
        : ['solid', 'climb'].includes(role)
          ? 'geometry'
          : 'gameplay',
    );
  }
  assert.equal(
    objectViewCategory(
      {
        ...common,
        kind: 'sprite',
        asset: 'a/b',
        properties: [{ name: 'forge_view', type: 'string', value: 'guides' }],
      },
      [],
    ),
    'sprites',
  );
  assert.equal(
    objectViewCategory(
      { ...rectangle, properties: [{ name: 'forge_view', type: 'string', value: 'invalid' }] },
      [],
    ),
    'geometry',
  );
});
