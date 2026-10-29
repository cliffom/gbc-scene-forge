/** Native command popovers and keyboard-operable authoring library tabs. */
export type LibraryCategory = 'artwork' | 'objects' | 'stamps';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) {
    throw Error(`Missing layout element ${id}`);
  }
  return value;
}

export function createEditorLayout() {
  const categories: LibraryCategory[] = ['artwork', 'objects', 'stamps'];
  function showLibrary(category: LibraryCategory, focus = false) {
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
  for (const [index, category] of categories.entries()) {
    const tab = element(`${category}-tab`, HTMLButtonElement);
    tab.onclick = () => showLibrary(category);
    tab.onkeydown = (event) => {
      let next: number;
      switch (event.key) {
        case 'ArrowRight':
          next = (index + 1) % categories.length;
          break;
        case 'ArrowLeft':
          next = (index + categories.length - 1) % categories.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = categories.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      showLibrary(categories[next], true);
    };
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
    panel.addEventListener('toggle', () => {
      trigger.setAttribute('aria-expanded', String(panel.matches(':popover-open')));
      position();
    });
    // Close before command handlers open a modal, preserving its autofocus target.
    panel.addEventListener(
      'click',
      (event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (button && !button.disabled && panel.matches(':popover-open')) {
          panel.hidePopover();
        }
      },
      true,
    );
    window.addEventListener('resize', position);
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
  new MutationObserver(reflectPaletteState).observe(palette, {
    attributes: true,
    attributeFilter: ['data-state'],
  });
  reflectPaletteState();
  return {
    showLibrary,
    reveal(this: void, target: HTMLElement) {
      const panel = target.closest('[role=tabpanel]');
      const category = categories.find((name) => panel?.id === `${name}-panel`);
      if (category) {
        showLibrary(category);
      }
    },
  };
}
