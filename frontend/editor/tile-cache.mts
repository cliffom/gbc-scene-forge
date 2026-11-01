import type { SceneLayer } from '../scene/layers.mts';
import { tileContext, tileParts } from '../artwork/tile-transform.mts';

type Region = { image: HTMLImageElement; x: number; y: number };
export interface ViewBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Scene coordinates from actual CSS geometry, with a one-pixel overscan. */
export function visibleBounds(canvas: HTMLCanvasElement, viewport: HTMLElement): ViewBounds {
  const c = canvas.getBoundingClientRect();
  const v = viewport.getBoundingClientRect();
  const x = canvas.width / c.width;
  const y = canvas.height / c.height;
  return {
    left: Math.max(0, Math.floor((v.left + viewport.clientLeft - c.left) * x) - 1),
    top: Math.max(0, Math.floor((v.top + viewport.clientTop - c.top) * y) - 1),
    right: Math.min(
      canvas.width,
      Math.ceil((v.left + viewport.clientLeft + viewport.clientWidth - c.left) * x) + 1,
    ),
    bottom: Math.min(
      canvas.height,
      Math.ceil((v.top + viewport.clientTop + viewport.clientHeight - c.top) * y) + 1,
    ),
  };
}

type Chunk = {
  canvas: HTMLCanvasElement;
  signature: string;
  regions: Map<string, Region | undefined>;
};

/** Transparent per-layer chunks preserve objects interleaved between tile layers. */
export class TileCache {
  private chunks = new Map<string, Chunk>();
  private bytes = 0;
  readonly limit = 16 * 1024 * 1024;
  clear() {
    for (const chunk of this.chunks.values()) {
      chunk.canvas.width = chunk.canvas.height = 0;
    }
    this.chunks.clear();
    this.bytes = 0;
  }
  draw(
    context: CanvasRenderingContext2D,
    layer: Extract<SceneLayer, { type: 'tilelayer' }>,
    size: number,
    view: ViewBounds,
    regions: ReadonlyMap<string, Region>,
    retain = true,
  ) {
    if (!retain) {
      for (
        let y = Math.max(0, Math.floor(view.top / size));
        y < Math.min(layer.cells.length, Math.ceil(view.bottom / size));
        y++
      ) {
        const row = layer.cells[y];
        for (
          let x = Math.max(0, Math.floor(view.left / size));
          x < Math.min(row.length, Math.ceil(view.right / size));
          x++
        ) {
          const [asset, flags] = tileParts(row[x]);
          const region = regions.get(asset);
          if (region) {
            context.save();
            context.translate(x * size, y * size);
            tileContext(context, flags, size);
            context.drawImage(region.image, region.x, region.y, size, size, 0, 0, size, size);
            context.restore();
          }
        }
      }
      return;
    }
    const step = Math.max(1, Math.floor(256 / size));
    const pixels = step * size;
    for (
      let cy = Math.max(0, Math.floor(view.top / pixels));
      cy < Math.ceil(view.bottom / pixels);
      cy++
    ) {
      for (
        let cx = Math.max(0, Math.floor(view.left / pixels));
        cx < Math.ceil(view.right / pixels);
        cx++
      ) {
        const rows = layer.cells
          .slice(cy * step, (cy + 1) * step)
          .map((row) => row.slice(cx * step, (cx + 1) * step));
        const signature = JSON.stringify(rows);
        const key = `${layer.id}:${size}:${cx}:${cy}`;
        let chunk = this.chunks.get(key);
        if (
          chunk &&
          (chunk.signature !== signature ||
            [...chunk.regions].some(([asset, region]) => regions.get(asset) !== region))
        ) {
          this.bytes -= chunk.canvas.width * chunk.canvas.height * 4;
          chunk.canvas.width = chunk.canvas.height = 0;
          this.chunks.delete(key);
          chunk = undefined;
        }
        if (!chunk) {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, ...rows.map((row) => row.length)) * size;
          canvas.height = Math.max(1, rows.length) * size;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw Error('Canvas context unavailable.');
          }
          ctx.imageSmoothingEnabled = false;
          const usedRegions = new Map<string, Region | undefined>();
          chunk = { canvas, signature, regions: usedRegions };
          rows.forEach((row, y) =>
            row.forEach((cell, x) => {
              const [asset, flags] = tileParts(cell);
              const region = regions.get(asset);
              usedRegions.set(asset, region);
              if (region) {
                ctx.save();
                ctx.translate(x * size, y * size);
                tileContext(ctx, flags, size);
                ctx.drawImage(region.image, region.x, region.y, size, size, 0, 0, size, size);
                ctx.restore();
              }
            }),
          );
          const bytes = canvas.width * canvas.height * 4;
          while (this.bytes + bytes > this.limit && this.chunks.size) {
            const oldest = this.chunks.keys().next().value;
            if (oldest === undefined) {
              break;
            }
            const entry = this.chunks.get(oldest);
            if (!entry) {
              break;
            }
            this.bytes -= entry.canvas.width * entry.canvas.height * 4;
            entry.canvas.width = entry.canvas.height = 0;
            this.chunks.delete(oldest);
          }
          this.bytes += bytes;
        }
        // Touch in LRU order, including entries created above.
        this.chunks.delete(key);
        this.chunks.set(key, chunk);
        context.drawImage(chunk.canvas, cx * pixels, cy * pixels);
      }
    }
  }
}
