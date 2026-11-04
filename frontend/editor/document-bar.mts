/** Presentation of the active document; models retain dirty and saved-base ownership. */
import { button, element } from './editor-dom.mts';

export interface DocumentSummary {
  name: string;
  kind: 'Scene' | 'Artwork';
  state: 'Saved' | 'Modified' | 'New' | '';
  externalChanged: boolean;
}

export function documentCaption(document: DocumentSummary) {
  return `${document.name} · ${document.kind}`;
}

export function documentStateLabel(document: DocumentSummary) {
  return [document.state, document.externalChanged ? 'Saved base changed externally' : '']
    .filter(Boolean)
    .join(' · ');
}

export function createDocumentBar() {
  const trigger = button('document-switcher');
  const state = element('document-state', HTMLElement);
  const base = element('document-base-state', HTMLElement);
  return {
    render(document: DocumentSummary, disabled: boolean) {
      const caption = documentCaption(document);
      const label = `${caption} ▾`;
      if (trigger.textContent !== label) {
        trigger.textContent = label;
      }
      trigger.title = `Documents: ${caption}`;
      trigger.disabled = disabled;
      state.textContent = document.state;
      state.dataset.modified = String(document.state === 'Modified' || document.state === 'New');
      base.hidden = !document.externalChanged;
      base.textContent = document.externalChanged ? 'Saved base changed externally' : '';
    },
  };
}
