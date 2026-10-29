import { EditorLifetime } from './editor-lifetime.mts';
/** Screen-resolution annotations; geometry and pointer hit testing stay on the pixel canvas. */
import { blockoutAppearance, cameraAxis, climbEndpoint } from './blockout.mts';
import type { ObjectDefinition } from './object-definitions.mts';
import type { SceneObject } from './objects.mts';

export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelCandidate extends LabelRect {
  id: string;
  text: string;
  color: string;
  priority: number;
}
export interface PlacedLabel extends LabelRect {
  candidate: LabelCandidate;
  text: string;
}
const HEIGHT = 24;
const GAP = 4;
export function intersects(a: LabelRect, b: LabelRect, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}
/** Selected, camera, markers, notes, geometry, then climb endpoint captions.
 * Bound the number of placed labels and candidate positions even on very dense maps.
 */
export function layoutLabels(
  candidates: LabelCandidate[],
  view: LabelRect,
  measure: (text: string) => number,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const maxWidth = Math.min(240, view.width - GAP * 2);
  if (maxWidth < 24 || view.height < HEIGHT + GAP * 2) {
    return placed;
  }
  for (const candidate of candidates.slice().sort((a, b) => a.priority - b.priority)) {
    if (!intersects(candidate, view)) {
      continue;
    }
    // Limit measurement work for author-provided names/notes; do not alter saved text.
    let text = [...candidate.text].slice(0, 160).join('');
    if (measure(text) + 20 > maxWidth || text.length < candidate.text.length) {
      let low = 0,
        high = [...text].length;
      const chars = [...text];
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (measure(chars.slice(0, mid).join('') + '…') + 20 <= maxWidth) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }
      text = chars.slice(0, low).join('') + '…';
    }
    const width = Math.min(maxWidth, Math.ceil(measure(text)) + 20);
    const anchorX = Math.max(view.x, candidate.x),
      anchorY = Math.max(view.y, candidate.y);
    for (const [dx, dy] of [
      [6, -HEIGHT - 6],
      [6, 6],
      [6, HEIGHT + 10],
      [6, -HEIGHT * 2 - 10],
      [-width - 6, 6],
    ]) {
      const rect = {
        x: Math.max(view.x + GAP, Math.min(anchorX + dx, view.x + view.width - width - GAP)),
        y: Math.max(view.y + GAP, Math.min(anchorY + dy, view.y + view.height - HEIGHT - GAP)),
        width,
        height: HEIGHT,
      };
      if (!placed.some((label) => intersects(label, rect, GAP))) {
        placed.push({ ...rect, candidate, text });
        break;
      }
    }
    if (placed.length >= 160) {
      break;
    }
  }
  return placed;
}

export function labelCandidates(
  objects: SceneObject[],
  definitions: ObjectDefinition[],
  selected: ReadonlySet<string>,
  zoom: number,
): LabelCandidate[] {
  return objects.flatMap((item): LabelCandidate[] => {
    const style = blockoutAppearance(item, definitions);
    if (!style) {
      return [];
    }
    let text = `${style.symbol} ${item.name || style.role}`;
    if (style.role === 'camera') {
      text += ` · X ${cameraAxis(style.properties.scroll_x)} / Y ${cameraAxis(style.properties.scroll_y)}`;
    }
    const priority = selected.has(item.id)
      ? 0
      : style.role === 'camera'
        ? 1
        : item.kind === 'point' && style.role !== 'note'
          ? 2
          : ['note', 'section'].includes(style.role)
            ? 3
            : 4;
    const candidate: LabelCandidate = {
      id: item.id,
      text,
      color: style.color,
      priority,
      x: (item.x - (item.kind === 'point' ? 5 : 0)) * zoom,
      y: (item.y - (item.kind === 'point' ? 5 : 0)) * zoom,
      width: (item.kind === 'rectangle' ? item.width : 10) * zoom,
      height: (item.kind === 'rectangle' ? item.height : 10) * zoom,
    };
    const result = [candidate];
    if (item.kind === 'rectangle' && style.role === 'climb') {
      for (const prefix of ['entry', 'exit'] as const) {
        const p = climbEndpoint(item, style.properties, prefix);
        result.push({
          ...candidate,
          id: `${item.id}-${prefix}`,
          text: prefix.toUpperCase(),
          priority: 5,
          x: p.x * zoom,
          y: p.y * zoom,
          width: 1,
          height: 1,
        });
      }
    }
    return result;
  });
}

export function createBlockoutLabels(
  canvas: HTMLCanvasElement,
  viewport: HTMLElement,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const wrapper = document.createElement('div');
  wrapper.className = 'scene-surface';
  canvas.before(wrapper);
  wrapper.append(canvas);
  const overlay = document.createElement('div');
  overlay.id = 'blockout-labels';
  overlay.setAttribute('aria-hidden', 'true');
  wrapper.append(overlay);
  lifetime.cleanup(() => {
    wrapper.before(canvas);
    wrapper.remove();
  });
  const measureContext = document.createElement('canvas').getContext('2d');
  let candidates: LabelCandidate[] = [];
  let pending = false;
  function schedule() {
    if (pending) {
      return;
    }
    pending = true;
    lifetime.frame(() => {
      pending = false;
      const scene = canvas.getBoundingClientRect(),
        port = viewport.getBoundingClientRect();
      const x = Math.max(0, port.left - scene.left),
        y = Math.max(0, port.top - scene.top);
      const view = {
        x,
        y,
        width: Math.min(scene.width, port.left + viewport.clientWidth - scene.left) - x,
        height: Math.min(scene.height, port.top + viewport.clientHeight - scene.top) - y,
      };
      if (!measureContext) {
        return;
      }
      measureContext.font = '500 13px system-ui, sans-serif';
      overlay.replaceChildren(
        ...layoutLabels(candidates, view, (text) => measureContext.measureText(text).width).map(
          (label) => {
            const node = document.createElement('span');
            node.className = 'blockout-label';
            node.dataset.objectId = label.candidate.id;
            node.dataset.priority = String(label.candidate.priority);
            node.textContent = label.text;
            node.style.left = `${label.x}px`;
            node.style.top = `${label.y}px`;
            node.style.width = `${label.width}px`;
            node.style.setProperty('--label-color', label.candidate.color);
            return node;
          },
        ),
      );
    });
  }
  viewport.addEventListener('scroll', schedule, { ...{ passive: true }, signal: lifetime.signal });
  const observer = lifetime.observe(new ResizeObserver(schedule));
  observer.observe(viewport);
  observer.observe(wrapper);
  return {
    update(next: LabelCandidate[]) {
      candidates = next;
      schedule();
    },
  };
}
