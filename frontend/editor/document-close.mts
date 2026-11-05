/** Shared close confirmation; domain owners perform persistence and release. */
import { button, element } from './editor-dom.mts';
import type { EditorLifetime } from './editor-lifetime.mts';

export type CloseChoice = 'save' | 'keep' | 'discard';

export function createDocumentClose(lifetime: EditorLifetime) {
  const dialog = element('close-document-dialog', HTMLDialogElement);
  let finish: ((choice: CloseChoice | null) => void) | null = null;
  for (const choice of ['save', 'keep', 'discard'] as const) {
    lifetime.assign(button(`close-document-${choice}`), 'onclick', () => dialog.close(choice));
  }
  lifetime.assign(button('close-document-cancel'), 'onclick', () => dialog.close());
  dialog.addEventListener(
    'close',
    () => {
      const resolve = finish;
      finish = null;
      const choice = dialog.returnValue;
      resolve?.(choice === 'save' || choice === 'keep' || choice === 'discard' ? choice : null);
    },
    { signal: lifetime.signal },
  );
  lifetime.cleanup(() => {
    finish?.(null);
    finish = null;
  });
  return (name: string, artwork = false): Promise<CloseChoice | null> => {
    if (lifetime.disposed || finish || document.querySelector('dialog[open]')) {
      return Promise.resolve(null);
    }
    element('close-document-description', HTMLElement).textContent =
      `“${name}” has local work. Save before closing, keep a recoverable draft, or discard the local work and its checkpoint. Saved assets are not deleted.`;
    button('close-document-save').textContent = artwork
      ? 'Review / save and close…'
      : 'Save and close';
    element('close-document-save-hint', HTMLElement).textContent = artwork
      ? 'Review the artwork, then choose Confirm save and close. Cancel closing from the review panel to keep editing.'
      : 'Keep draft and close stores the current edits for recovery without changing the saved scene.';
    dialog.returnValue = '';
    return new Promise((resolve) => {
      finish = resolve;
      dialog.showModal();
    });
  };
}
