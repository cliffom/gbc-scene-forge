/** Presentation for artwork creation, contextual properties and focused change review. */
import { MAX_ARTWORK_AXIS, GRID_UNIT, MAX_GRID_AXIS } from './artwork-limits.mts';
import { button, element, input, select } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';

export function createArtworkWorkspace(
  lifetime: EditorLifetime,
  surface: HTMLElement,
  changed: () => void,
  reviewChanged: () => void,
) {
  const inspector = element('art-inspector-content', HTMLElement);
  for (const node of [
    element('art-inspector-actions', HTMLElement),
    element('art-shared', HTMLElement),
    element('art-selection-details', HTMLElement),
    element('art-layer-panel', HTMLElement),
    element('art-properties', HTMLElement),
    button('art-palette-toggle'),
    element('art-palette', HTMLElement),
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
  for (const id of ['art-frame-width', 'art-frame-height']) {
    input(id).min = String(GRID_UNIT);
    input(id).max = String(MAX_GRID_AXIS);
    input(id).step = String(GRID_UNIT);
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
  let setupMode: 'new' | 'existing' | 'agent' = 'new';
  const modes = ['new', 'existing', 'agent'] as const;
  function setup(mode: (typeof modes)[number]) {
    setupMode = mode;
    element('artwork-heading', HTMLElement).textContent =
      mode === 'new' ? 'New artwork' : mode === 'agent' ? 'From agent' : 'Open artwork';
    element('art-recovery', HTMLDetailsElement).open = mode === 'existing';
    element('art-source-panel', HTMLElement).hidden = mode !== 'existing';
    element('art-new-panel', HTMLElement).hidden = mode !== 'new';
    element('art-handoff', HTMLElement).hidden = mode !== 'agent';
    if (mode !== 'agent') {
      element(mode === 'new' ? 'art-new-fields' : 'art-copy-fields', HTMLElement).prepend(
        element('art-identity', HTMLElement),
      );
      element(mode === 'new' ? 'art-new-identity' : 'art-identity', HTMLElement).append(
        element('art-identity-options', HTMLDetailsElement),
      );
    }
    for (const key of modes) {
      const tab = button(`art-${key}-mode`);
      tab.setAttribute('aria-selected', String(mode === key));
      tab.tabIndex = mode === key ? 0 : -1;
    }
    changed();
  }
  function reviewPanel(open: boolean) {
    const panel = element('art-review-panel', HTMLElement);
    if (panel) {
      panel.hidden = !open;
    }
    surface.classList.toggle('show-art-review', open);
    reviewChanged();
    if (open) {
      element('art-layer-panel', HTMLElement).hidden = true;
      button('art-layers-toggle').setAttribute('aria-expanded', 'false');
      element('art-properties', HTMLElement).hidden = true;
      button('art-properties-toggle').setAttribute('aria-expanded', 'false');
    }
  }
  lifetime.assign(button('art-review-close'), 'onclick', () => {
    reviewPanel(false);
    button('save').focus();
  });
  lifetime.assign(button('art-properties-toggle'), 'onclick', () => {
    const panel = element('art-properties', HTMLElement);
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      reviewPanel(false);
    }
    button('art-properties-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  for (const mode of modes) {
    lifetime.assign(button(`art-${mode}-mode`), 'onclick', () => setup(mode));
  }
  surface.querySelector('.art-start-tabs')?.addEventListener(
    'keydown',
    (event) => {
      if (!(event instanceof KeyboardEvent)) {
        return;
      }
      let index = modes.indexOf(setupMode);
      if (event.key === 'ArrowRight') {
        index = (index + 1) % modes.length;
      } else if (event.key === 'ArrowLeft') {
        index = (index + modes.length - 1) % modes.length;
      } else if (event.key === 'Home') {
        index = 0;
      } else if (event.key === 'End') {
        index = modes.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      setup(modes[index]);
      button(`art-${modes[index]}-mode`).focus();
    },
    { signal: lifetime.signal },
  );
  function layoutPreview() {
    const multiple = input('art-multiple').checked;
    const grid = multiple || select('art-kind').value === 'tile';
    for (const id of ['art-width', 'art-height']) {
      input(id).min = grid ? String(GRID_UNIT) : '1';
      input(id).max = String(grid ? MAX_GRID_AXIS : MAX_ARTWORK_AXIS);
      input(id).step = grid ? String(GRID_UNIT) : '1';
    }
    element('art-size-guidance', HTMLElement).textContent = multiple
      ? 'Sheets: 8–256 pixels per axis in multiples of eight; frame sizes must divide the sheet.'
      : select('art-kind').value === 'tile'
        ? 'Single tiles: 8, 16 or 32 pixels square.'
        : 'Sprites / illustrations: 1–4,096 pixels per axis, up to 4,194,304 pixels total.';
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
