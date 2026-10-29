/** Runtime JSON primitives shared by supported domain contracts. */
export type Decoder<T> = (value: unknown) => T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw Error('Expected a JSON object');
  }
  return value;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') {
    throw Error('Expected a string');
  }
  return value;
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw Error('Expected a finite number');
  }
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw Error('Expected a boolean');
  }
  return value;
}
export function array<T>(value: unknown, decode: Decoder<T>): T[] {
  if (!Array.isArray(value)) {
    throw Error('Expected an array');
  }
  return value.map((item: unknown) => decode(item));
}
