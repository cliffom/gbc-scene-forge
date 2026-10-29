/** Portable world metadata and deterministic endpoint diagnostics. */
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
export interface WorldMarker {
  id: number;
  name: string;
  layer: number;
  visible: boolean;
  x: number;
  y: number;
  errors: { code: string; field: string }[];
}
export interface WorldScene {
  id: string;
  name: string;
  revision: string;
  width: number;
  height: number;
  grid: number;
  objects: WorldMarker[];
}
export interface WorldSnapshot {
  scenes: WorldScene[];
  revisions: Record<string, string>;
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
export function decodeWorldSnapshot(value: unknown): WorldSnapshot {
  const data = record(value);
  return {
    revisions: Object.fromEntries(
      Object.entries(record(data.scene_revisions)).map(([id, v]) => [id, string(v)]),
    ),
    scenes: array(data.scenes, (value) => {
      const s = record(value);
      return {
        id: string(s.id),
        name: string(s.name),
        revision: string(s.revision),
        width: number(s.width),
        height: number(s.height),
        grid: number(s.grid),
        objects: array(s.objects, (value) => {
          const o = record(value);
          return {
            id: number(o.id),
            name: string(o.name),
            layer: number(o.layer),
            visible: o.visible === true,
            x: number(o.x),
            y: number(o.y),
            errors: array(o.errors, (value) => {
              const e = record(value);
              return { code: string(e.code), field: string(e.field) };
            }),
          };
        }),
      };
    }),
  };
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
