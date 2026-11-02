/** Project-owned definitions; scene properties contain explicit overrides only. */
import * as v from 'valibot';
import { bool, finite, jsonArray, jsonObject, parse, text } from '../shared/schema.mts';
import type { NewObject, ObjectProperty, SceneObject } from './objects.mts';
import { decodeProperty } from './objects.mts';

const fieldSchema = v.pipe(
  jsonObject({
    type: v.pipe(text, v.picklist(['string', 'int', 'float', 'bool'], 'Invalid field type.')),
    name: text,
    required: bool,
    default: v.unknown(),
    min: v.unknown(),
    max: v.unknown(),
    choices: v.unknown(),
  }),
  v.transform(({ type, name, required, default: value, min, max, choices }) => ({
    name,
    type,
    required,
    ...(value === undefined ? {} : { default: decodeProperty({ name, type, value }).value }),
    ...(min === undefined ? {} : { min: parse(finite, min) }),
    ...(max === undefined ? {} : { max: parse(finite, max) }),
    ...(choices === undefined ? {} : { choices: parse(jsonArray(text), choices) }),
  })),
);
export type DefinitionField = v.InferOutput<typeof fieldSchema>;
const definitionSchema = v.pipe(
  jsonObject({
    kind: v.pipe(text, v.picklist(['point', 'rectangle', 'sprite'], 'Invalid definition kind.')),
    id: text,
    name: text,
    asset: v.optional(text),
    width: v.unknown(),
    height: v.unknown(),
    fields: v.unknown(),
  }),
  v.transform(({ width, height, fields, asset, ...common }) => ({
    ...common,
    ...(asset === undefined ? {} : { asset }),
    ...(width === undefined
      ? {}
      : parse(jsonObject({ width: finite, height: finite }), { width, height })),
    fields: parse(jsonArray(fieldSchema), fields),
  })),
);
export type ObjectDefinition = v.InferOutput<typeof definitionSchema>;
const librarySchema = jsonObject({
  version: v.literal(1, 'Unsupported object definition library version.'),
  definitions: jsonArray(definitionSchema),
});
export const definitionsSchema = v.pipe(
  v.unknown(),
  v.transform((value) => (value === undefined ? [] : parse(librarySchema, value).definitions)),
);
export interface DefinitionFinding {
  field: string;
  code: string;
}
export function objectKind(value: unknown): SceneObject['kind'] {
  if (value === 'point' || value === 'rectangle' || value === 'sprite') {
    return value;
  }
  throw Error('Invalid definition kind.');
}
export function fieldType(value: unknown): DefinitionField['type'] {
  if (value === 'string' || value === 'int' || value === 'float' || value === 'bool') {
    return value;
  }
  throw Error('Invalid field type.');
}
export function decodeDefinitions(value: unknown): ObjectDefinition[] {
  return parse(definitionsSchema, value);
}
export function resolveDefinition(item: SceneObject, definitions: ObjectDefinition[]) {
  const overrides = new Map(item.properties.map((p) => [p.name, structuredClone(p)]));
  const findings: DefinitionFinding[] = [];
  const effective = new Map<string, ObjectProperty>();
  if (!item.definition) {
    return { properties: [...overrides.values()], findings };
  }
  const definition = definitions.find((d) => d.id === item.definition);
  if (!definition) {
    return {
      properties: [...overrides.values()],
      findings: [{ field: '', code: 'missing-definition' }],
    };
  }
  if (item.kind !== definition.kind) {
    findings.push({ field: '', code: 'kind' });
  }
  const fields = new Set(definition.fields.map((f) => f.name));
  for (const f of definition.fields) {
    const prop =
      overrides.get(f.name) ??
      (f.default === undefined
        ? undefined
        : decodeProperty({ name: f.name, type: f.type, value: f.default }));
    if (!prop) {
      if (f.required) {
        findings.push({ field: f.name, code: 'required' });
      }
      continue;
    }
    effective.set(f.name, prop);
    if (prop.type !== f.type) {
      findings.push({ field: f.name, code: 'type' });
      continue;
    }
    if (f.required && prop.value === '') {
      findings.push({ field: f.name, code: 'required' });
    }
    if (f.min !== undefined && typeof prop.value === 'number' && prop.value < f.min) {
      findings.push({ field: f.name, code: 'min' });
    }
    if (f.max !== undefined && typeof prop.value === 'number' && prop.value > f.max) {
      findings.push({ field: f.name, code: 'max' });
    }
    if (f.choices && typeof prop.value === 'string' && !f.choices.includes(prop.value)) {
      findings.push({ field: f.name, code: 'choices' });
    }
  }
  for (const name of [...overrides.keys()].filter((n) => !fields.has(n)).sort()) {
    const prop = overrides.get(name);
    if (prop) {
      effective.set(name, prop);
    }
    findings.push({ field: name, code: 'unknown-field' });
  }
  return {
    properties: [...effective.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
    findings,
  };
}
export function describeFinding(
  item: SceneObject,
  finding: DefinitionFinding,
  definitions: ObjectDefinition[],
): string {
  const definition = definitions.find((d) => d.id === item.definition);
  const field = definition?.fields.find((f) => f.name === finding.field);
  switch (finding.code) {
    case 'missing-definition':
      return 'Missing definition. Choose a definition or detach this object.';
    case 'kind':
      return `Definition expects ${definition?.kind ?? 'another shape'}; this object is ${item.kind}.`;
    case 'required':
      return 'Required value is missing.';
    case 'type':
      return `Override must use type ${field?.type ?? 'from the definition'}. Edit or reset it.`;
    case 'min':
      return `Value must be at least ${field?.min}.`;
    case 'max':
      return `Value must be at most ${field?.max}.`;
    case 'choices':
      return 'Value is outside the allowed choices. Edit or reset it.';
    case 'unknown-field':
      return 'Field is no longer defined. Remove or rename its override.';
    default:
      return finding.code;
  }
}
export function definitionInstance(d: ObjectDefinition, x: number, y: number): NewObject {
  const common = { definition: d.id, name: '', class: d.name, x, y, properties: [] };
  if (d.kind === 'sprite') {
    if (!d.asset) {
      throw Error('Definition needs a sprite asset.');
    }
    return { ...common, kind: 'sprite', asset: d.asset };
  }
  if (d.kind === 'rectangle') {
    if (d.width === undefined || d.height === undefined) {
      throw Error('Definition needs rectangle dimensions.');
    }
    return { ...common, kind: 'rectangle', width: d.width, height: d.height };
  }
  return { ...common, kind: 'point' };
}
