/** Resolve fixed editor controls only when a controller is created. */
export function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const result = document.getElementById(id);
  if (!(result instanceof type)) {
    throw Error(`Missing element ${id}`);
  }
  return result;
}
export const button = (id: string) => element(id, HTMLButtonElement);
export const input = (id: string) => element(id, HTMLInputElement);
export const select = (id: string) => element(id, HTMLSelectElement);
export const form = (id: string) => element(id, HTMLFormElement);
