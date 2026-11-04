import { EditorLifetime } from './editor-lifetime.mts';
/** Native command popovers and keyboard-operable authoring library tabs. */
export type LibraryCategory = 'artwork' | 'objects' | 'stamps' | 'blockout';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) {
    throw Error(`Missing layout element ${id}`);
  }
  return value;
}

export function createEditorLayout(
  lifetime: EditorLifetime = new EditorLifetime(),
  changeLayout: (apply: () => void) => void = (apply) => apply(),
) {
  const main = element('editor-layout', HTMLElement);
  const inspector = element('inspector-pane', HTMLElement);
  const inspectorHeading = element('inspector-heading', HTMLElement);
  function inspectorScrollOffset() {
    inspector.style.scrollPaddingTop = `${inspectorHeading.offsetHeight + 8}px`;
  }
  lifetime.observe(new ResizeObserver(inspectorScrollOffset)).observe(inspectorHeading);
  inspector.addEventListener(
    'focusin',
    (event) => {
      if (!(event.target instanceof HTMLElement) || inspectorHeading.contains(event.target)) {
        return;
      }
      // Layer radios use their visible row as the focus indicator. Nested layer
      // scrolling can still leave that row under the outer sticky heading.
      const target = event.target.closest('.layer-row') ?? event.target;
      const top = target.getBoundingClientRect().top;
      const visibleTop = inspectorHeading.getBoundingClientRect().bottom + 4;
      if (top < visibleTop) {
        inspector.scrollTop -= visibleTop - top;
      }
    },
    { signal: lifetime.signal },
  );
  const toolbar = document.querySelector<HTMLElement>('.canvas-toolbar');
  const expandTools = element('expand-scene-tools', HTMLButtonElement);
  function reflectToolbar(expanded: boolean) {
    toolbar?.classList.toggle('toolbar-expanded', expanded);
    expandTools.setAttribute('aria-expanded', String(expanded));
    const tool = document.querySelector<HTMLInputElement>('input[name=tool]:checked');
    const name =
      tool?.closest('.tool')?.querySelector('.tool-label')?.textContent?.trim() || 'Paint';
    const label = `${expanded ? 'Collapse' : 'Expand'} tools (${name})`;
    expandTools.setAttribute('aria-label', label);
    expandTools.title = label;
    const text = expandTools.querySelector('.toolbar-tool-name');
    if (text) {
      text.textContent = `Tools · ${name}`;
    }
  }
  lifetime.assign(expandTools, 'onclick', () => {
    changeLayout(() => reflectToolbar(expandTools.getAttribute('aria-expanded') !== 'true'));
  });
  toolbar?.addEventListener(
    'change',
    () => reflectToolbar(expandTools.getAttribute('aria-expanded') === 'true'),
    { capture: true, signal: lifetime.signal },
  );
  toolbar?.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape' &&
        expandTools.checkVisibility() &&
        expandTools.getAttribute('aria-expanded') === 'true' &&
        !document.querySelector('[popover]:popover-open')
      ) {
        event.preventDefault();
        event.stopPropagation();
        expandTools.focus({ preventScroll: true });
        changeLayout(() => reflectToolbar(false));
      }
    },
    { signal: lifetime.signal },
  );
  if (toolbar) {
    let toolbarFocus: HTMLElement | null = null;
    document.addEventListener(
      'focusin',
      (event) => {
        toolbarFocus =
          event.target instanceof HTMLElement && toolbar.contains(event.target)
            ? event.target
            : null;
      },
      { signal: lifetime.signal },
    );
    toolbar.addEventListener(
      'focusout',
      (event) => {
        // Hiding a radio can blur it before ResizeObserver runs. Retain only
        // that case; explicit blur and focus moving elsewhere must stay put.
        if (
          event.relatedTarget ||
          (event.target instanceof HTMLElement && event.target.checkVisibility())
        ) {
          toolbarFocus = null;
        }
      },
      { signal: lifetime.signal },
    );
    lifetime
      .observe(
        new ResizeObserver(() => {
          const focused =
            document.activeElement === document.body ? toolbarFocus : document.activeElement;
          if (
            focused instanceof HTMLElement &&
            toolbar.contains(focused) &&
            !focused.checkVisibility()
          ) {
            const target = expandTools.checkVisibility()
              ? expandTools
              : element('review-mode', HTMLButtonElement);
            target.focus({ preventScroll: true });
          }
        }),
      )
      .observe(toolbar);
  }
  lifetime.cleanup(() => reflectToolbar(false));
  reflectToolbar(false);
  function reflectPane(name: 'library' | 'inspector', expanded: boolean) {
    const rail = element(`${name}-rail`, HTMLElement);
    const toggle = element(`toggle-${name}`, HTMLButtonElement);
    const host = expanded ? element(`${name}-heading`, HTMLElement) : rail;
    if (toggle.parentElement !== host) {
      host.append(toggle);
    }
    rail.hidden = expanded;
    element(`${name}-pane`, HTMLElement).hidden = !expanded;
    main.classList.toggle(`${name}-collapsed`, !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    const label = name === 'library' ? 'Library' : 'Inspector';
    const action = `${expanded ? 'Hide' : 'Show'} ${label}`;
    toggle.setAttribute('aria-label', action);
    toggle.title = action;
  }
  function showPane(name: 'library' | 'inspector', expanded: boolean) {
    const pane = element(`${name}-pane`, HTMLElement);
    if (pane.hidden === !expanded) {
      return;
    }
    const toggle = element(`toggle-${name}`, HTMLButtonElement);
    const restoreFocus =
      document.activeElement === toggle || (!expanded && pane.contains(document.activeElement));
    changeLayout(() => reflectPane(name, expanded));
    // Moving a focused control between its header and closed edge loses native focus.
    if (restoreFocus) {
      toggle.focus({ preventScroll: true });
    }
  }
  for (const name of ['library', 'inspector'] as const) {
    const toggle = element(`toggle-${name}`, HTMLButtonElement);
    lifetime.assign(toggle, 'onclick', () =>
      showPane(name, element(`${name}-pane`, HTMLElement).hidden),
    );
    lifetime.cleanup(() => reflectPane(name, true));
  }
  const categories: LibraryCategory[] = ['artwork', 'objects', 'blockout', 'stamps'];
  function selectLibrary(category: LibraryCategory, focus = false) {
    for (const name of categories) {
      const selected = name === category;
      const tab = element(`${name}-tab`, HTMLButtonElement);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      element(`${name}-panel`, HTMLElement).hidden = !selected;
      if (selected && focus) {
        tab.focus();
      }
    }
  }
  function showLibrary(category: LibraryCategory, focus = false) {
    showPane('library', true);
    selectLibrary(category, focus);
  }
  for (const category of categories) {
    const tab = element(`${category}-tab`, HTMLButtonElement);
    lifetime.assign(tab, 'onclick', () => showLibrary(category));
    lifetime.assign(tab, 'onkeydown', (event) => {
      const available = categories.filter(
        (name) => !element(`${name}-tab`, HTMLButtonElement).hidden,
      );
      const index = available.indexOf(category);
      let next: number;
      switch (event.key) {
        case 'ArrowRight':
          next = (index + 1) % available.length;
          break;
        case 'ArrowLeft':
          next = (index + available.length - 1) % available.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = available.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      showLibrary(available[next], true);
    });
  }
  for (const name of ['scene', 'project', 'transform']) {
    const trigger = element(`${name}-commands`, HTMLButtonElement);
    const panel = element(`${name}-command-panel`, HTMLElement);
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'false');
    function position() {
      if (!panel.matches(':popover-open')) {
        return;
      }
      const anchor = trigger.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 12))}px`;
      const below = anchor.bottom + 6;
      const top =
        below + bounds.height <= innerHeight - 12 ? below : anchor.top - bounds.height - 6;
      panel.style.top = `${Math.max(12, Math.min(top, innerHeight - bounds.height - 12))}px`;
    }
    panel.addEventListener(
      'toggle',
      () => {
        trigger.setAttribute('aria-expanded', String(panel.matches(':popover-open')));
        position();
      },
      { signal: lifetime.signal },
    );
    // Close before command handlers open a modal, preserving its autofocus target.
    panel.addEventListener(
      'click',
      (event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (button && !button.disabled && panel.matches(':popover-open')) {
          panel.hidePopover();
        }
      },
      { capture: true, signal: lifetime.signal },
    );
    window.addEventListener('resize', position, { signal: lifetime.signal });
  }
  const palette = element('show-palettes', HTMLButtonElement);
  const project = element('project-commands', HTMLButtonElement);
  function reflectPaletteState() {
    const failed = palette.dataset.state === 'fail';
    project.dataset.paletteState = palette.dataset.state;
    project.setAttribute(
      'aria-label',
      failed ? 'Project tools: GBC palette budget exceeded' : 'Project tools',
    );
    project.title = failed
      ? 'GBC palette budget exceeded. Open Project tools to inspect.'
      : 'World connections, diagnostics and GBC palette checks';
  }
  lifetime.observe(new MutationObserver(reflectPaletteState)).observe(palette, {
    attributes: true,
    attributeFilter: ['data-state'],
  });
  reflectPaletteState();
  return {
    showLibrary,
    showInspector() {
      showPane('inspector', true);
    },
    syncToolbar() {
      reflectToolbar(expandTools.getAttribute('aria-expanded') === 'true');
    },
    enableBlockout(enabled: boolean) {
      const tab = element('blockout-tab', HTMLButtonElement);
      tab.hidden = !enabled;
      if (!enabled && tab.getAttribute('aria-selected') === 'true') {
        selectLibrary('artwork');
      }
    },
    reveal(this: void, target: HTMLElement) {
      if (target.closest('#library-pane')) {
        showPane('library', true);
      }
      if (target.closest('#inspector-pane')) {
        showPane('inspector', true);
      }
      const panel = target.closest('[role=tabpanel]');
      const category = categories.find((name) => panel?.id === `${name}-panel`);
      if (category) {
        showLibrary(category);
      }
    },
  };
}
