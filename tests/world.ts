/** World graph diagnostics preserve endpoint identity across metadata changes. */
import assert from 'node:assert/strict';
import { decodeWorld, decodeWorldSnapshot, worldFindings } from '../frontend/world.mts';
const value = {
  version: 1,
  positions: { first: { x: -50, y: 30 } },
  connections: [
    {
      id: 'door',
      name: 'Doorway',
      source: { scene: 'first', object: 1 },
      destination: { scene: 'second', object: 1 },
      direction: 'two-way',
    },
  ],
};
const world = decodeWorld(value);
const snapshot = decodeWorldSnapshot({
  scene_revisions: { first: 'a', second: 'b' },
  scenes: [
    {
      id: 'first',
      name: 'Room',
      revision: 'a',
      width: 8,
      height: 8,
      grid: 8,
      objects: [{ id: 1, name: 'Exit', layer: 2, visible: true, x: 8, y: 8, errors: [] }],
    },
    {
      id: 'second',
      name: 'Cave',
      revision: 'b',
      width: 8,
      height: 8,
      grid: 8,
      objects: [{ id: 1, name: 'Entry', layer: 5, visible: false, x: 0, y: 0, errors: [] }],
    },
  ],
});
assert.deepEqual(worldFindings(world, snapshot.scenes), []);
snapshot.scenes[1].objects[0].errors = [{ code: 'required', field: 'facing' }];
assert.deepEqual(worldFindings(world, snapshot.scenes), [
  {
    connection: 'door',
    endpoint: 'destination',
    scene: 'second',
    object: 1,
    code: 'required',
    field: 'facing',
  },
]);
snapshot.scenes[0].name = 'Renamed';
snapshot.scenes[1].objects[0].name = 'Renamed marker';
assert.equal(worldFindings(world, snapshot.scenes).length, 1);
snapshot.scenes[1].objects = [];
assert.equal(worldFindings(world, snapshot.scenes)[0].code, 'missing-object');
snapshot.scenes.pop();
assert.equal(worldFindings(world, snapshot.scenes)[0].code, 'missing-scene');
assert.deepEqual(decodeWorld(undefined), { version: 1, positions: {}, connections: [] });
assert.deepEqual(value.connections[0].destination, { scene: 'second', object: 1 });
assert.throws(() => decodeWorld({ ...value, version: 2 }), /version/);
assert.throws(
  () => decodeWorld({ ...value, connections: [{ ...value.connections[0], direction: 'both' }] }),
  /direction/,
);
console.log('World endpoint and decoding checks passed.');
