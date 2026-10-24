import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as decode from '../frontend/decode.mts';
import { ApiClient, HttpError, ProtocolError, errorDetails } from '../frontend/api.mts';

const scene = {
  version: 1,
  connector: 'independent',
  id: 'room',
  name: 'Room',
  profile: 'opaque-target',
  source_digest: 'opaque-revision',
  width: 2,
  height: 1,
  cells: [['floor', 'wall']],
  references: [],
  extra: { flags: [true, false] },
};
const profile = {
  label: 'Room',
  type: 'grid',
  cell_size: 8,
  erase_cell: 'floor',
  lighting: ['neutral'],
  states: [{ id: 'normal', label: 'Normal' }],
};
const catalog = {
  contract_version: 1,
  connector: scene.connector,
  token: 'session-token',
  project: { name: 'Example', label: 'Editor', source_label: 'PREVIEW' },
  capabilities: { export: true },
  profiles: { [scene.profile]: profile },
  families: [{ id: 'tiles', url: '/art/tiles', regions: [] }],
  entries: [
    {
      id: 'floor',
      label: 'Floor',
      family: 'tiles',
      profiles: [scene.profile],
      rect: { x: 0, y: 0, width: 8, height: 8 },
    },
  ],
};

await test('scene decoding retains connector extensions and rejects malformed grids', () => {
  assert.deepEqual(decode.scene(scene), scene);
  for (const value of [
    null,
    [],
    { ...scene, width: '2' },
    { ...scene, cells: [['floor']] },
    { ...scene, references: [{}] },
    { ...scene, version: 99 },
  ]) {
    assert.throws(() => decode.scene(value));
  }
  const loaded = decode.sceneData({ scene, locked: [[0, 0]], revision: null });
  assert.deepEqual(loaded.constraints, []);
  assert.equal(decode.loadedDocument({ scene, original: true, revision: null }).original, true);
  assert.equal(
    decode.loadedDocument({ scene, revision: 'raw-bytes-hash' }).revision,
    'raw-bytes-hash',
  );
  assert.throws(() => decode.sceneData({ scene, locked: [[0]], revision: null }));
});

await test('catalog decoding checks capabilities, asset rectangles and preview modes', () => {
  assert.equal(decode.catalog(catalog).entries[0].id, 'floor');
  for (const value of [
    { ...catalog, contract_version: 2 },
    { ...catalog, profiles: {} },
    { ...catalog, capabilities: { apply: 'yes' } },
    { ...catalog, profiles: { room: { ...profile, cell_size: 0 } } },
    { ...catalog, profiles: { room: { ...profile, animation_frames: 2 } } },
    { ...catalog, entries: [{ ...catalog.entries[0], rect: { width: '8' } }] },
  ]) {
    assert.throws(() => decode.catalog(value));
  }
});

await test('preview, saved-draft and task responses are checked before use', () => {
  const comparison = { differs: false, source_revision: 'opaque' };
  assert.deepEqual(
    decode.preview({ png: 'data:image/png;base64,AA==', collision: [[false]], comparison })
      .comparison,
    comparison,
  );
  assert.throws(() => decode.preview({ png: '', collision: [[1]], comparison }));
  assert.throws(() => decode.savedDraft({ id: 'room', revision: null, path: 'drafts/room' }));
  assert.throws(() => decode.job({ status: 'unknown', started_at: 0 }));
  assert.throws(() => decode.job({ status: 'running', started_at: '0' }));
  assert.equal(
    decode.job({
      status: 'complete',
      started_at: 0,
      scene,
      process: { command: 'python compile.py', running: false, return_code: 0 },
    }).scene?.profile,
    scene.profile,
  );
  assert.deepEqual(decode.lastApply({}), { transaction: undefined, label: undefined });
});

await test('API sends the session token, decodes unknown JSON and preserves HTTP failures', async (t) => {
  const client = new ApiClient();
  client.token = 'session-token';
  const request = t.mock.method(
    globalThis,
    'fetch',
    (_input: string | URL | Request, init?: RequestInit) => {
      assert.deepEqual(init?.headers, {
        'Content-Type': 'application/json',
        'X-Scene-Token': 'session-token',
      });
      assert.deepEqual(JSON.parse(decode.string(init?.body)), { scene });
      return Promise.resolve(Response.json({ id: 'room', revision: 'new', path: 'drafts/room' }));
    },
  );
  assert.equal((await client.json('save', decode.savedDraft, { scene })).revision, 'new');
  request.mock.mockImplementation(() => Promise.resolve(Response.json({ id: 'room' })));
  await assert.rejects(client.json('save', decode.savedDraft, { scene }), /Expected a string/);
  request.mock.mockImplementation(() =>
    Promise.resolve(Response.json({ error: 'Draft changed' }, { status: 409 })),
  );
  await assert.rejects(
    client.request('save', { scene }),
    (error) =>
      error instanceof HttpError && error.status === 409 && error.message === 'Draft changed',
  );
  request.mock.mockImplementation(() =>
    Promise.resolve(new Response('unavailable', { status: 503 })),
  );
  await assert.rejects(
    client.request('catalog'),
    (error) => error instanceof HttpError && error.status === 503,
  );
});

await test('nullable optional fields retain connector-v1 behavior for tiles, stamps and references', () => {
  const decoded = decode.catalog({
    ...catalog,
    profiles: {
      room: {
        ...profile,
        animation_frames: null,
        animation_interval_ms: null,
        animation_label: null,
      },
    },
    capabilities: { apply: null, export: true },
    entries: [
      {
        ...catalog.entries[0],
        reference: null,
        cells: null,
        rect: { ...catalog.entries[0].rect, origin: null },
      },
      {
        id: 'stamp',
        label: 'Stamp',
        family: 'tiles',
        profiles: ['room'],
        rect: null,
        cells: [['floor']],
      },
      {
        ...catalog.entries[0],
        id: 'actor',
        reference: true,
        rect: { ...catalog.entries[0].rect, origin: [4, 7] },
      },
    ],
  });
  assert.equal(decoded.profiles.room.animation_frames, undefined);
  assert.equal(decoded.profiles.room.animation_label, undefined);
  assert.deepEqual(decoded.entries[1].cells, [['floor']]);
  assert.equal(decoded.entries[1].rect, undefined);
  assert.deepEqual(decoded.entries[2].rect?.origin, [4, 7]);
});

await test('protocol failures remain distinct from retryable transport errors', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(Response.json({ status: 'complete', started_at: 'invalid' })),
  );
  await assert.rejects(
    new ApiClient().json('apply-status/job', decode.job),
    (error) => error instanceof ProtocolError && errorDetails(error) instanceof ProtocolError,
  );
  request.mock.mockImplementation(() => Promise.resolve(new Response('{invalid JSON')));
  await assert.rejects(new ApiClient().json('apply-active', decode.activeApply), ProtocolError);
  request.mock.mockImplementation(() => Promise.reject(new TypeError('Connection refused')));
  await assert.rejects(
    new ApiClient().json('apply-active', decode.activeApply),
    (error) => error instanceof HttpError && error.status === 0,
  );
});
