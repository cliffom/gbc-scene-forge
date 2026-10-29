import { EditorLifetime } from './editor-lifetime.mts';
/** Blockout controls and revision-matched, read-only SVG review. */
import { blockoutDefinitions, cameraAxis, definitionRole } from './blockout.mts';
import { number, record, string } from './decode.mts';
import type { ObjectDefinition } from './object-definitions.mts';
import type { SceneObject } from './objects.mts';
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) {
    throw Error(`Missing blockout element ${id}`);
  }
  return value;
}
const button = (id: string) => element(id, HTMLButtonElement);
const input = (id: string) => element(id, HTMLInputElement);
const select = (id: string) => element(id, HTMLSelectElement);
export interface BlockoutContext {
  definitions: ObjectDefinition[];
  cameras: { item: SceneObject; scrollX: boolean; scrollY: boolean }[];
  width: number;
  height: number;
  grid: number;
  busy: boolean;
  hasScene: boolean;
}
export function createBlockoutView(
  context: () => BlockoutContext,
  create: (name: string, options: Record<string, unknown>) => void,
  choose: (definition: ObjectDefinition) => void,
  camera: (id: string, edit: boolean) => void,
  review: (id: string) => void,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const createDialog = element('create-blockout-dialog', HTMLDialogElement);
  const reviewDialog = element('blockout-review-dialog', HTMLDialogElement);
  let urls: string[] = [];
  function revokePreviews() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
  }
  lifetime.cleanup(revokePreviews);
  let signature = '';
  let cameraDefaults = '';
  let pendingCreate = false;
  function showCreate() {
    if (context().busy) {
      pendingCreate = true;
      return;
    }
    if (document.querySelector('dialog[open]')) {
      return;
    }
    const definition = blockoutDefinitions(context().definitions).find(
      (d) => definitionRole(d) === 'camera' && d.kind === 'rectangle',
    );
    const signature = JSON.stringify(definition);
    if (definition && signature !== cameraDefaults) {
      cameraDefaults = signature;
      input('blockout-camera-width').value = String(definition.width ?? 160);
      input('blockout-camera-height').value = String(definition.height ?? 136);
      input('blockout-scroll-x').checked =
        definition.fields.find((f) => f.name === 'scroll_x')?.default !== false;
      input('blockout-scroll-y').checked =
        definition.fields.find((f) => f.name === 'scroll_y')?.default === true;
      dimensions();
    }
    createDialog.showModal();
  }
  lifetime.assign(button('show-blockout-create'), 'onclick', showCreate);
  lifetime.assign(button('blockout-new-scene'), 'onclick', showCreate);
  lifetime.assign(button('blockout-create-cancel'), 'onclick', () => createDialog.close());
  lifetime.assign(element('blockout-scene-form', HTMLFormElement), 'onsubmit', (event) => {
    event.preventDefault();
    create(input('blockout-title').value, {
      width: Number(input('blockout-width').value),
      height: Number(input('blockout-height').value),
      units: select('blockout-units').value,
      grid: Number(select('blockout-grid').value),
      camera_width: Number(input('blockout-camera-width').value),
      camera_height: Number(input('blockout-camera-height').value),
      scroll_x: input('blockout-scroll-x').checked,
      scroll_y: input('blockout-scroll-y').checked,
    });
  });
  let units = 'pixels';
  lifetime.assign(select('blockout-units'), 'onchange', () => {
    const next = select('blockout-units').value;
    if (next !== units) {
      const factor = Number(select('blockout-grid').value);
      for (const id of ['blockout-width', 'blockout-height']) {
        input(id).value = String(
          Number(input(id).value) * (next === 'pixels' ? factor : 1 / factor),
        );
      }
      units = next;
    }
    dimensions();
  });
  function dimensions() {
    const grid = Number(select('blockout-grid').value),
      factor = select('blockout-units').value === 'pixels' ? 1 : grid;
    const width = Number(input('blockout-width').value) * factor,
      height = Number(input('blockout-height').value) * factor;
    for (const id of ['blockout-width', 'blockout-height']) {
      input(id).max = factor === 1 ? '8192' : '256';
    }
    const cw = Number(input('blockout-camera-width').value),
      ch = Number(input('blockout-camera-height').value);
    element('blockout-create-metrics', HTMLElement).textContent =
      cw > 0 && ch > 0
        ? `${width} × ${height}px · ${width / grid} × ${height / grid} cells · ${(width / cw).toFixed(2)} horizontal × ${(height / ch).toFixed(2)} vertical screens`
        : 'Enter positive camera dimensions.';
  }
  for (const id of [
    'blockout-width',
    'blockout-height',
    'blockout-camera-width',
    'blockout-camera-height',
  ]) {
    lifetime.assign(input(id), 'oninput', dimensions);
  }
  lifetime.assign(select('blockout-grid'), 'onchange', dimensions);
  dimensions();
  lifetime.assign(button('blockout-customize'), 'onclick', () =>
    button('manage-definitions').click(),
  );
  lifetime.assign(button('blockout-camera-select'), 'onclick', () =>
    camera(select('blockout-cameras').value, false),
  );
  lifetime.assign(button('blockout-camera-edit'), 'onclick', () =>
    camera(select('blockout-cameras').value, true),
  );
  lifetime.assign(button('blockout-review'), 'onclick', () =>
    review(select('blockout-cameras').value),
  );
  lifetime.assign(button('blockout-review-close'), 'onclick', () => reviewDialog.close());
  reviewDialog.addEventListener('close', revokePreviews, { signal: lifetime.signal });
  function sync() {
    const state = context();
    const definitions = blockoutDefinitions(state.definitions);
    const next = JSON.stringify(definitions);
    if (next !== signature) {
      signature = next;
      const list = element('blockout-presets', HTMLElement);
      list.replaceChildren();
      for (const d of definitions) {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = d.name;
        item.dataset.definition = d.id;
        item.dataset.blockoutRole = definitionRole(d);
        const symbol = d.fields.find((f) => f.name === 'blockout_symbol')?.default;
        const badge = document.createElement('span');
        badge.className = 'preset-symbol';
        badge.textContent = String(symbol ?? '◇');
        badge.setAttribute('aria-hidden', 'true');
        const color = d.fields.find((f) => f.name === 'blockout_color')?.default;
        if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
          badge.style.color = color;
        }
        item.prepend(badge);
        lifetime.assign(item, 'onclick', () => choose(d));
        list.append(item);
      }
    }
    for (const control of element('blockout-presets', HTMLElement).querySelectorAll('button')) {
      control.disabled = state.busy || !state.hasScene;
    }
    const cameras = select('blockout-cameras'),
      previous = cameras.value;
    const cameraSignature = JSON.stringify(state.cameras.map((c) => [c.item.id, c.item.name]));
    if (cameras.dataset.signature !== cameraSignature) {
      cameras.dataset.signature = cameraSignature;
      cameras.replaceChildren(
        ...state.cameras.map((c) => new Option(c.item.name || `Camera #${c.item.id}`, c.item.id)),
      );
      if (state.cameras.some((c) => c.item.id === previous)) {
        cameras.value = previous;
      }
    }
    cameras.disabled = state.busy || !state.cameras.length;
    const active = state.cameras.find((c) => c.item.id === cameras.value)?.item;
    const metrics = element('blockout-metrics', HTMLElement);
    metrics.textContent =
      active?.kind === 'rectangle'
        ? `${state.width} × ${state.height}px · ${state.width / state.grid} × ${state.height / state.grid} cells · ${(state.width / active.width).toFixed(2)} × ${(state.height / active.height).toFixed(2)} screens`
        : 'Create a blockout scene or show a camera guide to review its framing.';
    for (const id of ['blockout-camera-select', 'blockout-camera-edit', 'blockout-review']) {
      button(id).disabled = state.busy || !active;
    }
    for (const id of ['show-blockout-create', 'blockout-new-scene', 'blockout-customize']) {
      button(id).disabled = state.busy;
    }
    for (const control of element('blockout-scene-form', HTMLFormElement).querySelectorAll(
      'button,input,select',
    )) {
      if (
        control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement
      ) {
        control.disabled = state.busy;
      }
    }
    if (pendingCreate && !state.busy) {
      pendingCreate = false;
      showCreate();
    }
  }
  lifetime.assign(select('blockout-cameras'), 'onchange', sync);
  return {
    sync,
    showCreate,
    closeCreate() {
      createDialog.close();
    },
    present(value: unknown) {
      if (lifetime.disposed) {
        return;
      }
      const data = record(value);
      revokePreviews();
      for (const [key, target, download] of [
        ['overview_svg', 'blockout-overview-image', 'blockout-overview-download'],
        ['camera_svg', 'blockout-camera-image', 'blockout-camera-download'],
      ]) {
        const url = URL.createObjectURL(new Blob([string(data[key])], { type: 'image/svg+xml' }));
        urls.push(url);
        element(target, HTMLImageElement).src = url;
        element(download, HTMLAnchorElement).href = url;
      }
      const camera = record(data.camera),
        properties = record(data.camera_properties);
      element('blockout-review-summary', HTMLElement).textContent =
        `${number(data.width)} × ${number(data.height)}px · ${number(data.screens_x).toFixed(2)} × ${number(data.screens_y).toFixed(2)} screens · camera ${number(camera.width)} × ${number(camera.height)}px at ${number(camera.x)}, ${number(camera.y)} · X ${cameraAxis(properties.scroll_x) === 'scroll' ? 'scrolls' : cameraAxis(properties.scroll_x)} / Y ${cameraAxis(properties.scroll_y) === 'scroll' ? 'scrolls' : cameraAxis(properties.scroll_y)}`;
      // Parse identities as part of the response contract, without injecting SVG markup into the DOM.
      string(data.project_revision);
      string(data.scene_revision);
      if (!reviewDialog.open) {
        reviewDialog.showModal();
      }
    },
  };
}
