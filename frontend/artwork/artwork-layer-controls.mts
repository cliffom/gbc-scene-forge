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
    operation: (work: () => void) => void;
    opening: () => void;
  },
) {
  const panel = element('art-layer-panel', HTMLElement);
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
            if (
              item.locked &&
              (input('art-layer-name').value !== item.name ||
                input('art-layer-visible').checked !== item.visible ||
                Number(input('art-layer-opacity').value) !== item.opacity)
            ) {
              throw Error('Unlock the layer first.');
            }
            items[index] = {
              ...item,
              name: input('art-layer-name').value.trim(),
              visible: input('art-layer-visible').checked,
              opacity: Number(input('art-layer-opacity').value),
              locked: input('art-layer-locked').checked,
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
      const current = model?.activeLayer;
      if (
        JSON.stringify([...layerSelect.options].map((o) => [o.value, o.text])) !==
        JSON.stringify(items.map((i) => [i.id, i.name]))
      ) {
        layerSelect.replaceChildren(...items.map((i) => new Option(i.name, i.id)));
      }
      layerSelect.value = current ?? '';
      const item = items.find((i) => i.id === current);
      input('art-layer-name').value = item?.name ?? '';
      input('art-layer-visible').checked = item?.visible ?? true;
      input('art-layer-locked').checked = item?.locked ?? false;
      input('art-layer-opacity').value = String(item?.opacity ?? 255);
      for (const id of ['art-layer-remove', 'art-layer-up', 'art-layer-down', 'art-layer-update']) {
        button(id).disabled = ports.busy() || !item;
      }
      button('art-layer-add').disabled = ports.busy() || !model || items.length >= 8;
    },
  };
}
