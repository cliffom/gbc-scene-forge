/** Standalone project controller for atlas, layer and object authoring. */
import type { SpriteAnimation } from './animation-preview.mts';
import type { Composition } from './compositions.mts';
import { array, boolean, number, record, string } from './decode.mts';
import type { SceneLayer } from './layers.mts';
import type { ObjectDefinition } from './object-definitions.mts';
import { decodeDefinitions } from './object-definitions.mts';
import { decodeObject } from './objects.mts';
import type { PaletteProfile } from './palette-budget.mts';
import { decodePaletteProfile } from './palette-budget.mts';
import type { MetadataSets } from './tile-metadata.mts';
import { decodeMetadataSets } from './tile-metadata.mts';
import type { World } from './world.mts';
import { decodeWorld } from './world.mts';

export interface Region {
  name: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  origin: [number, number];
}
export interface Atlas {
  png: string;
  regions: Region[];
  mappings: Record<string, Record<string, number>>;
  animations: SpriteAnimation[];
  metadata: MetadataSets;
}
export interface Project {
  id: string;
  name: string;
  paletteProfile: PaletteProfile | null;
  definitions: ObjectDefinition[];
  world: World;
  stamps: { id: string; name: string; composition: Composition }[];
  scenes: { id: string; name: string }[];
  atlases: Record<string, Atlas>;
}
export interface Loaded {
  id: string;
  name: string;
  revision: string;
  width: number;
  height: number;
  grid: number;
  layers: SceneLayer[];
  nextLayerId: number;
  nextObjectId: number;
}
export function decodeLoaded(value: unknown): Loaded {
  const data = record(value);
  const scene = record(data.scene);
  const result = {
    id: string(data.id),
    name: string(data.name),
    revision: string(data.revision),
    width: number(scene.width),
    height: number(scene.height),
    grid: number(scene.grid),
    layers:
      scene.layers === undefined
        ? [
            {
              id: 1,
              name: 'Ground',
              type: 'tilelayer' as const,
              visible: true,
              cells: array(scene.cells, (row) => array(row, string)).map((row) =>
                row.map((cell) => cell || 'empty'),
              ),
            },
            {
              id: 2,
              name: 'Sprites',
              type: 'objectgroup' as const,
              visible: true,
              objects: array(scene.objects ?? [], decodeObject),
            },
          ]
        : array(scene.layers, (value): SceneLayer => {
            const layer = record(value);
            const common = {
              id: number(layer.id),
              name: string(layer.name),
              visible: boolean(layer.visible),
            };
            if (layer.type === 'tilelayer') {
              return {
                ...common,
                type: 'tilelayer',
                cells: array(layer.cells, (row) => array(row, string)).map((row) =>
                  row.map((cell) => cell || 'empty'),
                ),
              };
            }
            if (layer.type !== 'objectgroup') {
              throw Error('Unsupported layer type');
            }
            return {
              ...common,
              type: 'objectgroup',
              objects: array(layer.objects, decodeObject),
            };
          }),
    nextLayerId: number(scene.next_layer_id ?? 3),
    nextObjectId: number(scene.next_object_id ?? 1),
  };
  if (
    !Number.isInteger(result.width) ||
    !Number.isInteger(result.height) ||
    result.width < 1 ||
    result.width > 256 ||
    result.height < 1 ||
    result.height > 256 ||
    ![8, 16, 32].includes(result.grid) ||
    !result.layers.length ||
    result.layers.some(
      (layer) =>
        layer.type === 'tilelayer' &&
        (layer.cells.length !== result.height ||
          layer.cells.some((row) => row.length !== result.width)),
    )
  ) {
    throw Error('Invalid scene response');
  }
  return result;
}
export function decodeProject(value: unknown): Project {
  const data = record(value);
  const atlases: Record<string, Atlas> = {};
  for (const [id, item] of Object.entries(record(data.atlases))) {
    const entry = record(item);
    const mappings: Record<string, Record<string, number>> = {};
    for (const [grid, map] of Object.entries(record(entry.tiles))) {
      mappings[grid] = Object.fromEntries(
        Object.entries(record(map)).map(([k, v]) => [k, number(v)]),
      );
    }
    atlases[id] = {
      png: string(entry.png),
      metadata: decodeMetadataSets(entry.metadata),
      mappings,
      animations: array(record(entry.manifest).animations ?? [], (value) => {
        const animation = record(value);
        return {
          name: string(animation.name),
          frames: array(animation.frames, (value) => {
            const frame = record(value);
            const region = array(record(entry.manifest).regions, record).find(
              (region) => region.name === frame.region,
            );
            return {
              region: string(frame.region),
              duration: number(frame.duration_ms ?? region?.duration_ms),
            };
          }),
        };
      }),
      regions: array(record(entry.manifest).regions, (value) => {
        const r = record(value);
        const origin = array(r.origin ?? [0, 0], number);
        if (origin.length !== 2) {
          throw Error('Invalid region origin');
        }
        return {
          name: string(r.name),
          kind: string(r.kind),
          x: number(r.x),
          y: number(r.y),
          width: number(r.width),
          height: number(r.height),
          origin: [origin[0], origin[1]],
        };
      }),
    };
  }
  return {
    id: string(data.id),
    name: string(data.name),
    paletteProfile: decodePaletteProfile(data.gbc_palette_profile),
    definitions: decodeDefinitions(data.object_definitions),
    world: decodeWorld(data.world),
    stamps: array(data.stamps ?? [], (value) => {
      const stamp = record(value);
      const loaded = decodeLoaded({
        id: stamp.id,
        name: stamp.name,
        revision: '',
        scene: stamp.scene,
      });
      return {
        id: string(stamp.id),
        name: string(stamp.name),
        composition: {
          project: string(data.id),
          slots: array(stamp.slots, number),
          scene: {
            width: loaded.width,
            height: loaded.height,
            grid: loaded.grid,
            layers: loaded.layers,
            next_layer_id: loaded.nextLayerId,
            next_object_id: loaded.nextObjectId,
          },
        },
      };
    }),
    atlases,
    scenes: array(data.scenes, (value) => {
      const scene = record(value);
      return { id: string(scene.id), name: string(scene.name) };
    }),
  };
}
