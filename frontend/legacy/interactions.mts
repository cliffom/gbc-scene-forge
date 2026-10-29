import { errorDetails } from '../shared/errors.mts';
import { canvasPoint, clone } from '../scene/model.mts';
import type { Assets } from './assets.mts';
import { $, requireValue } from './dom.mts';
import type { Renderer } from './render.mts';
import type { EditorSession } from './session.mts';
import type { Point, Tool } from './types.ts';
import { guarded, status } from './ui.mts';
export interface EditActions {
  changed: () => void;
  markChanged: () => void;
}
export function createInteractions(
  state: EditorSession,
  assets: Assets,
  renderer: Renderer,
  actions: EditActions,
) {
  const { changed, markChanged } = actions;
  const { draw } = renderer;
  const { assetEntry, assetRegion, entries, chooseBrush } = assets;
  const canvas = $('scene');
  function point(event: MouseEvent) {
    const p = canvasPoint(event, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    return { ...p, tx: Math.floor(p.x / state.cellSize), ty: Math.floor(p.y / state.cellSize) };
  }
  const shortcuts: Record<string, Tool | undefined> = {
    p: 'paint',
    s: 'select',
    f: 'fill',
    e: 'erase',
    h: 'pan',
  };
  function decodeTool(value: unknown): Tool {
    if (
      value === 'select' ||
      value === 'paint' ||
      value === 'fill' ||
      value === 'erase' ||
      value === 'pan'
    ) {
      return value;
    }
    throw Error('Unknown editing tool');
  }
  function setTool(value: Tool) {
    state.tool = value;
    document
      .querySelectorAll<HTMLElement>('[data-tool]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === value)));
    canvas.style.cursor = value === 'pan' ? 'grab' : value === 'select' ? 'default' : 'crosshair';
    draw();
  }
  function paint(p: Point) {
    if (state.tool === 'erase') {
      state.editor.stamp(p.tx, p.ty, [[state.editor.floor]]);
    } else if (state.tool === 'fill') {
      if (!state.brush || state.brush.cells || state.brush.reference) {
        throw Error('Choose an individual tile for flood fill.');
      }
      state.editor.fill(p.tx, p.ty, state.brush.id);
    } else if (state.brush?.reference) {
      const asset = state.brush.id;
      state.editor.change((scene) =>
        scene.references.push({ id: crypto.randomUUID(), asset, x: p.x, y: p.y }),
      );
      state.selectedReference = requireValue(state.editor.scene.references.at(-1)).id;
    } else if (state.brush) {
      state.editor.stamp(p.tx, p.ty, state.brush.cells || [[state.brush.id]]);
    } else {
      throw Error('Choose a compatible brush from the asset library.');
    }
  }
  canvas.addEventListener(
    'pointerdown',
    guarded((event) => {
      if (!state.ready) {
        return;
      }
      if (event.button !== 0 && event.button !== 1) {
        return;
      }
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      $('viewport').focus();
      const p = point(event);
      if (state.tool === 'pan' || event.button === 1) {
        state.gesture = {
          type: 'pan',
          x: event.clientX,
          y: event.clientY,
          left: $('viewport').scrollLeft,
          top: $('viewport').scrollTop,
        };
      } else if (state.tool === 'select') {
        const ref = [...state.editor.scene.references].reverse().find((ref) => {
          const r = assetRegion(ref.asset),
            o = r.origin || [r.width / 2, r.height - 1];
          return (
            p.x >= ref.x - o[0] &&
            p.x < ref.x - o[0] + r.width &&
            p.y >= ref.y - o[1] &&
            p.y < ref.y - o[1] + r.height
          );
        });
        state.selectedReference = ref?.id || null;
        if (ref) {
          state.gesture = { type: 'reference', p, ref: clone(ref) };
        } else if (
          state.selection &&
          p.tx >= state.selection.x &&
          p.ty >= state.selection.y &&
          p.tx < state.selection.x + state.selection.w &&
          p.ty < state.selection.y + state.selection.h
        ) {
          state.gesture = { type: 'move', p };
        } else {
          state.selection = { x: p.tx, y: p.ty, w: 1, h: 1 };
          state.gesture = { type: 'selection', p };
        }
        renderReferences();
        draw();
      } else {
        state.editor.begin();
        state.gesture = { type: 'paint', last: null };
        paint(p);
        state.gesture.last = `${p.tx},${p.ty}`;
        changed();
        if (state.tool === 'fill' || state.brush?.reference) {
          state.editor.end();
          state.gesture = null;
          markChanged();
        }
      }
    }),
  );
  canvas.addEventListener(
    'pointermove',
    guarded((event) => {
      if (!state.ready) {
        return;
      }
      const p = point(event);
      state.hover = p;
      if (state.gesture) {
        state.gesture.current = p;
      }
      $('coordinates').textContent =
        `X ${p.tx.toString().padStart(2, '0')}   Y ${p.ty.toString().padStart(2, '0')}`;
      canvas.title = `${state.editor.scene.cells[p.ty]?.[p.tx] || 'Outside scene'}${state.editor.reasons.has(`${p.tx},${p.ty}`) ? ' · ' + state.editor.reasons.get(`${p.tx},${p.ty}`) : ''}`;
      if (state.gesture?.type === 'pan') {
        $('viewport').scrollLeft = state.gesture.left - event.clientX + state.gesture.x;
        $('viewport').scrollTop = state.gesture.top - event.clientY + state.gesture.y;
      } else if (state.gesture?.type === 'selection') {
        const tx = Math.max(0, Math.min(state.editor.scene.width - 1, p.tx)),
          ty = Math.max(0, Math.min(state.editor.scene.height - 1, p.ty));
        state.selection = {
          x: Math.min(state.gesture.p.tx, tx),
          y: Math.min(state.gesture.p.ty, ty),
          w: Math.abs(state.gesture.p.tx - tx) + 1,
          h: Math.abs(state.gesture.p.ty - ty) + 1,
        };
      } else if (state.gesture?.type === 'paint' && state.gesture.last !== `${p.tx},${p.ty}`) {
        // Interpolate fast strokes so pointer sampling cannot leave holes in a brush line.
        const [lx, ly] = (state.gesture.last || `${p.tx},${p.ty}`).split(',').map(Number);
        const count = Math.max(Math.abs(lx - p.tx), Math.abs(ly - p.ty));
        for (let i = 1; i <= count; i++) {
          const tx = Math.round(lx + ((p.tx - lx) * i) / count),
            ty = Math.round(ly + ((p.ty - ly) * i) / count);
          try {
            paint({ ...p, tx, ty });
          } catch (cause) {
            const error = errorDetails(cause);
            status(error.message);
          }
        }
        state.gesture.last = `${p.tx},${p.ty}`;
        changed();
      }
      draw();
    }),
  );
  canvas.addEventListener(
    'pointerup',
    guarded((event) => {
      if (!state.ready) {
        return;
      }
      const g = state.gesture;
      state.gesture = null;
      state.editor.end();
      if (g?.type === 'move') {
        const p = point(event),
          dx = p.tx - g.p.tx,
          dy = p.ty - g.p.ty;
        try {
          const moved = requireValue(state.selection);
          state.editor.move(moved, dx, dy);
          state.selection = { ...moved, x: moved.x + dx, y: moved.y + dy };
          changed();
        } catch (cause) {
          const error = errorDetails(cause);
          status(error.message);
        }
      } else if (g?.type === 'reference') {
        const p = point(event);
        state.editor.change((scene) => {
          const ref = requireValue(scene.references.find((r) => r.id === g.ref.id));
          ref.x = Math.max(0, Math.min(scene.width * state.cellSize - 1, g.ref.x + p.x - g.p.x));
          ref.y = Math.max(0, Math.min(scene.height * state.cellSize - 1, g.ref.y + p.y - g.p.y));
        });
        changed();
      }
      markChanged();
      draw();
    }),
  );
  canvas.addEventListener('pointercancel', () => {
    if (!state.ready) {
      return;
    }
    state.gesture = null;
    state.editor.cancel();
    changed();
  });
  canvas.addEventListener('pointerleave', () => {
    state.hover = null;
    draw();
  });
  canvas.addEventListener('dragover', (event) => event.preventDefault());
  canvas.addEventListener(
    'drop',
    guarded((event) => {
      if (!state.ready) {
        return;
      }
      event.preventDefault();
      const id = requireValue(event.dataTransfer).getData('text/plain');
      const entry = entries().find((e) => e.id === id && e.available);
      if (!entry) {
        throw Error('This asset is unavailable for the selected scene.');
      }
      chooseBrush(entry);
      const p = point(event);
      paint(p);
      changed();
      status(entry.reference ? 'Composition reference placed.' : 'Placement added.');
    }),
  );
  $('remove-reference').onclick = () => {
    state.editor.change((scene) => {
      scene.references = scene.references.filter((r) => r.id !== state.selectedReference);
    });
    state.selectedReference = null;
    changed();
  };
  function deselect() {
    const painting = state.editor.stroke !== null;
    state.gesture = null;
    state.editor.cancel();
    state.selection = null;
    state.selectedReference = null;
    if (painting) {
      changed();
    } else {
      renderReferences();
      draw();
    }
    status('Selection cleared.');
  }
  $('deselect').onclick = deselect;
  document.addEventListener(
    'keydown',
    guarded((event) => {
      if (!state.ready) {
        return;
      }
      if (
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName || '') ||
        document.querySelector('dialog[open]')
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          state.editor.redo();
        } else {
          state.editor.undo();
        }
        state.selection = null;
        changed();
      } else if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault();
        $('save').click();
      } else if (key === 'escape') {
        event.preventDefault();
        deselect();
      } else if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        if (state.selectedReference) {
          $('remove-reference').click();
        } else if (state.selection) {
          state.editor.erase(state.selection);
          changed();
        }
      } else if (!event.metaKey && !event.ctrlKey) {
        const shortcut = shortcuts[key];
        if (shortcut) {
          setTool(shortcut);
        }
      }
    }),
  );
  function renderReferences() {
    $('references').replaceChildren();
    $('reference-count').textContent = String(state.editor.scene.references.length);
    for (const ref of state.editor.scene.references) {
      const button = document.createElement('button');
      button.className = 'reference' + (state.selectedReference === ref.id ? ' selected' : '');
      button.textContent = `${assetEntry(ref.asset).label} · ${ref.x}, ${ref.y}`;
      button.onclick = () => {
        state.selectedReference = ref.id;
        setTool('select');
        renderReferences();
        draw();
      };
      $('references').append(button);
    }
    $('remove-reference').disabled = !state.editor.scene.references.some(
      (r) => r.id === state.selectedReference,
    );
  }
  document
    .querySelectorAll<HTMLElement>('[data-tool]')
    .forEach((b) => (b.onclick = () => setTool(decodeTool(b.dataset.tool))));
  return { setTool, renderReferences, deselect };
}
export type Interactions = ReturnType<typeof createInteractions>;
