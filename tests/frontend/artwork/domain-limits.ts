/** Shared service/browser boundary fixtures; no Python or code generation at runtime. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import {
  decodeDescriptor,
  placementsSchema,
} from '../../../frontend/artwork/artwork-contracts.mts';
import * as artwork from '../../../frontend/artwork/artwork-limits.mts';
import * as sheets from '../../../frontend/artwork/sheet-limits.mts';
import * as placements from '../../../frontend/artwork/placement-limits.mts';
import * as scene from '../../../frontend/scene/dimensions.mts';

const fields = v.record(v.string(), v.unknown());
const fixture = v.parse(
  v.object({
    descriptor: fields,
    frame: fields,
    descriptor_cases: v.array(
      v.object({
        name: v.string(),
        valid: v.boolean(),
        descriptor: v.optional(fields),
        frame: v.optional(fields),
        frame_count: v.optional(v.number()),
        sequence_lengths: v.optional(v.array(v.number())),
        duration: v.optional(v.unknown()),
        layer_count: v.optional(v.number()),
        descriptor_bytes: v.optional(v.number()),
      }),
    ),
    placement_cases: v.array(
      v.object({
        name: v.string(),
        valid: v.boolean(),
        count: v.optional(v.number()),
        field: v.optional(v.string()),
        value: v.optional(v.number()),
      }),
    ),
    scene_cases: v.array(
      v.object({
        width: v.number(),
        height: v.number(),
        grid: v.number(),
        valid: v.boolean(),
      }),
    ),
    policy: v.record(v.string(), v.record(v.string(), v.number())),
  }),
  JSON.parse(readFileSync(new URL('../../fixtures/domain-limits.json', import.meta.url), 'utf8')),
);
for (const test of fixture.descriptor_cases) {
  const value = { ...fixture.descriptor, ...test.descriptor };
  if (value.version === 2) {
    value.frames = Array.from({ length: test.frame_count ?? 1 }, (_, i) => ({
      ...fixture.frame,
      id: `f${i}`,
      ...test.frame,
    }));
    value.sequences = (test.sequence_lengths ?? []).map((count, i) => ({
      id: `s${i}`,
      name: 'S',
      loop: true,
      frames: Array.from({ length: count }, () => ({
        frame_id: 'f0',
        duration_ms: test.duration ?? 1,
      })),
    }));
  }
  if (test.layer_count !== undefined) {
    value.layers = {
      version: 1,
      items: Array.from({ length: test.layer_count }, (_, i) => ({
        id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
        name: 'L',
        visible: true,
        locked: false,
        opacity: 255,
      })),
    };
  }
  if (test.descriptor_bytes) {
    const provenance = {
      project_id: value.id,
      atlas_id: 'sheet',
      region: 'f0',
      grid: null,
      cell: null,
      artwork_revision: 'a'.repeat(64),
      source_format: '',
    };
    value.provenance = provenance;
    const byteCount = () => Buffer.byteLength(JSON.stringify(value, null, 2) + '\n');
    provenance.source_format = 'x'.repeat(test.descriptor_bytes - byteCount());
    assert.equal(byteCount(), test.descriptor_bytes);
  }
  const original = structuredClone(value);
  if (test.valid) {
    assert.deepEqual(decodeDescriptor(value), value, test.name);
  } else {
    assert.throws(() => decodeDescriptor(value), test.name);
  }
  assert.deepEqual(value, original);
}
for (const test of fixture.placement_cases) {
  const value = Array.from({ length: test.count ?? 1 }, (_, i) => {
    const item: Record<string, unknown> = {
      scene_id: fixture.descriptor.id,
      scene_revision: 'a'.repeat(64),
      layer_id: 1,
      x: i,
      y: 0,
    };
    if (test.field === 'object_id') {
      delete item.x;
      delete item.y;
    }
    if (test.field) {
      item[test.field] = test.value;
    }
    return item;
  });
  assert.equal(v.safeParse(placementsSchema, value).success, test.valid, test.name);
}
for (const test of fixture.scene_cases) {
  assert.equal(
    scene.validDimensions(test.width, test.height, test.grid),
    test.valid,
    JSON.stringify(test),
  );
}
for (const [domain, definitions] of Object.entries({ artwork, sheets, placements, scene })) {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(definitions).filter(([key]) => Object.hasOwn(fixture.policy[domain], key)),
    ),
    fixture.policy[domain],
    domain,
  );
}
console.log('Shared artwork, sheet, placement and scene lower/upper boundaries passed.');
