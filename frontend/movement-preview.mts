/** Movement and geometry used only by transient previews. Coordinates are native pixels. */
import type { SpritePreviewSettings } from './preview-settings.mts';
import type { SceneLayer } from './layers.mts';
import type { SceneObject } from './objects.mts';
import type { CollisionShape, TileMetadata } from './tile-metadata.mts';

export interface PreviewPoint {
  x: number;
  y: number;
}
export interface PreviewRect extends PreviewPoint {
  width: number;
  height: number;
}
export interface PreviewWorld {
  width: number;
  height: number;
  blocked(rect: PreviewRect): boolean;
}
function overlaps(a: PreviewRect, b: PreviewRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function polygonOverlap(rect: PreviewRect, vertices: PreviewPoint[]) {
  // Clip to the footprint, then require positive area (touching edges are allowed).
  let points = vertices;
  for (const [axis, edge, sign] of [
    ['x', rect.x, 1],
    ['x', rect.x + rect.width, -1],
    ['y', rect.y, 1],
    ['y', rect.y + rect.height, -1],
  ] as const) {
    const result: PreviewPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const insideA = (a[axis] - edge) * sign >= 0;
      const insideB = (b[axis] - edge) * sign >= 0;
      if (insideA) {
        result.push(a);
      }
      if (insideA !== insideB) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    points = result;
  }
  const area = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0);
  return Math.abs(area) > 1e-8;
}
export function shapeOverlaps(rect: PreviewRect, shape: CollisionShape): boolean {
  if (shape.kind === 'polygon') {
    return polygonOverlap(
      rect,
      shape.points.map(([x, y]) => ({ x, y })),
    );
  }
  if (!overlaps(rect, shape)) {
    return false;
  }
  if (shape.kind === 'rectangle') {
    return true;
  }
  const rx = shape.width / 2,
    ry = shape.height / 2;
  const cx = shape.x + rx,
    cy = shape.y + ry;
  const x = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const y = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
}
export function metadataOverlaps(
  rect: PreviewRect,
  metadata: TileMetadata | undefined,
  bounds: PreviewRect,
): boolean {
  if (!metadata || !overlaps(rect, bounds)) {
    return false;
  }
  const local = { ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y };
  return metadata.shapes.length
    ? metadata.shapes.some((shape) => shapeOverlaps(local, shape))
    : metadata.solid;
}
/** Only visible artwork with collision metadata blocks a preview actor. */
export function sceneOverlaps(
  rect: PreviewRect,
  layers: SceneLayer[],
  grid: number,
  selectedId: string,
  metadata: (group: string, asset: string) => TileMetadata | undefined,
  bounds: (item: SceneObject) => PreviewRect,
): boolean {
  for (const layer of layers) {
    if (!layer.visible) {
      continue;
    }
    if (layer.type === 'tilelayer') {
      for (
        let y = Math.max(0, Math.floor(rect.y / grid));
        y <= Math.min(layer.cells.length - 1, Math.floor((rect.y + rect.height) / grid));
        y++
      ) {
        const row = layer.cells[y];
        for (
          let x = Math.max(0, Math.floor(rect.x / grid));
          x <= Math.min(row.length - 1, Math.floor((rect.x + rect.width) / grid));
          x++
        ) {
          if (
            metadataOverlaps(rect, metadata(String(grid), row[x]), {
              x: x * grid,
              y: y * grid,
              width: grid,
              height: grid,
            })
          ) {
            return true;
          }
        }
      }
    } else {
      for (const item of layer.objects) {
        if (
          item.kind === 'sprite' &&
          item.id !== selectedId &&
          metadataOverlaps(rect, metadata('sprites', item.asset), bounds(item))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
export function parsePreviewPath(text: string): PreviewPoint[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 128) {
    throw Error('Enter 1–128 waypoints, one X, Y pair per line.');
  }
  return lines.map((line) => {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length !== 2 || parts.some((part) => !part || !Number.isFinite(Number(part)))) {
      throw Error('Each waypoint needs two finite pixel coordinates: X, Y.');
    }
    return { x: Number(parts[0]), y: Number(parts[1]) };
  });
}
export class MovementPreview {
  position: PreviewPoint = { x: 0, y: 0 };
  footprint: PreviewRect = { x: -4, y: -4, width: 8, height: 8 };
  speed = 48;
  checkCollisions = false;
  path: PreviewPoint[] = [];
  direction: 'down' | 'left' | 'right' | 'up' = 'down';
  initialDirection: MovementPreview['direction'] = 'down';
  paused = false;
  moving = false;
  blocked = false;
  reset(start: PreviewPoint) {
    this.position = { ...start };
    this.direction = this.initialDirection;
    this.paused = false;
    this.path = [];
    this.moving = false;
    this.blocked = false;
  }
  bounds(position = this.position): PreviewRect {
    return {
      ...this.footprint,
      x: position.x + this.footprint.x,
      y: position.y + this.footprint.y,
    };
  }
  advance(milliseconds: number, vector: PreviewPoint, world: PreviewWorld) {
    if (this.paused) {
      return;
    }
    this.moving = false;
    let budget = (this.speed * Math.max(0, Math.min(milliseconds, 100))) / 1000;
    const keyboard = vector.x !== 0 || vector.y !== 0;
    if (keyboard) {
      this.path = [];
    }
    while (budget > 1e-8) {
      const goal = this.path[0];
      const dx = keyboard ? vector.x : goal ? goal.x - this.position.x : 0;
      const dy = keyboard ? vector.y : goal ? goal.y - this.position.y : 0;
      const distance = Math.hypot(dx, dy);
      if (distance < 1e-8) {
        if (!goal) {
          break;
        }
        this.path.shift();
        continue;
      }
      this.direction =
        Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
      const step = Math.min(0.5, budget, keyboard ? Infinity : distance);
      const candidate = {
        x: this.position.x + (dx / distance) * step,
        y: this.position.y + (dy / distance) * step,
      };
      const rect = this.bounds(candidate);
      const before = this.bounds();
      // Swept substeps prevent thin obstacles from being skipped at high speeds.
      const swept = {
        x: Math.min(before.x, rect.x),
        y: Math.min(before.y, rect.y),
        width: rect.width + Math.abs(candidate.x - this.position.x),
        height: rect.height + Math.abs(candidate.y - this.position.y),
      };
      this.blocked = false;
      if (
        rect.x < 0 ||
        rect.y < 0 ||
        rect.x + rect.width > world.width ||
        rect.y + rect.height > world.height ||
        (this.checkCollisions && world.blocked(swept))
      ) {
        this.blocked = true;
        this.path = [];
        break;
      }
      this.position = candidate;
      this.moving = true;
      budget -= step;
    }
  }
}

export function createMovementPreview(changed: () => void) {
  function control<T extends HTMLElement>(id: string, type: new () => T): T {
    const element = document.getElementById(id);
    if (!(element instanceof type)) {
      throw Error(`Missing element ${id}`);
    }
    return element;
  }
  const enabled = control('preview-movement', HTMLInputElement);
  const speed = control('preview-move-speed', HTMLInputElement);
  const collision = control('preview-check-collision', HTMLInputElement);
  const path = control('preview-path', HTMLTextAreaElement);
  const status = control('preview-position', HTMLElement);
  const follow = control('preview-follow-path', HTMLButtonElement);
  const reset = control('preview-reset-position', HTMLButtonElement);
  const pause = control('preview-pause-movement', HTMLButtonElement);
  const fields = ['x', 'y', 'width', 'height'].map((key) =>
    control(`preview-footprint-${key}`, HTMLInputElement),
  );
  const model = new MovementPreview();
  const keys = new Set<string>();
  let target: { key: string; start: PreviewPoint; world: PreviewWorld } | null = null;
  let signature = '';
  let error = '';
  function render() {
    const p = model.position;
    status.textContent =
      error ||
      `Preview X ${p.x.toFixed(1)}, Y ${p.y.toFixed(1)} · ${model.paused ? 'Paused' : model.blocked ? 'Blocked' : model.moving ? 'Walking' : 'Idle'}${model.path.length ? ` · ${model.path.length} waypoints left` : ''}`;
    follow.disabled = reset.disabled = pause.disabled = !enabled.checked;
    pause.textContent = model.paused ? 'Resume movement' : 'Pause movement';
  }
  function clear() {
    keys.clear();
    if (target) {
      model.reset(target.start);
    }
    error = '';
  }
  enabled.onchange = () => {
    clear();
    settings();
  };
  pause.onclick = () => {
    keys.clear();
    model.paused = !model.paused;
    render();
    changed();
  };
  reset.onclick = () => {
    clear();
    render();
    changed();
  };
  function settings() {
    const values = fields.map((field) => Number(field.value));
    if (
      fields.some((field) => !field.value.trim()) ||
      values.some((n) => !Number.isFinite(n) || Math.abs(n) > 4096) ||
      values[2] <= 0 ||
      values[3] <= 0 ||
      !speed.value.trim() ||
      !Number.isFinite(Number(speed.value)) ||
      Number(speed.value) < 1 ||
      Number(speed.value) > 512
    ) {
      enabled.checked = false;
      clear();
      error =
        'Use footprint offsets within ±4096 px, dimensions above 0 and up to 4096 px, and speed 1–512 px/s.';
    } else {
      model.footprint = { x: values[0], y: values[1], width: values[2], height: values[3] };
      model.speed = Number(speed.value);
      model.checkCollisions = collision.checked;
      error = '';
    }
    render();
    changed();
  }
  for (const field of [...fields, speed, collision]) {
    field.onchange = settings;
  }
  follow.onclick = () => {
    if (!enabled.checked || !target) {
      return;
    }
    keys.clear();
    model.path = [];
    try {
      const world = target.world;
      const points = parsePreviewPath(path.value);
      if (
        points.some(
          (point) => point.x < 0 || point.y < 0 || point.x > world.width || point.y > world.height,
        )
      ) {
        throw Error('Waypoints must be inside the scene.');
      }
      keys.clear();
      model.path = points;
      model.paused = false;
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    render();
    changed();
  };
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => {
    keys.clear();
    model.path = [];
    model.moving = false;
    changed();
  });
  document.addEventListener('visibilitychange', () => {
    keys.clear();
    model.path = [];
    model.moving = false;
  });
  return {
    preferences() {
      const values = fields.map((field) => Number(field.value));
      if (
        fields.some((field) => !field.value.trim()) ||
        values.some((n) => !Number.isFinite(n) || Math.abs(n) > 4096) ||
        values[2] <= 0 ||
        values[3] <= 0 ||
        !speed.value.trim() ||
        !Number.isFinite(Number(speed.value)) ||
        Number(speed.value) < 1 ||
        Number(speed.value) > 512
      ) {
        throw Error(
          'Enter valid footprint dimensions and movement speed before saving preview settings.',
        );
      }
      return {
        movement_speed: Number(speed.value),
        check_collisions: collision.checked,
        footprint: { x: values[0], y: values[1], width: values[2], height: values[3] },
      };
    },
    restore(settings: SpritePreviewSettings) {
      fields.forEach((field, index) => {
        field.value = String(
          [
            settings.footprint.x,
            settings.footprint.y,
            settings.footprint.width,
            settings.footprint.height,
          ][index],
        );
      });
      speed.value = String(settings.movement_speed);
      collision.checked = settings.check_collisions;
      model.footprint = { ...settings.footprint };
      model.speed = settings.movement_speed;
      model.checkCollisions = settings.check_collisions;
      enabled.checked = false;
      clear();
      render();
    },
    model,
    get active() {
      return enabled.checked && !!target;
    },
    configure(value: typeof target) {
      const nextSignature = value
        ? JSON.stringify([value.key, value.start, value.world.width, value.world.height])
        : '';
      target = value;
      if (signature !== nextSignature) {
        signature = nextSignature;
        enabled.checked = false;
        clear();
      }
      render();
    },
    keydown(event: KeyboardEvent) {
      if (!enabled.checked || !target) {
        return false;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        document.querySelector('dialog[open]')
      ) {
        return true;
      }
      const key = event.key.toLowerCase();
      if (
        ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(key) &&
        !model.paused &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        keys.add(key);
      }
      if (key === 'escape') {
        enabled.checked = false;
        clear();
        render();
        changed();
      }
      return true;
    },
    tick(milliseconds: number) {
      if (!enabled.checked || !target) {
        return;
      }
      if (document.querySelector('dialog[open]')) {
        keys.clear();
        model.path = [];
        model.moving = false;
        render();
        return;
      }
      const axis = (negative: string[], positive: string[]) =>
        Number(positive.some((k) => keys.has(k))) - Number(negative.some((k) => keys.has(k)));
      model.advance(
        milliseconds,
        {
          x: axis(['arrowleft', 'a'], ['arrowright', 'd']),
          y: axis(['arrowup', 'w'], ['arrowdown', 's']),
        },
        target.world,
      );
      render();
    },
    position(key: string) {
      return enabled.checked && target?.key === key ? model.position : undefined;
    },
    draw(ctx: CanvasRenderingContext2D, key: string) {
      if (!enabled.checked || target?.key !== key) {
        return;
      }
      ctx.save();
      ctx.strokeStyle = model.blocked ? '#ed886f' : '#83cfc1';
      ctx.lineWidth = 0.75;
      const rect = model.bounds();
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.beginPath();
      ctx.moveTo(model.position.x, model.position.y);
      for (const point of model.path) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
    },
    reset() {
      target = null;
      signature = '';
      enabled.checked = false;
      clear();
      render();
    },
  };
}
