/** Modal document navigation with native inert background and focus restoration. */
import { button, element } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';

export function createDocumentChooser(lifetime: EditorLifetime, opening: () => void) {
  const dialog = element('document-tabs', HTMLDialogElement);
  const trigger = button('document-switcher');
  function close() {
    if (dialog.open) {
      dialog.close();
    }
    trigger.setAttribute('aria-expanded', 'false');
  }
  function open(savedScene = false) {
    opening();
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    if (savedScene) {
      element('scenes', HTMLSelectElement).focus();
    }
  }
  lifetime.assign(trigger, 'onclick', () => open());
  lifetime.assign(button('empty-open'), 'onclick', () => open(true));
  lifetime.assign(button('document-chooser-close'), 'onclick', close);
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      close();
    },
    { signal: lifetime.signal },
  );
  let outsideDown = false;
  function outside(event: MouseEvent) {
    const r = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom)
    );
  }
  dialog.addEventListener(
    'pointerdown',
    (event) => {
      outsideDown = outside(event);
    },
    { signal: lifetime.signal },
  );
  dialog.addEventListener(
    'click',
    (event) => {
      if (outsideDown && outside(event)) {
        close();
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.cleanup(close);
  return {
    close,
    get open() {
      return dialog.open;
    },
  };
}
