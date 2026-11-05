/** Mounted palette inspection. Uses the shared raster and scans only on demand. */
import { button, element, select } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import { paletteColors } from './artwork-palette.mts';
import type { ArtworkRaster } from './artwork-raster.mts';
import type { Color, PixelModel, Rectangle } from './pixel-model.mts';

export function createArtworkPaletteControls(
  lifetime: EditorLifetime,
  raster: ArtworkRaster,
  ports: {
    current: () => PixelModel | null;
    view: () => Rectangle | null;
    busy: () => boolean;
    color: () => Color | null;
    chooseColor: (color: Color) => void;
  },
) {
  const panel = element('art-palette', HTMLElement);
  const grid = element('art-swatches', HTMLElement);
  const tabs = [button('art-palette-composition'), button('art-palette-layer')];
  let scope: 'composition' | 'layer' = 'composition';
  let dirty = true;
  let previousModel: WeakRef<PixelModel> | null = null;
  let previousKey = '';
  let colorSignature = '';

  function reflectColor(c: Color | null, force = false) {
    const signature = c?.join(',') ?? 'invalid';
    if (!force && colorSignature === signature) {
      return;
    }
    colorSignature = signature;
    const rgba = c ? `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})` : 'transparent';
    element('art-palette-chip', HTMLElement).style.setProperty('--swatch', rgba);
    element('art-palette-color', HTMLElement).textContent = c
      ? `RGBA ${c.join(', ')}`
      : 'Choose an opacity within 0–255';
    for (const swatch of grid.querySelectorAll('button')) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.rgba === signature));
    }
  }
  function sync(opening = false) {
    const model = ports.current();
    if (!model || (!opening && !panel.matches(':popover-open'))) {
      return;
    }
    const view = ports.view();
    const layer = model.descriptor.layers?.items.find((item) => item.id === model.activeLayer);
    const key = JSON.stringify([
      raster.revision,
      view,
      model.activeLayer,
      layer?.name,
      scope,
      select('art-palette-sort').value,
    ]);
    if (!dirty && previousModel?.deref() === model && previousKey === key) {
      reflectColor(ports.color());
      return;
    }
    const pixels = scope === 'composition' ? raster.pixels : model.pixels;
    if (!pixels) {
      return;
    }
    const order = select('art-palette-sort').value === 'usage' ? 'usage' : 'hue';
    const { colors, limited } = paletteColors(pixels, {
      width: model.width,
      view,
      visibleOnly: scope === 'composition',
      order,
    });
    previousModel = new WeakRef(model);
    previousKey = key;
    dirty = false;
    const area =
      model.descriptor.version === 2 ? (view ? 'Current frame' : 'Entire sheet') : 'Entire image';
    element('art-palette-scope', HTMLElement).textContent =
      `${area} · ${scope === 'composition' ? 'visible composition' : (layer?.name ?? 'selected layer')}`;
    element('art-palette-count', HTMLElement).textContent = limited
      ? `First ${colors.length.toLocaleString()} colors shown · additional colors available.`
      : `${colors.length} colors · ${order === 'hue' ? 'sorted by hue' : 'most used first'}`;
    element('art-palette-help', HTMLElement).textContent =
      scope === 'composition'
        ? 'Visible RGBA after blending; transparent pixels and view overlays are excluded.'
        : 'Exact source RGBA, including transparent pixels; layer visibility and opacity are not applied.';
    element('art-palette-limits', HTMLElement).hidden = !limited;
    const focused =
      document.activeElement instanceof HTMLElement && grid.contains(document.activeElement)
        ? document.activeElement.dataset.rgba
        : undefined;
    grid.replaceChildren(
      ...colors.map((c) => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.title = `RGBA ${c.join(', ')}`;
        swatch.setAttribute('aria-label', swatch.title);
        swatch.style.setProperty('--swatch', `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`);
        swatch.dataset.rgba = c.join(',');
        swatch.onclick = () => {
          if (ports.busy()) {
            return;
          }
          ports.chooseColor(c);
          panel.hidePopover();
          button('art-palette-toggle').focus();
        };
        return swatch;
      }),
    );
    element('art-palette-empty', HTMLElement).hidden = colors.length > 0;
    reflectColor(ports.color(), true);
    if (focused) {
      (
        [...grid.querySelectorAll('button')].find((b) => b.dataset.rgba === focused) ?? tabs[0]
      ).focus();
    }
    if (panel.matches(':popover-open')) {
      position();
    }
  }
  function changeScope(index: number) {
    scope = index === 0 ? 'composition' : 'layer';
    element('art-palette-content', HTMLElement).setAttribute('aria-labelledby', tabs[index].id);
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    sync();
    position();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => changeScope(index), { signal: lifetime.signal });
    tab.addEventListener(
      'keydown',
      (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
        changeScope(next);
        tabs[next].focus();
      },
      { signal: lifetime.signal },
    );
  });
  select('art-palette-sort').addEventListener('change', () => sync(), { signal: lifetime.signal });
  panel.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        panel.hidePopover();
        button('art-palette-toggle').focus();
        return;
      }
      const buttons = [...grid.querySelectorAll('button')];
      const index = buttons.findIndex((b) => b === document.activeElement);
      if (index < 0) {
        return;
      }
      const step: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: 12,
        ArrowUp: -12,
      };
      if (event.key in step || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(0, Math.min(buttons.length - 1, index + step[event.key]));
        buttons[next]?.focus();
      }
    },
    { signal: lifetime.signal },
  );
  function position(height = Math.min(480, panel.scrollHeight + 2)) {
    const trigger = button('art-palette-toggle').getBoundingClientRect();
    const gap = 5,
      margin = 8;
    const below = Math.max(0, window.innerHeight - margin - trigger.bottom - gap);
    const above = Math.max(0, trigger.top - gap - margin);
    const useBelow = below >= height || below >= above;
    const available = Math.min(480, window.innerHeight - margin * 2, useBelow ? below : above);
    // Keep the invoker clickable. Large palettes scroll in the available space
    // instead of being clamped across their own Colors button.
    panel.style.maxHeight = `${Math.max(0, available)}px`;
    panel.style.left = `${Math.max(8, Math.min(trigger.left, window.innerWidth - 350))}px`;
    const top = useBelow ? trigger.bottom + gap : trigger.top - Math.min(height, available) - gap;
    panel.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - Math.min(height, available) - margin))}px`;
  }
  panel.addEventListener(
    'beforetoggle',
    (event) => {
      if (event.newState === 'open') {
        sync(true);
        position(480);
      }
    },
    { signal: lifetime.signal },
  );
  panel.addEventListener(
    'toggle',
    () => {
      if (panel.matches(':popover-open')) {
        position();
        tabs[scope === 'composition' ? 0 : 1].focus();
      }
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    'resize',
    () => {
      if (panel.matches(':popover-open')) {
        position();
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.cleanup(() => {
    panel.hidePopover();
    grid.replaceChildren();
    previousModel = null;
  });
  return {
    sync,
    reflectColor,
    invalidate() {
      dirty = true;
    },
  };
}
