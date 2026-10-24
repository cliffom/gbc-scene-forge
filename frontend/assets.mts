import { $, context, requireValue } from './dom.mts';
import { loadImage, status } from './ui.mts';
import type { EditorSession } from './session.mts';
import type { Brush, Tool } from './types.ts';
export function createAssets(state: EditorSession, selectTool: (tool: Tool) => void) {
  const images = new Map<string, HTMLImageElement>();
  function assetEntry(id: string) {
    const entry = state.catalog.entries.find((entry) => entry.id === id);
    if (!entry) {
      throw Error('Unknown asset');
    }
    return entry;
  }
  function assetRegion(id: string) {
    return requireValue(assetEntry(id).rect, 'Asset has no image rectangle');
  }
  function entries() {
    return state.catalog.entries.map((entry) => ({
      ...entry,
      available: entry.profiles.includes(state.editor.scene.profile),
    }));
  }
  function tileRegion(id: string) {
    return assetRegion(id);
  }
  function thumbnail(entry: Brush) {
    const thumb = document.createElement('canvas');
    const cells = entry.cells || [[entry.id]];
    if (entry.rect) {
      const r = entry.rect;
      thumb.width = r.width;
      thumb.height = r.height;
      context(thumb).drawImage(
        requireValue(images.get(entry.family)),
        r.x,
        r.y,
        r.width,
        r.height,
        0,
        0,
        r.width,
        r.height,
      );
    } else {
      thumb.width = cells[0].length * state.cellSize;
      thumb.height = cells.length * state.cellSize;
      cells.forEach((row, y) =>
        row.forEach((id, x) => {
          const family = assetEntry(id).family,
            r = tileRegion(id);
          context(thumb).drawImage(
            requireValue(images.get(family)),
            r.x,
            r.y,
            state.cellSize,
            state.cellSize,
            x * state.cellSize,
            y * state.cellSize,
            state.cellSize,
            state.cellSize,
          );
        }),
      );
    }
    const scale = Math.max(1, Math.min(4, Math.floor(48 / Math.max(thumb.width, thumb.height))));
    thumb.style.width = `${thumb.width * scale}px`;
    thumb.style.height = `${thumb.height * scale}px`;
    return thumb;
  }
  function chooseBrush(entry: Brush | undefined) {
    if (!entry) {
      throw Error('Connector has no erase brush');
    }
    if (!entry.available) {
      status(
        'This tile is visible for reference; its loader or palette is unavailable in this profile.',
      );
      return;
    }
    state.brush = entry;
    selectTool('paint');
    $('selected-brush').textContent = entry.label + (entry.reference ? ' · reference' : '');
    renderAssets();
  }
  function renderAssets() {
    const query = $('search').value.toLowerCase(),
      kind = $('kind').value,
      family = $('family').value;
    const items = entries().filter(
      (e) =>
        (!family || e.family === family) &&
        (!query || `${e.label} ${e.family}`.toLowerCase().includes(query)) &&
        (kind === 'all' ||
          (kind === 'placeable' && e.available && !e.reference) ||
          (kind === 'sprite' && e.reference) ||
          (kind === 'tile' && !e.reference)),
    );
    $('asset-count').textContent = String(items.length);
    const fragment = document.createDocumentFragment();
    for (const entry of items) {
      const button = document.createElement('button');
      button.className =
        'asset' +
        (entry.available ? '' : ' unavailable') +
        (state.brush?.id === entry.id ? ' selected' : '');
      button.draggable = entry.available;
      button.title = `${entry.family} · ${entry.label}${entry.available ? '' : ' · unavailable in this profile'}`;
      button.setAttribute('aria-pressed', String(state.brush?.id === entry.id));
      button.append(thumbnail(entry));
      const label = document.createElement('span');
      label.textContent = entry.label;
      button.append(label);
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = entry.reference
        ? 'REFERENCE'
        : entry.cells
          ? 'STAMP'
          : entry.available
            ? 'BRUSH'
            : 'VIEW ONLY';
      button.append(type);
      button.onclick = () => chooseBrush(entry);
      button.addEventListener('dragstart', (event) => {
        requireValue(event.dataTransfer).setData('text/plain', entry.id);
        requireValue(event.dataTransfer).effectAllowed = 'copy';
      });
      fragment.append(button);
    }
    $('assets').replaceChildren(fragment);
  }
  for (const id of ['search', 'family', 'kind'] as const) {
    $(id).addEventListener(id === 'search' ? 'input' : 'change', renderAssets);
  }
  async function load() {
    await Promise.all(
      state.catalog.families.map(async (family) =>
        images.set(family.id, await loadImage(family.url)),
      ),
    );
  }
  return { images, load, assetEntry, assetRegion, entries, chooseBrush, renderAssets };
}
export type Assets = ReturnType<typeof createAssets>;
