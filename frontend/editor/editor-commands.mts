import type { EditorLifetime } from './editor-lifetime.mts';
import type { createAnimationPreview } from '../preview/animation-preview.mts';
import type { CompositionSelection } from '../compositions/compositions.mts';
import { capture, eraseCaptured, paste } from '../compositions/compositions.mts';
import { button, element, form, input, select } from './editor-dom.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import { downloadArchive } from '../scene/export.mts';
import { LayerEditor } from '../scene/layers.mts';
import type { ProjectApi } from '../project/project-api.mts';

export interface Ports {
  run: (work: () => Promise<void> | void) => Promise<void>;
  showImport: (reimport?: boolean) => void;
  filterPalette: () => void;
  draw: (refreshUI?: boolean) => void;
  syncPanCursor: () => void;
  compositionAction: (
    action: 'copy' | 'cut' | 'paste' | 'duplicate' | 'horizontal' | 'vertical' | 'rotate',
  ) => void;
  compositionSelection: () => CompositionSelection;
  regions: ReadonlyMap<string, { image: HTMLImageElement; x: number; y: number }>;
}
export function createCommandsController({
  lifetime,
  workspaceState,
  sceneSession,
  activity,
  gestures,
  status,
  request,
  sceneSelection,
  brushes,
  canvas,
  animationPreview,
  ports,
}: {
  lifetime: EditorLifetime;
  workspaceState: Pick<WorkspaceState, 'navigating' | 'project' | 'revision'>;
  sceneSession: Pick<SceneSession, 'dirty' | 'editor' | 'loaded' | 'serialize'>;
  activity: EditorActivity;
  gestures: Pick<GestureState, 'anchor'>;
  status: HTMLElement;
  request: ProjectApi['request'];
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  brushes: Pick<BrushState, 'definitionBrush' | 'stampBrush'>;
  canvas: HTMLCanvasElement;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  ports: Ports;
}) {
  function exportDetails() {
    const projectScope = select('export-scope').value === 'project';
    element('export-details', HTMLElement).textContent = projectScope
      ? `Export all ${workspaceState.project?.scenes.length || 0} saved scene(s) and managed assets. The ZIP can be reopened in Forge or Tiled.`
      : `Export “${sceneSession.loaded?.name || ''}” and all referenced tilesets and PNGs for Tiled.`;
    element('export-canvas-field', HTMLElement).hidden =
      !sceneSession.editor || !sceneSession.dirty();
  }

  lifetime.assign(button('show-palettes'), 'onclick', () => {
    element('palette-dialog', HTMLDialogElement).showModal();
  });

  lifetime.assign(button('palette-close'), 'onclick', () => {
    element('palette-dialog', HTMLDialogElement).close();
  });

  lifetime.assign(button('show-export'), 'onclick', () => {
    if (!workspaceState.project || activity.busy || gestures.anchor) {
      return;
    }
    select('export-scope').replaceChildren(
      ...(sceneSession.loaded ? [new Option('Open scene', 'scene')] : []),
      new Option('Whole project', 'project'),
    );
    input('export-canvas').checked = !!sceneSession.editor && sceneSession.dirty();
    exportDetails();
    element('export-form', HTMLFormElement).querySelector('.form-error')?.replaceChildren();
    element('export-dialog', HTMLDialogElement).showModal();
  });

  lifetime.assign(select('export-scope'), 'onchange', exportDetails);

  lifetime.assign(button('export-cancel'), 'onclick', () => {
    if (!activity.busy) {
      element('export-dialog', HTMLDialogElement).close();
    }
  });

  lifetime.assign(element('export-dialog', HTMLDialogElement), 'oncancel', (event) => {
    if (activity.busy) {
      event.preventDefault();
    }
  });

  lifetime.assign(form('export-form'), 'onsubmit', (event) => {
    event.preventDefault();
    if (!workspaceState.project || activity.busy) {
      return;
    }
    const scope = select('export-scope').value;
    const includeCanvas =
      !!sceneSession.editor && sceneSession.dirty() && input('export-canvas').checked;
    const payload = {
      scope,
      project_revision: workspaceState.revision,
      ...(sceneSession.loaded && (scope === 'scene' || includeCanvas)
        ? { scene_id: sceneSession.loaded.id, scene_revision: sceneSession.loaded.revision }
        : {}),
      ...(includeCanvas ? { scene: sceneSession.serialize() } : {}),
    };
    void ports.run(async () => {
      status.textContent = 'Preparing portable export…';
      await downloadArchive(await request('export', payload, 120000), lifetime);
      element('export-dialog', HTMLDialogElement).close();
      status.textContent = includeCanvas
        ? 'Export downloaded with open scene edits. Those edits are still unsaved in this project.'
        : 'Portable export downloaded.';
    });
  });

  lifetime.assign(button('library-import'), 'onclick', () => ports.showImport());

  for (const close of document.querySelectorAll<HTMLButtonElement>('[data-close]')) {
    lifetime.assign(close, 'onclick', () => {
      const id = close.dataset.close;
      if (id && !activity.busy) {
        element(id, HTMLDialogElement).close();
      }
    });
  }

  lifetime.assign(input('search'), 'oninput', ports.filterPalette);

  lifetime.assign(select('atlas-filter'), 'onchange', ports.filterPalette);

  lifetime.assign(select('kind-filter'), 'onchange', ports.filterPalette);

  lifetime.assign(button('deselect'), 'onclick', () => {
    sceneSelection.selection = null;
    sceneSelection.selectedObject = null;
    sceneSelection.selectedObjects.clear();
    ports.draw();
  });

  lifetime.assign(button('remove-sprite'), 'onclick', () => {
    const id = sceneSelection.selectedObject;
    sceneSession.editor?.change(() => {
      if (sceneSession.editor) {
        sceneSession.editor.objects = sceneSession.editor.objects.filter((r) => r.id !== id);
      }
    });
    sceneSelection.selectedObject = null;
    sceneSelection.selectedObjects.clear();
    ports.draw();
  });

  for (const control of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) {
    lifetime.assign(control, 'onchange', () => {
      brushes.stampBrush = null;
      ports.syncPanCursor();
      ports.draw();
    });
  }

  // Active preview captures scene gestures so they cannot become authoring strokes.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick']) {
    canvas.addEventListener(
      type,
      (event) => {
        if (!animationPreview.movement.active) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type === 'pointerdown') {
          canvas.focus({ preventScroll: true });
        }
      },
      { ...{ capture: true }, signal: lifetime.signal },
    );
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (activity.reviewing) {
        // Keep native focus/zoom controls and viewport scrolling; block authoring shortcuts.
        if (
          ['Delete', 'Backspace'].includes(event.key) ||
          ((event.ctrlKey || event.metaKey) &&
            ['c', 'x', 'v', 'd', 's', 'z', 'y'].includes(event.key.toLowerCase()))
        ) {
          event.preventDefault();
        }
        return;
      }
      if (
        sceneSession.editor &&
        !activity.busy &&
        !document.querySelector('dialog[open], [popover]:popover-open') &&
        event.target instanceof HTMLInputElement &&
        ['layer-name', 'search'].includes(event.target.id) &&
        ['Enter', 'Escape'].includes(event.key) &&
        !event.isComposing
      ) {
        event.preventDefault();
        if (event.key === 'Escape' && event.target.id === 'layer-name') {
          event.target.value = sceneSession.editor.active.name;
        }
        canvas.focus({ preventScroll: true });
        return;
      }
      if (!activity.busy && animationPreview.movement.keydown(event)) {
        return;
      }
      if (
        (event.target instanceof Element && event.target.closest('#animation-preview')) ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof Element &&
          Boolean(event.target.closest('a, [contenteditable]:not([contenteditable="false"])'))) ||
        (event.target instanceof HTMLButtonElement && !event.ctrlKey && !event.metaKey) ||
        document.querySelector('dialog[open], [popover]:popover-open') ||
        activity.busy
      ) {
        return;
      }
      try {
        if (event.key === 'Escape' && brushes.definitionBrush) {
          brushes.definitionBrush = null;
          ports.draw();
        }
        if (event.key === 'Escape' && brushes.stampBrush) {
          event.preventDefault();
          brushes.stampBrush = null;
          status.textContent = 'Stamp placement stopped.';
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          ['c', 'x', 'v', 'd'].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          const commands: Record<string, Parameters<typeof ports.compositionAction>[0]> = {
            c: 'copy',
            x: 'cut',
            v: 'paste',
            d: 'duplicate',
          };
          ports.compositionAction(commands[event.key.toLowerCase()]);
        } else if (
          (event.ctrlKey || event.metaKey) &&
          ['s', 'z', 'y'].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          button(
            event.key.toLowerCase() === 's'
              ? 'save'
              : event.key.toLowerCase() === 'y' || event.shiftKey
                ? 'redo'
                : 'undo',
          ).click();
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          sceneSession.editor &&
          ['s', 'p', 'f', 'e', 'h'].includes(event.key.toLowerCase())
        ) {
          const tools: Record<string, string> = {
            s: 'select',
            p: 'paint',
            f: 'fill',
            e: 'erase',
            h: 'pan',
          };
          const control = document.querySelector<HTMLInputElement>(
            `input[name="tool"][value="${tools[event.key.toLowerCase()]}"]`,
          );
          if (control && !control.disabled) {
            event.preventDefault();
            control.checked = true;
            control.dispatchEvent(new Event('change'));
          }
        } else if (
          sceneSelection.selectedObjects.size &&
          !sceneSelection.selection &&
          sceneSession.editor
        ) {
          if (event.key === 'Escape') {
            sceneSelection.selectedObjects.clear();
            ports.draw();
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            eraseCaptured(sceneSession.editor, ports.compositionSelection());
            sceneSelection.selectedObjects.clear();
            ports.draw();
          }
        } else if (sceneSelection.selectedObject && sceneSession.editor) {
          const id = sceneSelection.selectedObject;
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            sceneSession.editor.change(() => {
              if (sceneSession.editor) {
                sceneSession.editor.objects = sceneSession.editor.objects.filter(
                  (r) => r.id !== id,
                );
              }
            });
            sceneSelection.selectedObject = null;
            sceneSelection.selectedObjects.clear();
          } else if (event.key === 'Escape') {
            sceneSelection.selectedObject = null;
            sceneSelection.selectedObjects.clear();
          } else {
            const move: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const delta = move[event.key];
            if (delta) {
              event.preventDefault();
              sceneSession.editor.change(() => {
                const item = sceneSession.editor?.objects.find((r) => r.id === id);
                if (item) {
                  item.x = Math.max(
                    0,
                    Math.min(
                      canvas.width - (item.kind === 'rectangle' ? item.width : 1),
                      item.x + delta[0],
                    ),
                  );
                  item.y = Math.max(
                    0,
                    Math.min(
                      canvas.height - (item.kind === 'rectangle' ? item.height : 1),
                      item.y + delta[1],
                    ),
                  );
                }
              });
            }
          }
          ports.draw();
        } else if (sceneSelection.selection && sceneSession.editor) {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            eraseCaptured(sceneSession.editor, ports.compositionSelection());
          } else {
            const move: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const delta = move[event.key];
            if (delta) {
              event.preventDefault();
              const copied = capture(
                sceneSession.editor,
                ports.compositionSelection(),
                workspaceState.project?.id ?? '',
              );
              const staged = new LayerEditor(
                sceneSession.editor.scene,
                [],
                sceneSession.editor.descriptor,
              );
              staged.spriteRegion = sceneSession.editor.spriteRegion;
              eraseCaptured(staged, ports.compositionSelection());
              paste(
                staged,
                copied.composition,
                workspaceState.project?.id ?? '',
                copied.x + delta[0],
                copied.y + delta[1],
                (asset) => ports.regions.has(asset),
                false,
              );
              sceneSession.editor.change(() => {
                if (sceneSession.editor) {
                  sceneSession.editor.scene = staged.scene;
                }
              });
              sceneSelection.selection.x += delta[0];
              sceneSelection.selection.y += delta[1];
            } else if (event.key === 'Escape') {
              sceneSelection.selection = null;
            }
          }
          ports.draw();
        }
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    },
    { signal: lifetime.signal },
  );

  window.addEventListener(
    'beforeunload',
    (event) => {
      if (!workspaceState.navigating && (sceneSession.dirty() || activity.busy)) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
    { signal: lifetime.signal },
  );
  return {};
}
