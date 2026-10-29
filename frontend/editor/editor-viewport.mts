import type { EditorLifetime } from './editor-lifetime.mts';
import { blockoutAppearance } from '../blockout/blockout.mts';
import { button, element, input, select } from './editor-dom.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';

export interface Ports {
  draw: (refreshUI?: boolean) => void;
  viewport: HTMLElement;
  trackHover: (event: { clientX: number; clientY: number }) => void;
}
export function createViewportController({
  lifetime,
  sceneSession,
  workspaceState,
  brushes,
  activity,
  gestures,
  canvas,
  ports,
}: {
  lifetime: EditorLifetime;
  sceneSession: Pick<SceneSession, 'editor' | 'loaded'>;
  workspaceState: Pick<WorkspaceState, 'project'>;
  brushes: Pick<BrushState, 'planningScene'>;
  activity: EditorActivity;
  gestures: Pick<GestureState, 'anchor' | 'pan'>;
  canvas: HTMLCanvasElement;
  ports: Ports;
}) {
  function syncBlockoutZoom() {
    const planning = !!sceneSession.editor?.layers.some(
      (layer) =>
        layer.type === 'objectgroup' &&
        layer.objects.some(
          (item) => blockoutAppearance(item, workspaceState.project?.definitions ?? []) !== null,
        ),
    );
    const control = select('zoom');
    for (const [value, label] of [
      ['0.25', '25%'],
      ['0.5', '50%'],
    ]) {
      const existing = Array.from(control.options).find((option) => option.value === value);
      if (planning && !existing) {
        control.add(
          new Option(label, value),
          Array.from(control.options).find((option) => option.value === '1'),
        );
      } else if (!planning && existing) {
        if (existing.selected) {
          control.value = '1';
        }
        existing.remove();
      }
    }
    if (!planning && control.value !== 'fit') {
      element('fit-zoom-option', HTMLOptionElement).textContent = 'Fit';
    }
    return planning;
  }

  function sceneZoom() {
    if (select('zoom').value !== 'fit' || !sceneSession.loaded) {
      return Number(select('zoom').value) || 1;
    }
    const viewport = element('viewport', HTMLElement);
    const padding = getComputedStyle(element('canvas-surround', HTMLElement));
    const width =
      viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) - 2;
    const height =
      viewport.clientHeight -
      parseFloat(padding.paddingTop) -
      parseFloat(padding.paddingBottom) -
      2;
    const scale = Math.max(
      brushes.planningScene ? 1 / 64 : 1,
      Math.min(
        8,
        width / (sceneSession.loaded.width * sceneSession.loaded.grid),
        height / (sceneSession.loaded.height * sceneSession.loaded.grid),
      ),
    );
    const zoom = scale >= 1 ? Math.floor(scale) : scale;
    element('fit-zoom-option', HTMLOptionElement).textContent =
      `Fit (${zoom >= 1 ? `${zoom}×` : `${Math.round(zoom * 100)}%`})`;
    return zoom;
  }

  function fitScene() {
    if (!sceneSession.editor) {
      return;
    }
    select('zoom').value = 'fit';
    ports.draw();
    element('viewport', HTMLElement).scrollTo(0, 0);
  }

  lifetime.assign(button('fit-scene'), 'onclick', fitScene);

  let wheelDelta = 0;

  let lastWheel = 0;

  ports.viewport.addEventListener(
    'wheel',
    (event) => {
      if (
        !sceneSession.editor ||
        activity.busy ||
        document.querySelector('dialog[open], [popover]:popover-open') ||
        event.ctrlKey ||
        event.metaKey ||
        event.deltaY === 0 ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        return;
      }
      event.preventDefault();
      if (gestures.anchor || gestures.pan) {
        return;
      }
      const now = performance.now();
      if (now - lastWheel > 180 || Math.sign(wheelDelta) !== Math.sign(event.deltaY)) {
        wheelDelta = 0;
      }
      lastWheel = now;
      wheelDelta +=
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? ports.viewport.clientHeight : 1);
      if (Math.abs(wheelDelta) < 40) {
        return;
      }
      const direction = Math.sign(wheelDelta);
      wheelDelta = 0;
      const current = sceneZoom();
      const stops = Array.from(select('zoom').options, (option) => Number(option.value)).filter(
        Number.isFinite,
      );
      const next =
        direction < 0
          ? stops.find((value) => value > current + 0.001)
          : [...stops].reverse().find((value) => value < current - 0.001);
      if (next === undefined) {
        return;
      }
      const before = canvas.getBoundingClientRect();
      const x = (event.clientX - before.left) / before.width;
      const y = (event.clientY - before.top) / before.height;
      select('zoom').value = String(next);
      canvas.style.width = `${canvas.width * next}px`;
      canvas.style.height = `${canvas.height * next}px`;
      const after = canvas.getBoundingClientRect();
      ports.viewport.scrollLeft += after.left + x * after.width - event.clientX;
      ports.viewport.scrollTop += after.top + y * after.height - event.clientY;
      ports.trackHover(event);
      ports.draw();
    },
    { ...{ passive: false }, signal: lifetime.signal },
  );

  lifetime.assign(select('zoom'), 'onchange', () => {
    ports.draw();
    if (select('zoom').value === 'fit') {
      element('viewport', HTMLElement).scrollTo(0, 0);
    }
  });

  lifetime
    .observe(
      new ResizeObserver(() => {
        if (sceneSession.editor && select('zoom').value === 'fit') {
          ports.draw(false);
          element('viewport', HTMLElement).scrollTo(0, 0);
        }
      }),
    )
    .observe(element('viewport', HTMLElement));

  lifetime.assign(input('grid'), 'onchange', () => ports.draw());

  lifetime.assign(input('terrain-overlay'), 'onchange', () => ports.draw());

  lifetime.assign(input('collision-overlay'), 'onchange', () => ports.draw());

  lifetime.assign(input('snap'), 'onchange', () => ports.draw());
  return { sceneZoom, fitScene, syncBlockoutZoom };
}
