/** Native candidate wire boundary. Saved policy and digest validation stay in artwork services. */
import * as v from 'valibot';
import { parse, text } from '../shared/schema.mts';
const bounded = (min: number, max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const revision = v.pipe(text, v.regex(/^[0-9a-f]{64}$/));
const identifier = v.pipe(text, v.regex(/^[a-z][a-z0-9_]{0,63}$/));
const identity = v.pipe(text, v.uuid());
const placementBase = {
  scene_id: identity,
  scene_revision: revision,
  layer_id: bounded(1, 2147483646),
};
export const placementsSchema = v.pipe(
  v.array(
    v.union([
      v.strictObject({ ...placementBase, x: bounded(0, 2047), y: bounded(0, 2047) }),
      v.strictObject({ ...placementBase, object_id: bounded(1, 2147483646) }),
    ]),
  ),
  v.minLength(1),
  v.maxLength(256),
);
export type Placement = v.InferOutput<typeof placementsSchema>[number];
const sourceEntries = {
  atlas_id: identifier,
  region: identifier,
  grid: v.nullable(v.picklist([8, 16, 32])),
  cell: v.nullable(v.tuple([bounded(0, 2047), bounded(0, 2047)])),
  artwork_revision: revision,
};
const descriptor = v.pipe(
  v.strictObject({
    version: v.literal(1),
    id: identity,
    atlas_id: identifier,
    region: identifier,
    name: v.pipe(text, v.minLength(1), v.maxLength(100)),
    kind: v.picklist(['tile', 'sprite']),
    width: bounded(8, 256),
    height: bounded(8, 256),
    origin: v.tuple([bounded(0, 255), bounded(0, 255)]),
    pixel_format: v.literal('rgba8'),
    provenance: v.nullable(
      v.strictObject({ ...sourceEntries, project_id: identity, source_format: v.nullable(text) }),
    ),
  }),
  v.check(
    (d) =>
      d.width % 8 === 0 &&
      d.height % 8 === 0 &&
      d.origin[0] < d.width &&
      d.origin[1] < d.height &&
      (d.kind !== 'tile' ||
        (d.width === d.height && [8, 16, 32].includes(d.width) && d.origin.every((n) => n === 0))),
    'Invalid artwork dimensions or origin.',
  ),
);
export const candidateSchema = v.pipe(
  v.strictObject({
    version: v.literal(1),
    project_id: identity,
    document_id: identity,
    atlas_id: identifier,
    descriptor,
    rgba: v.pipe(text, v.maxLength(349528)),
    revision,
    project_revision: revision,
    artwork_revision: v.nullable(revision),
    operation: v.picklist(['create', 'edit', 'duplicate']),
    source: v.nullable(v.strictObject(sourceEntries)),
    metadata: v.record(text, v.unknown()),
    placements: v.optional(placementsSchema),
  }),
  v.check(
    (c) =>
      c.document_id === c.descriptor.id &&
      c.atlas_id === c.descriptor.atlas_id &&
      (c.operation === 'edit' ? c.artwork_revision !== null : c.artwork_revision === null) &&
      (!c.placements || c.operation === 'duplicate') &&
      (c.operation === 'duplicate' ? c.source !== null : c.source === null),
    'Invalid artwork identity or saved base.',
  ),
  v.check((c) => {
    try {
      const raw = atob(c.rgba);
      return btoa(raw) === c.rgba && raw.length === c.descriptor.width * c.descriptor.height * 4;
    } catch {
      return false;
    }
  }, 'Invalid artwork pixel count.'),
);
export type Candidate = v.InferOutput<typeof candidateSchema>;
export function decodeCandidate(value: unknown): Candidate {
  return parse(candidateSchema, value);
}
