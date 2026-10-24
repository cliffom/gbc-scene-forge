import type { Coordinate, EditorDescriptor, Scene, Selection } from './types.ts';
// Editing operations use native scene pixels and semantic cell identifiers.
export const clone = <T,>(value: T): T => structuredClone(value);

export function canvasPoint(
  event: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) {
  return {
    x: Math.floor(((event.clientX - rect.left) * width) / rect.width),
    y: Math.floor(((event.clientY - rect.top) * height) / rect.height),
  };
}

export class Editor {
  descriptor: EditorDescriptor;
  reasons: Map<string, string>;
  scene: Scene;
  locked: Set<string>;
  undoStack: Scene[] = [];
  redoStack: Scene[] = [];
  stroke: Scene | null = null;
  constructor(scene: Scene, locked: Coordinate[], descriptor: EditorDescriptor) {
    if (!descriptor?.erase_cell) {
      throw Error('Scene descriptor needs an erase cell.');
    }
    this.descriptor = descriptor;
    this.reasons = new Map((descriptor.constraints || []).map((c) => [`${c.x},${c.y}`, c.reason]));
    this.scene = clone(scene);
    this.locked = new Set(locked.map(([x, y]) => `${x},${y}`));
    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
  }
  get floor() {
    return this.descriptor.erase_cell;
  }
  begin() {
    if (this.stroke === null) {
      this.stroke = clone(this.scene);
    }
  }
  end() {
    if (this.stroke !== null && JSON.stringify(this.stroke) !== JSON.stringify(this.scene)) {
      this.undoStack.push(this.stroke);
      if (this.undoStack.length > 100) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }
    this.stroke = null;
  }
  cancel() {
    if (this.stroke !== null) {
      this.scene = this.stroke;
    }
    this.stroke = null;
  }
  change(callback: (scene: Scene) => void) {
    const own = this.stroke === null;
    if (own) {
      this.begin();
    }
    callback(this.scene);
    if (own) {
      this.end();
    }
  }
  check(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.scene.width || y >= this.scene.height) {
      throw Error('Placement is outside the scene.');
    }
    if (this.locked.has(`${x},${y}`)) {
      throw Error(this.reasons.get(`${x},${y}`) || 'This cell is fixed by the project.');
    }
  }
  stamp(x: number, y: number, cells: string[][]) {
    cells.forEach((row, dy) => row.forEach((_, dx) => this.check(x + dx, y + dy)));
    this.change((scene) =>
      cells.forEach((row, dy) =>
        row.forEach((cell, dx) => {
          scene.cells[y + dy][x + dx] = cell;
        }),
      ),
    );
  }
  fill(x: number, y: number, replacement: string) {
    this.check(x, y);
    const target = this.scene.cells[y][x];
    if (target === replacement) {
      return;
    }
    const found: Coordinate[] = [],
      seen = new Set<string>(),
      pending: Coordinate[] = [[x, y]];
    while (pending.length) {
      const next = pending.pop();
      if (!next) {
        break;
      }
      const [px, py] = next,
        key = `${px},${py}`;
      if (
        seen.has(key) ||
        this.locked.has(key) ||
        px < 0 ||
        py < 0 ||
        px >= this.scene.width ||
        py >= this.scene.height
      ) {
        continue;
      }
      seen.add(key);
      if (this.scene.cells[py][px] !== target) {
        continue;
      }
      found.push([px, py]);
      pending.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    this.change((scene) =>
      found.forEach(([px, py]) => {
        scene.cells[py][px] = replacement;
      }),
    );
  }
  move(selection: Selection, dx: number, dy: number) {
    const { x, y, w, h } = selection;
    const pixels = this.scene.cells.slice(y, y + h).map((row) => row.slice(x, x + w));
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        this.check(x + px, y + py);
        this.check(x + px + dx, y + py + dy);
      }
    }
    this.change((scene) => {
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          scene.cells[y + py][x + px] = this.floor;
        }
      }
      pixels.forEach((row, py) =>
        row.forEach((cell, px) => {
          scene.cells[y + dy + py][x + dx + px] = cell;
        }),
      );
    });
  }
  erase(selection: Selection) {
    const { x, y, w, h } = selection;
    this.stamp(
      x,
      y,
      Array.from({ length: h }, () => Array.from({ length: w }, () => this.floor)),
    );
  }
  undo() {
    const previous = this.undoStack.pop();
    if (!previous) {
      return;
    }
    this.redoStack.push(clone(this.scene));
    this.scene = previous;
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) {
      return;
    }
    this.undoStack.push(clone(this.scene));
    this.scene = next;
  }
}
