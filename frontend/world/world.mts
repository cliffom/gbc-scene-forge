/** Portable world metadata and deterministic endpoint diagnostics. */
import * as v from 'valibot';
import { array, number, record, string } from '../shared/decode.mts';
import { finite, text, jsonObject, jsonDictionary, jsonArray, parse } from '../shared/schema.mts';
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
const markerSchema = jsonObject({
  id: finite,
  name: text,
  layer: finite,
  visible: v.pipe(
    v.unknown(),
    v.transform((value) => value === true),
  ),
  x: finite,
  y: finite,
  errors: jsonArray(jsonObject({ code: text, field: text })),
});
const sceneSchema = jsonObject({
  id: text,
  name: text,
  revision: text,
  width: finite,
  height: finite,
  grid: finite,
  objects: jsonArray(markerSchema),
});
const snapshotSchema = v.pipe(
  jsonObject({
    scene_revisions: jsonDictionary(text),
    scenes: jsonArray(sceneSchema),
  }),
  v.transform(({ scene_revisions, scenes }) => ({ revisions: scene_revisions, scenes })),
);
export type WorldMarker = v.InferOutput<typeof markerSchema>;
export type WorldScene = v.InferOutput<typeof sceneSchema>;
export type WorldSnapshot = v.InferOutput<typeof snapshotSchema>;

export function decodeWorldSnapshot(value: unknown): WorldSnapshot {
  return parse(snapshotSchema, value);
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
