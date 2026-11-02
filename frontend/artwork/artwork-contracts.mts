/** Native candidate wire boundary. Saved policy and digest validation stay in artwork services. */
import * as v from 'valibot';
import { parse, text } from '../shared/schema.mts';
const bounded = (min: number, max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const revision = v.pipe(text, v.regex(/^[0-9a-f]{64}$/));
const identifier = v.pipe(text, v.regex(/^[a-z][a-z0-9_]{0,63}$/));
const identity = v.pipe(text, v.uuid());
const sourceEntries = {
  atlas_id: identifier,
  region: identifier,
  grid: v.nullable(v.picklist([8, 16, 32])),
  cell: v.nullable(v.tuple([bounded(0, 2047), bounded(0, 2047)])),
  artwork_revision: revision,
};
const descriptor = v.strictObject({
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
});
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
  }),
  v.check((c) => {
    try {
      return atob(c.rgba).length === c.descriptor.width * c.descriptor.height * 4;
    } catch {
      return false;
    }
  }, 'Invalid artwork pixel count.'),
);
export type Candidate = v.InferOutput<typeof candidateSchema>;
export function decodeCandidate(value: unknown): Candidate {
  return parse(candidateSchema, value);
}
