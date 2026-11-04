/** Presentation for artwork creation, contextual properties and focused change review. */
import { MAX_ARTWORK_AXIS } from './artwork-limits.mts';
import { button, element, input, select } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';

export function createArtworkWorkspace(
  lifetime: EditorLifetime,
  surface: HTMLElement,
  changed: () => void,
) {
  const inspector = element('art-inspector-content', HTMLElement);
  for (const node of [
    element('art-inspector-actions', HTMLElement),
    element('art-shared', HTMLElement),
    element('art-selection-details', HTMLElement),
    element('art-layer-panel', HTMLElement),
    element('art-properties', HTMLElement),
    element('art-review-panel', HTMLElement),
  ]) {
    const marker = document.createComment('artwork panel');
    node.before(marker);
    inspector.append(node);
    lifetime.cleanup(() => marker.replaceWith(node));
  }
  element('art-editor', HTMLElement).insertBefore(
    element('art-sheet-controls', HTMLElement),
    element('art-draft-status', HTMLElement),
  );
  const help = surface.querySelector('.art-help');
  if (help) {
    surface.querySelector('.art-document-actions>div')?.append(help);
  }
  let automaticIdentity = true;
  function identityFromName() {
    const normalized = input('art-name')
      .value.normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const identity = normalized || 'artwork';
    return (/^[a-z]/.test(identity) ? identity : `art_${identity}`).slice(0, 64);
  }
  function prepareIdentity(name = 'New artwork') {
    automaticIdentity = true;
    input('art-name').value = name;
    input('art-id').value = identityFromName();
  }
  lifetime.assign(input('art-name'), 'oninput', () => {
    if (automaticIdentity) {
      input('art-id').value = identityFromName();
    }
  });
  lifetime.assign(input('art-id'), 'oninput', () => {
    automaticIdentity = input('art-id').value === identityFromName();
  });
  let setupMode: 'new' | 'existing' = 'new';
  function setup(mode: 'new' | 'existing') {
    setupMode = mode;
    element('artwork-heading', HTMLElement).textContent =
      mode === 'new' ? 'New artwork' : 'Open artwork';
    element('art-recovery', HTMLDetailsElement).open = mode === 'existing';
    element('art-source-panel', HTMLElement).hidden = mode !== 'existing';
    element('art-new-panel', HTMLElement).hidden = mode !== 'new';
    element(mode === 'new' ? 'art-new-fields' : 'art-copy-fields', HTMLElement).prepend(
      element('art-identity', HTMLElement),
    );
    button('art-new-mode').setAttribute('aria-pressed', String(mode === 'new'));
    button('art-existing-mode').setAttribute('aria-pressed', String(mode === 'existing'));
    changed();
  }
  function reviewPanel(open: boolean) {
    const panel = element('art-review-panel', HTMLElement);
    if (panel) {
      panel.hidden = !open;
    }
    surface.classList.toggle('show-art-review', open);
    if (!open) {
      button('art-save').textContent = 'Save…';
    }
    if (open) {
      element('art-layer-panel', HTMLElement).hidden = true;
      button('art-layers-toggle').setAttribute('aria-expanded', 'false');
      element('art-properties', HTMLElement).hidden = true;
      button('art-properties-toggle').setAttribute('aria-expanded', 'false');
    }
  }
  lifetime.assign(button('art-review-close'), 'onclick', () => {
    reviewPanel(false);
    button('art-save').focus();
  });
  lifetime.assign(button('art-properties-toggle'), 'onclick', () => {
    const panel = element('art-properties', HTMLElement);
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      element('art-layer-panel', HTMLElement).hidden = true;
      button('art-layers-toggle').setAttribute('aria-expanded', 'false');
      reviewPanel(false);
    }
    button('art-properties-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  lifetime.assign(button('art-new-mode'), 'onclick', () => setup('new'));
  lifetime.assign(button('art-existing-mode'), 'onclick', () => setup('existing'));
  function layoutPreview() {
    const multiple = input('art-multiple').checked;
    const grid = multiple || select('art-kind').value === 'tile';
    for (const id of ['art-width', 'art-height']) {
      input(id).min = grid ? '8' : '1';
      input(id).max = grid ? '256' : String(MAX_ARTWORK_AXIS);
      input(id).step = grid ? '8' : '1';
    }
    element('art-sheet-layout', HTMLElement).hidden = !multiple;
    const w = Number(input('art-width').value),
      h = Number(input('art-height').value),
      fw = Number(input('art-frame-width').value),
      fh = Number(input('art-frame-height').value);
    element('art-layout-preview', HTMLElement).textContent =
      fw > 0 && fh > 0 && w % fw === 0 && h % fh === 0
        ? `${w} × ${h} sheet · ${w / fw} columns × ${h / fh} rows · ${(w / fw) * (h / fh)} frames`
        : 'Frame dimensions must divide the whole sheet exactly.';
  }
  for (const id of [
    'art-multiple',
    'art-width',
    'art-height',
    'art-frame-width',
    'art-frame-height',
  ]) {
    lifetime.assign(input(id), 'oninput', layoutPreview);
  }
  lifetime.assign(select('art-kind'), 'onchange', layoutPreview);
  layoutPreview();
  return {
    setup,
    prepareIdentity,
    reviewPanel,
    resetPanels() {
      reviewPanel(false);
      element('art-properties', HTMLElement).hidden = true;
      button('art-properties-toggle').setAttribute('aria-expanded', 'false');
    },
    get mode() {
      return setupMode;
    },
  };
}
