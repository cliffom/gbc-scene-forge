/** Transient artwork navigation/target feedback; never touches authored state. */
import { button, element } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { PixelTool, Point } from './pixel-model.mts';

type View = { x: number; y: number; width: number; height: number };
export type ArtworkViewState = { center: Point; panTool: boolean };
// Keyboard navigation moves a modest screen-space distance, independent of pixel zoom.
const KEY_PAN_PIXELS = 32;

export function createArtworkViewport(
  lifetime: EditorLifetime,
  canvas: HTMLCanvasElement,
  ports: {
    available: () => boolean;
    drawing: () => boolean;
    tool: () => PixelTool;
    view: () => View | null;
    zoom?: (direction: number) => void;
  },
) {
  const viewport = element('art-viewport', HTMLElement);
  const stage = element('art-stage', HTMLElement);
  const target = element('art-target', HTMLElement);
  const panButton = button('art-pan');
  let geometry = '';
  let layoutKey = '';
  let size = { width: 0, height: 0 };
  let gutter = { x: 0, y: 0 };
  let space = false;
  let panTool = false;
  let pan: { pointer: number; x: number; y: number; left: number; top: number } | null = null;
  let hover: Point | null = null;
  let frame: number | undefined;

  function hideTarget() {
    hover = null;
    target.hidden = true;
    if (frame !== undefined) {
      lifetime.cancelFrame(frame);
      frame = undefined;
    }
  }
  function cursor() {
    viewport.style.cursor = pan ? 'grabbing' : space || panTool ? 'grab' : '';
    canvas.style.cursor =
      pan || space || panTool ? 'inherit' : ports.tool() === 'move' ? 'move' : 'crosshair';
    panButton.setAttribute('aria-pressed', String(panTool));
  }
  /** Shared conversion for hover and drawing; only captured drawing clamps at edges. */
  function point(event: Point, clamp = false): Point | null {
    const view = ports.view();
    const rect = canvas.getBoundingClientRect();
    if (!view || !rect.width || !rect.height) {
      return null;
    }
    let x = Math.floor(((event.x - rect.left) / rect.width) * view.width);
    let y = Math.floor(((event.y - rect.top) / rect.height) * view.height);
    if (clamp) {
      x = Math.max(0, Math.min(view.width - 1, x));
      y = Math.max(0, Math.min(view.height - 1, y));
    } else if (x < 0 || y < 0 || x >= view.width || y >= view.height) {
      return null;
    }
    return { x: x + view.x, y: y + view.y };
  }
  function paintTarget() {
    frame = undefined;
    const view = ports.view();
    const p = hover && point(hover);
    if (!ports.available() || ports.drawing() || pan || space || panTool || !view || !p) {
      target.hidden = true;
      return;
    }
    // Move selection targets a displacement, not a single writable pixel.
    if (ports.tool() === 'move') {
      target.hidden = true;
      return;
    }
    const scaleX = canvas.offsetWidth / view.width;
    const scaleY = canvas.offsetHeight / view.height;
    target.style.left = `${gutter.x + (p.x - view.x) * scaleX}px`;
    target.style.top = `${gutter.y + (p.y - view.y) * scaleY}px`;
    target.style.width = `${scaleX}px`;
    target.style.height = `${scaleY}px`;
    target.dataset.x = String(p.x);
    target.dataset.y = String(p.y);
    target.dataset.tool = ports.tool();
    target.hidden = false;
  }
  function scheduleTarget() {
    if (frame === undefined) {
      frame = lifetime.frame(paintTarget);
    }
  }
  function center(): Point {
    return {
      x: (viewport.scrollLeft + gutter.x / 2 - gutter.x) / (size.width || 1),
      y: (viewport.scrollTop + gutter.y / 2 - gutter.y) / (size.height || 1),
    };
  }
  function position(p: Point) {
    viewport.scrollTo(
      gutter.x + p.x * canvas.offsetWidth - viewport.clientWidth / 2,
      gutter.y + p.y * canvas.offsetHeight - viewport.clientHeight / 2,
    );
  }
  function layout(reset = false) {
    const view = ports.view();
    if (lifetime.disposed || !view || !viewport.clientWidth || !viewport.clientHeight) {
      return;
    }
    const next = `${view.x},${view.y},${view.width},${view.height}`;
    const key = `${next},${canvas.offsetWidth},${canvas.offsetHeight},${viewport.clientWidth},${viewport.clientHeight}`;
    if (!reset && layoutKey === key) {
      return;
    }
    const p = reset || next !== geometry ? { x: 0.5, y: 0.5 } : center();
    geometry = next;
    layoutKey = key;
    size = { width: canvas.offsetWidth, height: canvas.offsetHeight };
    // A viewport of surrounding space on each side also lets fitting artwork pan.
    gutter = { x: viewport.clientWidth, y: viewport.clientHeight };
    stage.style.width = `${canvas.offsetWidth + 2 * gutter.x}px`;
    stage.style.height = `${canvas.offsetHeight + 2 * gutter.y}px`;
    canvas.style.left = `${gutter.x}px`;
    canvas.style.top = `${gutter.y}px`;
    const pixelGrid = stage.querySelector<HTMLElement>('#art-pixel-grid');
    if (pixelGrid) {
      pixelGrid.style.left = canvas.style.left;
      pixelGrid.style.top = canvas.style.top;
    }
    position(p);
    hideTarget();
  }
  function cancelPan() {
    const pointer = pan?.pointer;
    pan = null;
    if (pointer !== undefined && viewport.hasPointerCapture(pointer)) {
      viewport.releasePointerCapture(pointer);
    }
    hideTarget();
    cursor();
  }
  function suspend() {
    space = false;
    cancelPan();
  }
  lifetime.assign(panButton, 'onclick', () => {
    if (!ports.available() || ports.drawing()) {
      return;
    }
    panTool = !panTool;
    hideTarget();
    cursor();
    canvas.focus({ preventScroll: true });
  });
  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !ports.available() ||
        ports.drawing() ||
        pan ||
        !(event.button === 1 || (event.button === 0 && (space || panTool)))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      canvas.focus({ preventScroll: true });
      pan = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      hideTarget();
      lifetime.capture(viewport, event.pointerId);
      cursor();
    },
    { capture: true, signal: lifetime.signal },
  );
  viewport.addEventListener(
    'pointermove',
    (event) => {
      if (pan?.pointer === event.pointerId) {
        viewport.scrollTo(pan.left + pan.x - event.clientX, pan.top + pan.y - event.clientY);
      } else {
        hover = { x: event.clientX, y: event.clientY };
        scheduleTarget();
      }
    },
    { signal: lifetime.signal },
  );
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    viewport.addEventListener(
      name,
      (event) => {
        if (pan?.pointer === event.pointerId) {
          cancelPan();
        } else if (name !== 'pointerup') {
          hideTarget();
        }
      },
      { signal: lifetime.signal },
    );
  }
  viewport.addEventListener('pointerleave', hideTarget, { signal: lifetime.signal });
  viewport.addEventListener('scroll', scheduleTarget, { signal: lifetime.signal });
  let wheelDelta = 0;
  let wheelTime = 0;
  viewport.addEventListener(
    'wheel',
    (event) => {
      // Ctrl-wheel is also how browsers report trackpad pinch. Leave page zoom to the browser.
      if (!ports.available() || !ports.zoom || event.ctrlKey || event.metaKey) {
        return;
      }
      event.preventDefault();
      if (ports.drawing() || pan) {
        return;
      }
      const now = performance.now();
      if (now - wheelTime > 200) {
        wheelDelta = 0;
      }
      wheelTime = now;
      wheelDelta +=
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      if (Math.abs(wheelDelta) < 40) {
        return;
      }
      const direction = Math.sign(wheelDelta);
      wheelDelta = 0;
      const before = canvas.getBoundingClientRect();
      const x = (event.clientX - before.left) / before.width;
      const y = (event.clientY - before.top) / before.height;
      ports.zoom(direction);
      layout();
      const after = canvas.getBoundingClientRect();
      viewport.scrollBy(
        after.left + x * after.width - event.clientX,
        after.top + y * after.height - event.clientY,
      );
      hideTarget();
    },
    { passive: false, signal: lifetime.signal },
  );
  viewport.addEventListener(
    'keydown',
    (event) => {
      if (event.target !== canvas || !ports.available()) {
        return;
      }
      if (event.code === 'Space' && !ports.drawing()) {
        event.preventDefault();
        event.stopPropagation();
        space = true;
        hideTarget();
        cursor();
      } else if (event.key === 'Escape' && (pan || space || panTool)) {
        event.preventDefault();
        event.stopPropagation();
        panTool = false;
        suspend();
      } else if ((panTool || space) && event.key.startsWith('Arrow')) {
        event.preventDefault();
        event.stopPropagation();
        viewport.scrollBy(
          event.key === 'ArrowLeft'
            ? -KEY_PAN_PIXELS
            : event.key === 'ArrowRight'
              ? KEY_PAN_PIXELS
              : 0,
          event.key === 'ArrowUp'
            ? -KEY_PAN_PIXELS
            : event.key === 'ArrowDown'
              ? KEY_PAN_PIXELS
              : 0,
        );
      }
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.code === 'Space') {
        space = false;
        cancelPan();
      }
    },
    { signal: lifetime.signal },
  );
  window.addEventListener('blur', suspend, { signal: lifetime.signal });
  viewport.addEventListener(
    'focusout',
    () => {
      space = false;
      cancelPan();
    },
    { signal: lifetime.signal },
  );
  const resize = new ResizeObserver(() => layout());
  resize.observe(viewport);
  lifetime.cleanup(() => {
    resize.disconnect();
    suspend();
  });
  return {
    point,
    layout,
    hideTarget,
    suspend,
    cursor,
    remember(): ArtworkViewState | null {
      // Hidden viewports report zero scroll offsets; retain the last visible snapshot.
      if (!viewport.clientWidth || !viewport.clientHeight) {
        return null;
      }
      return { center: center(), panTool };
    },
    restore(state: ArtworkViewState) {
      layout();
      position(state.center);
      panTool = state.panTool;
      cursor();
    },
    authoringTool() {
      panTool = false;
      suspend();
    },
  };
}
