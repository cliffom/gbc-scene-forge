/** Exact RGBA authoring/history. No DOM, transport or scene state. */
import type { Candidate } from './artwork-contracts.mts';
export type Color = [number, number, number, number];
export type Point = { x: number; y: number };
export type Rectangle = Point & { width: number; height: number };
export type PixelTool =
  'pencil' | 'erase' | 'fill' | 'pick' | 'line' | 'rectangle' | 'select' | 'move';
export function bytes(encoded: string) {
  return Uint8ClampedArray.from(atob(encoded), (c) => c.charCodeAt(0));
}
export function encoded(pixels: Uint8ClampedArray) {
  let value = '';
  for (const byte of pixels) {
    value += String.fromCharCode(byte);
  }
  return btoa(value);
}
type PixelSnapshot = {
  pixels: Uint8ClampedArray;
  selection: Rectangle | null;
  descriptor: Candidate['descriptor'];
};
export class PixelModel {
  readonly width: number;
  readonly height: number;
  pixels: Uint8ClampedArray;
  descriptor: Candidate['descriptor'];
  bounds: Rectangle | null = null;
  selection: Rectangle | null = null;
  clipboard: { width: number; height: number; pixels: Uint8ClampedArray } | null = null;
  readonly undoStack: PixelSnapshot[] = [];
  readonly redoStack: PixelSnapshot[] = [];
  private stroke: PixelSnapshot | null = null;
  constructor(candidate: Candidate) {
    this.width = candidate.descriptor.width;
    this.height = candidate.descriptor.height;
    this.pixels = bytes(candidate.rgba);
    this.descriptor = structuredClone(candidate.descriptor);
  }
  retainSavedFrames(saved: Candidate['descriptor']) {
    if (saved.version !== 2) {
      return;
    }
    for (const stack of [this.undoStack, this.redoStack]) {
      for (const snapshot of stack) {
        if (snapshot.descriptor.version !== 2) {
          continue;
        }
        const frames = snapshot.descriptor.frames;
        for (const frame of saved.frames) {
          const index = frames.findIndex((previous) => previous.id === frame.id);
          if (index < 0) {
            frames.push(structuredClone(frame));
          } else {
            // Names remain undoable; acknowledged frame identity/geometry does not.
            frames[index] = { ...structuredClone(frame), name: frames[index].name };
          }
        }
      }
      // Saving a representation can turn its history entry into a no-op.
      // Keep earlier pixel/sequence edits reachable in a single Undo/Redo.
      let next = { pixels: this.pixels, descriptor: this.descriptor };
      for (let index = stack.length - 1; index >= 0; index--) {
        const snapshot = stack[index];
        if (
          snapshot.pixels.every((value, i) => value === next.pixels[i]) &&
          JSON.stringify(snapshot.descriptor) === JSON.stringify(next.descriptor)
        ) {
          stack.splice(index, 1);
        } else {
          next = snapshot;
        }
      }
    }
  }
  private inside(p: Point) {
    return (
      Number.isInteger(p.x) &&
      Number.isInteger(p.y) &&
      p.x >= 0 &&
      p.y >= 0 &&
      p.x < this.width &&
      p.y < this.height &&
      (!this.bounds ||
        (p.x >= this.bounds.x &&
          p.y >= this.bounds.y &&
          p.x < this.bounds.x + this.bounds.width &&
          p.y < this.bounds.y + this.bounds.height))
    );
  }
  color(p: Point): Color {
    if (!this.inside(p)) {
      throw Error('Choose a pixel inside the artwork.');
    }
    const offset = (p.y * this.width + p.x) * 4;
    return [
      this.pixels[offset],
      this.pixels[offset + 1],
      this.pixels[offset + 2],
      this.pixels[offset + 3],
    ];
  }
  put(p: Point, color: Color) {
    if (this.inside(p)) {
      this.pixels.set(color, (p.y * this.width + p.x) * 4);
    }
  }
  begin() {
    if (!this.stroke) {
      this.stroke = {
        pixels: this.pixels.slice(),
        descriptor: structuredClone(this.descriptor),
        selection: this.selection ? { ...this.selection } : null,
      };
    }
  }
  cancel() {
    if (this.stroke) {
      this.pixels = this.stroke.pixels;
      this.descriptor = this.stroke.descriptor;
      this.selection = this.stroke.selection;
      this.stroke = null;
    }
  }
  finish() {
    const before = this.stroke;
    this.stroke = null;
    if (
      !before ||
      (before.pixels.every((v, i) => v === this.pixels[i]) &&
        JSON.stringify(before.descriptor) === JSON.stringify(this.descriptor))
    ) {
      return false;
    }
    this.undoStack.push(before);
    while (
      this.undoStack.length > Math.min(100, Math.floor((16 * 1024 * 1024) / before.pixels.length))
    ) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    return true;
  }
  apply(work: () => void) {
    this.begin();
    try {
      work();
      return this.finish();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  undo() {
    this.cancel();
    const value = this.undoStack.pop();
    if (value) {
      this.redoStack.push({
        pixels: this.pixels,
        descriptor: structuredClone(this.descriptor),
        selection: this.selection ? { ...this.selection } : null,
      });
      this.pixels = value.pixels;
      this.descriptor = value.descriptor;
      this.selection = value.selection;
    }
  }
  redo() {
    this.cancel();
    const value = this.redoStack.pop();
    if (value) {
      this.undoStack.push({
        pixels: this.pixels,
        descriptor: structuredClone(this.descriptor),
        selection: this.selection ? { ...this.selection } : null,
      });
      this.pixels = value.pixels;
      this.descriptor = value.descriptor;
      this.selection = value.selection;
    }
  }
  line(a: Point, b: Point, color: Color) {
    let x = a.x,
      y = a.y;
    const dx = Math.abs(b.x - x),
      sx = x < b.x ? 1 : -1;
    const dy = -Math.abs(b.y - y),
      sy = y < b.y ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.put({ x, y }, color);
      if (x === b.x && y === b.y) {
        break;
      }
      const twice = 2 * error;
      if (twice >= dy) {
        error += dy;
        x += sx;
      }
      if (twice <= dx) {
        error += dx;
        y += sy;
      }
    }
  }
  rectangle(a: Point, b: Point, color: Color) {
    this.line(a, { x: b.x, y: a.y }, color);
    this.line({ x: b.x, y: a.y }, b, color);
    this.line(b, { x: a.x, y: b.y }, color);
    this.line({ x: a.x, y: b.y }, a, color);
  }
  fill(start: Point, color: Color) {
    const old = this.color(start);
    if (old.every((v, i) => v === color[i])) {
      return;
    }
    const pending = [start];
    const visited = new Uint8Array(this.width * this.height);
    while (pending.length) {
      const p = pending.pop();
      if (!p || !this.inside(p)) {
        continue;
      }
      const index = p.y * this.width + p.x;
      if (visited[index]) {
        continue;
      }
      visited[index] = 1;
      if (!this.color(p).every((v, i) => v === old[i])) {
        continue;
      }
      this.put(p, color);
      pending.push(
        { x: p.x - 1, y: p.y },
        { x: p.x + 1, y: p.y },
        { x: p.x, y: p.y - 1 },
        { x: p.x, y: p.y + 1 },
      );
    }
  }
  select(a: Point, b: Point) {
    this.selection = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x) + 1,
      height: Math.abs(a.y - b.y) + 1,
    };
  }
  private area() {
    return this.selection ?? this.bounds ?? { x: 0, y: 0, width: this.width, height: this.height };
  }
  copy() {
    const r = this.area(),
      pixels = new Uint8ClampedArray(r.width * r.height * 4);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        pixels.set(this.color({ x: r.x + x, y: r.y + y }), (y * r.width + x) * 4);
      }
    }
    this.clipboard = { width: r.width, height: r.height, pixels };
  }
  private fits(r: Rectangle) {
    if (!this.inside(r) || !this.inside({ x: r.x + r.width - 1, y: r.y + r.height - 1 })) {
      throw Error(
        'Selection would leave the artwork. Move it inside first or select a smaller area.',
      );
    }
  }
  private clear(r: Rectangle) {
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        this.put({ x, y }, [0, 0, 0, 0]);
      }
    }
  }
  paste(at = this.selection ?? this.bounds ?? { x: 0, y: 0 }) {
    const c = this.clipboard;
    if (!c) {
      return;
    }
    const r = { x: at.x, y: at.y, width: c.width, height: c.height };
    this.fits(r);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        this.put({ x: at.x + x, y: at.y + y }, [
          c.pixels[i],
          c.pixels[i + 1],
          c.pixels[i + 2],
          c.pixels[i + 3],
        ]);
      }
    }
    this.selection = r;
  }
  move(dx: number, dy: number) {
    const r = this.selection;
    if (!r) {
      throw Error('Select pixels before moving.');
    }
    this.fits({ ...r, x: r.x + dx, y: r.y + dy });
    const clipboard = this.clipboard;
    this.copy();
    this.clear(r);
    this.paste({ x: r.x + dx, y: r.y + dy });
    this.clipboard = clipboard;
  }
  transform(kind: 'horizontal' | 'vertical' | 'rotate') {
    const r = this.area(),
      before = this.pixels.slice();
    const width = kind === 'rotate' ? r.height : r.width,
      height = kind === 'rotate' ? r.width : r.height;
    const next = { ...r, width, height };
    this.fits(next);
    this.clear(r);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const nx =
          kind === 'horizontal' ? r.width - 1 - x : kind === 'rotate' ? r.height - 1 - y : x;
        const ny = kind === 'vertical' ? r.height - 1 - y : kind === 'rotate' ? x : y;
        const i = ((r.y + y) * this.width + r.x + x) * 4;
        this.put({ x: r.x + nx, y: r.y + ny }, [
          before[i],
          before[i + 1],
          before[i + 2],
          before[i + 3],
        ]);
      }
    }
    this.selection = next;
  }
}
