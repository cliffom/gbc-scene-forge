/** One command surface; each active domain supplies its own capabilities. */
import { button } from './editor-dom.mts';
import type { EditorLifetime } from './editor-lifetime.mts';

export const commandButtons = {
  save: 'save',
  undo: 'undo',
  redo: 'redo',
  copy: 'copy-selection',
  cut: 'cut-selection',
  paste: 'paste-selection',
  duplicate: 'duplicate-selection',
  deselect: 'deselect',
  horizontal: 'flip-horizontal',
  vertical: 'flip-vertical',
  rotate: 'rotate-selection',
} as const;
export type DocumentCommand = keyof typeof commandButtons;
const commandNames: readonly DocumentCommand[] = [
  'save',
  'undo',
  'redo',
  'copy',
  'cut',
  'paste',
  'duplicate',
  'deselect',
  'horizontal',
  'vertical',
  'rotate',
];
export type CommandCapabilities = Partial<
  Record<
    DocumentCommand,
    {
      enabled: boolean;
      run: () => void;
      label?: string;
    }
  >
>;

export function createDocumentCommands(
  lifetime: EditorLifetime,
  current: () => CommandCapabilities,
  focus: () => void,
) {
  const titles = new Map(commandNames.map((name) => [name, button(commandButtons[name]).title]));
  lifetime.cleanup(() => {
    for (const command of commandNames) {
      button(commandButtons[command]).title = titles.get(command) ?? '';
    }
  });
  function invoke(command: DocumentCommand) {
    if (lifetime.disposed || document.querySelector('dialog[open]')) {
      return;
    }
    const capability = current()[command];
    if (capability?.enabled) {
      capability.run();
    }
  }
  for (const command of commandNames) {
    const id = commandButtons[command];
    lifetime.assign(button(id), 'onclick', (event) => {
      invoke(command);
      if (event.detail > 0 && command !== 'save' && !document.querySelector('dialog[open]')) {
        focus();
      }
    });
  }
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        document.querySelector('dialog[open], [popover]:popover-open:not(.notifications)') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input:not([type=radio]):not([type=checkbox]), select, textarea, a, [contenteditable]:not([contenteditable="false"])',
          ))
      ) {
        return;
      }
      const commands: Record<string, DocumentCommand> = {
        s: 'save',
        z: event.shiftKey ? 'redo' : 'undo',
        y: 'redo',
        c: 'copy',
        x: 'cut',
        v: 'paste',
        d: 'duplicate',
      };
      const command = commands[event.key.toLowerCase()];
      if (command) {
        event.preventDefault();
        invoke(command);
      }
    },
    { signal: lifetime.signal },
  );
  return {
    render() {
      if (lifetime.disposed) {
        return;
      }
      const capabilities = current();
      for (const command of commandNames) {
        const id = commandButtons[command];
        const capability = capabilities[command];
        const control = button(id);
        control.disabled = !capability?.enabled;
        control.title = capability
          ? (titles.get(command) ?? '')
          : `${titles.get(command) ?? ''} — unavailable for this document`;
        if (command === 'save') {
          control.textContent = capability?.label ?? 'Save';
          control.title = `${control.textContent} (⌘/Ctrl S)`;
          control.classList.toggle('primary', Boolean(capability?.enabled));
        }
      }
      button('transform-commands').disabled = !commandNames.some(
        (key) => ['horizontal', 'vertical', 'rotate'].includes(key) && capabilities[key]?.enabled,
      );
    },
  };
}
