/** Differential boundary corpus. Set FORGE_CONTRACT_BASELINE to compare a Git revision. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { record } from '../../../frontend/shared/decode.mts';
import type { Decoder } from '../../../frontend/shared/decode.mts';
import * as objects from '../../../frontend/objects/objects.mts';
import * as definitions from '../../../frontend/objects/object-definitions.mts';
import * as metadata from '../../../frontend/artwork/tile-metadata.mts';
import * as palettes from '../../../frontend/diagnostics/palette-budget.mts';
import * as contracts from '../../../frontend/project/project-contracts.mts';

const decoders = {
  decodeProperty: objects.decodeProperty,
  decodeObject: objects.decodeObject,
  decodeDefinitions: definitions.decodeDefinitions,
  decodeMetadata: metadata.decodeMetadata,
  decodeMetadataSets: metadata.decodeMetadataSets,
  decodePaletteProfile: palettes.decodePaletteProfile,
  decodeLoaded: contracts.decodeLoaded,
  decodeProject: contracts.decodeProject,
};
type Name = keyof typeof decoders;
const property = { name: 'speed', type: 'float', value: 1.5 };
const sprite = { id: 1, x: 0, y: 0, asset: 'hero', origin: [0, 8], properties: [property] };
const definition = {
  id: 'hero',
  name: 'Hero',
  kind: 'sprite',
  asset: 'hero',
  width: 8,
  height: 16,
  fields: [
    { name: 'speed', type: 'float', required: true, default: 1.5, min: 0, max: 8, choices: ['a'] },
  ],
};
const tile = {
  terrain: 'grass',
  terrain_mask: 3,
  solid: true,
  next_shape_id: 4,
  shapes: [
    { id: 1, kind: 'rectangle', x: 0, y: 0, width: 8, height: 8 },
    { id: 2, kind: 'ellipse', x: 1, y: 2, width: 3, height: 4 },
    {
      id: 3,
      kind: 'polygon',
      points: [
        [0, 0],
        [8, 0],
        [0, 8],
      ],
    },
  ],
};
const profile = {
  version: 2,
  bg_reserved: 0,
  obj_reserved: null,
  hardware: {
    id: 'gbc-static-split-v1',
    sprite_height: 16,
    bg_tiles_reserved: 256,
    obj_tiles_reserved: null,
    oam_reserved: 40,
  },
};
const scene = { width: 1, height: 1, grid: 8, cells: [['']], objects: [sprite] };
const saved = { id: 'room', name: 'Room', revision: 'r', scene };
const catalog = {
  id: 'project',
  name: 'Project',
  scenes: [{ id: 'room', name: 'Room' }],
  atlases: {
    art: {
      png: 'atlas.png',
      tiles: {},
      metadata: { '8': { grass: tile } },
      manifest: { regions: [] },
    },
  },
  object_definitions: { version: 1, definitions: [definition] },
  gbc_palette_profile: profile,
};
const seeds: [Name, unknown][] = [
  ['decodeProperty', property],
  ...['string', 'bool', 'int'].map((type): [Name, unknown] => [
    'decodeProperty',
    { name: '', type, value: type === 'string' ? '' : type === 'bool' ? false : 1 },
  ]),
  ['decodeObject', sprite],
  ['decodeObject', { id: 2, x: 0, y: 0, kind: 'point' }],
  ['decodeObject', { id: 3, x: 0, y: 0, kind: 'rectangle', width: 8, height: 16 }],
  ['decodeDefinitions', { version: 1, definitions: [definition] }],
  ['decodeMetadata', tile],
  ['decodeMetadataSets', { '8': { grass: tile } }],
  ['decodePaletteProfile', profile],
  ['decodePaletteProfile', { version: 1, bg_reserved: null, obj_reserved: 8, hardware: 'ignored' }],
  ['decodeLoaded', saved],
  ['decodeProject', catalog],
];
const replacements: unknown[] = [
  undefined,
  null,
  false,
  true,
  '',
  'bad',
  0,
  -0,
  -1,
  0.5,
  7,
  8,
  9,
  15,
  16,
  39,
  40,
  41,
  255,
  256,
  257,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER + 1,
  NaN,
  Infinity,
  -Infinity,
  [],
  {},
  [0],
  [0, 1, 'bad'],
];
function variants(value: unknown): unknown[] {
  const result = [...replacements];
  if (typeof value !== 'object' || value === null) {
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    for (const replacement of variants(child)) {
      const copy: unknown = structuredClone(value);
      if (Array.isArray(copy)) {
        copy[Number(key)] = replacement;
      } else if (replacement === undefined) {
        delete record(copy)[key];
      } else {
        record(copy)[key] = replacement;
      }
      result.push(copy);
      if (replacement === undefined && !Array.isArray(copy)) {
        result.push({ ...record(copy), [key]: undefined });
      }
    }
  }
  if (!Array.isArray(value)) {
    result.push({ ...value, ignored: { extra: true } });
  }
  return result;
}
function outcome(decode: (value: unknown) => unknown, value: unknown) {
  const input = structuredClone(value);
  const before = structuredClone(input);
  try {
    return { output: decode(input) };
  } catch (error) {
    assert(error instanceof Error);
    return { error: error.message };
  } finally {
    assert.deepEqual(input, before, 'decoder mutated its input');
  }
}
const corpus: [Name, unknown][] = seeds.flatMap(([name, value]) =>
  variants(value).map((value): [Name, unknown] => [name, value]),
);
for (const key of ['__proto__', 'constructor', 'prototype']) {
  corpus.push(['decodeMetadataSets', { [key]: { [key]: tile } }]);
  corpus.push(['decodeMetadataSets', { [key]: { [key]: { ...tile, solid: null } } }]);
}
// Multiple faults pin the historical first-error order and conditional short circuiting.
corpus.push(
  ['decodeProperty', { name: 1, type: 'bad', value: null }],
  ['decodeObject', { ...sprite, id: null, kind: 'bad' }],
  ['decodeObject', { ...sprite, origin: [0, 1, 'bad'], asset: null }],
  ['decodeDefinitions', { version: 1, definitions: [{ ...definition, kind: 'bad', id: null }] }],
  [
    'decodeDefinitions',
    { version: 1, definitions: [{ ...definition, fields: [{ name: null, type: 'bad' }] }] },
  ],
  ['decodeMetadata', { ...tile, solid: null, shapes: null }],
  ['decodeMetadata', { ...tile, terrain_mask: null, solid: null }],
  ['decodeMetadata', { ...tile, shapes: [{ id: null, kind: 'bad' }] }],
  ['decodeObject', { ...sprite, properties: null, definition: null, kind: 'bad' }],
  [
    'decodeDefinitions',
    { version: 1, definitions: [{ ...definition, width: null, fields: null }] },
  ],
  [
    'decodeDefinitions',
    {
      version: 1,
      definitions: [
        {
          ...definition,
          fields: [{ name: '', type: 'int', required: true, default: null, min: null }],
        },
      ],
    },
  ],
  [
    'decodePaletteProfile',
    {
      ...profile,
      bg_reserved: null,
      obj_reserved: 'bad',
      hardware: { ...profile.hardware, id: 'bad', sprite_height: null },
    },
  ],
  [
    'decodePaletteProfile',
    { ...profile, bg_reserved: 'bad', hardware: { ...profile.hardware, bg_tiles_reserved: 'bad' } },
  ],
);

assert.deepEqual(objects.decodeObject(sprite).id, '1');
assert.deepEqual(objects.decodeProperty({ name: '', type: 'int', value: 0.5 }), {
  name: '',
  type: 'int',
  value: 0.5,
});
assert.throws(() => objects.validateProperties([{ name: 'n', type: 'int', value: 0.5 }]));
assert.deepEqual(definitions.decodeDefinitions(undefined), []);
assert.deepEqual(metadata.decodeMetadataSets(null), {});
assert.equal(palettes.decodePaletteProfile(undefined), null);
assert.throws(() => objects.decodeProperty({ name: '', type: 'bool', value: 1 }), {
  message: 'Unsupported property type.',
});
assert.throws(() => objects.decodeObject({ ...sprite, kind: 'sprite' }), {
  message: 'Unsupported object kind.',
});
assert.throws(
  () => palettes.decodePaletteProfile({ ...profile, hardware: { id: 'bad', sprite_height: null } }),
  { message: 'Unsupported hardware layout or sprite height.' },
);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return ['array', value.map(canonical)];
  }
  if (value && typeof value === 'object') {
    return [
      'object',
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    ];
  }
  return [
    typeof value,
    typeof value === 'number' ? (Object.is(value, -0) ? '-0' : String(value)) : (value ?? null),
  ];
}
function digest(decode: Record<string, Decoder<unknown>>) {
  const hash = createHash('sha256');
  for (const [name, value] of corpus) {
    hash.update(JSON.stringify(canonical(outcome(decode[name], value))));
  }
  return hash.digest('hex');
}
const ref = process.env.FORGE_CONTRACT_BASELINE;
if (ref) {
  // Bundle original sources from Git against the same locked dependency and runtime.
  const output = resolve('build/contracts-compat/baseline.mjs');
  await mkdir(dirname(output), { recursive: true });
  const entry = Object.keys(decoders)
    .map((name) => {
      const domain =
        name === 'decodeProperty' || name === 'decodeObject'
          ? 'objects/objects'
          : name === 'decodeDefinitions'
            ? 'objects/object-definitions'
            : name.startsWith('decodeMetadata')
              ? 'artwork/tile-metadata'
              : name === 'decodePaletteProfile'
                ? 'diagnostics/palette-budget'
                : 'project/project-contracts';
      return `export { ${name} } from './frontend/${domain}.mts';`;
    })
    .join('\n');
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'baseline',
        setup(build) {
          build.onLoad({ filter: /[/\\]frontend[/\\].*\.(mts|ts)$/ }, ({ path }) => ({
            contents: execFileSync('git', ['show', `${ref}:${relative(process.cwd(), path)}`], {
              encoding: 'utf8',
            }),
            loader: 'ts',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  await writeFile(output, result.outputFiles[0].contents);
  const exports = record(await import(pathToFileURL(output).href));
  function isDecoder(value: unknown): value is Decoder<unknown> {
    return typeof value === 'function';
  }
  const baseline = Object.fromEntries(
    Object.keys(decoders).map((name) => {
      const decode = exports[name];
      assert(isDecoder(decode));
      return [name, decode];
    }),
  );
  for (const [index, [name, value]] of corpus.entries()) {
    assert.deepEqual(
      outcome(decoders[name], value),
      outcome(baseline[name], value),
      `${name} case ${index}`,
    );
  }
  console.log(`Baseline digest: ${digest(baseline)}`);
  console.log(
    `Compared ${corpus.length} cases against ${ref}: identical output/errors; inputs unchanged.`,
  );
} else {
  // Pin all baseline outputs/errors even in source archives without Git history.
  assert.equal(
    digest(decoders),
    'b766d0b30b56e16baaadba6ee3769b6cd88db17ff5bf32853be6fcca1be20536',
  );
  console.log(
    `Exercised ${corpus.length} domain contract cases (set FORGE_CONTRACT_BASELINE for differential verification).`,
  );
}

// Optional normal Python/Tiled loading of the tracked Courtyard, with no tracked edits.
if (process.env.FORGE_CONTRACT_DEMO) {
  const demo = record(JSON.parse(await readFile(process.env.FORGE_CONTRACT_DEMO, 'utf8')));
  const loaded = contracts.decodeLoaded(demo.scene);
  assert.equal(loaded.name, 'Courtyard');
  assert.deepEqual(
    new Set(
      loaded.layers.flatMap((layer) =>
        layer.type === 'objectgroup' ? layer.objects.map((object) => object.kind) : [],
      ),
    ),
    new Set(['sprite', 'point', 'rectangle']),
  );
  assert(
    loaded.layers.some(
      (layer) =>
        layer.type === 'objectgroup' &&
        layer.objects.some((object) => object.properties.length > 0),
    ),
  );
  assert(Object.keys(contracts.decodeProject(demo.catalog).atlases).length > 0);
  console.log(
    'Courtyard normal project/Tiled load: catalog, layers, three object kinds and properties passed.',
  );
}
