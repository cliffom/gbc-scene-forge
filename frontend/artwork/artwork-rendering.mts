/** Main artwork raster and overlays; sheet synchronization stays with the composition. */
import { MAX_ARTWORK_PIXELS } from './artwork-limits.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { ArtworkFrame } from './artwork-contracts.mts';
import type { ArtworkRaster } from './artwork-raster.mts';
import type { PixelModel } from './pixel-model.mts';

type View = Pick<ArtworkFrame, 'x' | 'y' | 'width' | 'height'>;
export function createArtworkRendering(
  lifetime: EditorLifetime,
  canvas: HTMLCanvasElement,
  raster: ArtworkRaster,
  ports: {
    current: () => PixelModel | null;
    view: () => View | null;
    selectedFrame: () => ArtworkFrame | null;
    zoom: () => number;
    onion: () => boolean;
    grid: () => boolean;
  },
) {
  const pixelGrid = canvas.parentElement?.querySelector<HTMLElement>('#art-pixel-grid');
  const context = canvas.getContext('2d');
  if (!context) {
    throw Error('Pixel canvas is unavailable.');
  }
  function clear() {
    canvas.width = canvas.height = 0;
  }
  lifetime.cleanup(clear);
  function draw() {
    const model = ports.current();
    if (!model || !context || lifetime.disposed) {
      return;
    }
    const displayZoom = ports.zoom();
    const view = ports.view() ?? { x: 0, y: 0, width: model.width, height: model.height };
    const zoom = Math.min(
      displayZoom,
      Math.max(1, Math.floor(4096 / Math.max(view.width, view.height))),
      Math.max(1, Math.floor(Math.sqrt(MAX_ARTWORK_PIXELS / (view.width * view.height)))),
    );
    const width = view.width * zoom,
      height = view.height * zoom;
    const displayWidth = view.width * displayZoom,
      displayHeight = view.height * displayZoom;
    if (pixelGrid) {
      pixelGrid.hidden = !ports.grid() || displayZoom < 4 || displayZoom === zoom;
      pixelGrid.style.width = `${displayWidth}px`;
      pixelGrid.style.height = `${displayHeight}px`;
      pixelGrid.style.backgroundSize = `${displayZoom}px ${displayZoom}px`;
    }
    if (canvas.width !== width) {
      canvas.width = Math.ceil(width);
    }
    if (canvas.height !== height) {
      canvas.height = Math.ceil(height);
    }
    if (canvas.style.width !== `${displayWidth}px`) {
      canvas.style.width = `${displayWidth}px`;
    }
    if (canvas.style.height !== `${displayHeight}px`) {
      canvas.style.height = `${displayHeight}px`;
    }
    // Reusing a canvas must reset alpha, dash, transform and transparent pixels.
    context.reset();
    const small = raster.canvas;
    context.imageSmoothingEnabled = false;
    if (ports.view() && ports.onion() && model.descriptor.version === 2) {
      const frames = model.descriptor.frames,
        current = ports.selectedFrame();
      const previous =
        frames[(frames.findIndex((f) => f.id === current?.id) + frames.length - 1) % frames.length];
      if (previous) {
        context.globalAlpha = 0.3;
        context.drawImage(
          small,
          previous.x,
          previous.y,
          previous.width,
          previous.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        context.globalAlpha = 1;
      }
    }
    context.drawImage(
      small,
      view.x,
      view.y,
      view.width,
      view.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    if (ports.grid() && zoom >= 4 && zoom === displayZoom) {
      context.strokeStyle = '#0005';
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= view.width; x++) {
        context.moveTo(x * zoom + 0.5, 0);
        context.lineTo(x * zoom + 0.5, canvas.height);
      }
      for (let y = 0; y <= view.height; y++) {
        context.moveTo(0, y * zoom + 0.5);
        context.lineTo(canvas.width, y * zoom + 0.5);
      }
      context.stroke();
    }
    if (model.selection) {
      const r = model.selection;
      context.strokeStyle = '#fff';
      context.setLineDash([4, 3]);
      context.lineWidth = 2;
      context.strokeRect(
        (r.x - view.x) * zoom + 1,
        (r.y - view.y) * zoom + 1,
        r.width * zoom - 2,
        r.height * zoom - 2,
      );
    }
    if (!ports.view() && model.descriptor.version === 2) {
      for (const f of model.descriptor.frames) {
        context.strokeStyle = f.id === ports.selectedFrame()?.id ? '#e5c46a' : '#ffffff55';
        context.strokeRect(
          f.x * zoom + 0.5,
          f.y * zoom + 0.5,
          f.width * zoom - 1,
          f.height * zoom - 1,
        );
      }
    }
    if (model.descriptor.version === 2) {
      const frames = ports.view() ? [ports.selectedFrame()] : model.descriptor.frames;
      context.setLineDash([]);
      context.strokeStyle = '#ff79c6';
      for (const frame of frames) {
        if (!frame || frame.kind !== 'sprite') {
          continue;
        }
        const x = (frame.x + frame.origin[0] - view.x + 0.5) * zoom;
        const y = (frame.y + frame.origin[1] - view.y + 0.5) * zoom;
        context.beginPath();
        context.moveTo(x - 5, y);
        context.lineTo(x + 5, y);
        context.moveTo(x, y - 5);
        context.lineTo(x, y + 5);
        context.stroke();
      }
    }
  }
  return { draw, clear };
}
