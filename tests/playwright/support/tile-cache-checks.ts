import { TileCache } from '../../../frontend/editor/tile-cache.mts';
import { tileContext, tileParts } from '../../../frontend/artwork/tile-transform.mts';
import type { SceneLayer } from '../../../frontend/scene/layers.mts';

/** Actual Canvas2D pixels: transforms/transparency, intermediate strokes and asset replacement. */
export async function checkTileCache() {
  const source = document.createElement('canvas');
  source.width = source.height = 8;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) {
    throw Error('source context');
  }
  sourceContext.fillStyle = '#f00';
  sourceContext.fillRect(0, 0, 4, 3);
  sourceContext.fillStyle = '#00f8';
  sourceContext.fillRect(4, 3, 4, 5);
  const image = new Image();
  image.src = source.toDataURL();
  await image.decode();
  sourceContext.fillStyle = '#0f0';
  sourceContext.fillRect(1, 1, 6, 6);
  const replacement = new Image();
  replacement.src = source.toDataURL();
  await replacement.decode();
  const regions = new Map([['tile', { image, x: 0, y: 0 }]]);
  const layers: Extract<SceneLayer, { type: 'tilelayer' }>[] = [1, 2].map((id) => ({
    id,
    name: String(id),
    visible: true,
    type: 'tilelayer',
    cells: Array.from({ length: 36 }, (_, y) =>
      Array.from({ length: 66 }, (_, x) => ((x + y + id) % 3 ? `tile#${((x + y) % 7) + 1}` : '')),
    ),
  }));
  const cached = document.createElement('canvas'),
    reference = document.createElement('canvas');
  cached.width = reference.width = 528;
  cached.height = reference.height = 288;
  const ctx = cached.getContext('2d'),
    ref = reference.getContext('2d');
  if (!ctx || !ref) {
    throw Error('context');
  }
  const cache = new TileCache();
  const checks: boolean[] = [];
  let rasterizations = 0;
  const rasterCanvases = new Set<HTMLCanvasElement>();
  const bitmapBytes = () =>
    [...rasterCanvases].reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0);
  const descriptor = Object.getOwnPropertyDescriptor(
    CanvasRenderingContext2D.prototype,
    'drawImage',
  );
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw Error('drawImage');
  }
  const value: unknown = descriptor.value;
  function isDrawImage(value: unknown): value is CanvasRenderingContext2D['drawImage'] {
    return typeof value === 'function';
  }
  if (!isDrawImage(value)) {
    throw Error('drawImage');
  }
  const native = value;
  CanvasRenderingContext2D.prototype.drawImage = new Proxy(native, {
    apply(
      target,
      receiver: CanvasRenderingContext2D,
      args: Parameters<CanvasRenderingContext2D['drawImage']>,
    ) {
      if (receiver.canvas !== cached && receiver.canvas !== reference) {
        rasterizations++;
        rasterCanvases.add(receiver.canvas);
      }
      return Reflect.apply(target, receiver, args);
    },
  });
  function paint(left: number, top: number, retain = true) {
    if (!ctx || !ref) {
      throw Error('context');
    }
    const view = { left, top, right: Math.min(528, left + 270), bottom: Math.min(288, top + 140) };
    for (const context of [ctx, ref]) {
      context.clearRect(0, 0, 528, 288);
      context.save();
      context.beginPath();
      context.rect(left, top, view.right - left, view.bottom - top);
      context.clip();
    }
    for (const layer of layers) {
      cache.draw(ctx, layer, 8, view, regions, retain);
      layer.cells.forEach((row, y) =>
        row.forEach((cell, x) => {
          const [asset, flags] = tileParts(cell);
          const region = regions.get(asset);
          if (region) {
            ref.save();
            ref.translate(x * 8, y * 8);
            tileContext(ref, flags, 8);
            ref.drawImage(region.image, 0, 0, 8, 8, 0, 0, 8, 8);
            ref.restore();
          }
        }),
      );
      // Dynamic object between transparent tile layers, including an offscreen origin.
      for (const context of [ctx, ref]) {
        context.fillStyle = '#0f08';
        context.fillRect(left - 7, top + 5, 21, 17);
      }
    }
    ctx.restore();
    ref.restore();
    checks.push(cached.toDataURL() === reference.toDataURL());
  }
  try {
    paint(0, 0);
    const cold = rasterizations;
    paint(0, 0);
    const warm = rasterizations - cold;
    layers[0].cells[2][2] = 'tile#7';
    paint(0, 0);
    layers[0].cells[2][2] = '';
    paint(0, 0); // cancelled stroke / undo
    regions.set('tile', { image: replacement, x: 0, y: 0 });
    paint(0, 0); // reimported region identity
    regions.delete('tile');
    paint(0, 0); // deletion
    regions.set('tile', { image, x: 0, y: 0 });
    layers.reverse();
    paint(0, 0);
    paint(255, 127);
    paint(257, 129, false);
    // Sweep enough chunks to evict, then revisit the original cells.
    for (let i = 0; i < 100; i++) {
      const layer = { ...layers[0], id: i + 10 };
      cache.draw(ctx, layer, 8, { left: 0, top: 0, right: 528, bottom: 288 }, regions);
    }
    const retainedBytes = bitmapBytes();
    paint(0, 0);
    cache.clear();
    const releasedBytes = bitmapBytes();
    paint(0, 0);
    return { checks, cold, warm, retainedBytes, releasedBytes, limit: cache.limit };
  } finally {
    CanvasRenderingContext2D.prototype.drawImage = native;
    cache.clear();
  }
}
