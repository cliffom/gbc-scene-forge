/** PNG scope and output details; authoring and encoding stay with their existing owners. */
import { button, element, input } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { ArtworkFrame } from './artwork-contracts.mts';
import type { PixelModel } from './pixel-model.mts';

export function artworkPngFilename(asset: string, frame: ArtworkFrame | null) {
  const safe = (value: string) =>
    value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'artwork';
  return `${safe(asset)}-${frame ? safe(frame.id) : 'sheet'}.png`;
}

export function createArtworkPngControls(lifetime: EditorLifetime, changed: () => void) {
  const whole = input('art-png-sheet');
  const frame = input('art-png-frame');
  const trigger = button('art-png-menu');
  const download = button('art-download-png');
  for (const control of [whole, frame]) {
    lifetime.assign(control, 'onchange', changed);
  }
  return {
    frameSelected: () => frame.checked,
    reset() {
      whole.checked = true;
    },
    block() {
      // Gesture redraws skip full control synchronization; only disable export once.
      for (const control of [trigger, download, whole, frame]) {
        if (!control.disabled) {
          control.disabled = true;
        }
      }
    },
    sync(model: PixelModel | null, selected: ArtworkFrame | null, blocked: boolean) {
      whole.disabled = blocked || !model;
      frame.disabled = blocked || !model || !selected;
      trigger.disabled = blocked || !model;
      download.disabled = blocked || !model || (frame.checked && !selected);
      // Dismissal stays available while an operation disables export controls.
      button('art-png-close').disabled = false;
      element('art-png-sheet-title', HTMLElement).textContent =
        model?.descriptor.version === 2 ? 'Whole artwork / sheet' : 'Whole artwork';
      element('art-png-sheet-detail', HTMLElement).textContent = model
        ? `${model.width} × ${model.height} px${model.descriptor.version === 2 ? ' · all frames' : ''}`
        : 'No artwork open';
      element('art-png-frame-detail', HTMLElement).textContent = selected
        ? `${selected.name} · ${selected.width} × ${selected.height} px`
        : model?.descriptor.version === 2
          ? 'Select a frame in the editor first'
          : 'Available when a sheet frame is selected';
      const bounds = frame.checked ? selected : model;
      element('art-png-filename', HTMLElement).textContent =
        model && bounds
          ? artworkPngFilename(model.descriptor.atlas_id, frame.checked ? selected : null)
          : '—';
      element('art-png-output', HTMLElement).textContent = bounds
        ? `PNG · ${bounds.width} × ${bounds.height} px · RGBA`
        : 'Select an available scope to download';
    },
  };
}
