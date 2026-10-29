/** Native project boundaries reject malformed data before editor adoption. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLoaded, decodeProject } from '../frontend/project/project-contracts.mts';
import { ProjectApi } from '../frontend/project/project-api.mts';
import { HttpError } from '../frontend/shared/errors.mts';
import { record, string } from '../frontend/shared/decode.mts';

const scene = {
  width: 2,
  height: 1,
  grid: 8,
  next_layer_id: 2,
  next_object_id: 1,
  layers: [{ id: 1, name: 'Ground', type: 'tilelayer', visible: true, cells: [['floor', 'wall']] }],
};
const saved = { id: 'room', name: 'Room', revision: 'opaque-revision', scene };
const project = {
  id: 'project',
  name: 'Project',
  atlases: {},
  scenes: [{ id: 'room', name: 'Room' }],
};

await test('native scenes validate dimensions, grid, layers and saved revision', () => {
  assert.deepEqual(decodeLoaded(saved).layers, scene.layers);
  assert.equal(decodeLoaded(saved).revision, 'opaque-revision');
  for (const value of [
    null,
    [],
    { ...saved, revision: null },
    { ...saved, scene: { ...scene, width: '2' } },
    { ...saved, scene: { ...scene, grid: 4 } },
    { ...saved, scene: { ...scene, layers: [] } },
    { ...saved, scene: { ...scene, width: 3 } },
  ]) {
    assert.throws(() => decodeLoaded(value));
  }
});

await test('native catalogs validate identities, artwork and feature contracts', () => {
  assert.deepEqual(decodeProject(project).scenes, project.scenes);
  for (const value of [
    null,
    { ...project, id: 2 },
    { ...project, scenes: [{ id: 'room' }] },
    { ...project, atlases: { art: { png: 3 } } },
    { ...project, object_definitions: [{}] },
    { ...project, world: { scenes: 'invalid' } },
  ]) {
    assert.throws(() => decodeProject(value));
  }
});

await test('project API uses relative routes and mutation tokens and validates acknowledgments', async (t) => {
  const client = new ProjectApi('/projects/example');
  client.token = 'session-token';
  const request = t.mock.method(
    globalThis,
    'fetch',
    (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(input, '/projects/example/api/save');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(init?.headers, {
        'Content-Type': 'application/json',
        'X-Scene-Token': 'session-token',
      });
      assert.deepEqual(JSON.parse(string(init?.body)), { scene });
      return Promise.resolve(Response.json({ revision: 'new' }));
    },
  );
  const acknowledgment = (value: unknown) => string(record(value).revision);
  assert.equal(await client.json('save', acknowledgment, { scene }), 'new');
  request.mock.mockImplementation(() => Promise.resolve(Response.json({})));
  await assert.rejects(client.json('save', acknowledgment, { scene }), /Expected a string/);
  request.mock.mockImplementation(() =>
    Promise.resolve(Response.json({ error: 'Scene changed' }, { status: 409 })),
  );
  await assert.rejects(
    client.request('save', { scene }),
    (error) =>
      error instanceof HttpError && error.status === 409 && error.message === 'Scene changed',
  );
  request.mock.mockImplementation(() => Promise.resolve(new Response('{invalid JSON')));
  await assert.rejects(client.json('catalog', decodeProject), SyntaxError);
  request.mock.mockImplementation(() => Promise.reject(new TypeError('Connection refused')));
  await assert.rejects(client.json('catalog', decodeProject), /Connection refused/);
});
