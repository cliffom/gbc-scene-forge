/** Exact RGBA authoring/history. No DOM, transport or scene state. */
import { composite } from './artwork-layers.mts';
import { MAX_HISTORY_BYTES } from './artwork-limits.mts';
import { decodeDescriptor, type Candidate } from './artwork-contracts.mts';
export type Color = [number, number, number, number];
export type Point = { x: number; y: number };
export type Rectangle = Point & { width: number; height: number };
export type PixelTool =
  'pencil' | 'erase' | 'fill' | 'pick' | 'line' | 'rectangle' | 'select' | 'move';
export function bytes(encoded: string) {
  return Uint8ClampedArray.from(atob(encoded), (c) => c.charCodeAt(0));
}
export function encoded(pixels: Uint8ClampedArray) {
  const chunks: string[] = [];
  for (let i = 0; i < pixels.length; i += 8192) {
    chunks.push(String.fromCharCode(...pixels.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}
type PixelSnapshot = {
  pixels: Uint8ClampedArray;
  selection: Rectangle | null;
  descriptor: Candidate['descriptor'];
  layerState?: {
    active: string | null;
    rasters: Map<string, Uint8ClampedArray>;
    flat?: Uint8ClampedArray;
  };
};
type PixelHistory = Omit<PixelSnapshot, 'pixels'> & {
  chunks: { offset: number; bytes: Uint8ClampedArray }[];
};
export class PixelModel {
  readonly width: number;
  readonly height: number;
  pixels: Uint8ClampedArray;
  descriptor: Candidate['descriptor'];
  bounds: Rectangle | null = null;
  selection: Rectangle | null = null;
  clipboard: { width: number; height: number; pixels: Uint8ClampedArray } | null = null;
  readonly undoStack: PixelHistory[] = [];
  readonly redoStack: PixelHistory[] = [];
  private stroke: PixelSnapshot | null = null;
  activeLayer: string | null = null;
  private layerPixels = new Map<string, Uint8ClampedArray>();
  constructor(candidate: Candidate) {
    this.width = candidate.descriptor.width;
    this.height = candidate.descriptor.height;
    this.pixels = bytes(candidate.rgba);
    this.descriptor = structuredClone(candidate.descriptor);
    if (candidate.layer_rgba) {
      this.layerPixels = new Map(
        Object.entries(candidate.layer_rgba).map(([id, raw]) => [id, bytes(raw)]),
      );
      this.selectLayer(this.descriptor.layers?.items[0].id ?? '');
    }
  }
  layerData() {
    if (this.activeLayer) {
      this.layerPixels.set(this.activeLayer, this.pixels);
    }
    return new Map([...this.layerPixels].map(([id, pixels]) => [id, pixels.slice()]));
  }
  layerEncoding() {
    return Object.fromEntries([...this.layerData()].map(([id, pixels]) => [id, encoded(pixels)]));
  }
  composite() {
    return this.descriptor.layers ? composite(this.descriptor, this.layerData()) : this.pixels;
  }
  selectLayer(id: string) {
    if (this.activeLayer) {
      this.layerPixels.set(this.activeLayer, this.pixels);
    }
    const pixels = this.layerPixels.get(id);
    if (!pixels) {
      throw Error('Choose an existing layer.');
    }
    this.activeLayer = id;
    this.pixels = pixels;
  }
  setLayers(items: NonNullable<Candidate['descriptor']['layers']>['items']) {
    const d = decodeDescriptor({ ...this.descriptor, layers: { version: 1, items } });
    for (const [index, item] of (this.descriptor.layers?.items ?? []).entries()) {
      const proposed = items[index];
      if (
        item.locked &&
        (!proposed ||
          proposed.id !== item.id ||
          proposed.name !== item.name ||
          proposed.visible !== item.visible ||
          proposed.opacity !== item.opacity)
      ) {
        throw Error('Unlock a layer before removing, reordering or changing it.');
      }
    }
    if (!this.descriptor.layers) {
      this.layerPixels.set(items[0].id, this.pixels.slice());
    } else if (this.activeLayer) {
      this.layerPixels.set(this.activeLayer, this.pixels);
    }
    this.layerPixels = new Map(
      items.map((item) => [
        item.id,
        this.layerPixels.get(item.id) ?? new Uint8ClampedArray(this.pixels.length),
      ]),
    );
    this.descriptor = d;
    const previous = this.activeLayer;
    this.activeLayer = null;
    this.selectLayer(items.find((item) => item.id === previous)?.id ?? items[items.length - 1].id);
  }
  private restoreLayerState(state: PixelSnapshot['layerState']) {
    if (state) {
      this.layerPixels = new Map([...state.rasters].map(([id, p]) => [id, p.slice()]));
      this.activeLayer = null;
      if (state.active) {
        this.selectLayer(state.active);
      } else if (state.flat) {
        this.pixels = state.flat.slice();
      }
    } else {
      this.layerPixels.clear();
      this.activeLayer = null;
    }
  }
  retainSavedFrames(saved: Candidate['descriptor']) {
    if (saved.version !== 2) {
      return;
    }
    for (const stack of [this.undoStack, this.redoStack]) {
      for (let index = stack.length - 1; index >= 0; index--) {
        const snapshot = stack[index];
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
        try {
          decodeDescriptor(snapshot.descriptor);
        } catch {
          // Saved frame identities are mandatory. Skip states that no longer
          // fit the document limits, keeping valid history on either side.
          const older = stack[index - 1];
          if (older) {
            // Removing a state must bridge its pixel delta to the next surviving
            // state. This applies symmetrically to Undo and Redo stacks.
            const chunks = new Map(older.chunks.map((chunk) => [chunk.offset, chunk.bytes]));
            for (const chunk of snapshot.chunks) {
              const previous = chunks.get(chunk.offset);
              if (previous) {
                for (let i = 0; i < previous.length; i++) {
                  previous[i] ^= chunk.bytes[i];
                }
              } else {
                chunks.set(chunk.offset, chunk.bytes.slice());
              }
            }
            older.chunks = [...chunks]
              .filter(([, bytes]) => bytes.some((v) => v !== 0))
              .map(([offset, bytes]) => ({ offset, bytes }));
          }
          stack.splice(index, 1);
        }
      }
      // Saving a representation can turn its history entry into a no-op.
      // Keep earlier pixel/sequence edits reachable in a single Undo/Redo.
      let next = { descriptor: this.descriptor };
      for (let index = stack.length - 1; index >= 0; index--) {
        const snapshot = stack[index];
        if (
          snapshot.chunks.length === 0 &&
          !snapshot.layerState &&
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
    if (this.descriptor.layers?.items.find((i) => i.id === this.activeLayer)?.locked) {
      throw Error('Layer is locked.');
    }
    if (this.inside(p)) {
      this.pixels.set(color, (p.y * this.width + p.x) * 4);
    }
  }
  begin() {
    if (!this.stroke) {
      this.stroke = {
        pixels: this.pixels.slice(),
        layerState: this.activeLayer
          ? { active: this.activeLayer, rasters: this.layerData() }
          : undefined,
        descriptor: structuredClone(this.descriptor),
        selection: this.selection ? { ...this.selection } : null,
      };
    }
  }
  cancel() {
    if (this.stroke) {
      this.pixels = this.stroke.pixels;
      this.restoreLayerState(this.stroke.layerState);
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
    // XOR chunks are reversible and retain only changed 4 KiB blocks. A
    // single-pixel stroke on a large illustration no longer stores a full image.
    const chunks: PixelHistory['chunks'] = [];
    for (let offset = 0; offset < this.pixels.length; offset += 4096) {
      const end = Math.min(offset + 4096, this.pixels.length);
      let changed = false;
      for (let i = offset; i < end; i++) {
        if (this.pixels[i] !== before.pixels[i]) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        continue;
      }
      const bytes = before.pixels.slice(offset, end);
      for (let i = offset; i < end; i++) {
        bytes[i - offset] ^= this.pixels[i];
      }
      chunks.push({ offset, bytes });
    }
    this.undoStack.push({
      chunks: before.layerState?.active || this.activeLayer ? [] : chunks,
      layerState:
        before.layerState ??
        (this.activeLayer ? { active: null, rasters: new Map(), flat: before.pixels } : undefined),
      descriptor: before.descriptor,
      selection: before.selection,
    });
    this.redoStack.length = 0;
    let total = this.undoStack.reduce((sum, item) => sum + this.historyBytes(item), 0);
    while (this.undoStack.length > 100 || total > MAX_HISTORY_BYTES) {
      const removed = this.undoStack.shift();
      if (removed) {
        total -= this.historyBytes(removed);
      }
    }
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
  private historyBytes(value: PixelHistory) {
    return (
      (value.layerState?.flat?.byteLength ?? 0) +
      [...(value.layerState?.rasters.values() ?? [])].reduce((n, p) => n + p.byteLength, 0) +
      value.chunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength + 16, 0) +
      new TextEncoder().encode(JSON.stringify(value.descriptor)).length +
      64
    );
  }
  private travel(from: PixelHistory[], to: PixelHistory[]) {
    this.cancel();
    const value = from.pop();
    if (!value) {
      return;
    }
    to.push({
      chunks: value.chunks,
      layerState: value.layerState
        ? {
            active: this.activeLayer,
            rasters: this.layerData(),
            flat: this.activeLayer ? undefined : this.pixels.slice(),
          }
        : undefined,
      descriptor: structuredClone(this.descriptor),
      selection: this.selection ? { ...this.selection } : null,
    });
    for (const chunk of value.chunks) {
      for (let i = 0; i < chunk.bytes.length; i++) {
        this.pixels[chunk.offset + i] ^= chunk.bytes[i];
      }
    }
    this.descriptor = value.descriptor;
    this.restoreLayerState(value.layerState);
    this.selection = value.selection;
  }
  undo() {
    this.travel(this.undoStack, this.redoStack);
  }
  redo() {
    this.travel(this.redoStack, this.undoStack);
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
