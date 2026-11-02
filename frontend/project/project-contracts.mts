import { validDimensions } from '../scene/dimensions.mts';
/** Runtime-validated native catalog and saved-scene contracts. */
import * as v from 'valibot';
import { array, record } from '../shared/decode.mts';
import {
  bool,
  decoded,
  finite,
  jsonArray,
  jsonDictionary,
  jsonObject,
  parse,
  text,
} from '../shared/schema.mts';
import type { SceneLayer } from '../scene/layers.mts';
import { definitionsSchema } from '../objects/object-definitions.mts';
import { objectSchema } from '../objects/objects.mts';
import { paletteProfileSchema } from '../diagnostics/palette-budget.mts';
import { metadataSetsSchema } from '../artwork/tile-metadata.mts';
import { decodeWorld } from '../world/world.mts';

const cellsSchema = jsonArray(
  jsonArray(
    v.pipe(
      text,
      v.transform((cell) => cell || 'empty'),
    ),
  ),
);
const objectsSchema = jsonArray(objectSchema);
const layerSchema = v.pipe(
  jsonObject({
    id: finite,
    name: text,
    visible: bool,
    type: v.unknown(),
    cells: v.unknown(),
    objects: v.unknown(),
  }),
  v.transform((layer): SceneLayer => {
    const common = { id: layer.id, name: layer.name, visible: layer.visible };
    if (layer.type === 'tilelayer') {
      return { ...common, type: 'tilelayer', cells: parse(cellsSchema, layer.cells) };
    }
    if (layer.type !== 'objectgroup') {
      throw Error('Unsupported layer type');
    }
    return {
      ...common,
      type: 'objectgroup',
      objects: parse(objectsSchema, layer.objects),
    };
  }),
);
const sceneSchema = v.pipe(
  v.unknown(),
  v.transform((value): unknown => {
    const scene = record(value);
    // Normalize the older flat scene before validating the common layer shape.
    return {
      ...scene,
      layers:
        scene.layers === undefined
          ? [
              { id: 1, name: 'Ground', type: 'tilelayer', visible: true, cells: scene.cells },
              {
                id: 2,
                name: 'Sprites',
                type: 'objectgroup',
                visible: true,
                objects: scene.objects ?? [],
              },
            ]
          : scene.layers,
    };
  }),
  jsonObject({
    width: finite,
    height: finite,
    grid: finite,
    layers: jsonArray(layerSchema),
    next_layer_id: v.nullish(finite, 3),
    next_object_id: v.nullish(finite, 1),
  }),
  v.transform((scene) => ({
    width: scene.width,
    height: scene.height,
    grid: scene.grid,
    layers: scene.layers,
    nextLayerId: scene.next_layer_id,
    nextObjectId: scene.next_object_id,
  })),
  v.check(
    (scene) =>
      validDimensions(scene.width, scene.height, scene.grid) &&
      scene.layers.length > 0 &&
      scene.layers.every(
        (layer) =>
          layer.type !== 'tilelayer' ||
          (layer.cells.length === scene.height &&
            layer.cells.every((row) => row.length === scene.width)),
      ),
    'Invalid scene response',
  ),
);
const loadedSchema = v.pipe(
  v.unknown(),
  v.transform((value): unknown => {
    const data = record(value);
    // The scene envelope was checked before identity fields in the original decoder.
    return { ...data, scene: record(data.scene) };
  }),
  jsonObject({ id: text, name: text, revision: text, scene: sceneSchema }),
  v.transform(({ id, name, revision, scene }) => ({ id, name, revision, ...scene })),
);
export type Loaded = v.InferOutput<typeof loadedSchema>;
export function decodeLoaded(value: unknown): Loaded {
  return parse(loadedSchema, value);
}

const originSchema = v.pipe(
  v.nullish(jsonArray(finite), [0, 0]),
  v.length(2, 'Invalid region origin'),
  v.transform((origin): [number, number] => [origin[0], origin[1]]),
);
const regionSchema = jsonObject({
  origin: originSchema,
  name: text,
  kind: text,
  x: finite,
  y: finite,
  width: finite,
  height: finite,
});
export type Region = v.InferOutput<typeof regionSchema>;

function manifestSchema(regions: unknown) {
  const frameSchema = v.pipe(
    v.unknown(),
    v.transform((value): unknown => {
      const frame = record(value);
      const region = array(regions, record).find((region) => region.name === frame.region);
      return { region: frame.region, duration: frame.duration_ms ?? region?.duration_ms };
    }),
    jsonObject({ region: text, duration: finite }),
  );
  return jsonObject({
    animations: v.nullish(
      jsonArray(jsonObject({ name: text, frames: jsonArray(frameSchema) })),
      [],
    ),
    regions: jsonArray(regionSchema),
  });
}
const atlasSchema = v.pipe(
  jsonObject({
    tiles: jsonDictionary(jsonDictionary(finite)),
    png: text,
    metadata: metadataSetsSchema,
    manifest: decoded((value) => {
      const manifest = record(value);
      return parse(manifestSchema(manifest.regions), manifest);
    }),
  }),
  v.transform(({ tiles, png, metadata, manifest }) => ({
    png,
    metadata,
    mappings: tiles,
    animations: manifest.animations,
    regions: manifest.regions,
  })),
);
export type Atlas = v.InferOutput<typeof atlasSchema>;

const stampSchema = decoded((value) => {
  const stamp = record(value);
  const loaded = decodeLoaded({ id: stamp.id, name: stamp.name, revision: '', scene: stamp.scene });
  return {
    id: loaded.id,
    name: loaded.name,
    slots: parse(jsonArray(finite), stamp.slots),
    scene: {
      width: loaded.width,
      height: loaded.height,
      grid: loaded.grid,
      layers: loaded.layers,
      next_layer_id: loaded.nextLayerId,
      next_object_id: loaded.nextObjectId,
    },
  };
});
const projectSchema = v.pipe(
  jsonObject({
    // Preserve validation order: artwork is decoded before the catalog identity.
    atlases: jsonDictionary(atlasSchema),
    id: text,
    name: text,
    gbc_palette_profile: paletteProfileSchema,
    object_definitions: definitionsSchema,
    world: decoded(decodeWorld),
    stamps: v.nullish(jsonArray(stampSchema), []),
    scenes: jsonArray(jsonObject({ id: text, name: text })),
  }),
  v.transform((project) => ({
    id: project.id,
    name: project.name,
    paletteProfile: project.gbc_palette_profile,
    definitions: project.object_definitions,
    world: project.world,
    stamps: project.stamps.map(({ id, name, slots, scene }) => ({
      id,
      name,
      composition: { project: project.id, slots, scene },
    })),
    atlases: project.atlases,
    scenes: project.scenes,
  })),
);
export type Project = v.InferOutput<typeof projectSchema>;
export function decodeProject(value: unknown): Project {
  return parse(projectSchema, value);
}
