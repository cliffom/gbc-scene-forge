import { EditorLifetime } from './editor-lifetime.mts';
/** Return mouse-operated editor controls to the canvas without disrupting keyboard use. */
export function editorFocus(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  enabled: () => boolean,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const commands = [
    '.canvas-toolbar button',
    '.composition-tools button',
    '#select-all-layers',
    '.tool',
    '.asset',
    '.layer-choice',
    '.layer-eye',
    '.layer-controls button',
    '.layer-add button',
    '.review-bar input',
    '#place-point',
    '#place-rectangle',
    '#context-show-layer',
    '#save',
    '#remove-sprite',
  ].join(',');
  const dropdowns = '#zoom, #atlas-filter, #kind-filter, #object-list, #stamps';
  let pointerSelect: HTMLSelectElement | null = null;
  function excluded(target: Element) {
    return Boolean(target.closest('dialog, #animation-preview, [popovertarget]'));
  }
  function returnToCanvas() {
    if (enabled() && !document.querySelector('dialog[open]')) {
      canvas.focus({ preventScroll: true });
    }
  }
  root.addEventListener(
    'click',
    (event) => {
      if (event.detail === 0 || !(event.target instanceof Element) || excluded(event.target)) {
        return;
      }
      if (event.target.closest(commands)) {
        returnToCanvas();
      }
    },
    { signal: lifetime.signal },
  );
  root.addEventListener(
    'pointerdown',
    (event) => {
      pointerSelect =
        event.target instanceof HTMLSelectElement && event.target.matches(dropdowns)
          ? event.target
          : null;
    },
    { signal: lifetime.signal },
  );
  root.addEventListener(
    'change',
    (event) => {
      if (event.target === pointerSelect) {
        pointerSelect = null;
        returnToCanvas();
      }
    },
    { signal: lifetime.signal },
  );
  document.addEventListener(
    'keydown',
    () => {
      pointerSelect = null;
    },
    { capture: true, signal: lifetime.signal },
  );
  window.addEventListener(
    'blur',
    () => {
      pointerSelect = null;
    },
    { signal: lifetime.signal },
  );
}
