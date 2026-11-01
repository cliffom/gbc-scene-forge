import { paintTerrain, terrainRules } from '../artwork/terrain.mts';
import type { EditorLifetime } from './editor-lifetime.mts';
import type { createAnimationPreview } from '../preview/animation-preview.mts';
import {
  blockoutAppearance,
  definitionRole,
  dragRectangle,
  resizeRectangle,
} from '../blockout/blockout.mts';
import { paste } from '../compositions/compositions.mts';
import { element, input, select } from './editor-dom.mts';
import { editorFocus } from './editor-focus.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import { definitionInstance } from '../objects/object-definitions.mts';
import type { SceneObject } from '../objects/objects.mts';

export interface Ports {
  point: (event: { clientX: number; clientY: number }) => {
    x: number;
    y: number;
    px: number;
    py: number;
  };
  draw: (refreshUI?: boolean) => void;
  spritePosition: (
    x: number,
    y: number,
    altKey: boolean,
    item?: SceneObject,
  ) => { x: number; y: number };
  hitObject: (px: number, py: number) => SceneObject | undefined;
  sceneZoom: () => number;
  regions: ReadonlyMap<string, { image: HTMLImageElement; x: number; y: number }>;
  trackHover: (event: { clientX: number; clientY: number }) => void;
  update: () => void;
}
export function createGesturesController({
  lifetime,
  sceneSession,
  activity,
  gestures,
  canvas,
  sceneSelection,
  brushes,
  status,
  workspaceState,
  animationPreview,
  ports,
}: {
  lifetime: EditorLifetime;
  sceneSession: Pick<SceneSession, 'editor' | 'loaded'>;
  activity: EditorActivity;
  gestures: Pick<
    GestureState,
    'anchor' | 'blockoutDraw' | 'hover' | 'objectDrag' | 'objectResize' | 'pan' | 'spacePan'
  >;
  canvas: HTMLCanvasElement;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  brushes: Pick<
    BrushState,
    'brush' | 'definitionBrush' | 'objectBrush' | 'spriteBrush' | 'stampBrush'
  >;
  status: HTMLElement;
  workspaceState: Pick<WorkspaceState, 'project'>;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  ports: Ports;
}) {
  function paint(event: PointerEvent) {
    if (!sceneSession.editor || activity.busy || !gestures.anchor) {
      return;
    }
    const p = ports.point(event);
    const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
    try {
      sceneSession.editor.editable();
      if (gestures.blockoutDraw || gestures.objectResize) {
        const gesture = gestures.blockoutDraw ?? gestures.objectResize;
        const item = sceneSession.editor.objects.find((item) => item.id === gesture?.id);
        if (item?.kind === 'rectangle' && gesture) {
          const step =
            input('snap').checked && !event.altKey ? (sceneSession.loaded?.grid ?? 8) : 1;
          const end = { x: p.px, y: p.py };
          const geometry = gestures.blockoutDraw
            ? dragRectangle(gestures.blockoutDraw, end, canvas.width, canvas.height, step)
            : resizeRectangle(gesture, end, canvas.width, canvas.height, step);
          sceneSession.editor.replaceObject({ ...item, ...geometry });
        }
        ports.draw();
        return;
      }
      if (gestures.objectDrag) {
        const drag = gestures.objectDrag;
        const origin = gestures.anchor;
        // Selecting an off-grid sprite must not move it before an actual drag.
        if (event.type === 'pointerdown') {
          ports.draw();
          return;
        }
        const position =
          p.px === origin.px && p.py === origin.py
            ? drag
            : ports.spritePosition(
                drag.x + p.px - origin.px,
                drag.y + p.py - origin.py,
                event.altKey,
                sceneSession.editor.objects.find((item) => item.id === drag.id),
              );
        sceneSession.editor.change(() => {
          sceneSession.editor?.editable('objectgroup');
          const item = sceneSession.editor?.objects.find((ref) => ref.id === drag.id);
          if (item) {
            item.x = position.x;
            item.y = position.y;
          }
        });
      } else if (tool === 'select') {
        if (
          p.x < 0 ||
          p.y < 0 ||
          p.x >= sceneSession.editor.scene.width ||
          p.y >= sceneSession.editor.scene.height
        ) {
          throw Error('Selection is outside the scene.');
        }
        sceneSelection.selection = {
          x: Math.min(gestures.anchor.x, p.x),
          y: Math.min(gestures.anchor.y, p.y),
          w: Math.abs(p.x - gestures.anchor.x) + 1,
          h: Math.abs(p.y - gestures.anchor.y) + 1,
        };
      } else if (
        select('terrain-brush').value &&
        sceneSession.editor.active.type === 'tilelayer' &&
        !brushes.brush &&
        !brushes.spriteBrush &&
        !brushes.objectBrush &&
        !brushes.definitionBrush &&
        !brushes.stampBrush &&
        (tool === 'paint' || tool === 'erase' || tool === 'fill')
      ) {
        if (tool === 'fill') {
          throw Error('Terrain brushes support Paint and Erase. Choose individual tiles to Fill.');
        }
        const warnings = paintTerrain(
          sceneSession.editor,
          terrainRules(workspaceState.project, sceneSession.editor.scene.grid),
          select('terrain-brush').value,
          p.x,
          p.y,
          tool === 'erase',
        );
        status.textContent = warnings.length
          ? warnings.join(' ')
          : `Terrain ${tool === 'erase' ? 'erased' : 'painted'} with neighbor updates.`;
      } else if (tool === 'erase') {
        const hit = ports.hitObject(p.px, p.py);
        if (hit) {
          sceneSession.editor.change(() => {
            if (sceneSession.editor) {
              sceneSession.editor.objects = sceneSession.editor.objects.filter(
                (r) => r.id !== hit.id,
              );
            }
          });
        } else if (sceneSession.editor.active.type === 'tilelayer') {
          sceneSession.editor.stamp(p.x, p.y, [['empty']]);
        }
      } else if (brushes.objectBrush && tool === 'paint' && event.type === 'pointerdown') {
        if (p.px < 0 || p.py < 0 || p.px >= canvas.width || p.py >= canvas.height) {
          throw Error('Place the object inside the scene.');
        }
        const position = ports.spritePosition(p.px, p.py, event.altKey);
        const common = { x: position.x, y: position.y, name: '', properties: [] };
        sceneSelection.selectedObject = sceneSession.editor.createObject(
          brushes.objectBrush === 'point'
            ? { ...common, kind: 'point', class: 'spawn' }
            : {
                ...common,
                kind: 'rectangle',
                class: 'trigger',
                width: Math.min(sceneSession.loaded?.grid || 8, canvas.width - position.x),
                height: Math.min(sceneSession.loaded?.grid || 8, canvas.height - position.y),
              },
        );
        sceneSelection.selection = null;
      } else if (brushes.spriteBrush && tool === 'paint' && event.type === 'pointerdown') {
        sceneSession.editor.editable('objectgroup');
        const asset = brushes.spriteBrush;
        if (p.px < 0 || p.py < 0 || p.px >= canvas.width || p.py >= canvas.height) {
          throw Error('Place the sprite origin inside the scene.');
        }
        const position = ports.spritePosition(p.px, p.py, event.altKey);
        sceneSelection.selectedObject = sceneSession.editor.createObject({
          kind: 'sprite',
          asset,
          x: position.x,
          y: position.y,
          name: '',
          class: '',
          properties: [],
        });
        sceneSelection.selection = null;
      } else if (brushes.brush && tool === 'paint') {
        sceneSession.editor.stamp(p.x, p.y, brushes.brush);
      } else if (brushes.brush && tool === 'fill') {
        if (brushes.brush.length !== 1 || brushes.brush[0].length !== 1) {
          throw Error(
            'Fill needs a one-cell region. Choose a smaller region or another grid size.',
          );
        }
        sceneSession.editor.fill(p.x, p.y, brushes.brush[0][0]);
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
    ports.draw();
  }

  function panEnabled() {
    return (
      activity.reviewing ||
      gestures.spacePan ||
      document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value === 'pan'
    );
  }

  function syncPanCursor() {
    const viewport = element('viewport', HTMLElement);
    viewport.dataset.pan = String(
      Boolean(sceneSession.editor && !activity.busy && (panEnabled() || gestures.pan)),
    );
    viewport.dataset.panning = String(gestures.pan !== null);
  }

  function finishPan() {
    const pointer = gestures.pan?.pointer;
    gestures.pan = null;
    const viewport = element('viewport', HTMLElement);
    if (pointer !== undefined && viewport.hasPointerCapture(pointer)) {
      viewport.releasePointerCapture(pointer);
    }
    syncPanCursor();
  }

  function releaseSpacePan() {
    const held = gestures.spacePan;
    gestures.spacePan = false;
    // Middle-button capture is independent of the temporary Space shortcut.
    if (gestures.pan?.button !== 1) {
      finishPan();
    }
    if (held) {
      ports.draw();
    }
  }

  function panShortcutBlocked(target: EventTarget | null) {
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, select, textarea, button, a, [contenteditable]:not([contenteditable="false"]), dialog, #animation-preview',
        ),
      )
    );
  }

  editorFocus(
    element('workspace', HTMLElement),
    canvas,
    () => Boolean(sceneSession.editor),
    lifetime,
  );

  const viewport = element('viewport', HTMLElement);

  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !sceneSession.editor ||
        activity.busy ||
        !(event.button === 1 || (event.button === 0 && panEnabled())) ||
        !event.isPrimary ||
        gestures.pan ||
        gestures.anchor
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      canvas.focus({ preventScroll: true });
      lifetime.capture(viewport, event.pointerId);
      gestures.pan = {
        pointer: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      syncPanCursor();
    },
    { capture: true, signal: lifetime.signal },
  );

  viewport.addEventListener(
    'pointermove',
    (event) => {
      if (!gestures.pan || event.pointerId !== gestures.pan.pointer) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Chorded mouse buttons can report the initiating button's release as a
      // pointermove rather than pointerup while another button remains held.
      if (!(event.buttons & (gestures.pan.button === 1 ? 4 : 1))) {
        finishPan();
        return;
      }
      viewport.scrollLeft = gestures.pan.left - event.clientX + gestures.pan.x;
      viewport.scrollTop = gestures.pan.top - event.clientY + gestures.pan.y;
    },
    { capture: true, signal: lifetime.signal },
  );

  viewport.addEventListener(
    'auxclick',
    (event) => {
      if (sceneSession.editor && event.button === 1) {
        event.preventDefault();
      }
    },
    { signal: lifetime.signal },
  );

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    viewport.addEventListener(
      type,
      (event) => {
        if (
          !gestures.pan ||
          event.pointerId !== gestures.pan.pointer ||
          (type === 'lostpointercapture' && event.target !== viewport)
        ) {
          return;
        }
        event.stopPropagation();
        finishPan();
      },
      { capture: true, signal: lifetime.signal },
    );
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.code !== 'Space' && event.key !== ' ') {
        return;
      }
      if (gestures.spacePan) {
        event.preventDefault();
        return;
      }
      if (
        !sceneSession.editor ||
        activity.busy ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('dialog[open], [popover]:popover-open') ||
        panShortcutBlocked(event.target)
      ) {
        return;
      }
      event.preventDefault();
      if (
        event.repeat ||
        gestures.pan ||
        gestures.anchor ||
        sceneSession.editor.stroke ||
        document.querySelector('#layers[data-dragging=true]')
      ) {
        return;
      }
      gestures.spacePan = true;
      syncPanCursor();
      ports.draw();
    },
    { capture: true, signal: lifetime.signal },
  );

  window.addEventListener(
    'keyup',
    (event) => {
      if (event.code === 'Space' || event.key === ' ') {
        releaseSpacePan();
      }
    },
    { signal: lifetime.signal },
  );

  function cancelPan() {
    releaseSpacePan();
    finishPan();
  }

  window.addEventListener('blur', cancelPan, { signal: lifetime.signal });

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelPan();
      }
    },
    { signal: lifetime.signal },
  );

  document.addEventListener(
    'focusin',
    (event) => {
      if (gestures.spacePan && panShortcutBlocked(event.target)) {
        releaseSpacePan();
      }
    },
    { signal: lifetime.signal },
  );

  lifetime.assign(canvas, 'onpointerdown', (event) => {
    if (!sceneSession.editor || activity.busy || activity.reviewing || event.button !== 0) {
      return;
    }
    const selected = sceneSession.editor.objects.find(
      (item) => item.id === sceneSelection.selectedObject,
    );
    const selectTool =
      document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value === 'select';
    if (
      selectTool &&
      selected?.kind === 'rectangle' &&
      blockoutAppearance(selected, workspaceState.project?.definitions ?? [])
    ) {
      const p = ports.point(event),
        radius = 7 / ports.sceneZoom();
      if (
        Math.abs(p.px - selected.x - selected.width) <= radius &&
        Math.abs(p.py - selected.y - selected.height) <= radius
      ) {
        gestures.objectResize = { id: selected.id, x: selected.x, y: selected.y };
        gestures.anchor = p;
        sceneSession.editor.begin();
        lifetime.capture(canvas, event.pointerId);
        canvas.focus({ preventScroll: true });
        return;
      }
    }
    if (
      brushes.definitionBrush &&
      workspaceState.project &&
      document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value === 'paint'
    ) {
      try {
        const definition = workspaceState.project.definitions.find(
          (d) => d.id === brushes.definitionBrush,
        );
        if (!definition) {
          throw Error('Choose an existing definition.');
        }
        const p = ports.point(event);
        const position = ports.spritePosition(p.px, p.py, event.altKey);
        const item = definitionInstance(definition, position.x, position.y);
        const isBlockout = definitionRole(definition).length > 0;
        if (isBlockout) {
          item.name = definition.name;
        }
        if (item.kind === 'rectangle' && isBlockout) {
          item.width = Math.min(item.width, canvas.width - item.x);
          item.height = Math.min(item.height, canvas.height - item.y);
          sceneSession.editor.begin();
          sceneSelection.selectedObject = sceneSession.editor.createObject(item);
          gestures.blockoutDraw = {
            id: sceneSelection.selectedObject,
            x: position.x,
            y: position.y,
          };
          gestures.anchor = p;
          lifetime.capture(canvas, event.pointerId);
          canvas.focus({ preventScroll: true });
        } else {
          sceneSelection.selectedObject = sceneSession.editor.createObject(item);
        }
        sceneSelection.selectedObjects.clear();
        sceneSelection.selection = null;
        ports.draw();
      } catch (error) {
        status.textContent = String(error);
      }
      return;
    }
    if (brushes.stampBrush && workspaceState.project) {
      try {
        const p = ports.point(event);
        paste(
          sceneSession.editor,
          brushes.stampBrush,
          workspaceState.project.id,
          p.x,
          p.y,
          (asset) => ports.regions.has(asset),
        );
        ports.draw();
      } catch (error) {
        status.textContent = String(error);
      }
      return;
    }
    lifetime.capture(canvas, event.pointerId);
    canvas.focus({ preventScroll: true });
    gestures.anchor = ports.point(event);
    ports.trackHover(event);
    const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
    sceneSession.editor.begin();
    if (tool === 'select') {
      const hit = ports.hitObject(gestures.anchor.px, gestures.anchor.py);
      if (event.shiftKey && hit) {
        if (sceneSelection.selectedObject) {
          sceneSelection.selectedObjects.add(sceneSelection.selectedObject);
        }
        if (sceneSelection.selectedObjects.has(hit.id)) {
          sceneSelection.selectedObjects.delete(hit.id);
        } else {
          sceneSelection.selectedObjects.add(hit.id);
        }
        sceneSelection.selectedObject = null;
        sceneSelection.selection = null;
        gestures.objectDrag = null;
        gestures.anchor = null;
        sceneSession.editor.end();
        ports.draw();
        return;
      }
      sceneSelection.selectedObjects.clear();
      sceneSelection.selectedObject = hit?.id ?? null;
      sceneSelection.selection = null;
      gestures.objectDrag = hit ? { id: hit.id, x: hit.x, y: hit.y } : null;
    }
    paint(event);
  });

  lifetime.assign(canvas, 'onpointermove', (event) => {
    const previous = gestures.hover;
    ports.trackHover(event);
    if (gestures.anchor) {
      paint(event);
    } else if (previous?.x !== gestures.hover?.x || previous?.y !== gestures.hover?.y) {
      ports.draw();
    }
  });

  lifetime.assign(canvas, 'onpointerleave', () => {
    gestures.hover = null;
    element('coordinates', HTMLElement).textContent = 'Cell —, — · Pixel —, —';
    ports.draw();
  });

  lifetime.assign(canvas, 'onpointerup', () => {
    gestures.blockoutDraw = null;
    gestures.objectResize = null;
    sceneSession.editor?.end();
    gestures.anchor = null;
    gestures.objectDrag = null;
    ports.update();
  });

  lifetime.assign(canvas, 'onpointercancel', () => {
    gestures.blockoutDraw = null;
    gestures.objectResize = null;
    sceneSession.editor?.cancel();
    gestures.anchor = null;
    gestures.objectDrag = null;
    ports.draw();
  });

  lifetime.assign(canvas, 'onlostpointercapture', () => {
    gestures.blockoutDraw = null;
    gestures.objectResize = null;
    sceneSession.editor?.end();
    gestures.anchor = null;
    gestures.objectDrag = null;
    ports.update();
  });

  lifetime.assign(canvas, 'ondragover', (event) => {
    if (
      !activity.busy &&
      !activity.reviewing &&
      sceneSession.editor &&
      event.dataTransfer?.types.includes('application/x-forge-asset')
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });

  lifetime.assign(canvas, 'ondrop', (event) => {
    if (activity.reviewing || animationPreview.movement.active) {
      event.preventDefault();
      return;
    }
    if (!sceneSession.editor || activity.busy) {
      return;
    }
    const key = event.dataTransfer?.getData('application/x-forge-asset');
    const asset = Array.from(
      element('palette', HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((item) => item.dataset.asset === key && !item.disabled);
    if (!asset) {
      return;
    }
    event.preventDefault();
    asset.click();
    canvas.focus({ preventScroll: true });
    gestures.anchor = ports.point(event);
    sceneSession.editor.begin();
    paint(
      new PointerEvent('pointerdown', {
        clientX: event.clientX,
        clientY: event.clientY,
        altKey: event.altKey,
      }),
    );
    sceneSession.editor.end();
    gestures.anchor = null;
    ports.draw();
  });
  return { syncPanCursor, viewport, finishPan };
}
