/** Portable world metadata and deterministic endpoint diagnostics. */
import * as v from 'valibot';
import { array, number, record, string } from '../shared/decode.mts';
export interface Endpoint {
  scene: string;
  object: number;
}
export interface Connection {
  id: string;
  name: string;
  source: Endpoint;
  destination: Endpoint;
  direction: 'one-way' | 'two-way';
}
export interface World {
  version: 1;
  positions: Record<string, { x: number; y: number }>;
  connections: Connection[];
}
export function decodeWorld(value: unknown): World {
  if (value === undefined) {
    return { version: 1, positions: {}, connections: [] };
  }
  const data = record(value);
  if (data.version !== 1) {
    throw Error('Unsupported world version.');
  }
  const endpoint = (value: unknown): Endpoint => {
    const e = record(value);
    return { scene: string(e.scene), object: number(e.object) };
  };
  return {
    version: 1,
    positions: Object.fromEntries(
      Object.entries(record(data.positions)).map(([id, value]) => {
        const p = record(value);
        return [id, { x: number(p.x), y: number(p.y) }];
      }),
    ),
    connections: array(data.connections, (value) => {
      const link = record(value);
      if (link.direction !== 'one-way' && link.direction !== 'two-way') {
        throw Error('Invalid connection direction.');
      }
      return {
        id: string(link.id),
        name: string(link.name),
        source: endpoint(link.source),
        destination: endpoint(link.destination),
        direction: link.direction,
      };
    }),
  };
}
// Keep the existing JSON-object check and missing-field errors. Valibot's object
// schema alone accepts arrays and reports missing keys before their value schema.
function snapshotObject<T extends v.ObjectEntries>(entries: T) {
  return v.pipe(
    v.unknown(),
    v.transform((value) => {
      const data = record(value);
      return Object.fromEntries(Object.keys(entries).map((key) => [key, data[key]]));
    }),
    v.object(entries),
  );
}
const text = v.string('Expected a string');
const finite = v.pipe(v.number('Expected a finite number'), v.finite('Expected a finite number'));
const markerSchema = snapshotObject({
  id: finite,
  name: text,
  layer: finite,
  visible: v.pipe(
    v.unknown(),
    v.transform((value) => value === true),
  ),
  x: finite,
  y: finite,
  errors: v.array(snapshotObject({ code: text, field: text }), 'Expected an array'),
});
const sceneSchema = snapshotObject({
  id: text,
  name: text,
  revision: text,
  width: finite,
  height: finite,
  grid: finite,
  objects: v.array(markerSchema, 'Expected an array'),
});
const snapshotSchema = v.pipe(
  snapshotObject({
    // v.record filters special keys. Preserve the existing own-entry dictionary
    // behavior safely with Object.fromEntries, including __proto__ as data.
    scene_revisions: v.pipe(
      v.unknown(),
      v.transform((value) => Object.entries(record(value))),
      v.array(v.tuple([text, text])),
      v.transform((entries) => Object.fromEntries(entries)),
    ),
    scenes: v.array(sceneSchema, 'Expected an array'),
  }),
  v.transform(({ scene_revisions, scenes }) => ({ revisions: scene_revisions, scenes })),
);
export type WorldMarker = v.InferOutput<typeof markerSchema>;
export type WorldScene = v.InferOutput<typeof sceneSchema>;
export type WorldSnapshot = v.InferOutput<typeof snapshotSchema>;

export function decodeWorldSnapshot(value: unknown): WorldSnapshot {
  return v.parse(snapshotSchema, value, { abortEarly: true });
}
export function worldFindings(world: World, scenes: WorldScene[]) {
  return world.connections.flatMap((link) =>
    (['source', 'destination'] as const).flatMap((side) => {
      const e = link[side],
        scene = scenes.find((s) => s.id === e.scene),
        object = scene?.objects.find((o) => o.id === e.object);
      const errors = !scene
        ? [{ code: 'missing-scene', field: '' }]
        : !object
          ? [{ code: 'missing-object', field: '' }]
          : object.errors;
      return errors.map((error) => ({ connection: link.id, endpoint: side, ...e, ...error }));
    }),
  );
}
