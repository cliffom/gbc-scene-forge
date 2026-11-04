/** Captured artwork strokes and tool input, bound to the model that began each gesture. */
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { Color, PixelModel, PixelTool, Point } from './pixel-model.mts';

export function createArtworkGestures(
  lifetime: EditorLifetime,
  surface: HTMLElement,
  canvas: HTMLCanvasElement,
  ports: {
    current: () => PixelModel | null;
    available: () => boolean;
    point: (client: Point) => Point | null;
    color: () => Color;
    chooseColor: (color: Color) => void;
    authoringTool: () => void;
    hideTarget: () => void;
    paint: (gestureOnly?: boolean) => void;
    mutate: (work: () => void) => void;
    changed: () => void;
    error: (error: unknown) => void;
  },
) {
  let gesture: {
    pointer: number;
    start: Point;
    last: Point;
    tool: PixelTool;
    model: PixelModel;
  } | null = null;
  function cancel() {
    ports.hideTarget();
    if (!gesture) {
      return;
    }
    const { pointer, model } = gesture;
    gesture = null;
    model.cancel();
    if (canvas.hasPointerCapture(pointer)) {
      canvas.releasePointerCapture(pointer);
    }
    ports.paint();
  }
  function point(event: PointerEvent): Point {
    const p = ports.point({ x: event.clientX, y: event.clientY });
    if (!p) {
      throw Error('Artwork viewport is unavailable.');
    }
    return p;
  }
  function tool(): PixelTool {
    const value = surface.querySelector<HTMLInputElement>('input[name=art-tool]:checked')?.value;
    switch (value) {
      case 'pencil':
      case 'erase':
      case 'fill':
      case 'pick':
      case 'line':
      case 'rectangle':
      case 'select':
      case 'move':
        return value;
      default:
        throw Error('Unknown pixel tool');
    }
  }
  for (const control of surface.querySelectorAll<HTMLInputElement>('input[name=art-tool]')) {
    lifetime.assign(control, 'onchange', () => {
      cancel();
      ports.authoringTool();
    });
    lifetime.assign(control, 'onclick', (event) => {
      ports.authoringTool();
      if (event.detail > 0) {
        canvas.focus({ preventScroll: true });
      }
    });
  }
  function preview(p: Point) {
    const model = ports.current(),
      g = gesture;
    if (!model || !g || model !== g.model) {
      cancel();
      return;
    }
    if (g.tool === 'pencil' || g.tool === 'erase') {
      model.line(g.last, p, g.tool === 'erase' ? [0, 0, 0, 0] : ports.color());
    } else if (g.tool === 'line' || g.tool === 'rectangle') {
      model.cancel();
      model.begin();
      model[g.tool](g.start, p, ports.color());
    } else if (g.tool === 'select') {
      model.select(g.start, p);
    }
    g.last = p;
    ports.paint(true);
  }
  lifetime.assign(canvas, 'onpointerdown', (event) => {
    const model = ports.current();
    if (!ports.available() || !model || event.button !== 0 || gesture) {
      return;
    }
    event.preventDefault();
    ports.hideTarget();
    canvas.focus({ preventScroll: true });
    try {
      const p = point(event),
        t = tool();
      if (t === 'pick') {
        ports.chooseColor(model.color(p));
        return;
      }
      if (t === 'fill') {
        ports.mutate(() => model.fill(p, ports.color()));
        return;
      }
      model.begin();
      gesture = { pointer: event.pointerId, start: p, last: p, tool: t, model };
      lifetime.capture(canvas, event.pointerId);
      preview(p);
    } catch (error) {
      cancel();
      ports.error(error);
    }
  });
  lifetime.assign(canvas, 'onpointermove', (event) => {
    if (gesture?.pointer === event.pointerId) {
      try {
        preview(point(event));
      } catch (error) {
        cancel();
        ports.error(error);
      }
    }
  });
  lifetime.assign(canvas, 'onpointerup', (event) => {
    if (gesture?.pointer !== event.pointerId) {
      return;
    }
    const model = ports.current();
    if (!model || gesture.model !== model) {
      cancel();
      return;
    }
    const g = gesture;
    try {
      const p = point(event);
      preview(p);
      if (g.tool === 'move') {
        model.move(p.x - g.start.x, p.y - g.start.y);
      }
      const didChange = model.finish();
      gesture = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (didChange) {
        ports.changed();
      } else {
        ports.paint();
      }
    } catch (error) {
      cancel();
      ports.error(error);
    }
  });
  lifetime.assign(canvas, 'onpointercancel', cancel);
  lifetime.assign(canvas, 'onlostpointercapture', cancel);
  window.addEventListener('blur', cancel, { signal: lifetime.signal });
  lifetime.cleanup(cancel);
  return {
    cancel,
    tool,
    get active() {
      return gesture !== null;
    },
  };
}
