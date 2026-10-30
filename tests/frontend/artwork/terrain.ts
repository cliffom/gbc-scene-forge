import assert from 'node:assert/strict';
import { LayerEditor } from '../../../frontend/scene/layers.mts';
import { paintTerrain, ruleReport, type TerrainRules } from '../../../frontend/artwork/terrain.mts';
import type { TileMetadata } from '../../../frontend/artwork/tile-metadata.mts';
import { emptyMetadata } from '../../../frontend/artwork/tile-metadata.mts';

function get<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  assert.ok(value !== undefined);
  return value;
}
function rules(): TerrainRules {
  const metadata = new Map<string, TileMetadata>();
  const families = new Map<string, Map<number, string[]>>();
  for (const name of ['road', 'water']) {
    const masks = new Map<number, string[]>();
    for (let mask = 0; mask < 16; mask++) {
      const asset = `${name}/${mask}`;
      metadata.set(asset, { ...emptyMetadata(), terrain: name, terrain_mask: mask });
      masks.set(mask, [asset]);
    }
    families.set(name, masks);
  }
  return { metadata, families };
}
function editor() {
  return new LayerEditor(
    {
      width: 4,
      height: 4,
      grid: 8,
      layers: [
        {
          id: 1,
          name: 'Roads',
          type: 'tilelayer',
          visible: true,
          cells: Array.from({ length: 4 }, () => Array<string>(4).fill('empty')),
        },
        {
          id: 2,
          name: 'Other',
          type: 'tilelayer',
          visible: true,
          cells: Array.from({ length: 4 }, () => Array<string>(4).fill('empty')),
        },
      ],
      next_layer_id: 3,
      next_object_id: 1,
      active_layer_id: 1,
    },
    [],
    { erase_cell: 'empty' },
  );
}
const e = editor(),
  r = rules();
e.begin();
paintTerrain(e, r, 'road', 0, 0);
paintTerrain(e, r, 'road', 1, 0);
paintTerrain(e, r, 'road', 1, 1);
e.end();
assert.equal(e.cells[0][0], 'road/2');
assert.equal(e.cells[0][1], 'road/12'); // south + west corner
assert.equal(e.cells[1][1], 'road/1');
assert.equal(e.undoStack.length, 1);
const painted = structuredClone(e.scene);
e.undo();
assert.equal(e.cells[0][0], 'empty');
e.redo();
assert.deepEqual(e.scene, painted);
paintTerrain(e, r, 'water', 1, 0);
assert.equal(e.cells[0][0], 'road/0');
assert.equal(e.cells[1][1], 'road/0');
assert.equal(e.cells[0][1], 'water/0');
paintTerrain(e, r, 'water', 2, 0);
assert.equal(e.cells[0][1], 'water/2');
paintTerrain(e, r, 'water', 2, 0, true);
assert.equal(e.cells[0][2], 'empty');
assert.equal(e.cells[0][1], 'water/0');
const depth = e.undoStack.length;
paintTerrain(e, r, 'water', 1, 0);
assert.equal(e.undoStack.length, depth); // repeated edits are deterministic/no-op
assert.equal(e.layers[1].type === 'tilelayer' && e.layers[1].cells[0][0], 'empty');
e.visibility();
assert.throws(() => paintTerrain(e, r, 'road', 0, 0));
e.visibility();
assert.throws(() => paintTerrain(e, r, 'road', -1, 0));
// All 16 masks, including scene edges, are resolved from prospective occupancy.
for (let mask = 0; mask < 16; mask++) {
  const sample = editor();
  const offsets = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  offsets.forEach(([dx, dy], i) => {
    if (mask & (1 << i)) {
      sample.cells[1 + dy][1 + dx] = 'road/0';
    }
  });
  paintTerrain(sample, r, 'road', 1, 1);
  assert.equal(sample.cells[1][1], `road/${mask}`);
}
// Incomplete/ambiguous rules have visible deterministic fallbacks and survive repeats.
const partial = rules();
get(partial.families, 'road').delete(2);
assert.ok(ruleReport(partial, 'road').join().includes('Missing masks: 2'));
const sample = editor();
paintTerrain(sample, partial, 'road', 0, 0);
assert.ok(paintTerrain(sample, partial, 'road', 1, 0).join().includes('Missing road mask 2'));
assert.equal(sample.cells[0][0], 'road/0');
partial.metadata.set('road/duplicate', { ...emptyMetadata(), terrain: 'road', terrain_mask: 0 });
get(get(partial.families, 'road'), 0).push('road/duplicate');
assert.ok(ruleReport(partial, 'road').join().includes('Duplicate masks: 0'));
assert.ok(paintTerrain(editor(), partial, 'road', 0, 0).join().includes('chose road/0'));
// Never rewrite collision metadata or swap a neighbor to incompatible collision geometry.
const unsafe = rules();
get(unsafe.metadata, 'road/1').solid = true;
const unchanged = editor(),
  before = structuredClone(unchanged.scene);
assert.throws(() => paintTerrain(unchanged, unsafe, 'road', 1, 1), /collision/);
assert.deepEqual(unchanged.scene, before);
const guarded = editor();
guarded.cells[1][1] = 'road/plain';
r.metadata.set('road/plain', { ...emptyMetadata(), terrain: 'road', solid: true });
assert.ok(paintTerrain(guarded, r, 'road', 2, 1).join().includes('preserve its collision'));
assert.equal(guarded.cells[1][1], 'road/plain');
// Locked-neighbor rejection is atomic, including the newly painted cell.
const locked = editor();
locked.cells[1][1] = 'road/0';
locked.locked.add('1,1');
const lockedBefore = structuredClone(locked.scene);
assert.throws(() => paintTerrain(locked, r, 'road', 2, 1));
assert.deepEqual(locked.scene, lockedBefore);
console.log(
  'Terrain rules: 16 masks, borders, types, history, incomplete rules and collision guards passed.',
);
