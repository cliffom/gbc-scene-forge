import { ExternalRefreshState } from './editor-refresh-state.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { createAnimationPreview } from '../preview/animation-preview.mts';
import { record } from '../shared/decode.mts';
import { button, element, input, select } from '../editor/editor-dom.mts';
import type {
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from '../editor/editor-state.mts';
import type { ProjectApi } from './project-api.mts';
import type { Loaded } from './project-contracts.mts';
import { decodeLoaded } from './project-contracts.mts';

export interface Ports {
  captureBrush: () => {
    artwork: string | undefined;
    object: 'point' | 'rectangle' | null;
    definition: string | null;
    stamp: string | null;
    paintLabel: string;
    label: string;
  };
  refresh: (
    supplied?: Record<string, unknown>,
    canApply?: () => Promise<boolean>,
  ) => Promise<boolean>;
  open: (data: Loaded, chooseInitialBrush?: boolean) => void;
  restoreBrush: (choice: ReturnType<Ports['captureBrush']>) => void;
  draw: (refreshUI?: boolean) => void;
  update: () => void;
}
export function createRefreshController({
  lifetime,
  workspaceState,
  activity,
  sceneSession,
  gestures,
  animationPreview,
  api,
  status,
  sceneSelection,
  canvas,
  ports,
}: {
  lifetime: EditorLifetime;
  workspaceState: Pick<WorkspaceState, 'navigating' | 'project' | 'revision'>;
  activity: EditorActivity;
  sceneSession: Pick<SceneSession, 'baseline' | 'committed' | 'dirty' | 'editor' | 'loaded'>;
  gestures: Pick<
    GestureState,
    'anchor' | 'blockoutDraw' | 'objectDrag' | 'objectResize' | 'pan' | 'spacePan'
  >;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  api: ProjectApi['json'];
  status: HTMLElement;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  canvas: HTMLCanvasElement;
  ports: Ports;
}) {
  // Saved-file synchronization never adopts a snapshot over local work. Network
  // requests can run while the user starts editing, so recheck both state and an
  // interaction generation after every asynchronous dependency.
  const fence = new ExternalRefreshState();
  const livePreference = `forge:auto-refresh:${location.pathname}`;

  try {
    input('auto-refresh').checked = localStorage.getItem(livePreference) !== 'false';
  } catch {
    // Private browsing/storage restrictions do not disable synchronization.
  }

  function liveReady() {
    return Boolean(
      !lifetime.disposed &&
      workspaceState.project &&
      !activity.busy &&
      !workspaceState.navigating &&
      !sceneSession.dirty() &&
      !gestures.anchor &&
      !gestures.pan &&
      !gestures.spacePan &&
      !gestures.objectDrag &&
      !gestures.blockoutDraw &&
      !gestures.objectResize &&
      !fence.pointers.size &&
      !animationPreview.movement.active &&
      document.visibilityState === 'visible' &&
      !document.querySelector('dialog[open], [popover]:popover-open') &&
      !document.activeElement?.matches('input, select, textarea, [contenteditable="true"]') &&
      element('layers', HTMLElement).dataset.dragging !== 'true',
    );
  }

  function syncMessage(message = '') {
    const notice = element('sync-status', HTMLElement);
    notice.textContent = message;
    notice.hidden = !message;
  }

  async function checkExternalChanges(manual = false) {
    if (fence.request || (!manual && !input('auto-refresh').checked)) {
      return;
    }
    if (!liveReady()) {
      if (manual) {
        syncMessage(
          'Refresh paused. Finish the current interaction and save or revert local edits first.',
        );
      }
      return;
    }
    fence.request = true;
    const before = fence.capture(sceneSession, workspaceState);
    const current = () =>
      liveReady() &&
      fence.matches(before, sceneSession, workspaceState) &&
      (manual || input('auto-refresh').checked);
    const query = sceneSession.loaded ? `?scene=${encodeURIComponent(sceneSession.loaded.id)}` : '';
    try {
      const probe = await api(`revisions${query}`, record);
      if (!current()) {
        return;
      }
      if (
        probe.revision === workspaceState.revision &&
        probe.scene_revision === (sceneSession.loaded?.revision ?? null)
      ) {
        syncMessage();
        if (manual) {
          status.textContent = 'No external changes.';
        }
        return;
      }
      const data = await api(`snapshot${query}`, record);
      const next = data.scene === null ? null : decodeLoaded(data.scene);
      if (!current()) {
        return;
      }
      const viewport = element('viewport', HTMLElement);
      const view = {
        layer: sceneSession.editor?.active.id,
        tool: document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value,
        brush: ports.captureBrush(),
        selectedObject: sceneSelection.selectedObject,
        selectedObjects: new Set(sceneSelection.selectedObjects),
        selection: sceneSelection.selection ? { ...sceneSelection.selection } : null,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      const applied = await ports.refresh(data, async () => {
        if (!current()) {
          return false;
        }
        const latest = await api(`revisions${query}`, record);
        return (
          current() &&
          latest.revision === data.revision &&
          latest.scene_revision === (next?.revision ?? null)
        );
      });
      if (!applied) {
        if (sceneSession.dirty()) {
          syncMessage(
            'External changes detected. Local edits were kept; save or revert them before refreshing.',
          );
        }
        return;
      }
      if (next) {
        ports.open(next, false);
        ports.restoreBrush(view.brush);
        const tool = Array.from(
          document.querySelectorAll<HTMLInputElement>('input[name="tool"]'),
        ).find((control) => control.value === view.tool);
        if (tool) {
          tool.checked = true;
        }
        if (
          view.layer !== undefined &&
          sceneSession.editor?.layers.some((layer) => layer.id === view.layer)
        ) {
          sceneSession.editor.activate(view.layer);
        }
        const ids = new Set(
          sceneSession.editor?.layers.flatMap((layer) =>
            layer.type === 'objectgroup' ? layer.objects.map((item) => item.id) : [],
          ),
        );
        sceneSelection.selectedObject =
          view.selectedObject && ids.has(view.selectedObject) ? view.selectedObject : null;
        sceneSelection.selectedObjects = new Set(
          [...view.selectedObjects].filter((id) => ids.has(id)),
        );
        sceneSelection.selection =
          view.selection &&
          view.selection.x + view.selection.w <= next.width &&
          view.selection.y + view.selection.h <= next.height
            ? view.selection
            : null;
        ports.draw();
        viewport.scrollTo(view.left, view.top);
      } else if (before.sceneId) {
        sceneSession.loaded = sceneSession.committed = null;
        sceneSession.editor = null;
        sceneSession.baseline = '';
        sceneSelection.selection = null;
        sceneSelection.selectedObject = null;
        sceneSelection.selectedObjects.clear();
        animationPreview.reset();
        canvas.hidden = true;
        element('canvas-surround', HTMLElement).hidden = true;
        element('empty-scene', HTMLElement).hidden = false;
        element('scene-name', HTMLElement).textContent = 'Scene removed. Choose another scene.';
        select('scenes').value = '';
        ports.update();
      } else {
        ports.update();
      }
      syncMessage();
      status.textContent =
        before.sceneId && !next
          ? 'The open scene was removed externally. Choose another scene; saved recovery drafts remain available.'
          : 'External changes loaded. Undo/Redo history was cleared.';
    } catch (error) {
      if (lifetime.disposed) {
        return;
      }
      // No automatic modal and no mutation of local drafts on connection/parse errors.
      syncMessage(
        `External refresh unavailable; keeping the current view. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      fence.request = false;
    }
  }

  lifetime.assign(input('auto-refresh'), 'onchange', () => {
    try {
      localStorage.setItem(livePreference, String(input('auto-refresh').checked));
    } catch {
      /* Keep the choice for this tab even when persistence is unavailable. */
    }
    element('project-command-panel', HTMLElement).hidePopover();
    button('project-commands').focus();
    syncMessage();
    void checkExternalChanges();
  });

  lifetime.assign(button('check-external'), 'onclick', () => {
    element('project-command-panel', HTMLElement).hidePopover();
    button('project-commands').focus();
    void checkExternalChanges(true);
  });

  for (const event of ['input', 'change', 'keydown', 'wheel', 'focusin']) {
    document.addEventListener(
      event,
      () => {
        fence.epoch++;
      },
      { ...{ capture: true, passive: true }, signal: lifetime.signal },
    );
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      fence.epoch++;
      fence.pointers.add(event.pointerId);
    },
    { capture: true, signal: lifetime.signal },
  );

  for (const event of ['pointerup', 'pointercancel'] as const) {
    document.addEventListener(
      event,
      (event) => {
        fence.epoch++;
        fence.pointers.delete(event.pointerId);
      },
      { capture: true, signal: lifetime.signal },
    );
  }

  window.addEventListener(
    'blur',
    () => {
      fence.epoch++;
      fence.pointers.clear();
    },
    { signal: lifetime.signal },
  );

  window.addEventListener('focus', () => void checkExternalChanges(), { signal: lifetime.signal });

  window.addEventListener('online', () => void checkExternalChanges(), { signal: lifetime.signal });

  document.addEventListener(
    'visibilitychange',
    () => {
      fence.epoch++;
      if (document.visibilityState === 'visible') {
        void checkExternalChanges();
      }
    },
    { signal: lifetime.signal },
  );

  document.addEventListener(
    'focusout',
    () => lifetime.timeout(() => void checkExternalChanges(), 0),
    { signal: lifetime.signal },
  );

  lifetime.interval(() => void checkExternalChanges(), 2000);
  return { checkExternalChanges };
}
