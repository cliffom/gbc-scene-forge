/** Blockout geometry is ordinary typed object data, shared with Tiled and scene history. */
import type { ObjectDefinition } from './object-definitions.mts';
import { resolveDefinition } from './object-definitions.mts';
import type { SceneObject } from './objects.mts';

export function cameraAxis(value: unknown) {
  return value === true ? 'scroll' : value === false ? 'fixed' : 'unverified';
}
export function blockoutDefinitions(definitions: ObjectDefinition[]) {
  return definitions.filter(
    (d) =>
      d.kind !== 'sprite' &&
      d.fields.some(
        (f) => f.name === 'blockout_role' && typeof f.default === 'string' && f.default.length > 0,
      ),
  );
}
export function blockoutAppearance(item: SceneObject, definitions: ObjectDefinition[]) {
  const properties = Object.fromEntries(
    resolveDefinition(item, definitions).properties.map((p) => [p.name, p.value]),
  );
  const role = properties.blockout_role;
  if (typeof role !== 'string' || !role || item.kind === 'sprite') {
    return null;
  }
  const rawColor = properties.blockout_color;
  return {
    role,
    properties,
    color: typeof rawColor === 'string' && /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#83cfc1',
    symbol: String(properties.blockout_symbol ?? '?').slice(0, 6),
    pattern: ['solid', 'one-way', 'waves', 'cross', 'ladder', 'outline'].includes(
      String(properties.blockout_pattern),
    )
      ? String(properties.blockout_pattern)
      : 'outline',
  };
}
export function definitionRole(definition: ObjectDefinition) {
  const role = definition.fields.find((f) => f.name === 'blockout_role')?.default;
  return typeof role === 'string' ? role : '';
}
export function blockoutLayer(role: string, kind: SceneObject['kind']) {
  return role === 'camera'
    ? 'Camera guides'
    : ['note', 'section'].includes(role)
      ? 'Design notes'
      : kind === 'point'
        ? 'Gameplay markers'
        : 'Blockout geometry';
}
export function dragRectangle(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
  step: number,
) {
  const x = Math.max(0, Math.min(width, Math.round(end.x / step) * step));
  const y = Math.max(0, Math.min(height, Math.round(end.y / step) * step));
  const left = Math.min(start.x, x),
    top = Math.min(start.y, y);
  return {
    x: left,
    y: top,
    width: Math.min(width - left, Math.max(1, step, Math.abs(x - start.x))),
    height: Math.min(height - top, Math.max(1, step, Math.abs(y - start.y))),
  };
}
export function resizeRectangle(
  item: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
  step: number,
) {
  return {
    width: Math.max(1, Math.min(width - item.x, Math.round(end.x / step) * step - item.x)),
    height: Math.max(1, Math.min(height - item.y, Math.round(end.y / step) * step - item.y)),
  };
}
export function climbEndpoint(
  item: { x: number; y: number; width: number; height: number },
  properties: Record<string, unknown>,
  prefix: 'entry' | 'exit',
) {
  const edge = properties[`${prefix}_edge`] ?? (prefix === 'entry' ? 'bottom' : 'top');
  const raw = properties[`${prefix}_offset`];
  const offset = typeof raw === 'number' && raw >= 0 && raw <= 1 ? raw : 0.5;
  return edge === 'left' || edge === 'right'
    ? { x: item.x + (edge === 'right' ? item.width : 0), y: item.y + item.height * offset }
    : { x: item.x + item.width * offset, y: item.y + (edge === 'bottom' ? item.height : 0) };
}
export function drawBlockout(
  context: CanvasRenderingContext2D,
  item: SceneObject,
  definitions: ObjectDefinition[],
): boolean {
  const style = blockoutAppearance(item, definitions);
  if (!style) {
    return false;
  }
  const { x, y } = item;
  context.save();
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.lineWidth = 1;
  if (style.pattern === 'outline' || style.pattern === 'one-way') {
    context.setLineDash([4, 3]);
  }
  if (item.kind === 'rectangle') {
    context.globalAlpha = style.pattern === 'outline' ? 0.08 : 0.28;
    context.fillRect(x, y, item.width, item.height);
    context.globalAlpha = 1;
    context.strokeRect(x + 0.5, y + 0.5, item.width - 1, item.height - 1);
    context.setLineDash([]);
    if (style.pattern === 'one-way') {
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x, y + 1);
      context.lineTo(x + item.width, y + 1);
      context.stroke();
    }
    if (['cross', 'ladder', 'waves'].includes(style.pattern)) {
      const step = Math.max(8, item.height / 16);
      context.globalAlpha = 0.6;
      for (let row = 0; row < Math.min(16, Math.floor(item.height / step)); row++) {
        const py = y + (row + 0.5) * step;
        context.beginPath();
        context.moveTo(x, py);
        if (style.pattern === 'waves') {
          context.quadraticCurveTo(x + item.width / 4, py - 4, x + item.width / 2, py);
          context.quadraticCurveTo(x + (3 * item.width) / 4, py + 4, x + item.width, py);
        } else {
          context.lineTo(x + item.width, py);
        }
        context.stroke();
      }
      if (style.pattern === 'cross') {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + item.width, y + item.height);
        context.moveTo(x, y + item.height);
        context.lineTo(x + item.width, y);
        context.stroke();
      }
      context.globalAlpha = 1;
    }
    if (style.role === 'climb') {
      for (const prefix of ['entry', 'exit'] as const) {
        const p = climbEndpoint(item, style.properties, prefix);
        context.beginPath();
        context.arc(p.x, p.y, 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  } else {
    context.beginPath();
    context.moveTo(x, y - 5);
    context.lineTo(x + 5, y);
    context.lineTo(x, y + 5);
    context.lineTo(x - 5, y);
    context.closePath();
    context.globalAlpha = 0.4;
    context.fill();
    context.globalAlpha = 1;
    context.stroke();
  }
  context.restore();
  return true;
}
