/** Native project boundaries reject malformed data before editor adoption. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLoaded, decodeProject } from '../frontend/project/project-contracts.mts';
import { decodeWorldSnapshot } from '../frontend/world/world.mts';
import { decodePaletteProfile } from '../frontend/diagnostics/palette-budget.mts';
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

await test('optional GBC profiles decode palette-only and versioned hardware settings', () => {
  const palettes = { version: 1, bg_reserved: 0, obj_reserved: null };
  assert.deepEqual(decodePaletteProfile(palettes), palettes);
  const target = {
    ...palettes,
    version: 2,
    hardware: {
      id: 'gbc-static-split-v1',
      sprite_height: 16,
      bg_tiles_reserved: 256,
      obj_tiles_reserved: null,
      oam_reserved: 40,
    },
  };
  assert.deepEqual(decodePaletteProfile(target), target);
  for (const hardware of [
    null,
    { ...target.hardware, sprite_height: 12 },
    { ...target.hardware, id: 'unknown' },
    { ...target.hardware, oam_reserved: 41 },
    { ...target.hardware, bg_tiles_reserved: 0.5 },
  ]) {
    assert.throws(() => decodePaletteProfile({ ...target, hardware }));
  }
  assert.throws(() => decodePaletteProfile({ ...palettes, version: 3 }));
});

const worldReport = {
  scene_revisions: { room: 'revision-a' },
  scenes: [
    {
      id: 'room',
      name: 'Room',
      revision: 'revision-a',
      width: 8,
      height: 16,
      grid: 8,
      objects: [
        {
          id: 1,
          name: 'Exit',
          layer: 2,
          visible: true,
          x: -8.5,
          y: 16,
          errors: [{ code: 'required', field: 'destination' }],
        },
      ],
    },
  ],
};

await test('world snapshots normalize visibility, rename revisions and drop unknown fields without mutation', () => {
  const expected = { revisions: worldReport.scene_revisions, scenes: worldReport.scenes };
  assert.deepEqual(decodeWorldSnapshot(worldReport), expected);
  const input = {
    ...structuredClone(worldReport),
    extra: 'ignored',
    scenes: worldReport.scenes.map((scene) => ({
      ...scene,
      extra: 'ignored',
      objects: scene.objects.map((object) => ({
        ...object,
        extra: 'ignored',
        errors: object.errors.map((error) => ({ ...error, extra: 'ignored' })),
      })),
    })),
  };
  const before = structuredClone(input);
  assert.deepEqual(decodeWorldSnapshot(input), expected);
  assert.deepEqual(input, before);
  for (const visible of [undefined, null, false, 0, 1, 'true', {}, []]) {
    const marker = { ...worldReport.scenes[0].objects[0], visible };
    if (visible === undefined) {
      delete marker.visible;
    }
    const result = decodeWorldSnapshot({
      ...worldReport,
      scenes: [{ ...worldReport.scenes[0], objects: [marker] }],
    });
    assert.equal(result.scenes[0].objects[0].visible, false);
  }
  assert.deepEqual(decodeWorldSnapshot({ scene_revisions: {}, scenes: [] }), {
    revisions: {},
    scenes: [],
  });
});

await test('world snapshots retain and validate all own revision keys safely', () => {
  const revisions: unknown = JSON.parse(
    '{"__proto__":"a","constructor":"b","prototype":"c","room":"d"}',
  );
  const decoded = decodeWorldSnapshot({ ...worldReport, scene_revisions: revisions });
  assert.deepEqual(decoded.revisions, revisions);
  assert.equal(Object.getPrototypeOf(decoded.revisions), Object.prototype);
  assert.equal(Object.hasOwn(decoded.revisions, '__proto__'), true);
  for (const key of ['__proto__', 'constructor', 'prototype', 'room']) {
    const bad = { ...record(revisions), [key]: 1 };
    assert.throws(() => decodeWorldSnapshot({ ...worldReport, scene_revisions: bad }), {
      message: 'Expected a string',
    });
  }
});

await test('world snapshot errors retain finite-number, missing-field, array and object semantics', () => {
  // Each path exercises the existing public decoder boundary, with the error
  // message authors already see. Missing required values are not defaulted.
  const cases: { paths: string[][]; invalid: unknown[]; message: string }[] = [
    {
      paths: [
        [],
        ['scene_revisions'],
        ['scenes', '0'],
        ['scenes', '0', 'objects', '0'],
        ['scenes', '0', 'objects', '0', 'errors', '0'],
      ],
      invalid: [undefined, null, [], 1, 'object'],
      message: 'Expected a JSON object',
    },
    {
      paths: [['scenes'], ['scenes', '0', 'objects'], ['scenes', '0', 'objects', '0', 'errors']],
      invalid: [undefined, null, {}, 1, 'array'],
      message: 'Expected an array',
    },
    {
      paths: [
        ['scene_revisions', 'room'],
        ...['id', 'name', 'revision'].map((key) => ['scenes', '0', key]),
        ['scenes', '0', 'objects', '0', 'name'],
        ...['code', 'field'].map((key) => ['scenes', '0', 'objects', '0', 'errors', '0', key]),
      ],
      invalid: [undefined, null, 1, false, {}, []],
      message: 'Expected a string',
    },
    {
      paths: [
        ...['width', 'height', 'grid'].map((key) => ['scenes', '0', key]),
        ...['id', 'layer', 'x', 'y'].map((key) => ['scenes', '0', 'objects', '0', key]),
      ],
      invalid: [undefined, null, '8', false, NaN, Infinity, -Infinity],
      message: 'Expected a finite number',
    },
  ];
  for (const { paths, invalid, message } of cases) {
    for (const path of paths) {
      for (const value of invalid) {
        let input: unknown = structuredClone(worldReport);
        if (!path.length) {
          input = value;
        } else {
          let parent: unknown = input;
          for (const key of path.slice(0, -1)) {
            parent = Array.isArray(parent) ? parent[Number(key)] : record(parent)[key];
          }
          const key = path.at(-1);
          assert(key !== undefined);
          if (Array.isArray(parent)) {
            parent[Number(key)] = value;
          } else {
            const fields = record(parent);
            if (value === undefined && path[0] !== 'scene_revisions') {
              delete fields[key];
            } else {
              fields[key] = value;
            }
          }
        }
        assert.throws(() => decodeWorldSnapshot(input), { message }, path.join('.'));
      }
    }
  }
  const input = structuredClone(worldReport);
  record(input.scenes[0]).name = 1;
  input.scenes[0].width = NaN;
  assert.throws(() => decodeWorldSnapshot(input), { message: 'Expected a string' });
});

const catalog = {
  ...project,
  atlases: {
    art: {
      png: 'assets/art/atlas.png',
      tiles: { '8': { '0/0': 0 } },
      manifest: {
        regions: [
          { name: 'idle', kind: 'sprite', x: 0, y: 0, width: 8, height: 8, duration_ms: 120 },
        ],
        animations: [
          { name: 'idle', frames: [{ region: 'idle' }, { region: 'idle', duration_ms: 80 }] },
        ],
      },
    },
  },
  stamps: [{ id: 'stamp', name: 'Stamp', slots: [1], scene }],
};
await test('schema catalogs preserve atlas normalization, animation fallback, stamps and defaults', () => {
  const before = structuredClone(catalog);
  const decoded = decodeProject(catalog);
  assert.deepEqual(decoded.atlases.art, {
    png: 'assets/art/atlas.png',
    mappings: { '8': { '0/0': 0 } },
    metadata: {},
    animations: [
      {
        name: 'idle',
        frames: [
          { region: 'idle', duration: 120 },
          { region: 'idle', duration: 80 },
        ],
      },
    ],
    regions: [{ name: 'idle', kind: 'sprite', x: 0, y: 0, width: 8, height: 8, origin: [0, 0] }],
  });
  assert.deepEqual(decoded.stamps, [
    { id: 'stamp', name: 'Stamp', composition: { project: 'project', slots: [1], scene } },
  ]);
  assert.deepEqual(catalog, before);
  const defaults = decodeProject(project);
  assert.equal(defaults.paletteProfile, null);
  assert.deepEqual(defaults.definitions, []);
  assert.deepEqual(defaults.world, { version: 1, positions: {}, connections: [] });
  assert.deepEqual(defaults.stamps, []);
});

await test('schema scenes retain flat-scene compatibility, object defaults and empty-cell normalization', () => {
  const point = { id: 7, kind: 'point', x: 0, y: 0 };
  const flat = {
    id: 'flat',
    name: 'Flat',
    revision: 'r',
    scene: { width: 1, height: 1, grid: 8, cells: [['']], objects: [point], next_layer_id: null },
  };
  const result = decodeLoaded(flat);
  assert.deepEqual(result, {
    id: 'flat',
    name: 'Flat',
    revision: 'r',
    width: 1,
    height: 1,
    grid: 8,
    nextLayerId: 3,
    nextObjectId: 1,
    layers: [
      { id: 1, name: 'Ground', type: 'tilelayer', visible: true, cells: [['empty']] },
      {
        id: 2,
        name: 'Sprites',
        type: 'objectgroup',
        visible: true,
        objects: [{ id: '7', kind: 'point', x: 0, y: 0, name: '', class: '', properties: [] }],
      },
    ],
  });
  assert.deepEqual(decodeLoaded({ ...flat, scene: { ...flat.scene, objects: null } }).layers[1], {
    id: 2,
    name: 'Sprites',
    type: 'objectgroup',
    visible: true,
    objects: [],
  });
  const unknown = {
    ...saved,
    extra: 1,
    scene: { ...scene, extra: 1, layers: scene.layers.map((layer) => ({ ...layer, extra: 1 })) },
  };
  assert.deepEqual(decodeLoaded(unknown), decodeLoaded(saved));
});

await test('scene and catalog schemas retain structural errors and domain error precedence', () => {
  const cases: [unknown, string][] = [
    [{ ...saved, id: 1, scene: null }, 'Expected a JSON object'],
    [{ ...saved, id: 1, scene: { ...scene, width: '2' } }, 'Expected a string'],
    [{ ...saved, scene: { ...scene, width: '2' } }, 'Expected a finite number'],
    [{ ...saved, scene: { ...scene, layers: {} } }, 'Expected an array'],
    [{ ...saved, scene: { ...scene, layers: [null] } }, 'Expected a JSON object'],
    [
      { ...saved, scene: { ...scene, layers: [{ ...scene.layers[0], visible: null }] } },
      'Expected a boolean',
    ],
    [
      { ...saved, scene: { ...scene, layers: [{ ...scene.layers[0], type: 'unknown' }] } },
      'Unsupported layer type',
    ],
    [
      { ...saved, scene: { ...scene, layers: [{ ...scene.layers[0], cells: [[null]] }] } },
      'Expected a string',
    ],
    [{ ...saved, scene: { ...scene, width: 3, next_object_id: '1' } }, 'Expected a finite number'],
    [{ ...saved, scene: { ...scene, width: 3 } }, 'Invalid scene response'],
  ];
  for (const [value, message] of cases) {
    assert.throws(() => decodeLoaded(value), { message });
  }
  const atlas = catalog.atlases.art;
  const region = atlas.manifest.regions[0];
  const atlasCases: [unknown, string][] = [
    [{ ...atlas, tiles: null, png: null }, 'Expected a JSON object'],
    [{ ...atlas, png: 1 }, 'Expected a string'],
    [{ ...atlas, tiles: { '8': { '0/0': Infinity } } }, 'Expected a finite number'],
    [{ ...atlas, manifest: null }, 'Expected a JSON object'],
    [
      {
        ...atlas,
        manifest: { regions: null, animations: [{ name: 'idle', frames: [{ region: 1 }] }] },
      },
      'Expected an array',
    ],
    [{ ...atlas, manifest: { regions: [{ ...region, origin: [1] }] } }, 'Invalid region origin'],
    [
      { ...atlas, manifest: { regions: [{ ...region, origin: [1, 2, 'bad'] }] } },
      'Expected a finite number',
    ],
    [
      { ...atlas, manifest: { regions: [{ ...region, origin: [1], name: 1 }] } },
      'Invalid region origin',
    ],
    [
      {
        ...atlas,
        manifest: {
          regions: [region],
          animations: [{ name: 'idle', frames: [{ region: 'missing' }] }],
        },
      },
      'Expected a finite number',
    ],
  ];
  for (const [value, message] of atlasCases) {
    assert.throws(() => decodeProject({ ...catalog, id: 1, atlases: { art: value } }), { message });
  }
  assert.throws(
    () => decodeProject({ ...catalog, stamps: [{ id: 1, slots: 'bad', scene: null }] }),
    { message: 'Expected a JSON object' },
  );
});
