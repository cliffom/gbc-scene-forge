/** Mounted raster-layer list; PixelModel owns pixels, active identity and history. */
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import { button, element, input } from '../editor/editor-dom.mts';
import { layerDragging } from '../editor/layer-drag.mts';
import { MAX_LAYERS } from './artwork-limits.mts';
import type { PixelModel } from './pixel-model.mts';

type Layer = NonNullable<PixelModel['descriptor']['layers']>['items'][number];
const icons = {
  add: '<path d="M12 5v14M5 12h14"/>',
  remove: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0"/>',
};
function icon(path: string) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
function control<T extends HTMLElement>(row: HTMLElement, selector: string): T {
  const node = row.querySelector<T>(selector);
  if (!node) {
    throw Error('Missing layer row control: ' + selector);
  }
  return node;
}
const percentage = (opacity: number) => String(Math.round((opacity * 100) / 255));

export function createArtworkLayerControls(
  lifetime: EditorLifetime,
  ports: {
    current: () => PixelModel | null;
    busy: () => boolean;
    cancelGesture: () => void;
    draw: () => void;
    refreshPalette: () => void;
    operation: (work: () => void) => void;
    opening: () => void;
  },
) {
  const panel = element('art-layer-panel', HTMLElement);
  const list = element('art-layer-list', HTMLElement);
  const number = input('art-layer-opacity');
  const range = input('art-layer-opacity-range');
  const message = element('art-layer-status', HTMLElement);
  let displayedModel: PixelModel | null = null;
  let displayedOpacity: { id: string | null; value: number } | null = null;
  let messageDescriptor: PixelModel['descriptor'] | undefined;
  let rename: { model: PixelModel; id: string; original: string } | null = null;
  const rows = new Map<string, HTMLElement>();
  const say = (text: string) => {
    message.textContent = text;
    messageDescriptor = ports.current()?.descriptor;
  };
  const items = () => ports.current()?.descriptor.layers?.items ?? [];
  const selected = () => items().find((item) => item.id === ports.current()?.activeLayer);
  function mutate(work: (model: PixelModel) => void) {
    if (ports.busy()) {
      return;
    }
    ports.cancelGesture();
    ports.operation(() => {
      const model = ports.current();
      if (model) {
        work(model);
      }
    });
  }
  function update(id: string, change: Partial<Layer>) {
    mutate((model) =>
      model.setLayers(items().map((item) => (item.id === id ? { ...item, ...change } : item))),
    );
  }
  function choose(id: string) {
    if (ports.busy()) {
      return;
    }
    ports.cancelGesture();
    ports.current()?.selectLayer(id);
    ports.refreshPalette();
    ports.draw();
  }
  function finishRename(cancel = false, focus = false) {
    const editing = rename;
    if (!editing || (!cancel && ports.busy())) {
      return;
    }
    const field = rows.get(editing.id)?.querySelector('input');
    const value = field?.value.trim() ?? '';
    rename = null;
    if (!cancel && editing.model === ports.current() && !ports.busy()) {
      if (!value) {
        say('A layer name is required. Original name kept.');
      } else if (value !== editing.original) {
        update(editing.id, { name: value });
        say('Layer renamed.');
      }
    }
    sync();
    if (focus) {
      rows.get(editing.id)?.querySelector<HTMLButtonElement>('.art-layer-select')?.focus();
    }
  }
  function startRename(id: string) {
    if (ports.busy()) {
      return;
    }
    const model = ports.current();
    const layer = items().find((item) => item.id === id);
    if (!model || !layer || layer.locked) {
      return;
    }
    choose(id);
    rename = { model, id, original: layer.name };
    sync();
    const field = rows.get(id)?.querySelector('input');
    field?.focus();
    field?.select();
  }
  function reorder(id: string, beforeId: string | null) {
    mutate((model) => {
      const ordered = [...items()].reverse();
      const from = ordered.findIndex((item) => item.id === id);
      if (from < 0 || ordered[from].locked || id === beforeId) {
        return;
      }
      const [moved] = ordered.splice(from, 1);
      const to =
        beforeId === null ? ordered.length : ordered.findIndex((item) => item.id === beforeId);
      if (to < 0) {
        return;
      }
      ordered.splice(to, 0, moved);
      model.setLayers(ordered.reverse());
      say(`${moved.name} reordered.`);
    });
  }
  const dragging = layerDragging(list, reorder, lifetime);
  button('art-layer-add').innerHTML = icon(icons.add);
  button('art-layer-remove').innerHTML = icon(icons.remove);
  lifetime.assign(button('art-layers-toggle'), 'onclick', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      ports.opening();
    }
    button('art-layers-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  lifetime.assign(button('art-layer-add'), 'onclick', () => {
    let added: string | null = null;
    mutate((model) => {
      const make = (name: string): Layer => ({
        id: crypto.randomUUID(),
        name,
        visible: true,
        opacity: 255,
        locked: false,
      });
      const layer = make('Layer');
      model.setLayers([...(model.descriptor.layers?.items ?? [make('Base')]), layer]);
      model.selectLayer(layer.id);
      added = layer.id;
    });
    if (added) {
      startRename(added);
    }
  });
  lifetime.assign(button('art-layer-remove'), 'onclick', () => {
    mutate((model) => {
      const layer = selected();
      if (!layer || layer.locked || items().length < 2) {
        return;
      }
      model.setLayers(items().filter((item) => item.id !== layer.id));
      say(`${layer.name} removed. Undo to restore it.`);
    });
    rows
      .get(ports.current()?.activeLayer ?? '')
      ?.querySelector<HTMLButtonElement>('.art-layer-select')
      ?.focus();
  });
  function commitOpacity() {
    const layer = selected();
    if (!layer || layer.locked || ports.busy()) {
      return;
    }
    const value = Number(number.value);
    if (!number.value || !number.validity.valid || !Number.isInteger(value)) {
      say('Enter a whole opacity percentage from 0 to 100.');
      number.value = range.value = percentage(layer.opacity);
      return;
    }
    // Merely visiting a rounded native value must not quantize its stored byte.
    if (number.value !== percentage(layer.opacity)) {
      update(layer.id, { opacity: Math.round((value * 255) / 100) });
    }
    sync();
  }
  // Number steppers emit change before blur. Keep their value pending too.
  lifetime.assign(number, 'oninput', () => {
    if (number.value && number.validity.valid) {
      range.value = number.value;
    }
  });
  lifetime.assign(number, 'onblur', commitOpacity);
  lifetime.assign(number, 'onkeydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitOpacity();
      number.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      number.value = range.value = percentage(selected()?.opacity ?? 255);
      number.blur();
    }
  });
  // Preview only the field while dragging; commit one authored edit on release.
  lifetime.assign(range, 'oninput', () => {
    number.value = range.value;
  });
  lifetime.assign(range, 'onchange', commitOpacity);
  lifetime.assign(range, 'onkeydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      number.value = range.value = percentage(selected()?.opacity ?? 255);
    }
  });
  function makeRow(id: string) {
    const row = document.createElement('div');
    row.className = 'layer-row art-layer-row';
    row.dataset.layerId = id;
    row.innerHTML = `<button type="button" class="layer-grip art-layer-icon" title="Drag to reorder · Alt + ↑ / ↓" aria-label="Reorder layer">⠿</button><button type="button" class="art-layer-visible art-layer-icon"></button><button type="button" class="art-layer-select"></button><input class="art-layer-name" maxlength="100" aria-label="Layer name" hidden><button type="button" class="art-layer-lock art-layer-icon"></button>`;
    const choice = control<HTMLButtonElement>(row, '.art-layer-select');
    const grip = control<HTMLButtonElement>(row, '.layer-grip');
    const field = control<HTMLInputElement>(row, 'input');
    lifetime.assign(choice, 'onclick', () => choose(id));
    lifetime.assign(choice, 'ondblclick', () => startRename(id));
    lifetime.assign(row, 'onkeydown', (event) => {
      if (event.key === 'F2' && event.target !== field) {
        event.preventDefault();
        startRename(id);
      }
      if (event.target === grip && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const ordered = [...items()].reverse();
        const index = ordered.findIndex((item) => item.id === id);
        const next = index + (event.key === 'ArrowUp' ? -1 : 1);
        if (next >= 0 && next < ordered.length) {
          reorder(id, event.key === 'ArrowUp' ? ordered[next].id : (ordered[next + 1]?.id ?? null));
        }
        grip.focus({ preventScroll: true });
      }
    });
    lifetime.assign(field, 'onblur', () => finishRename());
    lifetime.assign(field, 'onkeydown', (event) => {
      // Some IMEs report the candidate-accepting key as 229 after compositionend.
      if (event.isComposing || event.keyCode === 229) {
        event.stopPropagation();
        return;
      }
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finishRename(event.key === 'Escape', true);
      }
    });
    for (const [selector, flag] of [
      ['.art-layer-visible', 'visible'],
      ['.art-layer-lock', 'locked'],
    ] as const) {
      lifetime.assign(control<HTMLButtonElement>(row, selector), 'onclick', () => {
        const layer = items().find((item) => item.id === id);
        if (layer) {
          update(id, { [flag]: !layer[flag] });
        }
      });
    }
    return row;
  }
  function sync() {
    const model = ports.current();
    // History and external adoption must retire notices about a previous state.
    if (messageDescriptor !== model?.descriptor) {
      say('');
    }
    const disabled = ports.busy();
    const changedModel = displayedModel !== model;
    if (changedModel) {
      dragging.cancel();
      rename = null;
      displayedOpacity = null;
      displayedModel = model;
      rows.clear();
      list.replaceChildren();
      say('');
    }
    const layers = items();
    const focused = document.activeElement;
    const ordered = [...layers].reverse().map((layer) => {
      let row = rows.get(layer.id);
      if (!row) {
        row = makeRow(layer.id);
        rows.set(layer.id, row);
      }
      const choice = control<HTMLButtonElement>(row, '.art-layer-select');
      const grip = control<HTMLButtonElement>(row, '.layer-grip');
      const field = control<HTMLInputElement>(row, 'input');
      const eye = control<HTMLButtonElement>(row, '.art-layer-visible');
      const lock = control<HTMLButtonElement>(row, '.art-layer-lock');
      if (rename?.id === layer.id && (rename.original !== layer.name || layer.locked)) {
        rename = null;
      }
      const editing = rename?.id === layer.id;
      if (editing && field.hidden) {
        field.value = layer.name;
      }
      field.hidden = !editing;
      choice.hidden = editing;
      if (editing) {
        field.id = 'art-layer-name';
      } else {
        field.removeAttribute('id');
      }
      field.disabled = layer.locked;
      field.readOnly = disabled;
      choice.textContent = layer.name;
      choice.title = `${layer.name} · Double-click or F2 to rename`;
      choice.setAttribute('aria-label', `Select ${layer.name}`);
      choice.setAttribute('aria-pressed', String(layer.id === model?.activeLayer));
      choice.disabled = disabled;
      grip.disabled = disabled || layer.locked;
      grip.setAttribute('aria-label', `Reorder ${layer.name}`);
      if (row.dataset.visible !== String(layer.visible)) {
        eye.innerHTML = icon(icons.eye + (layer.visible ? '' : '<path d="m3 3 18 18"/>'));
      }
      eye.title = `${layer.visible ? 'Hide' : 'Show'} ${layer.name}${layer.locked ? ' (unlock first)' : ''}`;
      eye.setAttribute('aria-label', eye.title);
      eye.setAttribute('aria-pressed', String(layer.visible));
      eye.disabled = disabled || layer.locked;
      if (row.dataset.locked !== String(layer.locked)) {
        lock.innerHTML = icon(layer.locked ? icons.lock : icons.unlock);
      }
      lock.title = `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`;
      lock.setAttribute('aria-label', lock.title);
      lock.setAttribute('aria-pressed', String(layer.locked));
      lock.disabled = disabled;
      row.dataset.active = String(layer.id === model?.activeLayer);
      row.dataset.visible = String(layer.visible);
      row.dataset.locked = String(layer.locked);
      return row;
    });
    for (const id of rows.keys()) {
      if (!layers.some((layer) => layer.id === id)) {
        rows.delete(id);
      }
    }
    if (
      ordered.length !== list.children.length ||
      ordered.some((row, i) => row !== list.children[i])
    ) {
      list.replaceChildren(...ordered);
      if (focused instanceof HTMLElement && list.contains(focused)) {
        focused.focus({ preventScroll: true });
      }
    }
    const layer = selected();
    const value = layer?.opacity ?? 255;
    if (displayedOpacity?.id !== layer?.id || displayedOpacity?.value !== value) {
      number.value = range.value = percentage(value);
    }
    displayedOpacity = { id: layer?.id ?? null, value };
    number.disabled = range.disabled = disabled || !layer || layer.locked;
    button('art-layers-toggle').disabled = disabled;
    button('art-layer-add').disabled = disabled || !model || layers.length >= MAX_LAYERS;
    button('art-layer-remove').disabled = disabled || !layer || layer.locked || layers.length < 2;
    element('art-layer-count', HTMLElement).textContent = String(layers.length);
  }
  return { sync };
}
