import { MAX_LAYERS } from './artwork-limits.mts';
/** Mounted illustration-layer controls; model owns source pixels and history. */
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import { button, element, input, select } from '../editor/editor-dom.mts';
import type { PixelModel } from './pixel-model.mts';
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
  let displayedFields: {
    model: PixelModel | null;
    layer: string | null;
    name: string;
    opacity: number;
  } | null = null;
  button('art-layers-toggle').addEventListener(
    'click',
    () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        ports.opening();
      }
      button('art-layers-toggle').setAttribute('aria-expanded', String(!panel.hidden));
    },
    { signal: lifetime.signal },
  );
  select('art-layer').addEventListener(
    'change',
    () => {
      ports.cancelGesture();
      ports.current()?.selectLayer(select('art-layer').value);
      ports.refreshPalette();
      ports.draw();
    },
    { signal: lifetime.signal },
  );
  button('art-layer-add').addEventListener(
    'click',
    () =>
      ports.operation(() => {
        const model = ports.current();
        if (!model) {
          return;
        }
        const make = (name: string) => ({
          id: crypto.randomUUID(),
          name,
          visible: true,
          opacity: 255,
          locked: false,
        });
        model.setLayers([...(model.descriptor.layers?.items ?? [make('Base')]), make('Layer')]);
      }),
    { signal: lifetime.signal },
  );
  for (const field of ['visible', 'locked'] as const) {
    input(`art-layer-${field}`).addEventListener(
      'change',
      () => {
        const checked = input(`art-layer-${field}`).checked;
        ports.cancelGesture();
        ports.operation(() => {
          const model = ports.current();
          if (!model?.descriptor.layers) {
            return;
          }
          model.setLayers(
            model.descriptor.layers.items.map((item) =>
              item.id === model.activeLayer ? { ...item, [field]: checked } : item,
            ),
          );
        });
      },
      { signal: lifetime.signal },
    );
  }
  for (const action of ['up', 'down', 'remove', 'update'] as const) {
    button(`art-layer-${action}`).addEventListener(
      'click',
      () =>
        ports.operation(() => {
          const model = ports.current();
          if (!model?.descriptor.layers) {
            return;
          }
          const items = structuredClone(model.descriptor.layers.items);
          const index = items.findIndex((i) => i.id === model.activeLayer);
          if (index < 0) {
            return;
          }
          const item = items[index];
          if (item.locked && action !== 'update') {
            throw Error('Unlock the layer first.');
          }
          if (action === 'remove') {
            items.splice(index, 1);
          } else if (action === 'update') {
            // Explicit Apply also normalizes unchanged values and resets invalid input.
            displayedFields = null;
            if (
              item.locked &&
              (input('art-layer-name').value !== item.name ||
                Number(input('art-layer-opacity').value) !== item.opacity)
            ) {
              throw Error('Unlock the layer first.');
            }
            items[index] = {
              ...item,
              name: input('art-layer-name').value.trim(),
              opacity: Number(input('art-layer-opacity').value),
            };
          } else {
            const next = Math.max(
              0,
              Math.min(items.length - 1, index + (action === 'up' ? 1 : -1)),
            );
            [items[index], items[next]] = [items[next], items[index]];
          }
          model.setLayers(items);
        }),
      { signal: lifetime.signal },
    );
  }
  return {
    sync() {
      button('art-layers-toggle').disabled = ports.busy();
      const model = ports.current();
      const items = model?.descriptor.layers?.items ?? [];
      const layerSelect = select('art-layer');
      const current = model?.activeLayer ?? null;
      if (
        JSON.stringify([...layerSelect.options].map((o) => [o.value, o.text])) !==
        JSON.stringify(items.map((i) => [i.id, i.name]))
      ) {
        layerSelect.replaceChildren(...items.map((i) => new Option(i.name, i.id)));
      }
      layerSelect.value = current ?? '';
      const item = items.find((i) => i.id === current);
      const name = item?.name ?? '';
      const opacity = item?.opacity ?? 255;
      const sameLayer = displayedFields?.model === model && displayedFields?.layer === current;
      // Flag-only redraws must not replace pending edits in the native fields.
      if (!sameLayer || displayedFields?.name !== name) {
        input('art-layer-name').value = name;
      }
      if (!sameLayer || displayedFields?.opacity !== opacity) {
        input('art-layer-opacity').value = String(opacity);
      }
      displayedFields = { model, layer: current, name, opacity };
      input('art-layer-visible').checked = item?.visible ?? true;
      input('art-layer-locked').checked = item?.locked ?? false;
      layerSelect.disabled = ports.busy() || !items.length;
      for (const id of ['art-layer-name', 'art-layer-visible', 'art-layer-opacity']) {
        input(id).disabled = ports.busy() || !item || item.locked;
      }
      input('art-layer-visible').title = item?.locked
        ? 'Unlock the layer to change visibility'
        : 'Show or hide this layer immediately';
      input('art-layer-locked').disabled = ports.busy() || !item;
      for (const id of ['art-layer-remove', 'art-layer-up', 'art-layer-down', 'art-layer-update']) {
        button(id).disabled = ports.busy() || !item || item.locked;
      }
      button('art-layer-add').disabled = ports.busy() || !model || items.length >= MAX_LAYERS;
    },
  };
}
