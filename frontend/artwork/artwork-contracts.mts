/** Native candidate wire boundary. Saved policy and digest validation stay in artwork services. */
import * as v from 'valibot';
import {
  MAX_ARTWORK_AXIS,
  MAX_ARTWORK_PIXELS,
  MAX_RGBA_BASE64,
  GRID_UNIT,
  MAX_GRID_AXIS,
  TILE_SIZES,
  MAX_DESCRIPTOR_BYTES,
  MAX_LAYERS,
} from './artwork-limits.mts';
import {
  MAX_FRAMES,
  MAX_SEQUENCES,
  MAX_SEQUENCE_FRAMES,
  MAX_TOTAL_SEQUENCE_FRAMES,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
} from './sheet-limits.mts';
import { MAX_PLACEMENTS, MAX_SOURCE_CELL, MAX_PLACEMENT_ID } from './placement-limits.mts';
import { parse, text } from '../shared/schema.mts';
const bounded = (min: number, max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const revision = v.pipe(text, v.regex(/^[0-9a-f]{64}$/));
const identifier = v.pipe(text, v.regex(/^[a-z][a-z0-9_]{0,63}$/));
const identity = v.pipe(text, v.uuid());
const placementBase = {
  scene_id: identity,
  scene_revision: revision,
  layer_id: bounded(1, MAX_PLACEMENT_ID),
};
export const placementsSchema = v.pipe(
  v.array(
    v.union([
      v.strictObject({
        ...placementBase,
        x: bounded(0, MAX_SOURCE_CELL),
        y: bounded(0, MAX_SOURCE_CELL),
      }),
      v.strictObject({ ...placementBase, object_id: bounded(1, MAX_PLACEMENT_ID) }),
    ]),
  ),
  v.minLength(1),
  v.maxLength(MAX_PLACEMENTS),
);
export type Placement = v.InferOutput<typeof placementsSchema>[number];
const sourceEntries = {
  atlas_id: identifier,
  region: identifier,
  grid: v.nullable(v.picklist(TILE_SIZES)),
  cell: v.nullable(v.tuple([bounded(0, MAX_SOURCE_CELL), bounded(0, MAX_SOURCE_CELL)])),
  artwork_revision: revision,
};
export const layerSchema = v.strictObject({
  id: identity,
  name: v.pipe(text, v.minLength(1), v.maxLength(100)),
  visible: v.boolean(),
  locked: v.boolean(),
  opacity: bounded(0, 255),
});
export type ArtworkLayer = v.InferOutput<typeof layerSchema>;
const descriptorEntries = {
  layers: v.optional(
    v.strictObject({
      version: v.literal(1),
      items: v.pipe(v.array(layerSchema), v.minLength(1), v.maxLength(MAX_LAYERS)),
    }),
  ),
  id: identity,
  atlas_id: identifier,
  region: identifier,
  name: v.pipe(text, v.minLength(1), v.maxLength(100)),
  kind: v.picklist(['tile', 'sprite']),
  width: bounded(1, MAX_ARTWORK_AXIS),
  height: bounded(1, MAX_ARTWORK_AXIS),
  origin: v.tuple([bounded(0, MAX_ARTWORK_AXIS - 1), bounded(0, MAX_ARTWORK_AXIS - 1)]),
  pixel_format: v.literal('rgba8'),
  provenance: v.nullable(
    v.strictObject({ ...sourceEntries, project_id: identity, source_format: v.nullable(text) }),
  ),
};
export const frameSchema = v.strictObject({
  id: identifier,
  name: v.pipe(text, v.minLength(1), v.maxLength(100)),
  kind: v.picklist(['tile', 'sprite']),
  x: bounded(0, MAX_GRID_AXIS - GRID_UNIT),
  y: bounded(0, MAX_GRID_AXIS - GRID_UNIT),
  width: bounded(GRID_UNIT, MAX_GRID_AXIS),
  height: bounded(GRID_UNIT, MAX_GRID_AXIS),
  origin: v.tuple([bounded(0, MAX_GRID_AXIS - 1), bounded(0, MAX_GRID_AXIS - 1)]),
});
export const sequenceSchema = v.strictObject({
  id: identifier,
  name: v.pipe(text, v.minLength(1), v.maxLength(100)),
  loop: v.boolean(),
  frames: v.pipe(
    v.array(
      v.strictObject({
        frame_id: identifier,
        duration_ms: bounded(MIN_DURATION_MS, MAX_DURATION_MS),
      }),
    ),
    v.minLength(1),
    v.maxLength(MAX_SEQUENCE_FRAMES),
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
      frames: v.pipe(v.array(frameSchema), v.minLength(1), v.maxLength(MAX_FRAMES)),
      sequences: v.pipe(v.array(sequenceSchema), v.maxLength(MAX_SEQUENCES)),
    }),
  ]),
  v.check(
    (d) =>
      d.width * d.height * ((d.layers?.items.length ?? 0) + 1) <= MAX_ARTWORK_PIXELS &&
      (!d.layers ||
        new Set(d.layers.items.map((item) => item.id)).size === d.layers.items.length) &&
      ((d.version === 1 && d.kind === 'sprite') ||
        (d.width >= GRID_UNIT &&
          d.height >= GRID_UNIT &&
          d.width <= MAX_GRID_AXIS &&
          d.height <= MAX_GRID_AXIS &&
          d.width % GRID_UNIT === 0 &&
          d.height % GRID_UNIT === 0)) &&
      d.origin[0] < d.width &&
      d.origin[1] < d.height &&
      (d.version === 2 ||
        d.kind !== 'tile' ||
        (d.width === d.height &&
          TILE_SIZES.some((size) => size === d.width) &&
          d.origin.every((n) => n === 0))),
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
          f.x % GRID_UNIT === 0 &&
          f.y % GRID_UNIT === 0 &&
          f.width % GRID_UNIT === 0 &&
          f.height % GRID_UNIT === 0 &&
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
      d.sequences.reduce((n, s) => n + s.frames.length, 0) > MAX_TOTAL_SEQUENCE_FRAMES
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
  // Match core.serialization.record_bytes: two-space JSON, UTF-8 and a final newline.
  v.check(
    (d) =>
      new TextEncoder().encode(JSON.stringify(d, null, 2) + '\n').length <= MAX_DESCRIPTOR_BYTES,
    'Editable descriptor exceeds 64 KiB. Reduce the layout before adding more artwork or animation.',
  ),
);
export function decodeDescriptor(value: unknown) {
  return parse(descriptor, value);
}
export const candidateSchema = v.pipe(
  v.strictObject({
    version: v.literal(1),
    project_id: identity,
    document_id: identity,
    atlas_id: identifier,
    descriptor,
    rgba: v.pipe(text, v.maxLength(MAX_RGBA_BASE64)),
    revision,
    project_revision: revision,
    artwork_revision: v.nullable(revision),
    operation: v.picklist(['create', 'edit', 'duplicate']),
    source: v.nullable(v.strictObject(sourceEntries)),
    metadata: v.record(text, v.unknown()),
    placements: v.optional(placementsSchema),
    layer_rgba: v.optional(v.record(identity, v.pipe(text, v.maxLength(MAX_RGBA_BASE64)))),
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
      if (c.rgba.length !== 4 * Math.ceil((c.descriptor.width * c.descriptor.height * 4) / 3)) {
        return false;
      }
      const raw = atob(c.rgba);
      const ids = c.descriptor.layers?.items.map((item) => item.id) ?? [];
      const sources = Object.entries(c.layer_rgba ?? {});
      if (sources.length !== ids.length || !!c.layer_rgba !== !!c.descriptor.layers) {
        return false;
      }
      if (
        !sources.every(
          ([id, value]) =>
            ids.includes(id) &&
            value.length === c.rgba.length &&
            atob(value).length === raw.length &&
            btoa(atob(value)) === value,
        )
      ) {
        return false;
      }
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
