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
const descriptorEntries = {
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
};
export const frameSchema = v.strictObject({
  id: identifier,
  name: v.pipe(text, v.minLength(1), v.maxLength(100)),
  kind: v.picklist(['tile', 'sprite']),
  x: bounded(0, 248),
  y: bounded(0, 248),
  width: bounded(8, 256),
  height: bounded(8, 256),
  origin: v.tuple([bounded(0, 255), bounded(0, 255)]),
});
export const sequenceSchema = v.strictObject({
  id: identifier,
  name: v.pipe(text, v.minLength(1), v.maxLength(100)),
  loop: v.boolean(),
  frames: v.pipe(
    v.array(v.strictObject({ frame_id: identifier, duration_ms: bounded(1, 65535) })),
    v.minLength(1),
    v.maxLength(256),
  ),
});
export type ArtworkFrame = v.InferOutput<typeof frameSchema>;
export type ArtworkSequence = v.InferOutput<typeof sequenceSchema>;
const descriptor = v.pipe(
  v.union([
    v.strictObject({ ...descriptorEntries, version: v.literal(1) }),
    v.strictObject({
      ...descriptorEntries,
      version: v.literal(2),
      frames: v.pipe(v.array(frameSchema), v.minLength(1), v.maxLength(128)),
      sequences: v.pipe(v.array(sequenceSchema), v.maxLength(64)),
    }),
  ]),
  v.check(
    (d) =>
      d.width % 8 === 0 &&
      d.height % 8 === 0 &&
      d.origin[0] < d.width &&
      d.origin[1] < d.height &&
      (d.version === 2 ||
        d.kind !== 'tile' ||
        (d.width === d.height && [8, 16, 32].includes(d.width) && d.origin.every((n) => n === 0))),
    'Invalid artwork dimensions or origin.',
  ),
  v.check((d) => {
    if (d.version !== 2) {
      return true;
    }
    const indexed = new Map(d.frames.map((f) => [f.id, f]));
    if (
      indexed.size !== d.frames.length ||
      indexed.get(d.region)?.kind !== d.kind ||
      d.origin.some((n) => n !== 0)
    ) {
      return false;
    }
    if (
      !d.frames.every(
        (f) =>
          f.x % 8 === 0 &&
          f.y % 8 === 0 &&
          f.width % 8 === 0 &&
          f.height % 8 === 0 &&
          f.x + f.width <= d.width &&
          f.y + f.height <= d.height &&
          f.origin[0] < f.width &&
          f.origin[1] < f.height &&
          (f.kind !== 'tile' || f.origin.every((n) => n === 0)),
      )
    ) {
      return false;
    }
    if (
      new Set(d.sequences.map((s) => s.id)).size !== d.sequences.length ||
      d.sequences.reduce((n, s) => n + s.frames.length, 0) > 1024
    ) {
      return false;
    }
    return d.sequences.every((s) => {
      const first = indexed.get(s.frames[0].frame_id);
      return (
        first &&
        s.frames.every((item) => {
          const f = indexed.get(item.frame_id);
          return (
            f &&
            f.kind === first.kind &&
            f.width === first.width &&
            f.height === first.height &&
            f.origin.every((n, i) => n === first.origin[i])
          );
        })
      );
    });
  }, 'Invalid sheet frames or sequence geometry.'),
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
