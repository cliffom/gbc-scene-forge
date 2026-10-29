/** Valibot boundary schemas with Forge's existing JSON and error semantics. */
import * as v from 'valibot';
import { record } from './decode.mts';
import type { Decoder } from './decode.mts';

export const text = v.string('Expected a string');
export const finite = v.pipe(
  v.number('Expected a finite number'),
  v.finite('Expected a finite number'),
);
export const bool = v.boolean('Expected a boolean');

export function jsonObject<T extends v.ObjectEntries>(entries: T) {
  return v.pipe(
    v.unknown(),
    v.transform((value) => {
      const data = record(value);
      // Reject arrays and let value schemas handle missing fields, retaining
      // their existing error messages rather than generic missing-key errors.
      return Object.fromEntries(Object.keys(entries).map((key) => [key, data[key]]));
    }),
    v.object(entries),
  );
}
export function jsonArray<T extends v.GenericSchema>(item: T) {
  return v.array(item, 'Expected an array');
}
export function jsonDictionary<T extends v.GenericSchema>(item: T) {
  return v.pipe(
    v.unknown(),
    v.transform((value) => Object.entries(record(value))),
    jsonArray(v.tuple([text, item])),
    // v.record filters special keys. Keep all own keys safely as data.
    v.transform((entries) => Object.fromEntries(entries)),
  );
}
/** Bridge domain decoders during incremental migration; do not duplicate rules. */
export function decoded<T>(decode: Decoder<T>) {
  return v.pipe(v.unknown(), v.transform(decode));
}
export function parse<T extends v.GenericSchema>(schema: T, value: unknown): v.InferOutput<T> {
  return v.parse(schema, value, { abortEarly: true });
}
