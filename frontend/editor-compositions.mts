import type { EditorLifetime } from './editor-lifetime.mts';
import type { createAnimationPreview } from './animation-preview.mts';
import type { CompositionSelection } from './compositions.mts';
import { capture, eraseCaptured, paste, transform } from './compositions.mts';
import { record } from './decode.mts';
import { button, input, select } from './editor-dom.mts';
import type { createEditorLayout } from './editor-layout.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import { LayerEditor } from './layers.mts';
import { encodeObject } from './objects.mts';
import type { ProjectApi } from './project-api.mts';

export interface Ports {
  regions: ReadonlyMap<string, { image: HTMLImageElement; x: number; y: number }>;
  draw: (refreshUI?: boolean) => void;
  update: () => void;
  run: (work: () => Promise<void> | void) => Promise<void>;
  refresh: (
    supplied?: Record<string, unknown>,
    canApply?: () => Promise<boolean>,
  ) => Promise<boolean>;
}
export function createCompositionsController({
  lifetime,
  sceneSelection,
  sceneSession,
  workspaceState,
  activity,
  gestures,
  animationPreview,
  brushes,
  status,
  api,
  editorLayout,
  canvas,
  ports,
}: {
  lifetime: EditorLifetime;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  sceneSession: Pick<SceneSession, 'editor'>;
  workspaceState: Pick<WorkspaceState, 'project' | 'revision'>;
  activity: EditorActivity;
  gestures: Pick<GestureState, 'anchor' | 'hover'>;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  brushes: Pick<BrushState, 'clipboard' | 'definitionBrush' | 'stampBrush'>;
  status: HTMLElement;
  api: ProjectApi['json'];
  editorLayout: ReturnType<typeof createEditorLayout>;
  canvas: HTMLCanvasElement;
  ports: Ports;
}) {
  function compositionSelection(): CompositionSelection {
    return {
      rectangle: sceneSelection.selection,
      objects: sceneSelection.selectedObjects.size
        ? sceneSelection.selectedObjects
        : new Set(sceneSelection.selectedObject ? [sceneSelection.selectedObject] : []),
      allLayers: input('select-all-layers').checked || sceneSelection.selectedObjects.size > 0,
    };
  }

  function compositionAction(
    action: 'copy' | 'cut' | 'paste' | 'duplicate' | 'horizontal' | 'vertical' | 'rotate',
  ) {
    if (
      !sceneSession.editor ||
      !workspaceState.project ||
      activity.busy ||
      gestures.anchor ||
      animationPreview.movement.active
    ) {
      return;
    }
    try {
      const choice = compositionSelection();
      if (action === 'copy' || action === 'cut') {
        brushes.clipboard = capture(
          sceneSession.editor,
          choice,
          workspaceState.project.id,
        ).composition;
        if (action === 'cut') {
          eraseCaptured(sceneSession.editor, choice);
          sceneSelection.selection = null;
          sceneSelection.selectedObject = null;
          sceneSelection.selectedObjects.clear();
        }
        status.textContent =
          action === 'copy'
            ? 'Selection copied. Paste into a compatible scene in this project.'
            : 'Selection cut.';
      } else if (action === 'paste' || action === 'duplicate') {
        const copied =
          action === 'duplicate'
            ? capture(sceneSession.editor, choice, workspaceState.project.id)
            : null;
        const value = copied?.composition ?? brushes.clipboard;
        if (!value) {
          throw Error('Copy a selection first.');
        }
        const x = copied ? copied.x + 1 : (gestures.hover?.x ?? sceneSelection.selection?.x ?? 0);
        const y = copied ? copied.y + 1 : (gestures.hover?.y ?? sceneSelection.selection?.y ?? 0);
        sceneSelection.selectedObjects = paste(
          sceneSession.editor,
          value,
          workspaceState.project.id,
          x,
          y,
          (asset) => ports.regions.has(asset),
        );
        sceneSelection.selectedObject = null;
        if (value.scene.layers.length > 1) {
          input('select-all-layers').checked = true;
        }
        const firstLayer = value.scene.layers[0];
        const targetLayer = sceneSession.editor.layers.filter(
          (l) => l.name === firstLayer.name && l.type === firstLayer.type,
        )[value.slots[0]];
        sceneSession.editor.activate(targetLayer.id);
        sceneSelection.selection = value.scene.layers.some((l) => l.type === 'tilelayer')
          ? { x, y, w: value.scene.width, h: value.scene.height }
          : null;
        status.textContent = 'Composition placed. Undo reverses the entire placement.';
      } else {
        const copied = capture(sceneSession.editor, choice, workspaceState.project.id);
        const transformed = transform(copied.composition, action);
        const staged = new LayerEditor(
          sceneSession.editor.scene,
          [],
          sceneSession.editor.descriptor,
        );
        staged.spriteRegion = sceneSession.editor.spriteRegion;
        eraseCaptured(staged, choice);
        paste(
          staged,
          transformed,
          workspaceState.project.id,
          copied.x,
          copied.y,
          (asset) => ports.regions.has(asset),
          false,
        );
        sceneSession.editor.change(() => {
          if (sceneSession.editor) {
            sceneSession.editor.scene = staged.scene;
          }
        });
        sceneSelection.selection = {
          x: copied.x,
          y: copied.y,
          w: transformed.scene.width,
          h: transformed.scene.height,
        };
        sceneSelection.selectedObject = null;
        sceneSelection.selectedObjects.clear();
        status.textContent = 'Selection transformed around its top-left grid origin.';
      }
      ports.draw();
    } catch (error) {
      status.textContent = String(error instanceof Error ? error.message : error);
    }
  }

  const compositionCommands: Record<string, Parameters<typeof compositionAction>[0]> = {
    'copy-selection': 'copy',
    'cut-selection': 'cut',
    'paste-selection': 'paste',
    'duplicate-selection': 'duplicate',
    'flip-horizontal': 'horizontal',
    'flip-vertical': 'vertical',
    'rotate-selection': 'rotate',
  };

  for (const [id, action] of Object.entries(compositionCommands)) {
    lifetime.assign(button(id), 'onclick', () => compositionAction(action));
  }

  lifetime.assign(input('select-all-layers'), 'onchange', () => {
    sceneSelection.selection = null;
    sceneSelection.selectedObject = null;
    sceneSelection.selectedObjects.clear();
    ports.draw();
  });

  lifetime.assign(select('stamps'), 'onchange', () => {
    brushes.stampBrush = null;
    ports.update();
  });

  lifetime.assign(button('save-stamp'), 'onclick', () => {
    if (!sceneSession.editor || !workspaceState.project || activity.busy || gestures.anchor) {
      return;
    }
    try {
      const value = capture(
        sceneSession.editor,
        compositionSelection(),
        workspaceState.project.id,
      ).composition;
      const name = window.prompt('Name this reusable stamp:');
      if (!name?.trim()) {
        return;
      }
      void ports.run(async () => {
        const scene = {
          ...value.scene,
          layers: value.scene.layers.map((l) => ({
            ...l,
            ...(l.type === 'tilelayer'
              ? { cells: l.cells.map((r) => r.map((c) => (c === 'empty' ? '' : c))) }
              : { objects: l.objects.map(encodeObject) }),
          })),
        };
        await api('save-stamp', record, {
          name,
          scene,
          slots: value.slots,
          project_revision: workspaceState.revision,
        });
        await ports.refresh();
        ports.draw();
        editorLayout.showLibrary('stamps');
        status.textContent = 'Reusable stamp saved in the project.';
      });
    } catch (error) {
      status.textContent = String(error);
    }
  });

  lifetime.assign(button('place-stamp'), 'onclick', () => {
    brushes.definitionBrush = null;
    brushes.stampBrush = brushes.stampBrush
      ? null
      : (workspaceState.project?.stamps.find((s) => s.id === select('stamps').value)?.composition ??
        null);
    status.textContent = brushes.stampBrush
      ? 'Click the canvas to place the stamp repeatedly. Escape or choose a tool to stop.'
      : 'Stamp placement stopped.';
    ports.update();
    canvas.focus({ preventScroll: true });
  });

  lifetime.assign(
    button('delete-stamp'),
    'onclick',
    () =>
      void ports.run(async () => {
        await api('delete-stamp', record, {
          id: select('stamps').value,
          project_revision: workspaceState.revision,
        });
        brushes.stampBrush = null;
        await ports.refresh();
        ports.draw();
      }),
  );
  return { compositionAction, compositionSelection };
}
