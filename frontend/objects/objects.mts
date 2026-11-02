/** Native scene objects and the supported Tiled custom-property types. */
import * as v from 'valibot';
import { finite, jsonArray, jsonObject, parse, text } from '../shared/schema.mts';

// Dispatch after the name so malformed booleans retain their historical type error.
export const propertySchema = v.pipe(
  jsonObject({ name: text, type: v.unknown(), value: v.unknown() }),
  v.transform(({ name, type, value }) => {
    if (type === 'string') {
      return { name, type: 'string' as const, value: parse(text, value) };
    }
    if (type === 'bool' && typeof value === 'boolean') {
      return { name, type: 'bool' as const, value };
    }
    if (type === 'int' || type === 'float') {
      return {
        name,
        type: type === 'int' ? ('int' as const) : ('float' as const),
        value: parse(finite, value),
      };
    }
    throw Error('Unsupported property type.');
  }),
);
export type ObjectProperty = v.InferOutput<typeof propertySchema>;
// Authoring input remains independent of the wire object (notably string IDs and kind).
export type NewObject = {
  name: string;
  class: string;
  x: number;
  y: number;
  properties: ObjectProperty[];
  definition?: string;
} & (
  | { kind: 'sprite'; asset: string; origin?: [number, number] }
  | { kind: 'point' }
  | { kind: 'rectangle'; width: number; height: number }
);
export interface ObjectRegion {
  width: number;
  height: number;
  origin: [number, number];
}
export function propertyValue(type: string, raw: string | boolean): ObjectProperty['value'] {
  if (type === 'string') {
    return String(raw);
  }
  if (type === 'bool' && typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    throw Error('Enter a property value.');
  }
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER ||
    (type === 'int' && !Number.isSafeInteger(value)) ||
    !['int', 'float'].includes(type)
  ) {
    throw Error('Enter a finite number; integer properties need a whole safe integer.');
  }
  return value;
}
export function decodeProperty(value: unknown): ObjectProperty {
  return parse(propertySchema, value);
}
export function validateProperties(properties: ObjectProperty[], limit = 256) {
  if (properties.length > limit) {
    throw Error(`Use at most ${limit} properties.`);
  }
  const names = new Set<string>();
  for (const prop of properties) {
    if (
      !prop.name.trim() ||
      prop.name.length > 100 ||
      prop.name.startsWith('forge:') ||
      names.has(prop.name)
    ) {
      throw Error('Property names must be unique, nonempty and not start with forge:');
    }
    names.add(prop.name);
    if (prop.type === 'string' && prop.value.length > 4096) {
      throw Error('Property text must be at most 4096 characters.');
    }
    propertyValue(prop.type, prop.type === 'bool' ? prop.value : String(prop.value));
  }
}
const originSchema = v.pipe(
  jsonArray(finite),
  v.length(2, 'Invalid sprite origin.'),
  v.transform((origin): [number, number] => [origin[0], origin[1]]),
);
export const objectSchema = v.pipe(
  jsonObject({
    id: v.pipe(finite, v.transform(String)),
    x: finite,
    y: finite,
    name: v.nullish(text, ''),
    class: v.nullish(text, ''),
    properties: v.nullish(jsonArray(propertySchema), []),
    definition: v.optional(text),
    kind: v.unknown(),
    width: v.unknown(),
    height: v.unknown(),
    origin: v.unknown(),
    asset: v.unknown(),
  }),
  v.transform(({ kind, width, height, origin, asset, definition, ...fields }) => {
    const common = { ...fields, ...(definition === undefined ? {} : { definition }) };
    if (kind === 'point') {
      return { ...common, kind: 'point' as const };
    }
    if (kind === 'rectangle') {
      return {
        ...common,
        kind: 'rectangle' as const,
        ...parse(jsonObject({ width: finite, height: finite }), { width, height }),
      };
    }
    if (kind !== undefined) {
      throw Error('Unsupported object kind.');
    }
    // Origin precedes asset validation, including checking all elements before length.
    const parsedOrigin = origin === undefined ? undefined : parse(originSchema, origin);
    return {
      ...common,
      kind: 'sprite' as const,
      asset: parse(text, asset),
      ...(parsedOrigin ? { origin: parsedOrigin } : {}),
    };
  }),
);
export type SceneObject = v.InferOutput<typeof objectSchema>;
export function decodeObject(value: unknown): SceneObject {
  return parse(objectSchema, value);
}
export function encodeObject(item: SceneObject) {
  return {
    id: Number(item.id),
    ...(item.definition ? { definition: item.definition } : {}),
    x: item.x,
    y: item.y,
    ...(item.name ? { name: item.name } : {}),
    ...(item.class ? { class: item.class } : {}),
    ...(item.properties.length ? { properties: item.properties } : {}),
    ...(item.kind === 'sprite'
      ? { asset: item.asset, ...(item.origin ? { origin: item.origin } : {}) }
      : item.kind === 'point'
        ? { kind: 'point' }
        : { kind: 'rectangle', width: item.width, height: item.height }),
  };
}
export function objectBounds(item: SceneObject, region?: ObjectRegion) {
  if (item.kind === 'point') {
    return { x: item.x - 4, y: item.y - 4, width: 8, height: 8 };
  }
  if (item.kind === 'rectangle') {
    return { x: item.x, y: item.y, width: item.width, height: item.height };
  }
  if (!region) {
    throw Error(`Missing sprite asset ${item.asset}.`);
  }
  const origin = item.origin || region.origin;
  return {
    x: item.x - origin[0],
    y: item.y - origin[1],
    width: region.width,
    height: region.height,
  };
}
export function validateObject(
  item: SceneObject,
  width: number,
  height: number,
  region?: ObjectRegion,
) {
  if (
    !Number.isSafeInteger(Number(item.id)) ||
    Number(item.id) < 1 ||
    Number(item.id) > 2147483646
  ) {
    throw Error('Invalid object ID.');
  }
  if (
    ![item.x, item.y].every(Number.isInteger) ||
    item.x < 0 ||
    item.y < 0 ||
    item.x >= width ||
    item.y >= height
  ) {
    throw Error('Object position must be at whole pixels inside the scene.');
  }
  if (item.name.length > 100 || item.class.length > 100) {
    throw Error('Object name and class must be at most 100 characters.');
  }
  if (
    item.definition !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.definition)
  ) {
    throw Error('Invalid object definition identity.');
  }
  validateProperties(item.properties, item.definition === undefined ? 256 : 128);
  if (
    item.kind === 'rectangle' &&
    (!Number.isInteger(item.width) ||
      !Number.isInteger(item.height) ||
      item.width < 1 ||
      item.height < 1 ||
      item.x + item.width > width ||
      item.y + item.height > height)
  ) {
    throw Error('Rectangle dimensions must be positive whole pixels inside the scene.');
  }
  if (item.kind === 'sprite') {
    if (!region) {
      throw Error(`Missing sprite asset ${item.asset}.`);
    }
    if (
      item.origin &&
      (!item.origin.every(Number.isInteger) ||
        item.origin[0] < 0 ||
        item.origin[1] < 0 ||
        item.origin[0] > region.width ||
        item.origin[1] > region.height)
    ) {
      throw Error('Sprite origin must be inside its native bounds (including edges).');
    }
  }
}
