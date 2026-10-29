/** Native scene objects and the supported Tiled custom-property types. */
import { array, number, record, string } from '../shared/decode.mts';

export type ObjectProperty = { name: string } & (
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'int' | 'float'; value: number }
);
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
export type SceneObject = NewObject & { id: string };
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
  const prop = record(value),
    name = string(prop.name);
  if (prop.type === 'string') {
    return { name, type: 'string', value: string(prop.value) };
  }
  if (prop.type === 'bool' && typeof prop.value === 'boolean') {
    return { name, type: 'bool', value: prop.value };
  }
  if (prop.type === 'int' || prop.type === 'float') {
    return { name, type: prop.type, value: number(prop.value) };
  }
  throw Error('Unsupported property type.');
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
export function decodeObject(value: unknown): SceneObject {
  const item = record(value);
  const common = {
    id: String(number(item.id)),
    x: number(item.x),
    y: number(item.y),
    name: string(item.name ?? ''),
    class: string(item.class ?? ''),
    properties: array(item.properties ?? [], decodeProperty),
    ...(item.definition === undefined ? {} : { definition: string(item.definition) }),
  };
  if (item.kind === 'point') {
    return { ...common, kind: 'point' };
  }
  if (item.kind === 'rectangle') {
    return { ...common, kind: 'rectangle', width: number(item.width), height: number(item.height) };
  }
  if (item.kind !== undefined) {
    throw Error('Unsupported object kind.');
  }
  const origin = item.origin === undefined ? undefined : array(item.origin, number);
  if (origin && origin.length !== 2) {
    throw Error('Invalid sprite origin.');
  }
  return {
    ...common,
    kind: 'sprite',
    asset: string(item.asset),
    ...(origin ? { origin: [origin[0], origin[1]] } : {}),
  };
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
